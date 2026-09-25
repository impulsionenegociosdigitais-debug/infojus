// Servidor para rodar o painel no próprio computador ou em um contêiner.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, loadConfig } from './src/app.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

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

const config = loadConfig(process.env);
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const authEnabled = config.users.size > 0;

// Sem usuários cadastrados, o painel só pode ficar acessível na própria máquina.
if (!authEnabled && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(
    'Nenhum usuário configurado em DASHBOARD_USERS. Para publicar o painel fora deste computador, ' +
      'cadastre ao menos um usuário (veja o README).'
  );
  process.exit(1);
}

createServer(createHandler(config)).listen(port, host, () => {
  const mode = config.demo ? 'dados de demonstração' : `ADVbox (${config.baseUrl})`;
  const auth = authEnabled ? `${config.users.size} usuário(s) cadastrado(s)` : 'sem login (acesso apenas local)';
  console.log(`Dashboard em http://${host}:${port}  [fonte: ${mode}; ${auth}]`);
});
