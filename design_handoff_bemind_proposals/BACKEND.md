# BACKEND.md — stack, banco, API, segurança e publicação

Requisitos definidos pelo cliente (Be Mind Marketing): hospedagem própria, deploy por **FTP**,
**Apache ou Nginx + PHP + MySQL**, sem dependência de Node.js em produção, sem serviços proprietários externos.

## Stack recomendada

- **Backend**: PHP 8.2, sem framework pesado. Router próprio + PDO com prepared statements.
  (Slim 4 via Composer é aceitável — o vendor sobe por FTP junto.)
- **Banco**: MySQL 8 / MariaDB 10.6+, charset `utf8mb4_unicode_ci`.
- **Frontend interno**: build local (Vite + React ou Vue), saída estática em `/public` enviada por FTP.
  Node é usado **só na máquina de build**.
- **Páginas públicas** (proposta e briefing): renderizadas em PHP (Twig ou templates simples) —
  garantem SEO básico, carregamento rápido no celular e funcionam sem JS para leitura.
- **PDF**: Dompdf ou mPDF (PHP puro, sem binário externo). O PDF usa o mesmo layout da proposta online.
- **E-mail**: PHPMailer via SMTP configurado no `.env`.

## Estrutura de pastas

```
/public              index.php, assets/ (css, js, images, fonts), uploads/
/app
  /Controllers       Auth, Dashboard, Clients, Proposals, Services, Cloud, Briefings, Reports, Settings, Public
  /Models            acesso a dados (PDO)
  /Services          Numbering, Money, Pdf, Mailer, Whatsapp, Tracking, Autosave
  /Views             templates das páginas públicas + e-mails
/config              config.php (lê .env), routes.php
/database            schema.sql, seeds.sql, migrations/
/storage             logs/, pdf/, backups/   (fora do docroot)
/install             instalador web (apagar após uso)
.env.example
README.md
```

O docroot do domínio aponta para `/public`. `.env`, `/app`, `/config`, `/storage` **nunca** ficam acessíveis:
manter fora do docroot ou proteger com `.htaccess` (`Require all denied`).

## Banco de dados

Tabelas (todas com `created_at`, `updated_at`; FKs com `ON DELETE RESTRICT` salvo indicado):

- `users` — id, name, email (unique), password_hash, role (`admin|comercial|editor|viewer`), active, last_login_at
- `clients` — id, company_name, trade_name, doc (CPF/CNPJ), contact_name, email, phone, whatsapp, address, city, state, notes
- `client_contacts` — histórico de contatos: id, client_id, type, note, happened_at, user_id
- `service_categories` — id, name, slug, sort_order
- `services` — id, category_id, name, short_description, full_description, deliverables (JSON), lead_time, default_price DECIMAL(12,2), unit (`projeto|hora|mês|ano|unidade|pacote`), recurrence (`unico|mensal|anual`), icon, image, active
- `cloud_plans` — id, name, monthly_price, annual_price, min_price (default 150.00), disk, traffic, sites, mailboxes, databases, ssl, backup, support, migration, notes, active
- `proposals` — id, number (unique, `BEMIND-2026-0001`), public_token (unique, 32 bytes hex), client_id, user_id, title, project, summary, status (`rascunho|enviada|visualizada|negociacao|alteracao|aprovada|recusada|expirada|cancelada`), issue_date, valid_until, payment_terms, terms_text, discount_percent, discount_value, subtotal_monthly, subtotal_once, total_monthly, total_once, currency (`BRL`), template_id, archived_at
- `proposal_sections` — id, proposal_id, kind (`capa|apresentacao|projeto|objetivos|solucao|escopo|investimento|cronograma|diferenciais|condicoes|hospedagem|aceite`), title, body (HTML sanitizado), sort_order, visible
- `proposal_items` — id, proposal_id, service_id (nullable), name, description, deliverables (JSON), lead_time, quantity, unit_price, discount_percent, recurrence, sort_order
- `proposal_schedule` — id, proposal_id, phase, period, sort_order
- `proposal_views` — id, proposal_id, viewed_at, ip, user_agent, device, referrer  ← alimenta o rastreamento
- `proposal_acceptances` — id, proposal_id, name, email, doc, accepted_at, ip, user_agent, terms_version
- `proposal_requests` — pedidos de alteração: id, proposal_id, name, email, message, created_at, resolved_at
- `proposal_templates` — id, name, payload (JSON com seções, itens e textos), created_by
- `briefings` — id, number (`BRIEF-2026-0014`), public_token, client_id (nullable), kind, status (`rascunho|aguardando|respondido`), sent_at, first_viewed_at, answered_at, answers_count, total_questions
- `briefing_questions` — id, section (`empresa|publico|objetivos|projeto`), label, hint, type (`text|textarea|single|multi`), options (JSON), required, sort_order
- `briefing_answers` — id, briefing_id, question_id, value (TEXT ou JSON)
- `company_settings` — singleton: name, logo_path, email, phone, whatsapp, address, doc, site, instagram, bank_info, proposal_prefix (`BEMIND-`), default_validity_days, pix_key, pix_key_type, pix_holder, pix_bank, show_pix_in_proposals
- `notifications` — id, user_id, type, title, body, entity_type, entity_id, read_at
- `activity_logs` — id, user_id (nullable), action, entity_type, entity_id, meta (JSON), ip, created_at
- `attachments` — id, entity_type, entity_id, path, original_name, mime, size
- `payments` (preparado, opcional) — id, proposal_id, due_date, amount, status, paid_at

Índices: `proposals(status, issue_date)`, `proposals(client_id)`, `proposal_views(proposal_id, viewed_at)`,
`proposal_items(proposal_id, sort_order)`, `briefing_answers(briefing_id)`, `activity_logs(entity_type, entity_id)`.

Valores monetários: **DECIMAL(12,2)** no banco. Formatação `R$ 1.500,00` só na apresentação.

## Numeração

`company_settings.proposal_prefix` + ano + sequencial de 4 dígitos, gerado em transação
(`SELECT ... FOR UPDATE` no maior número do ano). Duplicar proposta gera número novo e mantém
estrutura, itens, descrições e valores, trocando cliente, data e número. Mesma regra para `BRIEF-`.

## Endpoints (JSON, sessão autenticada)

```
POST   /api/auth/login | /logout
GET    /api/dashboard                     KPIs, série do gráfico, atividade recente
GET    /api/clients?q= | POST /api/clients | GET|PUT /api/clients/{id}
GET    /api/clients/{id}/proposals
GET    /api/services?category= | POST /api/services | PUT /api/services/{id}
GET    /api/cloud-plans | PUT /api/cloud-plans/{id}
POST   /api/proposals                     cria (do zero, de template ou de briefing)
GET|PUT/api/proposals/{id}                PUT = autosave (payload parcial)
POST   /api/proposals/{id}/items | PUT|DELETE /api/proposals/{id}/items/{itemId}
POST   /api/proposals/{id}/reorder-items
POST   /api/proposals/{id}/send           canal: whatsapp | email; devolve link e mensagem pronta
GET    /api/proposals/{id}/pdf
POST   /api/proposals/{id}/duplicate | /archive | /renew-validity
GET    /api/proposals?status=&q=
GET    /api/briefings?status= | POST /api/briefings | GET /api/briefings/{id}
POST   /api/briefings/{id}/to-proposal    cria proposta com serviços sugeridos pelas respostas
GET    /api/reports?from=&to=
GET|PUT/api/settings
GET    /api/notifications | POST /api/notifications/{id}/read
GET    /api/export/{clients|proposals|services}.csv
```

Públicos, sem sessão (token na URL, nunca id sequencial):

```
GET    /p/{token}                 proposta online (HTML) — registra proposal_views
POST   /p/{token}/accept          aceite digital (nome, e-mail, doc, termos)
POST   /p/{token}/request-change  solicitação de alteração
POST   /p/{token}/decline         recusa
GET    /b/{token}                 briefing (HTML, 4 passos)
POST   /b/{token}/save            autosave de respostas
POST   /b/{token}/submit          envio final
```

## Regras de negócio

1. Preço do item nasce de `services.default_price` e é **sempre editável** na proposta — nada de preço fixo em código.
2. `cloud_plans.min_price` (R$ 150,00) é piso de referência: avisar ao gravar abaixo, mas **permitir**.
3. Totais recalculados no servidor a cada gravação; o valor do cliente nunca é fonte de verdade.
4. Primeiro acesso público muda status `enviada → visualizada` e grava `proposal_views`.
5. Aceite grava `proposal_acceptances` + status `aprovada` + notificação + e-mail para a empresa e para o cliente.
6. `valid_until` no passado → página mostra "Esta proposta expirou." e bloqueia aceite; admin pode renovar.
7. Toda mudança relevante entra em `activity_logs` (criada, preço alterado, enviada, visualizada, alteração solicitada, aprovada).
8. Autosave por PATCH com debounce; devolver `saved_at` para a UI mostrar "Salvo agora".

## Segurança

- `password_hash()` / `password_verify()` (bcrypt ou argon2id).
- Sessões: cookie `HttpOnly`, `Secure`, `SameSite=Lax`, regeneração de id no login, expiração por inatividade.
- **Todas** as queries com prepared statements (PDO, `ATTR_EMULATE_PREPARES = false`).
- Token CSRF em todo POST/PUT/DELETE, inclusive nos formulários públicos.
- Tokens públicos: `bin2hex(random_bytes(16))`, únicos, revogáveis. Nunca expor `proposals.id`.
- Rate limit por IP em `/p/*/accept`, `/b/*/submit` e login (ex.: 10 req/min).
- Sanitizar HTML do editor rico (HTMLPurifier) antes de gravar e ao renderizar.
- Uploads: validar mime e extensão, renomear, gravar em `/public/uploads` sem permissão de execução (`.htaccess` bloqueando PHP).
- Controle de acesso por papel: `admin` (tudo), `comercial` (clientes/propostas), `editor` (conteúdo/serviços), `viewer` (leitura).
- Cabeçalhos: HSTS, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, CSP básica. Forçar HTTPS.
- `.env` fora do docroot; nenhuma credencial no frontend.

## Instalação (`/install`)

Passos do instalador web, executável uma única vez:
1. Checagem de requisitos (PHP ≥ 8.1, extensões `pdo_mysql`, `mbstring`, `gd`, `openssl`, permissão de escrita em `/storage` e `/public/uploads`).
2. Formulário de conexão MySQL → grava `.env`.
3. Executa `database/schema.sql` + `seeds.sql` (categorias, serviços iniciais, planos Cloud, 12 perguntas do briefing).
4. Cria o usuário administrador (nome, e-mail, senha).
5. Dados da empresa (nome, CNPJ, WhatsApp, prefixo das propostas, PIX) e upload do logo.
6. Grava `storage/installed.lock` e instrui a apagar `/install`.

`.env.example`:

```
APP_ENV=production
APP_URL=https://propostas.bemindmarketing.com.br
APP_KEY=
DATABASE_HOST=localhost
DATABASE_NAME=
DATABASE_USER=
DATABASE_PASSWORD=
MAIL_HOST=
MAIL_PORT=587
MAIL_USER=
MAIL_PASSWORD=
MAIL_FROM=contato@bemindmarketing.com.br
COMPANY_WHATSAPP=5566996001122
```

## Publicação por FTP

1. `npm run build` na máquina local → estáticos em `/public/assets`.
2. Enviar por FTP: `/public` para o docroot; `/app`, `/config`, `/database`, `/storage`, `vendor/` (se houver) acima do docroot.
3. Criar o banco no painel da hospedagem, acessar `/install`, concluir, apagar `/install`.
4. Conferir: HTTPS ativo, `.env` inacessível pelo navegador, `/storage` sem listagem, upload de logo funcionando.
5. Backup: dump diário do MySQL + `/public/uploads` para `/storage/backups` (cron do painel) e cópia externa semanal.

## Performance

Lazy loading de imagens, minificação e hash nos assets, `Cache-Control` longo para estáticos e curto para HTML,
gzip/brotli, fontes servidas localmente com `font-display: swap`, índices do banco listados acima,
consultas do dashboard agregadas em uma única chamada. Meta: Lighthouse ≥ 90 nas páginas públicas.

## Ordem de implementação sugerida

1. Esqueleto (router, PDO, sessão, layout autenticado) + `/install` + schema/seeds.
2. Clientes e biblioteca de serviços (CRUD) — base de tudo.
3. Proposta Express + numeração + autosave + link com token.
4. Proposta pública + tracking + aceite digital + PDF.
5. Wizard completo (seções, itens, desconto, cronograma, condições).
6. Briefings (público 4 passos + respostas + "gerar proposta a partir do briefing").
7. Envio por WhatsApp/e-mail, duplicar, arquivar, templates.
8. Be Mind Cloud, relatórios, notificações, configurações/PIX, exportações CSV.
9. Modo escuro, papéis/permissões, backup, revisão de segurança e responsividade.
