import ava from 'ava'
import http from 'http'
import * as AtekNet from '../src/index.js'
import HyperDHT from '@hyperswarm/dht'
import fetch from 'node-fetch'

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

ava('Client-to-server HTTP requests', async (t) => {
  const serverKeypair = AtekNet.createKeypair()
  const atekServer = new AtekNet.Node(serverKeypair)
  await atekServer.listen()

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
  await new Promise(r => httpServer.on('listening', r))

  AtekNet.http.createProxy(atekServer, 8080)

  for (let i = 0; i < 10; i++) {
    const clientKeypair = AtekNet.createKeypair()
    const atekClient = new AtekNet.Node(clientKeypair)
    const agent = AtekNet.http.createAgent(atekClient)
    for (let j = 0; j < 10; j++) {
      const res = await fetch(`${atekServer.httpUrl}/test/path`, {agent})
      const body = await res.json()
      t.deepEqual(body, {
        host: atekServer.httpHostname,
        remote: atekClient.publicKeyB32,
        url: '/test/path',
        data: 'Hello World!'
      })
    }
  }

  httpServer.close()
})

ava('Dont let the atek-remote-public-key header get overwritten', async (t) => {
  const serverKeypair = AtekNet.createKeypair()
  const atekServer = new AtekNet.Node(serverKeypair)
  await atekServer.listen()

  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      host: req.headers.host,
      remote: req.headers['atek-remote-public-key'],
      url: req.url,
      data: 'Hello World!'
    }));
  });
  httpServer.listen(8081)
  await new Promise(r => httpServer.on('listening', r))

  AtekNet.http.createProxy(atekServer, 8081)

  const clientKeypair = AtekNet.createKeypair()
  const atekClient = new AtekNet.Node(clientKeypair)
  const agent = AtekNet.http.createAgent(atekClient)

  const res = await fetch(`${atekServer.httpUrl}/test/path`, {agent, headers: {'atek-remote-public-key': 'FAKE!'}})
  const body = await res.json()
  t.deepEqual(body, {
    host: atekServer.httpHostname,
    remote: atekClient.publicKeyB32,
    url: '/test/path',
    data: 'Hello World!'
  })

  const res2 = await fetch(`${atekServer.httpUrl}/test/path`, {agent, headers: {'Atek-Remote-Public-Key': 'FAKE!'}})
  const body2 = await res2.json()
  t.deepEqual(body2, {
    host: atekServer.httpHostname,
    remote: atekClient.publicKeyB32,
    url: '/test/path',
    data: 'Hello World!'
  })

  httpServer.close()
})

ava('Server-to-server HTTP requests', async (t) => {
  const server1Keypair = AtekNet.createKeypair()
  const server2Keypair = AtekNet.createKeypair()
  const atekServer1 = new AtekNet.Node(server1Keypair)
  const atekServer2 = new AtekNet.Node(server2Keypair)
  await atekServer1.listen()
  await atekServer2.listen()

  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      host: req.headers.host,
      remote: req.headers['atek-remote-public-key'],
      url: req.url,
      data: 'Hello World!'
    }));
  });
  httpServer.listen(8082)
  await new Promise(r => httpServer.on('listening', r))

  AtekNet.http.createProxy(atekServer1, 8082)
  AtekNet.http.createProxy(atekServer2, 8082)

  const agent1 = AtekNet.http.createAgent(atekServer1)
  const agent2 = AtekNet.http.createAgent(atekServer2)

  const res1 = await fetch(`${atekServer2.httpUrl}/test/path`, {agent: agent1})
  const body1 = await res1.json()
  t.deepEqual(body1, {
    host: atekServer2.httpHostname,
    remote: atekServer1.publicKeyB32,
    url: '/test/path',
    data: 'Hello World!'
  })

  const res2 = await fetch(`${atekServer1.httpUrl}/test/path`, {agent: agent2})
  const body2 = await res2.json()
  t.deepEqual(body2, {
    host: atekServer1.httpHostname,
    remote: atekServer2.publicKeyB32,
    url: '/test/path',
    data: 'Hello World!'
  })

  httpServer.close()
})