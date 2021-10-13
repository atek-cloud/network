declare module '@hyperswarm/dht' {
  import streamx from 'streamx'

  export default class DHT {
    constructor (opts?: object)
    ready (): Promise<void>
    createServer (opts?: object, onconnection?: (socket: Socket)=>void): Server
    connect (pubKey: NodeJS.Buffer, opts?: object): Socket
    static keyPair (seed?: NodeJS.Buffer): KeyPair
    destroy (): Promise<void>
  }

  export class Server {
    on (event: string, handler: (data: any) => void)
    listen (keyPair: NodeJS.Buffer)
    close(): Promise<void>
  }

  export interface Socket extends streamx.Duplex {
    on (event: string, handler: (data: any) => void)
    close: () => Promise<void>
    destroy (error: any): void
    remotePublicKey: NodeJS.Buffer
    publicKey: NodeJS.Buffer
  }

  export interface KeyPair {
    publicKey: NodeJS.Buffer
    secretKey: NodeJS.Buffer
  }
}