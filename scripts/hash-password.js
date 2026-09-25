// Gera a senha criptografada para usar em DASHBOARD_USERS.
// Uso: npm run hash-password -- usuario

import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../src/auth.js';

const user = (process.argv[2] ?? '').trim().toLowerCase();
if (!user || user.includes(':') || user.includes(',')) {
  console.error('Informe o nome do usuário, sem ":" nem ",". Exemplo: npm run hash-password -- maite');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Senha: ');
rl.close();
if (password.length < 8) {
  console.error('Use uma senha com pelo menos 8 caracteres.');
  process.exit(1);
}
console.log(`\n${user}:${hashPassword(password)}`);
