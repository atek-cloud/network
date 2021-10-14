import http from 'http'
import * as AtekNet from '../dist/index.js'

await AtekNet.setup()

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

const node1 = new AtekNet.Node(AtekNet.createKeypair())
await node1.listen()
AtekNet.http.createProxy(node1, 8080)

const node2 = new AtekNet.Node(AtekNet.createKeypair())
const agent = AtekNet.http.createAgent(node2)

http.get(node1.httpUrl, {agent}, (res) => {
  res.setEncoding('utf8');
  let rawData = '';
  res.on('data', (chunk) => { rawData += chunk; });
  res.on('end', () => {
    console.log(rawData)
  })
})