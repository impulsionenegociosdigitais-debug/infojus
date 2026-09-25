// Gera processos fictícios para visualizar o painel sem um token do ADVbox.
// Nenhum dado aqui corresponde a processos ou pessoas reais.

const STAGES = [
  ['Administrativo', 14],
  ['Judicial', 40],
  ['Recursal', 14],
  ['Execução', 10],
  ['Cumprimento de sentença', 8],
  ['Acordo', 4],
];
const STEPS = [
  ['Aguardando protocolo', 8],
  ['Aguardando citação', 9],
  ['Aguardando perícia', 12],
  ['Aguardando audiência', 10],
  ['Aguardando sentença', 14],
  ['Prazo em aberto', 7],
  ['Aguardando retorno do cliente', 6],
  ['Aguardando documentos', 6],
  ['Aguardando RPV/Precatório', 8],
  ['Aguardando julgamento do recurso', 9],
];
const TYPES = [
  ['Aposentadoria rural', 18],
  ['Aposentadoria urbana', 12],
  ['BPC/LOAS', 16],
  ['Auxílio por incapacidade', 18],
  ['Pensão por morte', 8],
  ['Salário-maternidade', 8],
  ['Reclamação trabalhista', 12],
  ['Cível', 8],
];
const GROUPS = [
  ['Previdenciário', 70],
  ['Trabalhista', 14],
  ['Cível', 16],
];
const RESPONSIBLES = [
  ['Advogado(a) A', 30],
  ['Advogado(a) B', 24],
  ['Advogado(a) C', 18],
  ['Estagiário(a) D', 12],
  ['', 4],
];

// Gerador pseudoaleatório determinístico, para o demo ser estável.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pick(rand, weighted) {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weighted) {
    if ((r -= w) < 0) return v;
  }
  return weighted[weighted.length - 1][0];
}

const iso = (d) => d.toISOString().slice(0, 10);

export function demoLawsuits(count = 420, now = new Date()) {
  const rand = rng(20260925);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const ageDays = Math.floor(rand() ** 1.6 * 365 * 6);
    const created = new Date(now.getTime() - ageDays * 86400000);
    const closed = rand() < 0.32;
    let closure = null;
    if (closed) {
      const dur = Math.floor(ageDays * (0.3 + rand() * 0.7));
      closure = new Date(created.getTime() + dur * 86400000);
    }
    const seq = String(1000000 + i).slice(1);
    out.push({
      id: i,
      process_number: `${seq}-${String(10 + (i % 89))}.${created.getUTCFullYear()}.8.00.0000`,
      protocol_number: null,
      folder: `P-${String(i).padStart(4, '0')}`,
      customers: [{ name: `Cliente ${String(i).padStart(4, '0')}` }],
      type: pick(rand, TYPES),
      group: pick(rand, GROUPS),
      stage: pick(rand, STAGES),
      step: pick(rand, STEPS),
      responsible: pick(rand, RESPONSIBLES),
      process_date: iso(created),
      created_at: `${iso(created)} 09:00:00`,
      status_closure: closure ? iso(closure) : null,
    });
  }
  return out;
}
