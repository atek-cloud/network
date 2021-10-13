import EventEmitter from 'events'
import { Duplex } from 'streamx'
import DHT, { Server, Socket, KeyPair } from '@hyperswarm/dht'
import MSS from 'multistream-select'
import Mplex from 'libp2p-mplex'
import pipe from 'it-pipe'
import toStream from 'it-to-stream'
import bl from 'bl'
import { toBase32 } from './util.js'

interface ItDuplex {
  source: AsyncIterable<any>
  sink: (it: AsyncIterable<any>) => Promise<void>
}

// globals
// =

let node: DHT | undefined = undefined
const activeNodes: AtekNode[] = []

// exported api
// =

export * as http from './http.js'

export async function setup (opts?: {bootstrap: string[]}): Promise<void> {
  if (node) throw new Error('Hyperswarm DHT already active')
  node = new DHT(opts)
  await node.ready()
}

export async function destroy () {
  if (node) {
    await node.destroy()
    node = undefined
  }
}

export function createKeypair (seed?: Buffer) {
  return DHT.keyPair(seed)
}

export interface AtekNodeProtocolHandler {
  (stream: Duplex, socket: AtekSocket): void|Promise<void>
}

export class AtekNode extends EventEmitter {
  sockets: Map<string, AtekSocket[]> = new Map()
  hyperswarmServer: Server|undefined
  protocols: Set<string> = new Set()
  protocolHandlers: Map<string, AtekNodeProtocolHandler> = new Map()
  constructor (public keyPair: KeyPair, protocols?: string|string[]) {
    super()
    if (protocols) this.addProtocols(protocols)
  }

  get isListening () {
    return !!this.hyperswarmServer
  }

  get publicKeyB32 () {
    return toBase32(this.keyPair.publicKey)
  }

  get httpHostname () {
    return `${this.publicKeyB32}.atek.app`
  }

  get httpUrl () {
    return `http://${this.httpHostname}`
  }

  async connect (remotePublicKey: Buffer): Promise<AtekSocket> {
    let atekSocket = this.getSocket(remotePublicKey)
    if (atekSocket) {
      return atekSocket
    }
    atekSocket = new AtekSocket(remotePublicKey, this.keyPair)
    await initOutboundSocket(this, atekSocket)
    this.addSocket(atekSocket)
    atekSocket.hyperswarmSocket?.on('close', () => {
      this.removeSocket(atekSocket)
    })
    return atekSocket
  }

  async listen (): Promise<void> {
    await initListener(this)
  }

  async close () {
    for (const socks of this.sockets.values()) {
      for (const sock of socks) {
        sock.close()
      }
    }
    this.sockets = new Map()

    await this.hyperswarmServer?.close()
    this.hyperswarmServer = undefined

    const i = findIndex(this.keyPair)
    if (i !== -1) activeNodes.splice(i, 1)
  }

  addProtocols (protocols: string|string[]) {
    for (const p of (Array.isArray(protocols) ? protocols : [protocols])) {
      this.protocols.add(p)
    }
  }

  removeProtocols (protocols: string|string[]) {
    for (const p of (Array.isArray(protocols) ? protocols : [protocols])) {
      this.protocols.delete(p)
    }
  }

  setProtocolHandler (protocol: string, handler: AtekNodeProtocolHandler) {
    this.addProtocols(protocol)
    this.protocolHandlers.set(protocol, handler)
  }

  removeProtocolHandler (protocol: string) {
    this.removeProtocols(protocol)
    this.protocolHandlers.delete(protocol)
  }

  getSocket (remotePublicKey: Buffer) {
    const remotePublicKeyB32 = toBase32(remotePublicKey)
    const arr = this.sockets.get(remotePublicKeyB32) || []
    return arr[0]
  }

  addSocket (atekSocket: AtekSocket) {
    const remotePublicKeyB32 = toBase32(atekSocket.remotePublicKey)
    const arr = this.sockets.get(remotePublicKeyB32) || []
    arr.push(atekSocket)
    this.sockets.set(remotePublicKeyB32, arr)
  }

  removeSocket (atekSocket: AtekSocket) {
    const remotePublicKeyB32 = toBase32(atekSocket.remotePublicKey)
    let arr = this.sockets.get(remotePublicKeyB32) || []
    arr = arr.filter(s => s !== atekSocket)
    this.sockets.set(remotePublicKeyB32, arr)
  }
}

export class AtekSocket extends EventEmitter {
  hyperswarmSocket: Socket|undefined
  muxer: Mplex|undefined
  constructor (public remotePublicKey: Buffer, public keyPair: KeyPair) {
    super()
  }

  get remotePublicKeyB32 () {
    return toBase32(this.remotePublicKey)
  }

  async close () {
    await this.hyperswarmSocket?.close()
    this.muxer = undefined
    this.hyperswarmSocket = undefined
  }
  
  async select (protocols: string[]): Promise<{protocol: string, stream: Duplex}> {
    if (!this.muxer) throw new Error('Error: this connection is not active')
    const muxedStream = this.muxer.newStream()
    const mss = new MSS.Dialer(muxedStream)
    const res = await mss.select(protocols)
    return {
      protocol: res.protocol,
      stream: toDuplex(res.stream)
    }
  }
}

// internal methods
// =

function findIndex (keyPair: KeyPair) {
  return activeNodes.findIndex(s => Buffer.compare(s.keyPair.publicKey, keyPair.publicKey) === 0)
}

async function initListener (atekNode: AtekNode) {
  if (!node) throw new Error('Cannot listen: Hyperswarm not active')
  if (atekNode.hyperswarmServer) return
  
  activeNodes.push(atekNode)

  atekNode.hyperswarmServer = node.createServer((hyperswarmSocket: Socket) => {
    const atekSocket = new AtekSocket(hyperswarmSocket.remotePublicKey, atekNode.keyPair)
    atekSocket.hyperswarmSocket = hyperswarmSocket
    initInboundSocket(atekNode, atekSocket)
    atekNode.addSocket(atekSocket)
    atekNode.emit('connection', atekSocket)
    hyperswarmSocket.on('close', () => {
      atekNode.removeSocket(atekSocket)
    })
  })

  await atekNode.hyperswarmServer.listen(atekNode.keyPair)
}

function initInboundSocket (atekNode: AtekNode, atekSocket: AtekSocket) {
  initSocket(atekNode, atekSocket)
}

async function initOutboundSocket (atekNode: AtekNode, atekSocket: AtekSocket) {
  if (!node) throw new Error('Cannot connect: Hyperswarm DHT not active')
  if (atekSocket.hyperswarmSocket) return

  const hyperswarmSocket = atekSocket.hyperswarmSocket = node.connect(atekSocket.remotePublicKey, {keyPair: atekSocket.keyPair})
  await new Promise((resolve, reject) => {
    hyperswarmSocket.on('open', resolve)
    hyperswarmSocket.on('close', resolve)
    hyperswarmSocket.on('error', reject)
  })

  initSocket(atekNode, atekSocket)
}

function initSocket (atekNode: AtekNode, atekSocket: AtekSocket) {
  if (!atekSocket.hyperswarmSocket) throw new Error('Hyperswarm Socket not initialized')
  atekSocket.muxer = new Mplex({
    onStream: async (stream: ItDuplex) => {
      try {
        const mss = new MSS.Listener(stream)
        const selection = await mss.handle(Array.from(atekNode.protocols))
        if (selection) {
          const handler = atekNode.protocolHandlers.get(selection.protocol)
          if (handler) {
            handler(toDuplex(selection.stream), atekSocket)
          } else {
            atekNode.emit('select', selection)
            atekSocket.emit('select', selection)
          }
        }
      } catch (e) {
        // TODO
        console.debug('Error handling connection', e)
        throw e
      }
    }
  })
  const hyperswarmSocketIter = toIterable(atekSocket.hyperswarmSocket)
  pipe(hyperswarmSocketIter, atekSocket.muxer, hyperswarmSocketIter)
}

function toIterable (socket: Socket) {
  return {
    sink: async (source: AsyncIterable<any>) => {
      try {
        for await (const chunk of source) {
          if (bl.isBufferList(chunk)) {
            socket.write(chunk.slice())
          } else {
            socket.write(chunk)
          }
        }
      } catch (err: any) {
        return socket.destroy(err.code === 'ABORT_ERR' ? null : err)
      }
      socket.end()
    },
    source: socket
  }
}

function toDuplex (it: ItDuplex): Duplex {
  return toStream.duplex({
    sink: it.sink,
    source: pipe(it.source, (source) => {
      return (async function * () {
        for await (const chunk of source) {
          if (bl.isBufferList(chunk)) {
            yield chunk.slice()
          } else {
            yield chunk
          }
        }
      })()
    })
  })
}