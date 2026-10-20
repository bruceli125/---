// 临时静态服务 + 报告收集（用完即删）
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\2026大挑京师家教';
const REPORT = path.join(ROOT, '_bgtest', 'report.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.writeFileSync(REPORT, body, 'utf8');
      res.writeHead(204).end();
    });
    return;
  }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(18990, '127.0.0.1', () => console.log('serving on http://127.0.0.1:18990'));
