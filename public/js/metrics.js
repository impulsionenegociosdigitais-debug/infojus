// Normalização e agregação dos processos do ADVbox.
// Módulo sem dependências, usado tanto pelo servidor quanto pelo navegador.

const DAY_MS = 24 * 60 * 60 * 1000;

export const SEM_INFO = 'Não informado';

// A API do ADVbox pode devolver campos como texto simples ou como objeto
// ({ id, name }). Esta função aceita as duas formas.
function label(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    return label(value.name ?? value.title ?? value.description ?? value.label ?? '');
  }
  return '';
}

function firstOf(obj, keys) {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// Aceita "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS", ISO e "DD/MM/YYYY".
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    if (m[1] === '0000') return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  return null;
}

function toISODate(d) {
  return d ? d.toISOString().slice(0, 10) : null;
}

function customerNames(raw) {
  const list = raw.customers ?? raw.clients ?? raw.customer ?? [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.map(label).filter(Boolean);
}

export function normalizeLawsuit(raw) {
  const closureDate = parseDate(
    firstOf(raw, ['status_closure', 'closure_date', 'date_closure', 'exit_date', 'closed_at'])
  );
  const processDate = parseDate(firstOf(raw, ['process_date', 'date', 'distribution_date']));
  const createdAt = parseDate(firstOf(raw, ['created_at', 'created', 'registration_date']));
  const statusText = label(firstOf(raw, ['status', 'situation']));
  const closedByStatus = /encerrad|arquivad|finalizad|baixad|closed/i.test(statusText);

  return {
    id: raw.id ?? raw.lawsuit_id ?? null,
    processNumber: label(firstOf(raw, ['process_number', 'number', 'cnj'])),
    protocolNumber: label(raw.protocol_number),
    folder: label(raw.folder),
    customers: customerNames(raw),
    type: label(firstOf(raw, ['type', 'type_lawsuit', 'lawsuit_type'])) || SEM_INFO,
    group: label(firstOf(raw, ['group', 'group_name'])) || SEM_INFO,
    stage: label(firstOf(raw, ['stage', 'stage_name'])) || SEM_INFO,
    step: label(firstOf(raw, ['step', 'step_name'])) || SEM_INFO,
    responsible: label(firstOf(raw, ['responsible', 'responsible_name', 'user'])) || SEM_INFO,
    processDate: toISODate(processDate),
    createdAt: toISODate(createdAt),
    closedAt: toISODate(closureDate),
    closed: Boolean(closureDate) || closedByStatus,
  };
}

// Data de início usada para calcular a idade do processo.
function startDate(l) {
  return parseDate(l.processDate) ?? parseDate(l.createdAt);
}

export function ageInDays(l, now = new Date()) {
  const start = startDate(l);
  if (!start) return null;
  const end = l.closed ? parseDate(l.closedAt) ?? now : now;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export function countBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const k = typeof key === 'function' ? key(item) : item[key];
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

// Mantém os N maiores itens e soma o restante em "Outros".
export function topN(entries, n) {
  if (entries.length <= n) return entries;
  const head = entries.slice(0, n);
  const rest = entries.slice(n).reduce((s, e) => s + e.count, 0);
  return [...head, { name: 'Outros', count: rest, other: true }];
}

export const AGE_BANDS = [
  { name: 'Até 6 meses', max: 182 },
  { name: '6 a 12 meses', max: 365 },
  { name: '1 a 2 anos', max: 730 },
  { name: '2 a 5 anos', max: 1826 },
  { name: 'Mais de 5 anos', max: Infinity },
];

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(monthKey(d));
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeMetrics(lawsuits, { now = new Date(), months = 12 } = {}) {
  const active = lawsuits.filter((l) => !l.closed);
  const closed = lawsuits.filter((l) => l.closed);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const entered = (l) => parseDate(l.createdAt) ?? parseDate(l.processDate);
  const new30 = lawsuits.filter((l) => {
    const d = entered(l);
    return d && d >= since30 && d <= now;
  }).length;
  const closed30 = closed.filter((l) => {
    const d = parseDate(l.closedAt);
    return d && d >= since30 && d <= now;
  }).length;

  const activeAges = active.map((l) => ageInDays(l, now)).filter((v) => v !== null);
  const closedDurations = closed
    .filter((l) => l.closedAt)
    .map((l) => ageInDays(l, now))
    .filter((v) => v !== null);

  const ageBands = AGE_BANDS.map((b) => ({ name: b.name, count: 0 }));
  for (const age of activeAges) {
    const idx = AGE_BANDS.findIndex((b) => age < b.max);
    ageBands[idx].count++;
  }

  const monthKeys = lastMonths(months, now);
  const flow = new Map(monthKeys.map((k) => [k, { month: k, entered: 0, closed: 0 }]));
  for (const l of lawsuits) {
    const e = entered(l);
    if (e && flow.has(monthKey(e))) flow.get(monthKey(e)).entered++;
    const c = parseDate(l.closedAt);
    if (c && flow.has(monthKey(c))) flow.get(monthKey(c)).closed++;
  }

  return {
    total: lawsuits.length,
    active: active.length,
    closed: closed.length,
    new30,
    closed30,
    medianActiveAgeDays: median(activeAges),
    medianClosedDurationDays: median(closedDurations),
    withoutResponsible: active.filter((l) => l.responsible === SEM_INFO).length,
    byStage: countBy(active, 'stage'),
    byStep: countBy(active, 'step'),
    byResponsible: countBy(active, 'responsible'),
    byType: countBy(active, 'type'),
    byGroup: countBy(active, 'group'),
    ageBands,
    monthlyFlow: [...flow.values()],
  };
}

export function applyFilters(lawsuits, f = {}) {
  const q = (f.search ?? '').trim().toLowerCase();
  return lawsuits.filter((l) => {
    if (f.situation === 'active' && l.closed) return false;
    if (f.situation === 'closed' && !l.closed) return false;
    if (f.responsible && l.responsible !== f.responsible) return false;
    if (f.stage && l.stage !== f.stage) return false;
    if (f.type && l.type !== f.type) return false;
    if (f.group && l.group !== f.group) return false;
    if (q) {
      const hay = [l.processNumber, l.protocolNumber, l.folder, ...l.customers]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
