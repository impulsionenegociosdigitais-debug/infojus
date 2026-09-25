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
cp .env.example .env      # preencha ADVBOX_API_TOKEN e, se quiser login local, DASHBOARD_USERS
npm start                 # abre em http://127.0.0.1:3000
```

Sem token configurado, o painel sobe com dados fictícios de demonstração (`npm run demo` força esse modo), sinalizados no topo da página.

O token fica apenas no servidor: o navegador consulta `/api/lawsuits`, que busca todas as páginas de `GET /lawsuits` no ADVbox e guarda o resultado em cache por 15 minutos (`CACHE_MINUTES`). O botão "Atualizar dados" força uma nova leitura.

### Login

O acesso é feito com usuário e senha. Os usuários ficam na variável `DASHBOARD_USERS`, no formato `usuario:senha`, separados por vírgula:

```
DASHBOARD_USERS=maite:UmaSenhaForte123,joao:OutraSenhaForte456
```

Para não gravar a senha em texto, gere a versão criptografada com `npm run hash-password -- maite` e use a linha que o comando imprime.

- A sessão dura 12 horas. Depois disso é preciso entrar de novo.
- Depois de 8 tentativas erradas, o endereço de origem fica bloqueado por 15 minutos.
- `SESSION_SECRET` é opcional. Sem ela, a chave das sessões é derivada da lista de usuários.
- Sem nenhum usuário cadastrado, o painel só aceita acesso do próprio computador. Se `HOST` apontar para fora dele, o servidor se recusa a iniciar.

### Publicar para a equipe (Vercel)

O repositório já traz o `vercel.json` com a configuração pronta. Na Vercel, todas as páginas e dados passam pela função `api/index.js`, que exige login antes de mostrar qualquer coisa.

1. Crie uma conta em https://vercel.com entrando com a conta do GitHub (o plano Hobby é gratuito).
2. Clique em **Add New** e depois em **Project**. Importe o repositório `infojus`.
3. Em **Environment Variables**, cadastre:
   - `DASHBOARD_USERS`: os usuários e senhas, como no exemplo acima. Obrigatório.
   - `ADVBOX_API_TOKEN`: o token de API do ADVbox. Enquanto não existir, deixe sem cadastrar e o painel mostra dados fictícios.
   - `SESSION_SECRET`: opcional. Sem ela, a chave das sessões é derivada da lista de usuários, e todos precisam entrar de novo quando a lista muda.
4. Clique em **Deploy**. Ao terminar, a Vercel mostra o endereço, no formato `https://infojus-xxxx.vercel.app`.

Para incluir ou remover pessoas, ou para colocar o token do ADVbox depois, altere as variáveis em **Settings > Environment Variables** e faça um novo deploy em **Deployments > Redeploy**.

Na Vercel, o limite de tentativas de login vale por instância da função. Ele dificulta a tentativa de adivinhar senhas, mas não substitui senhas fortes.

Também há um `Dockerfile` para publicar em provedores que rodam contêineres. Nesse caso, defina `DASHBOARD_USERS`, `ADVBOX_API_TOKEN` e `TRUST_PROXY=1` quando houver HTTPS na frente do serviço.

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
