// Função da Vercel: recebe todas as rotas (ver vercel.json) e usa o mesmo código do servidor local.

import { createHandler, loadConfig } from '../src/app.js';

const handler = createHandler({ ...loadConfig(process.env), requireAuth: true });

export default handler;
