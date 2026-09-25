# infojus

Sistema de Metrificação de processos.

## Dashboard de status dos processos (ADVbox)

Painel web que lê os processos cadastrados no ADVbox pela API oficial e mostra:

- Indicadores: total, ativos, encerrados, novos e encerrados nos últimos 30 dias, tempo mediano dos ativos, duração mediana dos encerrados e ativos sem responsável.
- Processos ativos por fase, por etapa, por responsável e por tipo de ação.
- Faixas de tempo de tramitação dos processos ativos.
- Entradas e encerramentos mês a mês (últimos 12 meses).
- Tabela de processos com busca, ordenação e filtro de situação.

Os filtros (responsável, fase, tipo, grupo e busca) valem para todo o painel. Clicar em uma barra de fase, responsável ou tipo aplica o filtro correspondente.

### Como rodar

Requisito: Node.js 18 ou superior. Não há dependências para instalar.

```bash
cp .env.example .env      # preencha ADVBOX_API_TOKEN
npm start                 # abre em http://127.0.0.1:3000
```

Sem token configurado, o painel sobe com dados fictícios de demonstração (`npm run demo` força esse modo), sinalizados no topo da página.

O token fica apenas no servidor: o navegador consulta `/api/lawsuits`, que busca todas as páginas de `GET /lawsuits` no ADVbox e guarda o resultado em cache por 15 minutos (`CACHE_MINUTES`). O botão "Atualizar dados" força uma nova leitura.

### Como os dados são interpretados

| Painel | Campo do ADVbox |
|---|---|
| Fase | `stage` |
| Etapa | `step` |
| Responsável | `responsible` |
| Tipo de ação | `type` |
| Grupo | `group` |
| Encerrado | `status_closure` preenchido (ou status contendo "encerrado"/"arquivado") |
| Data de entrada | `created_at`, ou `process_date`/`date` na falta dele |

Campos que chegam como objeto (`{ id, name }`) ou como texto são aceitos. Se a sua conta usar nomes de campo diferentes, ajuste `normalizeLawsuit` em `public/js/metrics.js`.

### Testes

```bash
npm test
```
