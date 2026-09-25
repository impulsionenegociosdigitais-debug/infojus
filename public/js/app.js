import { applyFilters, computeMetrics, topN, ageInDays } from './metrics.js';

const PAGE_SIZE = 50;
const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('pt-BR');
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const state = {
  all: [],
  filters: { responsible: '', stage: '', type: '', group: '', search: '' },
  situation: 'active',
  sort: { key: 'age', dir: 'desc' },
  page: 0,
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function duration(days) {
  if (days === null || days === undefined) return 'Sem dados';
  if (days < 60) return `${fmt.format(days)} dias`;
  if (days < 730) return `${fmt.format(Math.round(days / 30.4))} meses`;
  return `${(days / 365).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTHS[+m - 1]}/${y.slice(2)}`;
}

// ---------- Tooltip ----------
const tooltip = $('#tooltip');
function showTip(evt, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 12;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = tooltip.getBoundingClientRect();
  const x = evt.clientX ?? evt.target.getBoundingClientRect().right;
  const y = evt.clientY ?? evt.target.getBoundingClientRect().top;
  tooltip.style.left = `${Math.min(x + pad, w - rect.width - pad)}px`;
  tooltip.style.top = `${Math.min(y + pad, h - rect.height - pad)}px`;
}
function hideTip() {
  tooltip.hidden = true;
}
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(e, el.dataset.tip);
});
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && !tooltip.hidden) showTip(e, el.dataset.tip);
  else if (!el) hideTip();
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(e, el.dataset.tip);
});
document.addEventListener('focusout', hideTip);

// ---------- Indicadores ----------
function renderKpis(m) {
  const share = m.total ? m.active / m.total : 0;
  const tiles = [
    { label: 'Total de processos', value: fmt.format(m.total) },
    { label: 'Ativos', value: fmt.format(m.active), hint: `${pct.format(share)} do total` },
    { label: 'Encerrados', value: fmt.format(m.closed) },
    { label: 'Novos nos últimos 30 dias', value: fmt.format(m.new30) },
    { label: 'Encerrados nos últimos 30 dias', value: fmt.format(m.closed30) },
    { label: 'Tempo mediano dos ativos', value: duration(m.medianActiveAgeDays) },
    { label: 'Duração mediana dos encerrados', value: duration(m.medianClosedDurationDays) },
    { label: 'Ativos sem responsável', value: fmt.format(m.withoutResponsible) },
  ];
  $('#kpis').innerHTML = tiles
    .map(
      (t) => `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div>${
        t.hint ? `<div class="hint">${t.hint}</div>` : ''
      }</div>`
    )
    .join('');
}

// ---------- Barras horizontais ----------
function renderHBars(el, entries, total) {
  const filterKey = el.dataset.filter;
  if (!entries.length) {
    el.innerHTML = '<div class="empty">Nenhum processo ativo com os filtros atuais.</div>';
    return;
  }
  const max = Math.max(...entries.map((e) => e.count));
  const tag = filterKey ? 'button' : 'div';
  el.innerHTML = entries
    .map((e) => {
      const share = total ? pct.format(e.count / total) : '';
      const tip = `<b>${escapeHtml(e.name)}</b><div class="row"><span>Processos</span><span>${fmt.format(e.count)}</span></div><div class="row"><span>Participação</span><span>${share}</span></div>`;
      const selected = filterKey && state.filters[filterKey] === e.name;
      const clickable = filterKey && !e.other;
      return `<${tag} class="hbar${e.other ? ' other' : ''}${selected ? ' selected' : ''}" ${
        clickable ? `type="button" data-value="${escapeHtml(e.name)}"` : 'tabindex="0"'
      } data-tip="${escapeHtml(tip)}">
        <span class="name">${escapeHtml(e.name)}</span>
        <span class="bar"><i style="width:${(e.count / max) * 100}%"></i></span>
        <span class="val">${fmt.format(e.count)}</span>
      </${tag}>`;
    })
    .join('');
}

document.querySelectorAll('.hbars[data-filter]').forEach((el) => {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    const key = el.dataset.filter;
    state.filters[key] = state.filters[key] === btn.dataset.value ? '' : btn.dataset.value;
    $('#filters').elements[key].value = state.filters[key];
    state.page = 0;
    render();
  });
});

// ---------- Fluxo mensal ----------
function renderFlow(flow) {
  const max = Math.max(1, ...flow.flatMap((f) => [f.entered, f.closed]));
  $('#chart-flow').innerHTML = flow
    .map((f) => {
      const saldo = f.entered - f.closed;
      const tip = `<b>${monthLabel(f.month)}</b><div class="row"><span>Entradas</span><span>${fmt.format(f.entered)}</span></div><div class="row"><span>Encerramentos</span><span>${fmt.format(f.closed)}</span></div><div class="row"><span>Saldo</span><span>${saldo > 0 ? '+' : ''}${fmt.format(saldo)}</span></div>`;
      return `<div class="col" tabindex="0" data-tip="${escapeHtml(tip)}">
        <div class="pair">
          <i class="e" style="height:${(f.entered / max) * 100}%"></i>
          <i class="c" style="height:${(f.closed / max) * 100}%"></i>
        </div>
        <div class="m">${monthLabel(f.month)}</div>
      </div>`;
    })
    .join('');
}

// ---------- Tabela ----------
function sortValue(l, key) {
  if (key === 'age') return l._age ?? -1;
  if (key === 'customers') return l.customers.join(', ');
  return l[key] ?? '';
}

function renderTable(list) {
  const { key, dir } = state.sort;
  const rows = list
    .map((l) => ({ ...l, _age: ageInDays(l) }))
    .sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
      return dir === 'asc' ? cmp : -cmp;
    });

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const slice = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  $('#table-count').textContent = `(${fmt.format(rows.length)})`;
  $('#rows').innerHTML = slice.length
    ? slice
        .map(
          (l) => `<tr>
        <td><span class="status${l.closed ? ' closed' : ''}" title="${l.closed ? 'Encerrado' : 'Ativo'}">${escapeHtml(l.processNumber || l.folder || `#${l.id}`)}</span></td>
        <td title="${escapeHtml(l.customers.join(', '))}">${escapeHtml(l.customers.join(', '))}</td>
        <td>${escapeHtml(l.type)}</td>
        <td>${escapeHtml(l.stage)}</td>
        <td>${escapeHtml(l.step)}</td>
        <td>${escapeHtml(l.responsible)}</td>
        <td class="num">${l._age === null ? '' : fmt.format(l._age)}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty">Nenhum processo encontrado.</td></tr>';

  $('#page-info').textContent = `Página ${state.page + 1} de ${pages}`;
  $('#prev').disabled = state.page === 0;
  $('#next').disabled = state.page >= pages - 1;
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.sort === key);
    th.classList.toggle('asc', th.dataset.sort === key && dir === 'asc');
  });
}

document.querySelectorAll('th[data-sort]').forEach((th) =>
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'age' ? 'desc' : 'asc' };
    render();
  })
);
$('#prev').addEventListener('click', () => { state.page--; render(); });
$('#next').addEventListener('click', () => { state.page++; render(); });
$('#situation').addEventListener('change', (e) => { state.situation = e.target.value; state.page = 0; render(); });

// ---------- Filtros ----------
function fillSelect(select, values, current) {
  const opts = ['<option value="">Todos</option>']
    .concat(values.map((v) => `<option${v === current ? ' selected' : ''}>${escapeHtml(v)}</option>`));
  select.innerHTML = opts.join('');
}

function populateFilters() {
  const form = $('#filters');
  for (const key of ['responsible', 'stage', 'type', 'group']) {
    const values = [...new Set(state.all.map((l) => l[key]))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (state.filters[key] && !values.includes(state.filters[key])) state.filters[key] = '';
    fillSelect(form.elements[key], values, state.filters[key]);
  }
}

$('#filters').addEventListener('input', (e) => {
  const { name, value } = e.target;
  if (name in state.filters) {
    state.filters[name] = value;
    state.page = 0;
    render();
  }
});
$('#filters').addEventListener('reset', () => {
  setTimeout(() => {
    for (const k of Object.keys(state.filters)) state.filters[k] = '';
    state.page = 0;
    render();
  });
});

// ---------- Renderização ----------
function render() {
  const scoped = applyFilters(state.all, state.filters);
  const m = computeMetrics(scoped);
  renderKpis(m);
  renderHBars($('#chart-stage'), topN(m.byStage, 12), m.active);
  renderHBars($('#chart-step'), topN(m.byStep, 10), m.active);
  renderHBars($('#chart-responsible'), topN(m.byResponsible, 12), m.active);
  renderHBars($('#chart-type'), topN(m.byType, 12), m.active);
  renderHBars($('#chart-age'), m.ageBands, m.active);
  renderFlow(m.monthlyFlow);
  renderTable(applyFilters(state.all, { ...state.filters, situation: state.situation }));
}

async function load(refresh = false) {
  const btn = $('#refresh');
  btn.disabled = true;
  btn.textContent = 'Carregando…';
  $('#error').hidden = true;
  try {
    const res = await fetch(`/api/lawsuits${refresh ? '?refresh=1' : ''}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    state.all = body.lawsuits;
    const demo = body.source === 'demo';
    $('#source').textContent = demo ? 'Demonstração' : 'ADVbox';
    $('#demo-note').hidden = !demo;
    $('#updated').textContent = `Atualizado em ${new Date(body.fetchedAt).toLocaleString('pt-BR')}`;
    populateFilters();
    render();
  } catch (err) {
    $('#error').textContent = `Não foi possível carregar os processos: ${err.message}`;
    $('#error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Atualizar dados';
  }
}

$('#refresh').addEventListener('click', () => load(true));
load();
