// Minimal static server for the browser test page (serves the Wingcalc repo root
// so the page can read src/data/airfoils.json). Usage: node serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = +(process.argv[2] || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : '');
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, () => console.log(`http://localhost:${port}/spikes/xfoil-wasm/browser/`));
