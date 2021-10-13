# Atek Network

```
npm i @atek/network
```

Atek's networking protocol. Uses the following stack:

- [Hyperswarm](https://github.com/hyperswarm) for the connections layer.
- [LibP2P Mplex](https://github.com/libp2p/js-libp2p-mplex) for multiplexing on the connection.
- [LibP2P Multistream Select](https://github.com/multiformats/js-multistream-select) for protocol negotiation.

Includes APIs for transmitting HTTP traffic, which is Atek's preferred protocol.

```js
import * as AtekNet from '@atek/network'

await AtekNet.setup()

// create a new node which listens for connections
const node1 = new AtekNet.AtekNode(AtekNet.createKeypair())
await node1.listen()

// set a protocol handler
node1.setProtocolHandler('/some-proto/1.0.0', (stream, socket) => {
  console.log('Protocol selected by', socket.remotePublicKey)
  stream.write('Hello there')
  stream.end()
})

// create a second node and connect it to the first node
const node2 = new AtekNet.AtekNode(AtekNet.createKeypair())
const sock = await node2.connect(node1.keyPair.publicKey)

// select a protocol
const {protocol, stream} = await sock.select(['/some-proto/1.0.0'])

stream.on('data', (chunk) => console.log(chunk.toString())) // => 'Hello there'
```

## HTTP tooling

The module includes tooling to send and receive HTTP traffic. On the receiving side, you create a proxy which routes to a localhost port. On the sending side, you create a NodeJS HTTP agent which will route all requests to `http://{pubkey-base32}.atek.app` over the Atek network.

```js
import http from 'http'
import * as AtekNet from '../dist/index.js'

await AtekNet.setup()

// create our HTTP server
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    host: req.headers.host,
    remote: req.headers['atek-remote-public-key'],
    url: req.url,
    data: 'Hello World!'
  }));
});
httpServer.listen(8080)

// create our Atek server node
const node1 = new AtekNet.AtekNode(AtekNet.createKeypair())
await node1.listen()

// have our Atek server proxy the '/http/1.1' protocol to our http server
AtekNet.http.createProxy(node1, 8080)

// create another atek node
const node2 = new AtekNet.AtekNode(AtekNet.createKeypair())

// create an HTTP agent on the second node
const agent = AtekNet.http.createAgent(node2)

// send an HTTP GET request using our agent
http.get(node1.httpUrl, {agent}, (res) => {
  res.setEncoding('utf8');
  let rawData = '';
  res.on('data', (chunk) => { rawData += chunk; });
  res.on('end', () => {
    console.log(rawData)
  })
})
```

## API

### `createKeypair(): KeyPair`

Create a new keypair. A keypair is used to identify Atek nodes.

### `new AtekNode(keyPair: KeyPair, listeningProtocols?: string|string[])`

Create a new network node using the given keypair. The `listeningProtocols` identifies what protocols this node provides to incoming connections.

### `atekNode.keyPair: KeyPair`

### `atekNode.isListening: boolean`

### `atekNode.publicKeyB32: string`

### `atekNode.httpHostname: string`

### `atekNode.httpUrl: string`

### `atekNode.connect(remotePublicKey: Buffer) => Promise<AtekSocket>`

Establish a connection to the given public key.

### `atekNode.listen() => Promise<void>`

Announce the node on the Hyperswarm DHT and begin accepting connections.

### `atekNode.close() => Promise<void>`

Stop listening and close all existing connections.

### `atekNode.addProtocols(protocols: string|string[])`

Add to the protocols which connecting nodes can access.

### `atekNode.removeProtocols(protocols: string|string[])`

Remove from the protocols which connecting nodes can access.

### `atekNode.setProtocolHandler (protocol: string, handler: AtekNodeProtocolHandler)`

Set a handler for the given `protocol`. Automatically adds `protocol` to the list of handled protocols.

Handler should match this signature:

```
interface AtekNodeProtocolHandler {
  (stream: Duplex, socket: AtekSocket): void|Promise<void>
}
```

### `atekNode.removeProtocolHandler (protocol: string)`

Remove the handler from `protocol` and remove that protocol for this list of handled protocols.

### `atekNode.on("connection", socket: AtekSocket)`

Emitted when an incoming connection is created.

### `atekNode.on("select", {protocol: string, stream: Duplex}, socket: AtekSocket)`

Emitted when the remote selects a protocol. Won't be emitted if the node has a handler for the protocol.

### `AtekSocket`

The class used for sockets/connections between nodes.

### `atekSocket.remotePublicKey: Buffer`

### `atekSocket.remotePublicKeyB32: string`

### `atekSocket.close(): Promise<void>`

Close the socket.

### `atekSocket.select(protocols: string[]): Promise<{protocol: string, stream: Duplex}>`

Select a protocol for communicating over the socket. If the remote doesn't support the protocol, will throw.

### `atekSocket.on("select", {protocol: string, stream: Duplex})`

Emitted when the remote selects a protocol. Won't be emitted if the parent `AtekNode` has a handler for the protocol.

### `http.createProxy(node: AtekNode, port: number)`

Creates a handler on the `node` for the `/http/1.1` protocol and proxies all requests to `localhost:${port}`. Requests will have the `Atek-Remote-Public-Key` header set to the base32-encoded public key of the connecting node.

### `http.createAgent(node: AtekNode): Agent`

Creates a NodeJS "http agent" which routes all requests to `http://{pubkey-base32}.atek.app` over the Atek network.