import EventEmitter from 'events'
import { Duplex } from 'streamx'
import DHT, { Server, Socket, KeyPair } from '@hyperswarm/dht'
import { toBase32 } from './util.js'

// globals
// =

let node: DHT | undefined = undefined
const activeNodes: Node[] = []

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

export class Node extends EventEmitter {
  sockets: Map<string, AtekSocket[]> = new Map()
  hyperswarmServer: Server|undefined
  protocolHandlers: Map<string, AtekNodeProtocolHandler> = new Map()
  constructor (public keyPair: KeyPair) {
    super()
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

  async connect (remotePublicKey: Buffer, protocol?: string): Promise<AtekSocket> {
    const atekSocket = new AtekSocket({
      remotePublicKey,
      keyPair: this.keyPair,
      client: true,
      protocol
    })
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

  setProtocolHandler (protocol: string|AtekNodeProtocolHandler, handler?: AtekNodeProtocolHandler) {
    if (typeof protocol === 'string' && handler) {
      protocol = '*' // TODO: temporary hack until https://github.com/hyperswarm/dht/issues/57 lands
      this.protocolHandlers.set(protocol, handler)
    } else if (typeof protocol !== 'string') {
      this.protocolHandlers.set('*', protocol)
    }
  }

  removeProtocolHandler (protocol = '*') {
    this.protocolHandlers.delete(protocol)
  }

  getSocket (remotePublicKey: Buffer) {
    return this.getAllSockets(remotePublicKey)[0]
  }

  getAllSockets (remotePublicKey: Buffer) {
    const remotePublicKeyB32 = toBase32(remotePublicKey)
    return this.sockets.get(remotePublicKeyB32) || []
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
  remotePublicKey: Buffer
  keyPair: KeyPair
  client: boolean
  server: boolean
  protocol: string|undefined
  hyperswarmSocket: Socket|undefined
  // muxer: Mplex|undefined
  constructor (opts: {remotePublicKey: Buffer, keyPair: KeyPair, client?: boolean, server?: boolean, protocol?: string}) {
    super()
    this.remotePublicKey = opts.remotePublicKey
    this.keyPair = opts.keyPair
    this.client = opts.client || false
    this.server = opts.server || false
    this.protocol = opts.protocol || '*'
  }

  get remotePublicKeyB32 () {
    return toBase32(this.remotePublicKey)
  }

  get stream () {
    return this.hyperswarmSocket
  }

  async close () {
    await this.hyperswarmSocket?.close()
    // this.muxer = undefined
    this.hyperswarmSocket = undefined
  }
  
  // async select (protocols: string[]): Promise<{protocol: string, stream: Duplex}> {
  //   if (!this.muxer) throw new Error('Error: this connection is not active')
  //   const muxedStream = this.muxer.newStream()
  //   const mss = new MSS.Dialer(muxedStream)
  //   const res = await mss.select(protocols)
  //   return {
  //     protocol: res.protocol,
  //     stream: toDuplex(res.stream)
  //   }
  // }
}

// internal methods
// =

function findIndex (keyPair: KeyPair) {
  return activeNodes.findIndex(s => Buffer.compare(s.keyPair.publicKey, keyPair.publicKey) === 0)
}

async function initListener (atekNode: Node) {
  if (!node) throw new Error('Cannot listen: Hyperswarm not active')
  if (atekNode.hyperswarmServer) return
  
  activeNodes.push(atekNode)

  atekNode.hyperswarmServer = node.createServer((hyperswarmSocket: Socket) => {
    const atekSocket = new AtekSocket({
      remotePublicKey: hyperswarmSocket.remotePublicKey,
      keyPair: atekNode.keyPair,
      server: true
    })
    atekSocket.hyperswarmSocket = hyperswarmSocket
    initInboundSocket(atekNode, atekSocket)
    atekNode.addSocket(atekSocket)
    atekNode.emit('connection', atekSocket)
    hyperswarmSocket.once('close', () => {
      atekNode.removeSocket(atekSocket)
    })
  })

  await atekNode.hyperswarmServer.listen(atekNode.keyPair)
}

function initInboundSocket (atekNode: Node, atekSocket: AtekSocket) {
  if (!atekSocket.hyperswarmSocket) throw new Error('Hyperswarm Socket not initialized')
  initSocket(atekNode, atekSocket)

  const protocol = '*' // TODO: waiting on handshake userData buffer (https://github.com/hyperswarm/dht/issues/57)
  const handler = atekNode.protocolHandlers.get(protocol) || atekNode.protocolHandlers.get('*')
  if (handler) {
    handler(atekSocket.hyperswarmSocket, atekSocket)
  } else {
    atekNode.emit('select', {protocol, stream: atekSocket.hyperswarmSocket}, atekSocket)
    atekSocket.emit('select', {protocol, stream: atekSocket.hyperswarmSocket})
  }
}

async function initOutboundSocket (atekNode: Node, atekSocket: AtekSocket) {
  if (!node) throw new Error('Cannot connect: Hyperswarm DHT not active')
  if (atekSocket.hyperswarmSocket) return

  const hyperswarmSocket = atekSocket.hyperswarmSocket = node.connect(atekSocket.remotePublicKey, {keyPair: atekSocket.keyPair})
  await new Promise((resolve, reject) => {
    hyperswarmSocket.once('open', () => resolve(undefined))
    hyperswarmSocket.once('close', () => resolve(undefined))
    hyperswarmSocket.once('error', reject)
  })

  initSocket(atekNode, atekSocket)
}

function initSocket (atekNode: Node, atekSocket: AtekSocket) {
  if (!atekSocket.hyperswarmSocket) throw new Error('Hyperswarm Socket not initialized')

  // HACK
  // there are some nodejs stream features that are missing from streamx's Duplex
  // we're going to see if it's a problem to just noop them
  // cork and uncork, for instance, are optimizations that we can probably live without
  // -prf
  // @ts-ignore Duck-typing to match what is expected
  atekSocket.hyperswarmSocket.cork = noop
  // @ts-ignore Duck-typing to match what is expected
  atekSocket.hyperswarmSocket.uncork = noop
  // @ts-ignore Duck-typing to match what is expected
  atekSocket.hyperswarmSocket.setTimeout = noop
  
  // HACK
  // this is a specific issue that's waiting on https://github.com/streamxorg/streamx/pull/46
  // -prf
  // @ts-ignore Monkey patchin'
  atekSocket.hyperswarmSocket._ended = false
  const _end = atekSocket.hyperswarmSocket.end
  atekSocket.hyperswarmSocket.end = function (data: any) {
    _end.call(this, data)
    // @ts-ignore Monkey patchin'
    this._ended = true
  }
  Object.defineProperty(atekSocket.hyperswarmSocket, 'writable', {
    get() {
      return !this._ended && this._writableState !== null ? true : undefined
    }
  })

  atekSocket.hyperswarmSocket.once('close', () => {
    atekSocket.emit('close')
  })

  // atekSocket.muxer = new Mplex({
  //   onStream: async (stream: ItDuplex) => {
  //     try {
  //       const mss = new MSS.Listener(stream)
  //       const selection = await mss.handle(Array.from(atekNode.protocols))
  //       if (selection) {
  //         const handler = atekNode.protocolHandlers.get(selection.protocol)
  //         const duplexStream = toDuplex(selection.stream)
  //         if (handler) {
  //           handler(duplexStream, atekSocket)
  //         } else {
  //           atekNode.emit('select', {protocol: selection.protocol, stream: duplexStream}, atekSocket)
  //           atekSocket.emit('select', {protocol: selection.protocol, stream: duplexStream})
  //         }
  //       }
  //     } catch (e) {
  //       // TODO
  //       console.debug('Error handling connection', e)
  //       throw e
  //     }
  //   }
  // })
  // const hyperswarmSocketIter = toIterable(atekSocket.hyperswarmSocket)
  // pipe(hyperswarmSocketIter, atekSocket.muxer, hyperswarmSocketIter)
}
/*
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
}*/

function noop () {}