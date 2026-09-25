import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler, loadConfig } from '../src/app.js';

// Sobe o handler como a Vercel o chama: rota reescrita para /api/index?__path=...
// e, opcionalmente, com o corpo já lido em req.body.
async function vercelLike(env, { preparsedBody = false } = {}) {
  const handler = createHandler({ ...loadConfig({ VERCEL: '1', ...env }), requireAuth: true });
  const server = createServer(async (req, res) => {
    const original = new URL(req.url, 'http://x');
    req.url = `/api/index?__path=${encodeURIComponent(original.pathname)}&${original.searchParams}`;
    if (preparsedBody) {
      let raw = '';
      for await (const c of req) raw += c;
      req.body = Object.fromEntries(new URLSearchParams(raw));
    }
    handler(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('na Vercel, sem usuários cadastrados, o painel fica bloqueado', async () => {
  const srv = await vercelLike({});
  try {
    const res = await fetch(`${srv.base}/api/lawsuits`);
    assert.equal(res.status, 503);
    assert.equal((await fetch(`${srv.base}/health`)).status, 200);
  } finally {
    srv.close();
  }
});

test('na Vercel, login com corpo já interpretado e rota reescrita funciona', async () => {
  const srv = await vercelLike({ DASHBOARD_USERS: 'ana:senha-teste-123' }, { preparsedBody: true });
  try {
    let res = await fetch(`${srv.base}/`, { redirect: 'manual' });
    assert.equal(res.headers.get('location'), '/login');

    res = await fetch(`${srv.base}/login?erro=invalido`);
    assert.match(await res.text(), /Usuário ou senha incorretos/);

    res = await fetch(`${srv.base}/login`, {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: new URLSearchParams({ usuario: 'ana', senha: 'senha-teste-123' }),
      redirect: 'manual',
    });
    assert.equal(res.headers.get('location'), '/');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /Secure/);
    const cookie = setCookie.split(';')[0];

    res = await fetch(`${srv.base}/api/lawsuits`, { headers: { cookie } });
    const body = await res.json();
    assert.equal(body.source, 'demo');
    assert.ok(body.lawsuits.length > 0);

    res = await fetch(`${srv.base}/js/app.js`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  } finally {
    srv.close();
  }
});

test('chave de sessão derivada dos usuários é estável e muda com a lista', () => {
  const a = loadConfig({ DASHBOARD_USERS: 'ana:1' }).sessionSecret;
  assert.equal(a, loadConfig({ DASHBOARD_USERS: 'ana:1' }).sessionSecret);
  assert.notEqual(a, loadConfig({ DASHBOARD_USERS: 'ana:2' }).sessionSecret);
  assert.equal(loadConfig({ DASHBOARD_USERS: 'ana:1', SESSION_SECRET: 's' }).sessionSecret, 's');
});
