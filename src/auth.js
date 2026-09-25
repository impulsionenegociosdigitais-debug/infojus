// Login por usuário e senha com sessão em cookie assinado.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'infojus_sessao';
const SESSION_HOURS = 12;

// ---------- Senhas ----------

// Formato gravado: scrypt:<salt em hex>:<hash em hex>
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function sameBytes(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const got = scryptSync(String(password), salt, 32);
    return sameBytes(got, Buffer.from(hash, 'hex'));
  }
  // Senha em texto simples (guardada como segredo no provedor de hospedagem).
  const key = randomBytes(16);
  const h = (v) => createHmac('sha256', key).update(String(v)).digest();
  return sameBytes(h(password), h(stored));
}

// DASHBOARD_USERS: "usuario:senha" separados por vírgula ou quebra de linha.
// A senha pode estar em texto ou no formato gerado por `npm run hash-password`.
export function parseUsers(value) {
  const users = new Map();
  for (const entry of String(value ?? '').split(/[,\n]/)) {
    const trimmed = entry.trim();
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim().toLowerCase();
    const secret = trimmed.slice(idx + 1).trim();
    if (name && secret) users.set(name, secret);
  }
  return users;
}

// ---------- Sessão ----------

function sign(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(secret, user, now = Date.now()) {
  const exp = now + SESSION_HOURS * 3600 * 1000;
  const data = `${Buffer.from(user).toString('base64url')}.${exp}`;
  return `${data}.${sign(secret, data)}`;
}

export function readSessionToken(secret, token, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [userB64, exp, sig] = parts;
  const expected = sign(secret, `${userB64}.${exp}`);
  if (!sameBytes(Buffer.from(sig), Buffer.from(expected))) return null;
  if (!(Number(exp) > now)) return null;
  return Buffer.from(userB64, 'base64url').toString();
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure }) {
  const attrs = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_HOURS * 3600}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearedCookie({ secure }) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ---------- Limite de tentativas ----------

export class LoginLimiter {
  constructor({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.failures = new Map();
  }

  blocked(key, now = Date.now()) {
    const f = this.failures.get(key);
    if (!f) return false;
    if (now - f.first > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return f.count >= this.max;
  }

  fail(key, now = Date.now()) {
    const f = this.failures.get(key);
    if (!f || now - f.first > this.windowMs) this.failures.set(key, { first: now, count: 1 });
    else f.count++;
    if (this.failures.size > 10000) this.failures.clear();
  }

  reset(key) {
    this.failures.delete(key);
  }
}
