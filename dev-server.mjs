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
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';

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

    // POST /_log — a pagina despeja texto aqui e vira .dev-out/<nome>.txt.
    // Serve pra tirar resultado de dentro do navegador sem copy-paste, e pra
    // escapar de filtros de leitura de extensao.
    if (req.method === 'POST' && url.pathname === '/_log') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const name = (url.searchParams.get('name') || 'log').replace(/[^a-z0-9_.-]/gi, '');
      const dir = join(ROOT, '.dev-out');
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${name}.txt`);
      await writeFile(file, Buffer.concat(chunks));
      console.log(`LOG  .dev-out/${name}.txt  (${Buffer.concat(chunks).length} bytes)`);
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
      return;
    }

    // POST /_jev — proxy pro Jev da TypeSafe, SÓ no desenvolvimento local.
    //
    // A TypeSafe recusa chamada vinda do navegador (o preflight de CORS volta
    // sem Access-Control-Allow-Origin), e a chave não pode ir pra página: o
    // site é público. Então a página fala com /_jev, e é ESTE processo, na
    // máquina do dono, que lê a chave de ~/.garimpo e chama a API.
    //
    // O Worker da Cloudflare faz o mesmo papel no site publicado, com a mesma
    // interface — por isso o cliente só troca o endereço.
    if (req.method === 'POST' && url.pathname === '/_jev') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let chave = '';
      try { chave = (await readFile(join(homedir(), '.garimpo', 'typesafe-key.txt'), 'utf8')).trim(); } catch {}
      if (!chave) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'sem chave em ~/.garimpo/typesafe-key.txt' }));
        return;
      }
      const r = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks),
      });
      const corpo = await r.text();
      console.log(`JEV  ${r.status}  ${corpo.length} bytes`);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(corpo);
      return;
    }

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
