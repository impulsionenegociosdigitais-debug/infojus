// Rotas do painel. Usado pelo servidor local (server.js) e pela função da Vercel (api/index.js).

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllLawsuits } from './advbox.js';
import { demoLawsuits } from './demo-data.js';
import { normalizeLawsuit } from '../public/js/metrics.js';
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
} from './auth.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export function loadConfig(env = process.env) {
  const users = parseUsers(env.DASHBOARD_USERS);
  return {
    token: env.ADVBOX_API_TOKEN ?? '',
    baseUrl: env.ADVBOX_BASE_URL || 'https://app.advbox.com.br/api/v1',
    cacheMs: (Number(env.CACHE_MINUTES) || 15) * 60 * 1000,
    demo: env.ADVBOX_DEMO === '1' || !env.ADVBOX_API_TOKEN,
    users,
    // Sem SESSION_SECRET, a chave deriva da lista de usuários: fica estável entre reinícios
    // e muda (encerrando as sessões) quando a lista é alterada.
    sessionSecret:
      env.SESSION_SECRET ||
      (users.size ? createHash('sha256').update(`infojus:${env.DASHBOARD_USERS}`).digest('hex') : ''),
    trustProxy: env.TRUST_PROXY === '1' || env.VERCEL === '1',
  };
}

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

const MESSAGES = {
  invalido: 'Usuário ou senha incorretos.',
  bloqueado: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.',
  saiu: 'Você saiu do painel.',
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify(body));
}

function redirect(res, location, extraHeaders = {}) {
  send(res, 303, { Location: location, 'Cache-Control': 'no-store', ...extraHeaders });
}

async function readBody(req, limit = 10_000) {
  // Na Vercel o corpo já pode vir lido e interpretado em req.body.
  if ('body' in req) {
    const b = req.body;
    if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return new URLSearchParams(b).toString();
    return b ? String(b) : '';
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('Requisição grande demais');
  }
  return body;
}

// Na Vercel todas as rotas são reescritas para a mesma função, que recebe o caminho original em __path.
function resolveUrl(req) {
  const url = new URL(req.url, 'http://localhost');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    url.pathname = original.startsWith('/') ? original : `/${original}`;
  }
  return url;
}

export function createHandler(config) {
  const authEnabled = config.users.size > 0;
  const loginLimiter = new LoginLimiter();
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

  function clientIp(req) {
    if (config.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket?.remoteAddress ?? '';
  }

  function isSecure(req) {
    return config.trustProxy ? req.headers['x-forwarded-proto'] === 'https' : Boolean(req.socket?.encrypted);
  }

  function currentUser(req) {
    if (!authEnabled) return 'local';
    return readSessionToken(config.sessionSecret, parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

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
      send(res, 200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }, data);
    } catch {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Não encontrado');
    }
  }

  return async function handler(req, res) {
    try {
      const url = resolveUrl(req);
      const { pathname } = url;

      if (pathname === '/health') return sendJson(res, 200, { ok: true });
      if (pathname === '/styles.css') return serveStatic(res, pathname);

      if (!authEnabled && config.requireAuth) {
        return send(
          res,
          503,
          { 'Content-Type': 'text/plain; charset=utf-8' },
          'Painel sem usuários cadastrados. Defina a variável DASHBOARD_USERS nas configurações da hospedagem.'
        );
      }

      if (authEnabled && pathname === '/login') {
        if (req.method === 'POST') return await handleLogin(req, res);
        if (currentUser(req)) return redirect(res, '/');
        return await loginPage(res, url.searchParams.get('erro') ?? url.searchParams.get('msg'));
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
      return await serveStatic(res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Erro interno');
    }
  };
}
