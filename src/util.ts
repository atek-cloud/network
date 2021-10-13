import b32 from 'hi-base32'

export function toBase32 (buf: Buffer) {
  return b32.encode(buf).replace(/=/g, '').toLowerCase()
}

export function fromBase32 (str: string) {
  return Buffer.from(b32.decode.asBytes(str.toUpperCase()))
}