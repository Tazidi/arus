import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (!/^(?:assets\/)?[\w.-]+\.(?:html|css|m?js|svg|png|webmanifest)$/.test(name)) {
      response.writeHead(404).end();
      return;
    }
    const contents = await readFile(new URL('./dist/' + name, import.meta.url));
    response.writeHead(200, { 'Content-Type': types[extname(name)], 'Cache-Control': 'no-cache' }).end(contents);
  } catch { response.writeHead(404).end(); }
});
server.listen(Number(process.argv[2] || 4173), '127.0.0.1', () => {
  process.stdout.write('Arus: http://127.0.0.1:' + server.address().port + '\n');
});
