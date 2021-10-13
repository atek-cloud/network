declare module 'libp2p-mplex' {
  interface ItDuplex {
    source: AsyncIterable<any>
    sink: (it: AsyncIterable<any>) => Promise<void>
  }
  interface MplexOptions {
    onStream?: (stream: ItDuplex) => void|Promise<void>
    onStreamEnd?: (stream: ItDuplex) => void|Promise<void>
  }
  class Mplex extends ItDuplex {
    constructor (opts?: MplexOptions)
    newStream (): ItDuplex
  }
  export = Mplex
}