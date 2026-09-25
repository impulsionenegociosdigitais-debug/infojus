import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllLawsuits } from './src/advbox.js';
import { demoLawsuits } from './src/demo-data.js';
import { normalizeLawsuit } from './public/js/metrics.js';
import {
  COOKIE_NAME,
  LoginLimiter,
  clearedCookie,
  createSessionToken,
  parseCookies,
  parseUsers,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from './src/auth.js';

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

const env = process.env;
const config = {
  token: env.ADVBOX_API_TOKEN ?? '',
  baseUrl: env.ADVBOX_BASE_URL || 'https://app.advbox.com.br/api/v1',
  port: Number(env.PORT) || 3000,
  host: env.HOST || '127.0.0.1',
  cacheMs: (Number(env.CACHE_MINUTES) || 15) * 60 * 1000,
  demo: env.ADVBOX_DEMO === '1' || !env.ADVBOX_API_TOKEN,
  users: parseUsers(env.DASHBOARD_USERS),
  sessionSecret: env.SESSION_SECRET || '',
  trustProxy: env.TRUST_PROXY === '1',
};

const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
const authEnabled = config.users.size > 0;

// Sem usuários cadastrados, o painel só pode ficar acessível na própria máquina.
if (!authEnabled && !isLocalHost) {
  console.error(
    'Nenhum usuário configurado em DASHBOARD_USERS. Para publicar o painel fora deste computador, ' +
      'cadastre ao menos um usuário (veja o README).'
  );
  process.exit(1);
}
if (authEnabled && !config.sessionSecret) {
  console.warn('SESSION_SECRET não definido: as sessões serão encerradas sempre que o servidor reiniciar.');
  config.sessionSecret = randomBytes(32).toString('hex');
}

// ---------- Dados ----------

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

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(body));
}

function redirect(res, location, extraHeaders = {}) {
  send(res, 303, { Location: location, ...extraHeaders });
}

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? '';
}

function isSecure(req) {
  return config.trustProxy ? req.headers['x-forwarded-proto'] === 'https' : Boolean(req.socket.encrypted);
}

function currentUser(req) {
  if (!authEnabled) return 'local';
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return readSessionToken(config.sessionSecret, token);
}

async function readBody(req, limit = 10_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Requisição grande demais');
  }
  return body;
}

const loginLimiter = new LoginLimiter();
const MESSAGES = {
  invalido: 'Usuário ou senha incorretos.',
  bloqueado: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.',
  saiu: 'Você saiu do painel.',
};

async function loginPage(res, messageKey) {
  const html = await readFile(join(PUBLIC_DIR, 'login.html'), 'utf8');
  const msg = MESSAGES[messageKey];
  const note = msg ? `<div class="note${messageKey === 'saiu' ? '' : ' error'}" role="alert">${msg}</div>` : '';
  send(res, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }, html.replace('{{mensagem}}', note));
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (loginLimiter.blocked(ip)) return redirect(res, '/login?erro=bloqueado');

  const form = new URLSearchParams(await readBody(req));
  const name = String(form.get('usuario') ?? '').trim().toLowerCase();
  const stored = config.users.get(name);
  // Mesmo sem usuário, compara a senha para não revelar quais usuários existem pelo tempo de resposta.
  const ok = verifyPassword(form.get('senha') ?? '', stored ?? 'scrypt:00:00') && Boolean(stored);
  if (!ok) {
    loginLimiter.fail(ip);
    return redirect(res, '/login?erro=invalido');
  }
  loginLimiter.reset(ip);
  const token = createSessionToken(config.sessionSecret, name);
  redirect(res, '/', { 'Set-Cookie': sessionCookie(token, { secure: isSecure(req) }) });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 403, {}, '');
  try {
    const data = await readFile(file);
    send(res, 200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }, data);
  } catch {
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname === '/health') return sendJson(res, 200, { ok: true });
    if (pathname === '/styles.css') return serveStatic(res, pathname);

    if (authEnabled && pathname === '/login') {
      if (req.method === 'POST') return handleLogin(req, res);
      if (currentUser(req)) return redirect(res, '/');
      return loginPage(res, url.searchParams.get('erro') ?? url.searchParams.get('msg'));
    }
    if (authEnabled && pathname === '/logout' && req.method === 'POST') {
      return redirect(res, '/login?msg=saiu', { 'Set-Cookie': clearedCookie({ secure: isSecure(req) }) });
    }

    const user = currentUser(req);
    if (!user) {
      if (pathname.startsWith('/api/')) return sendJson(res, 401, { error: 'Sessão expirada. Entre novamente.' });
      return redirect(res, '/login');
    }

    if (pathname === '/api/me') return sendJson(res, 200, { user, authEnabled });
    if (pathname === '/api/lawsuits') {
      try {
        return sendJson(res, 200, await loadLawsuits(url.searchParams.get('refresh') === '1'));
      } catch (err) {
        console.error(err);
        return sendJson(res, 502, { error: err.message });
      }
    }
    if (pathname === '/login.html') return redirect(res, '/');
    return serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Erro interno');
  }
});

server.listen(config.port, config.host, () => {
  const mode = config.demo ? 'dados de demonstração' : `ADVbox (${config.baseUrl})`;
  const auth = authEnabled ? `${config.users.size} usuário(s) cadastrado(s)` : 'sem login (acesso apenas local)';
  console.log(`Dashboard em http://${config.host}:${config.port}  [fonte: ${mode}; ${auth}]`);
});
