# BE MIND PROPOSALS

Sistema interno da Be Mind Marketing para criar, enviar, rastrear e fechar propostas
comerciais. **PHP 8.2 + MySQL 8**, deploy por FTP em Apache/Nginx. Sem Node em produção.

Este pacote implementa **todos os passos** da ordem de `BACKEND.md`:
esqueleto, banco, instalador, CRUD de clientes/serviços/cloud, Proposta Express,
proposta pública com aceite digital + rastreamento + PDF, wizard completo,
briefings (público 4 passos + geração de proposta), envio por WhatsApp/e-mail,
duplicar/arquivar/renovar, relatórios, notificações, configurações, exportações
CSV, ACL por papel, rate limit, CSP, backup e modo escuro.

## Estrutura

```
bemind_proposals/
├── public/                    docroot
│   ├── index.php              front controller
│   ├── .htaccess              rewrite + cache + segurança
│   ├── favicon.svg
│   ├── assets/{css,js,fonts,images}
│   ├── install/index.php      wizard 6 passos (APAGAR após uso)
│   └── uploads/               logo e anexos (PHP bloqueado)
├── app/
│   ├── Core/                  Autoloader, Router, Db, Session, Csrf, Env, Config,
│   │                          Request, Response, View, Money, Sanitize, Url,
│   │                          RateLimit, Acl
│   ├── Controllers/           Auth · Dashboard · Clients · Services · Cloud
│   │                          · Proposals · ProposalItems · Briefings · Public
│   │                          · Reports · Notifications · Settings · More · Export
│   ├── Models/                Client, Service, CloudPlan, Proposal, Briefing,
│   │                          Notification, CompanySettings, User, ActivityLog
│   ├── Services/              Numbering · Totals · Tracking · Mailer · Whatsapp
│   │                          · Pdf · Csv
│   └── Views/                 layout/{auth,app,public} + telas por controller
├── config/                    config.php (env + segurança), routes.php
├── database/                  schema.sql, seeds.sql, migrations/
├── storage/                   logs/, pdf/, backups/, ratelimit/, installed.lock
├── scripts/backup.sh          dump MySQL + tar de uploads (cron)
├── .env.example
└── .gitignore
```

## Como rodar localmente

### Opção A — Docker (recomendado, um comando)

```bash
cd bemind_proposals
docker compose up -d --build
# depois abra http://localhost:8080/install/
```

Ambiente completo (PHP + MySQL + Adminer). Guia detalhado em
[`DOCKER.md`](DOCKER.md).

### Opção B — PHP embutido (precisa MySQL rodando na máquina)

```bash
cd bemind_proposals
php -S localhost:8080 -t public public/index.php
# 1) http://localhost:8080/install/  — wizard
# 2) http://localhost:8080/login    — entrar como o admin criado
```

## Publicação por FTP

1. Docroot do domínio → `bemind_proposals/public`.
2. Se o docroot for a raiz do projeto (limitação da hospedagem), o `.htaccess`
   da raiz reencaminha tudo para `/public`.
3. Enviar `app/`, `config/`, `database/`, `storage/` **fora do docroot** ou
   protegidos pelo `.htaccess` da raiz.
4. Acesse `/install/`, conclua os 5 passos e **apague `/public/install`**.
5. Cron sugerido para backup:
   `0 3 * * * /caminho/absoluto/bemind_proposals/scripts/backup.sh`

## Rotas (resumo)

**Autenticadas**
- `/dashboard` KPIs, valor aprovado, desempenho, atividade
- `/proposals` lista com filtros de status · `/proposals/{id}` detalhe/rastreamento
- `/proposals/express` fluxo em 4 cards · `/proposals/new` wizard completo
- `/proposals/{id}/wizard?step=0..3` navegação · `/proposals/{id}/pdf` PDF/preview
- Ações: `POST /proposals/{id}/{send,duplicate,archive,renew}`
- Itens (JSON): `/api/proposals/{id}/items[/{itemId}]` · `/api/proposals/{id}/autosave`
- Clientes: `/clients`, `/clients/{id}`, `/clients/new`, `/clients/{id}/edit`
- Serviços: `/services`, `/services/new`, `/services/{id}/edit`
- Cloud: `/cloud`, `/cloud/{id}/edit`
- Briefings: `/briefings`, `/briefings/new`, `/briefings/{id}`, `/briefings/{id}/to-proposal`
- Relatórios: `/reports` · Notificações: `/notifications`
- Config: `/settings` · Mais: `/more`
- Exportações: `/export/{clients|proposals|services}.csv`

**Públicas (sem login, com token)**
- `GET /p/{token}` — proposta online (registra `proposal_views`, muda `enviada → visualizada`)
- `POST /p/{token}/accept` — aceite digital (nome, e-mail, CPF/CNPJ, IP, UA)
- `POST /p/{token}/request-change` — solicitação de alteração
- `POST /p/{token}/decline` — recusa (com motivo opcional)
- `GET /b/{token}` — briefing (4 passos, autosave)
- `POST /b/{token}/save|submit`

## Segurança embutida

- Sessão `HttpOnly`, `Secure`, `SameSite=Lax`, regeneração de id no login.
- `password_hash` (bcrypt/argon) + `password_needs_rehash`.
- **CSRF** em todo `POST/PUT/PATCH/DELETE` (também no `/install`, no aceite, no briefing).
- **PDO** com `ATTR_EMULATE_PREPARES = false` e prepared statements.
- Tokens públicos: `bin2hex(random_bytes(16))`, únicos, revogáveis; `proposals.id`
  nunca é exposto.
- **Rate limit** por IP em login, aceite, alteração, recusa, briefing.
- Sanitização de HTML (HTMLPurifier se presente; senão allowlist).
- Cabeçalhos: HSTS (em HTTPS), CSP moderada, X-Content-Type-Options,
  X-Frame-Options: SAMEORIGIN, Referrer-Policy.
- Uploads: mime/ext validados, renome com `random_bytes`, `.htaccess` no
  `/uploads` bloqueia execução de PHP.
- ACL por papel: `admin` · `comercial` · `editor` · `viewer` (via `Acl::require()`).
- `.env` fora do docroot; instalador auto-bloqueia após `storage/installed.lock`.
- Backup diário via `scripts/backup.sh` (retém 30 dias por padrão).

## Regras de negócio

- **Totais** sempre recalculados no servidor a cada gravação
  (`Totals::recompute($id)`), nunca confiando no cliente.
- **Numeração** `BEMIND-{ano}-{4-dig}` (propostas) e `BRIEF-{ano}-{4-dig}`
  (briefings) com `SELECT ... FOR UPDATE` para evitar colisão.
- **Cloud**: `min_price` R$ 150,00 é piso configurado; qualquer valor manual é
  permitido, com aviso.
- **Aceite**: exige checkbox marcado; grava nome/e-mail/CPF-CNPJ/IP/UA; muda
  status para `aprovada`; notifica empresa e cliente.
- **Autosave**: PATCH com debounce ~800ms; devolve `saved_at` para a UI.
- **Moeda**: sempre `R$ 1.500,00` (`pt-BR`, 2 casas). Nunca `1500.00`.
- **Filtros**: status de proposta e briefing filtram lista e têm equivalente na API.
- **Duplicar**: novo número + token; mesmo escopo, itens, cronograma e textos.
- **Expiração**: `valid_until` no passado exibe "Esta proposta expirou."
  e bloqueia aceite; admin pode renovar.

## Design tokens

Refletidos em `public/assets/css/app.css`: coral `#FB6D62`, ink `#2B2E35`,
gradientes CTA e cloud, badges de status com fundo + texto conforme README de
handoff. Fontes Plus Jakarta Sans + Manrope via Google Fonts (mova para
`/public/assets/fonts` em produção para não depender de CDN).

## Papéis (ACL)

- `admin` — tudo.
- `comercial` — clientes/propostas/briefings/notificações + leitura de serviços/cloud/settings/reports.
- `editor` — serviços/cloud + leitura das demais telas.
- `viewer` — só leitura.

## PDF

- Se **Dompdf** estiver instalado via Composer em `/vendor`, `/proposals/{id}/pdf`
  entrega PDF real.
- Sem Dompdf, o mesmo endpoint devolve o HTML da proposta com CSS `@media print`
  para "Salvar como PDF" no navegador (funciona bem no mobile).

## Roadmap concluído

- [x] 1. Esqueleto + `/install` + schema/seeds.
- [x] 2. Clientes e biblioteca de serviços (CRUD + JSON APIs).
- [x] 3. Proposta Express + numeração + autosave + link com token.
- [x] 4. Proposta pública + tracking + aceite digital + PDF.
- [x] 5. Wizard completo (seções, itens, desconto, cronograma, condições).
- [x] 6. Briefings (público 4 passos + respostas + "gerar proposta").
- [x] 7. Envio WhatsApp/e-mail, duplicar, arquivar, renovar validade.
- [x] 8. Cloud, Relatórios, Notificações, Configurações/PIX, exportações CSV.
- [x] 9. Modo escuro, papéis/permissões, backup diário, revisão de segurança.
