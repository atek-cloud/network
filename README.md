# Atek Network

**Work in progress. Not yet published to NPM.**

```
npm i @atek-cloud/network
```

Atek's networking protocol. Uses [Hyperswarm](https://github.com/hyperswarm) for the connections layer.

Includes APIs for transmitting HTTP traffic, which is Atek's preferred protocol.

```js
import * as AtekNet from '@atek-cloud/network'

await AtekNet.setup()

// create a new node which listens for connections
const node1 = new AtekNet.Node(AtekNet.createKeypair())
await node1.listen()

// set a protocol handler
node1.setProtocolHandler((stream, socket) => {
  console.log('New connection from', socket.remotePublicKey)
  stream.write('Hello there')
  stream.end()
})

// create a second node and connect it to the first node
const node2 = new AtekNet.Node(AtekNet.createKeypair())
const sock = await node2.connect(node1.keyPair.publicKey)

sock.stream.on('data', (chunk) => console.log(chunk.toString())) // => 'Hello there'
```

Glossary for the API:

- `node` A network node identified by a keypair. May (or may not) listen for connections or connect to other nodes. Will identify itself by its public key to all connected nodes.
- `socket` A connection to a peer.

Quick overview:

- `setup()` Must be called before using AtekNet.
- `createKeypair()` Create a keypair to identify Atek nodes. If you plan to reuse the keypair, you should store it somewhere safe.
- `new Node(keypair)` Create a new Atek node.
- `node.listen()` Start listening for incoming connections.
- `node.setProtocolHandler(handler)` Add an incoming-requests handler.
- `node.connect(remotePublicKey) => socket` Create a connection the node identified by the given public key.
- `http.createProxy(node, port)` Create an HTTP 1.1 handler on the given node and route its traffic to `localhost:${port}`.
- `http.createAgent(node)` Create an agent for initiating HTTP connections over the Atek network.

## HTTP APIs

The module includes tooling to send and receive HTTP traffic. On the receiving side, you create a proxy which routes to a localhost port. On the sending side, you create a NodeJS HTTP agent which will route all requests to `http://{pubkey-base32}.atek.app` over the Atek network.

```js
import http from 'http'
import * as AtekNet from '@atek-cloud/network'

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
const node1 = new AtekNet.Node(AtekNet.createKeypair())
await node1.listen()

AtekNet.http.createProxy(node1, 8080) // proxy the 'http/1.1' protocol to our http server

// create another atek node and an http agent
const node2 = new AtekNet.Node(AtekNet.createKeypair())
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

### `new Node(keyPair: KeyPair)`

Create a new network node using the given keypair.

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

### `atekNode.setProtocolHandler (handler: AtekNodeProtocolHandler)`

Set a handler for incoming connections.

Handler should match this signature:

```
interface AtekNodeProtocolHandler {
  (stream: Duplex, socket: AtekSocket): void|Promise<void>
}
```

### `atekNode.removeProtocolHandler ()`

Remove the handler.

### `atekNode.on("connection", socket: AtekSocket)`

Emitted when an incoming connection is created.

### `AtekSocket`

The class used for sockets/connections between nodes.

### `atekSocket.remotePublicKey: Buffer`

### `atekSocket.remotePublicKeyB32: string`

### `atekSocket.close(): Promise<void>`

Close the socket.

### `http.createProxy(node: Node, port: number)`

Creates a handler on the `node` for the `http/1.1` protocol and proxies all requests to `localhost:${port}`. Requests will have the `Atek-Remote-Public-Key` header set to the base32-encoded public key of the connecting node.

### `http.createAgent(node: Node): Agent`

Creates a NodeJS "http agent" which routes all requests to `http://{pubkey-base32}.atek.app` over the Atek network.

## Notable Changes

### 0.0.4 - Drop libp2p modules

Previously we used [LibP2P Mplex](https://github.com/libp2p/js-libp2p-mplex) for multiplexing on the connection and [LibP2P Multistream Select](https://github.com/multiformats/js-multistream-select) for protocol negotiation. These tools were used for performance and protocol-negotiation, respectively.

The Hyperswarm team committed to two updates which will make those modules unnecessary:

- [dht#56 Cache handshake information for quick-connect of additional sockets](https://github.com/hyperswarm/dht/issues/56). This will lead to fast subsequent connections between peers, making the muxer less important.
- [dht#57 Add userData to handshake](https://github.com/hyperswarm/dht/issues/57). This can be used to provide protocol metadata.

As of 0.0.4's release, these updates haven't landed yet but I wanted to drop the wire-protocol behaviors in expectation of them. When dht#56 lands, we'll get a perf bump (especially with HTTP proxies). When dht#57 lands, we'll re-add some of the protocol negotiation features to this module.

## License

MIT