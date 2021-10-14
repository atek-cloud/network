import net from 'net'
import tls from 'tls'
import agent from 'agent-base'
import pump from 'pump'
import { Transform } from 'streamx'
import { Node } from './index.js'
import { fromBase32 } from './util.js'

export async function createProxy (atekNode: Node, port: number) {
  await atekNode.listen()
  atekNode.setProtocolHandler('/http/1.1', (stream, atekSocket) => {
    const conn = net.connect({host: 'localhost', port})

    let acc = ''
    let hasAddedHeader = false
    pump(
      stream,
      new Transform({
        transform (chunk, cb) {
          if (hasAddedHeader) {
            this.push(chunk)
          } else {
            acc += chunk.toString('utf8')

            const headersEndIndex = acc.indexOf('\r\n\r\n')
            if (headersEndIndex !== -1) {
              const existingHeaderMatch = acc.match(/atek-remote-public-key:/i)
              if (existingHeaderMatch) {
                const existingHeaderEndIndex = acc.indexOf('\r\n', existingHeaderMatch.index)
                acc = `${acc.slice(0, existingHeaderMatch.index)}Atek-Remote-Public-Key: ${atekSocket.remotePublicKeyB32}${acc.slice(existingHeaderEndIndex)}`
              } else {
                acc = `${acc.slice(0, headersEndIndex)}\r\nAtek-Remote-Public-Key: ${atekSocket.remotePublicKeyB32}${acc.slice(headersEndIndex)}`
              }
              hasAddedHeader = true
              this.push(acc)
            }
          }
          cb()
        }
      }),
      conn,
      stream
    )
  })
}

export function createAgent (atekNode: Node) {
  return agent(async (req: agent.ClientRequest, opts: agent.RequestOptions): Promise<agent.AgentCallbackReturn> => {
    if (req.host.endsWith('.atek.app')) {
      try {
        const hostParts = req.host.split('.').filter(Boolean)
        const conn = await atekNode.connect(fromBase32(hostParts[0]))
        const select = await conn.select(['/http/1.1'])

        // @ts-ignore Duck-typing to match what is expected
        select.stream.setTimeout = noop
        // @ts-ignore The streamx.Duplex is compatible with node's Duplex
        return select.stream
      } catch (e) {
        console.log('oh fail', e)
        throw e
      }
    } else if (opts.secureEndpoint) {
      return tls.connect(opts)
    } else {
      return net.connect(opts)
    }
  })
}

function noop () {}