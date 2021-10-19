import * as AtekNet from '../dist/index.js'

await AtekNet.setup()

const node1 = new AtekNet.Node(AtekNet.createKeypair())
await node1.listen()
node1.setProtocolHandler((stream, socket) => {
  console.log('New connection from', socket.remotePublicKey)
  stream.write('Hello there')
  stream.end()
})

const node2 = new AtekNet.Node(AtekNet.createKeypair())
const sock = await node2.connect(node1.keyPair.publicKey)
sock.stream.on('data', (chunk) => console.log(chunk.toString())) // => 'Hello there'