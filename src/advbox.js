// Cliente mínimo da API REST do ADVbox (somente leitura de processos).

const PAGE_SIZE = 100;
const MAX_PAGES = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AdvboxError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(baseUrl, token, path, params, attempt = 1) {
  const url = new URL(baseUrl.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  // Limite de requisições: espera e tenta de novo algumas vezes.
  if (res.status === 429 && attempt <= 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
    return request(baseUrl, token, path, params, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = res.status === 401 || res.status === 403 ? ' Verifique o ADVBOX_API_TOKEN.' : '';
    throw new AdvboxError(`ADVbox respondeu ${res.status}.${hint} ${body.slice(0, 200)}`.trim(), res.status);
  }
  return res.json();
}

// A resposta de listagem traz os itens em "data" e o total em "totalCount".
// Outras formas comuns também são aceitas por segurança.
function extractPage(json) {
  if (Array.isArray(json)) return { items: json, total: null };
  const items = json.data ?? json.lawsuits ?? json.items ?? json.results ?? [];
  const total = json.totalCount ?? json.total_count ?? json.total ?? json.meta?.total ?? null;
  return { items: Array.isArray(items) ? items : [], total: total === null ? null : Number(total) };
}

export async function fetchAllLawsuits({ baseUrl, token, pauseMs = 250 }) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await request(baseUrl, token, '/lawsuits', { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const { items, total } = extractPage(json);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (total !== null && all.length >= total) break;
    await sleep(pauseMs);
  }
  return all;
}
