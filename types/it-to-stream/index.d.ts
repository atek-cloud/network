declare module 'it-to-stream' {
  import streamx from 'streamx'
  interface ItDuplex {
    source: AsyncIterable<any>
    sink: (it: AsyncIterable<any>) => Promise<void>
  }
  function duplex (duplex: ItDuplex): streamx.Duplex
  export = {duplex}
}