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
  const node1 = new AtekNet.Node(keyPair1, ['/test/1.0.0', '/test2/2.0.0'])
  const node2 = new AtekNet.Node(keyPair2, ['/test/1.0.0', '/test2/2.0.0'])
  await node1.listen()
  const conn = await node2.connect(keyPair1.publicKey)

  const serverSelects: string[] = []
  node1.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    serverSelects.push(protocol)
  })

  const res = await conn.select(['/test2/2.0.0'])
  t.is(await res.protocol, '/test2/2.0.0')

  const res2 = await conn.select(['/test/1.0.0'])
  t.is(await res2.protocol, '/test/1.0.0')

  const res3 = await conn.select(['/test/1.0.0', '/test2/2.0.0'])
  t.is(await res3.protocol, '/test/1.0.0')

  t.deepEqual(serverSelects, [
    '/test2/2.0.0',
    '/test/1.0.0',
    '/test/1.0.0'
  ])
})

ava('Server to server, duplicated connections', async (t) => {
  const keyPair1 = AtekNet.createKeypair()
  const keyPair2 = AtekNet.createKeypair()
  const node1 = new AtekNet.Node(keyPair1, ['/test/1.0.0', '/test2/2.0.0'])
  const node2 = new AtekNet.Node(keyPair2, ['/test/1.0.0', '/test2/2.0.0'])
  await node1.listen()
  await node2.listen()
  const conn1 = await node1.connect(keyPair2.publicKey)
  const conn2 = await node2.connect(keyPair1.publicKey)

  const server1Selects: string[] = []
  node1.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server1Selects.push(protocol)
  })
  const server2Selects: string[] = []
  node2.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server2Selects.push(protocol)
  })

  const res = await conn1.select(['/test2/2.0.0'])
  t.is(await res.protocol, '/test2/2.0.0')

  const res2 = await conn1.select(['/test/1.0.0'])
  t.is(await res2.protocol, '/test/1.0.0')

  const res3 = await conn1.select(['/test/1.0.0', '/test2/2.0.0'])
  t.is(await res3.protocol, '/test/1.0.0')

  const res4 = await conn2.select(['/test2/2.0.0'])
  t.is(await res4.protocol, '/test2/2.0.0')

  const res5 = await conn2.select(['/test/1.0.0'])
  t.is(await res5.protocol, '/test/1.0.0')

  const res6 = await conn2.select(['/test/1.0.0', '/test2/2.0.0'])
  t.is(await res6.protocol, '/test/1.0.0')

  t.deepEqual(server1Selects, [
    '/test2/2.0.0',
    '/test/1.0.0',
    '/test/1.0.0'
  ])
  t.deepEqual(server2Selects, [
    '/test2/2.0.0',
    '/test/1.0.0',
    '/test/1.0.0'
  ])
})

ava('Server to server, deduplicated connections', async (t) => {
  const keyPair1 = AtekNet.createKeypair()
  const keyPair2 = AtekNet.createKeypair()
  const node1 = new AtekNet.Node(keyPair1, ['/test/1.0.0', '/test2/2.0.0'])
  const node2 = new AtekNet.Node(keyPair2, ['/test/1.0.0', '/test2/2.0.0'])
  await node1.listen()
  await node2.listen()

  const conn1promise = new Promise(r => node2.once('connection', r))
  const conn1 = await node1.connect(keyPair2.publicKey)
  await conn1promise // wait for the connection to finish so we can test dedup
  const conn2 = await node2.connect(keyPair1.publicKey)

  const server1Selects: string[] = []
  node1.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server1Selects.push(protocol)
  })
  const server2Selects: string[] = []
  node2.on('select', ({protocol, stream}: {protocol: string, stream: NodeJS.ReadWriteStream}) => {
    server2Selects.push(protocol)
  })

  const res = await conn1.select(['/test2/2.0.0'])
  t.is(await res.protocol, '/test2/2.0.0')

  const res2 = await conn1.select(['/test/1.0.0'])
  t.is(await res2.protocol, '/test/1.0.0')

  const res3 = await conn1.select(['/test/1.0.0', '/test2/2.0.0'])
  t.is(await res3.protocol, '/test/1.0.0')

  const res4 = await conn2.select(['/test2/2.0.0'])
  t.is(await res4.protocol, '/test2/2.0.0')

  const res5 = await conn2.select(['/test/1.0.0'])
  t.is(await res5.protocol, '/test/1.0.0')

  const res6 = await conn2.select(['/test/1.0.0', '/test2/2.0.0'])
  t.is(await res6.protocol, '/test/1.0.0')

  t.deepEqual(server1Selects, [
    '/test2/2.0.0',
    '/test/1.0.0',
    '/test/1.0.0'
  ])
  t.deepEqual(server2Selects, [
    '/test2/2.0.0',
    '/test/1.0.0',
    '/test/1.0.0'
  ])
})