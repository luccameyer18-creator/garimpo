/**
 * Servidor estático de desenvolvimento do Garimpo. Zero dependências.
 *
 *   node dev-server.mjs          → http://127.0.0.1:8080
 *   node dev-server.mjs 3000     → porta alternativa
 *
 * Por que 127.0.0.1 e não localhost:
 *   - a Spotify NÃO aceita "localhost" como redirect URI; exige o IP literal
 *   - 127.0.0.1 conta como contexto seguro, então File System Access API,
 *     Web MIDI, crypto.subtle e AudioWorklet funcionam sem HTTPS
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.argv[2] || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // impede subir acima da raiz do projeto
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403).end('403');
      return;
    }

    const s = await stat(path);
    if (s.isDirectory()) {
      res.writeHead(302, { Location: rel + '/' }).end();
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      // nunca cachear em dev: editar e dar F5 tem que refletir na hora
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(body);
    console.log(`200 ${rel}`);
  } catch (e) {
    const code = e.code === 'ENOENT' ? 404 : 500;
    console.log(`${code} ${req.url}${code === 500 ? ' — ' + e.message : ''}`);
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(code));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Garimpo dev  →  http://127.0.0.1:${PORT}`);
  console.log(`checagens    →  http://127.0.0.1:${PORT}/src/dev/checks.html`);
  console.log(`raiz         →  ${ROOT}`);
});
