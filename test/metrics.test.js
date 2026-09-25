import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLawsuit,
  computeMetrics,
  applyFilters,
  parseDate,
  topN,
  SEM_INFO,
} from '../public/js/metrics.js';
import { demoLawsuits } from '../src/demo-data.js';

const NOW = new Date(Date.UTC(2026, 8, 25));

test('parseDate aceita formatos comuns e ignora datas vazias', () => {
  assert.equal(parseDate('2026-09-01').toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseDate('2026-09-01 10:00:00').toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseDate('01/09/2026').toISOString().slice(0, 10), '2026-09-01');
  assert.equal(parseDate('0000-00-00'), null);
  assert.equal(parseDate(null), null);
});

test('normalizeLawsuit aceita campos como texto ou objeto', () => {
  const l = normalizeLawsuit({
    id: 7,
    process_number: '0001',
    customers: [{ name: 'Maria' }, 'João'],
    type: { id: 1, name: 'BPC/LOAS' },
    stage: 'Judicial',
    step: null,
    responsible: { name: 'Dra. X' },
    created_at: '2026-01-10 08:00:00',
    status_closure: null,
  });
  assert.equal(l.type, 'BPC/LOAS');
  assert.equal(l.responsible, 'Dra. X');
  assert.equal(l.step, SEM_INFO);
  assert.deepEqual(l.customers, ['Maria', 'João']);
  assert.equal(l.closed, false);
});

test('processo com data de encerramento é contado como encerrado', () => {
  const l = normalizeLawsuit({ id: 1, status_closure: '2026-05-02', created_at: '2025-01-01' });
  assert.equal(l.closed, true);
  assert.equal(l.closedAt, '2026-05-02');
});

test('computeMetrics calcula totais, distribuição e fluxo mensal', () => {
  const list = [
    { id: 1, stage: 'Judicial', responsible: 'A', created_at: '2026-09-10' },
    { id: 2, stage: 'Judicial', responsible: 'B', created_at: '2025-01-10' },
    { id: 3, stage: 'Recursal', created_at: '2026-08-01' },
    { id: 4, stage: 'Judicial', created_at: '2024-01-01', status_closure: '2026-09-05' },
  ].map(normalizeLawsuit);

  const m = computeMetrics(list, { now: NOW });
  assert.equal(m.total, 4);
  assert.equal(m.active, 3);
  assert.equal(m.closed, 1);
  assert.equal(m.new30, 1);
  assert.equal(m.closed30, 1);
  assert.equal(m.withoutResponsible, 1);
  assert.deepEqual(m.byStage, [
    { name: 'Judicial', count: 2 },
    { name: 'Recursal', count: 1 },
  ]);
  assert.equal(m.ageBands.reduce((s, b) => s + b.count, 0), 3);
  const sep = m.monthlyFlow.find((f) => f.month === '2026-09');
  assert.deepEqual(sep, { month: '2026-09', entered: 1, closed: 1 });
  assert.equal(m.monthlyFlow.length, 12);
});

test('applyFilters combina filtros e busca por cliente', () => {
  const list = [
    { id: 1, stage: 'Judicial', customers: [{ name: 'Ana Souza' }] },
    { id: 2, stage: 'Recursal', customers: [{ name: 'Bruno' }] },
    { id: 3, stage: 'Judicial', customers: [{ name: 'Carla' }], status_closure: '2026-01-01' },
  ].map(normalizeLawsuit);
  assert.equal(applyFilters(list, { stage: 'Judicial' }).length, 2);
  assert.equal(applyFilters(list, { stage: 'Judicial', situation: 'active' }).length, 1);
  assert.equal(applyFilters(list, { search: 'souza' })[0].id, 1);
});

test('topN agrupa o excedente em Outros', () => {
  const r = topN([{ name: 'a', count: 5 }, { name: 'b', count: 3 }, { name: 'c', count: 2 }], 1);
  assert.deepEqual(r, [{ name: 'a', count: 5 }, { name: 'Outros', count: 5, other: true }]);
});

test('dados de demonstração geram métricas consistentes', () => {
  const list = demoLawsuits(200, NOW).map(normalizeLawsuit);
  const m = computeMetrics(list, { now: NOW });
  assert.equal(m.active + m.closed, 200);
  assert.equal(m.byStage.reduce((s, e) => s + e.count, 0), m.active);
});
