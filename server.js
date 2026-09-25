import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllLawsuits } from './src/advbox.js';
import { demoLawsuits } from './src/demo-data.js';
import { normalizeLawsuit } from './public/js/metrics.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

// Carrega variáveis de um arquivo .env simples, se existir.
function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const config = {
  token: process.env.ADVBOX_API_TOKEN ?? '',
  baseUrl: process.env.ADVBOX_BASE_URL || 'https://app.advbox.com.br/api/v1',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  cacheMs: (Number(process.env.CACHE_MINUTES) || 15) * 60 * 1000,
  demo: process.env.ADVBOX_DEMO === '1' || !process.env.ADVBOX_API_TOKEN,
};

let cache = null;
let inflight = null;

async function loadLawsuits(force) {
  if (!force && cache && Date.now() - cache.at < config.cacheMs) return cache.payload;
  if (inflight) return inflight;

  inflight = (async () => {
    const raw = config.demo
      ? demoLawsuits()
      : await fetchAllLawsuits({ baseUrl: config.baseUrl, token: config.token });
    const payload = {
      source: config.demo ? 'demo' : 'advbox',
      fetchedAt: new Date().toISOString(),
      lawsuits: raw.map(normalizeLawsuit),
    };
    cache = { at: Date.now(), payload };
    return payload;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/lawsuits') {
    try {
      sendJson(res, 200, await loadLawsuits(url.searchParams.get('refresh') === '1'));
    } catch (err) {
      console.error(err);
      sendJson(res, 502, { error: err.message });
    }
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
});

server.listen(config.port, config.host, () => {
  const mode = config.demo ? 'dados de demonstração' : `ADVbox (${config.baseUrl})`;
  console.log(`Dashboard em http://${config.host}:${config.port}  [fonte: ${mode}]`);
});
