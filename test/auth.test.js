import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  hashPassword,
  verifyPassword,
  parseUsers,
  createSessionToken,
  readSessionToken,
  LoginLimiter,
} from '../src/auth.js';

test('senha criptografada e em texto simples são verificadas', () => {
  const stored = hashPassword('segredo-forte');
  assert.ok(stored.startsWith('scrypt:'));
  assert.equal(verifyPassword('segredo-forte', stored), true);
  assert.equal(verifyPassword('outra', stored), false);
  assert.equal(verifyPassword('abc12345', 'abc12345'), true);
  assert.equal(verifyPassword('abc1234', 'abc12345'), false);
});

test('parseUsers lê a lista e ignora entradas inválidas', () => {
  const users = parseUsers('Maite:senha1, joao:scrypt:aa:bb\nsemsenha,:x');
  assert.deepEqual([...users.keys()], ['maite', 'joao']);
  assert.equal(users.get('joao'), 'scrypt:aa:bb');
});

test('token de sessão valida assinatura e validade', () => {
  const now = Date.now();
  const token = createSessionToken('chave', 'maite', now);
  assert.equal(readSessionToken('chave', token, now), 'maite');
  assert.equal(readSessionToken('outra-chave', token, now), null);
  assert.equal(readSessionToken('chave', token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), now), null);
  assert.equal(readSessionToken('chave', token, now + 13 * 3600 * 1000), null);
  assert.equal(readSessionToken('chave', 'lixo', now), null);
});

test('LoginLimiter bloqueia após excesso de falhas', () => {
  const l = new LoginLimiter({ max: 2, windowMs: 1000 });
  l.fail('ip', 0);
  assert.equal(l.blocked('ip', 10), false);
  l.fail('ip', 20);
  assert.equal(l.blocked('ip', 30), true);
  assert.equal(l.blocked('ip', 2000), false);
});

// Sobe o servidor de verdade numa porta livre e testa o fluxo de login.
async function startServer(extraEnv) {
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ADVBOX_DEMO: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => String(d).includes('Dashboard em') && resolve());
    child.on('exit', (code) => reject(new Error(`servidor saiu com código ${code}`)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

test('fluxo de login protege o painel e a API', async () => {
  const srv = await startServer({ DASHBOARD_USERS: 'maite:senha-de-teste', SESSION_SECRET: 'x'.repeat(32) });
  try {
    let res = await fetch(`${srv.base}/`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login');

    res = await fetch(`${srv.base}/api/lawsuits`);
    assert.equal(res.status, 401);

    res = await fetch(`${srv.base}/js/metrics.js`, { redirect: 'manual' });
    assert.equal(res.status, 303);

    res = await fetch(`${srv.base}/login`, {
      method: 'POST',
      body: new URLSearchParams({ usuario: 'maite', senha: 'errada' }),
      redirect: 'manual',
    });
    assert.equal(res.headers.get('location'), '/login?erro=invalido');
    assert.equal(res.headers.get('set-cookie'), null);

    res = await fetch(`${srv.base}/login`, {
      method: 'POST',
      body: new URLSearchParams({ usuario: 'Maite', senha: 'senha-de-teste' }),
      redirect: 'manual',
    });
    assert.equal(res.headers.get('location'), '/');
    const cookie = res.headers.get('set-cookie').split(';')[0];

    res = await fetch(`${srv.base}/api/lawsuits`, { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).source, 'demo');

    res = await fetch(`${srv.base}/api/me`, { headers: { cookie } });
    assert.deepEqual(await res.json(), { user: 'maite', authEnabled: true });
  } finally {
    srv.stop();
  }
});

test('servidor recusa publicar fora do computador sem usuários', async () => {
  await assert.rejects(startServer({ HOST: '0.0.0.0' }), /código 1/);
});
