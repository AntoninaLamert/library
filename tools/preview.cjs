// Только локальная раздача статических файлов для предпросмотра.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('./sync-world.cjs').syncWorld(root);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403); return response.end('Forbidden'); }
    const content = await fs.readFile(target);
    const type = mime[path.extname(target)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type + (type.startsWith('text/') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => {
  console.log(`Предпросмотр: http://127.0.0.1:${server.address().port}`);
});
