import ava from 'ava'
import * as AtekNet from '../src/index.js'
import HyperDHT from '@hyperswarm/dht'

const nodes: any[] = []

ava.before(async () => {
  console.log('Initializing bootstrappers')
  while (nodes.length < 3) {
    nodes.push(new HyperDHT({ephemeral: true, bootstrap: []}))
  }

  const bootstrap = []
  for (const node of nodes) {
    await node.ready()
    bootstrap.push(`127.0.0.1:${node.address().port}`)
  }

  while (nodes.length < 10) {
    const node = new HyperDHT({ephemeral: false, bootstrap})
    await node.ready()
    nodes.push(node)
  }

  console.log('Initializing node with bootstrap=', bootstrap)
  await AtekNet.setup({bootstrap})
})

ava.after(async () => {
  for (const node of nodes) node.destroy()
  await AtekNet.destroy()
})

ava('Client to server', async (t) => {
  const keyPair1 = AtekNet.createKeypair()
  const keyPair2 = AtekNet.createKeypair()
  const node1 = new AtekNet.Node(keyPair1)
  const node2 = new AtekNet.Node(keyPair2)
  await node1.listen()

  let _r: any
  const p = new Promise(r => {_r = r})

  const serverSelects: string[] = []
  node1.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    serverSelects.push(protocol)
    if (serverSelects.length === 3) _r()
  })

  await node2.connect(keyPair1.publicKey, 'test')
  await node2.connect(keyPair1.publicKey)
  await node2.connect(keyPair1.publicKey, 'test2')
  await p

  // TODO: until hyperswarm implements the userData header in handshakes, protocol selection doesnt work
  t.deepEqual(serverSelects, [
    '*',
    '*',
    '*'
  ])
})

ava('Server to server', async (t) => {
  const keyPair1 = AtekNet.createKeypair()
  const keyPair2 = AtekNet.createKeypair()
  const node1 = new AtekNet.Node(keyPair1)
  const node2 = new AtekNet.Node(keyPair2)
  await node1.listen()
  await node2.listen()

  let _r: any
  const p = new Promise(r => {_r = r})

  const server1Selects: string[] = []
  node1.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server1Selects.push(protocol)
    if (server1Selects.length === 1 && server2Selects.length === 1) _r()
  })
  const server2Selects: string[] = []
  node2.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server2Selects.push(protocol)
    if (server1Selects.length === 1 && server2Selects.length === 1) _r()
  })

  await node1.connect(keyPair2.publicKey)
  await node2.connect(keyPair1.publicKey)
  await p

  t.deepEqual(server1Selects, [
    '*',
  ])
  t.deepEqual(server2Selects, [
    '*',
  ])
})
