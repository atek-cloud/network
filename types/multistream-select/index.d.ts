declare module 'multistream-select' {
  interface ItDuplex {
    source: AsyncIterable<any>
    sink: (it: AsyncIterable<any>) => Promise<void>
  }
  export class Dialer {
    constructor (duplex: ItDuplex)
    select (protocols: string[]): Promise<{stream: ItDuplex, protocol: string}>
    ls (): Promise<string[]>
  }
  export class Listener {
    constructor (duplex: ItDuplex)
    handle (protocols: string[]): Promise<{stream: ItDuplex, protocol: string}>
  }
  export = {Dialer, Listener}
}