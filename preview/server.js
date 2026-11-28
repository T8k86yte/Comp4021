const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../public');
const { raceClientSource } = require('../lib/raceClient');
const port = Number(process.argv[2]) || 8010;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wav': 'audio/wav' };
http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/race-client.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(raceClientSource());
    return;
  }
  const requested = pathname === '/' ? '/playtest.html' : pathname;
  const filename = path.resolve(root, `.${requested}`);
  if (!filename.startsWith(root + path.sep) || !types[path.extname(filename)]) {
    response.writeHead(404).end(); return;
  }
  fs.readFile(filename, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] }); response.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Edgerunner map playtest: http://127.0.0.1:${port}`));
