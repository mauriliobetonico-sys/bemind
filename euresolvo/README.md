# EU RESOLVO — Marketplace de Instalação de Comunicação Visual

Plataforma completa: **Portal Empresa**, **Portal Instalador**, **Portal Admin**, **site institucional**, **API REST**, **WebSocket** para tempo real, integração com **Mercado Pago (PIX + escrow)** e ledger financeiro imutável.

Stack: **PHP 8.1+**, **MySQL/MariaDB**, **Node.js (WebSocket)**, HTML/CSS/JS vanilla nos portais (sem build step). Foi desenhada para hospedagem própria (VPS, cPanel, Docker) e para ser extensível sem quebrar o que já está em produção.

## Arquitetura em uma olhada

```
euresolvo/
├── index.php              # roteador da API (/api/v1/*)
├── .htaccess              # reescreve rotas + security headers
├── .env.example           # copie para .env e preencha
├── config/
│   ├── database.php       # PDO + schema (installDB executa migrações)
│   ├── auth.php           # JWT HS256 + refresh tokens + CPF/CNPJ
│   ├── ledger.php         # carteira, escrow, comissão (append-only)
│   ├── matching.php       # algoritmo de match (score ponderado)
│   ├── payments.php       # Mercado Pago (PIX/cartão/payout)
│   ├── notifications.php  # WS broadcast, n8n webhooks, e-mail
│   └── storage.php        # upload de arquivos
├── routes/                # uma rota por recurso
│   ├── auth.php           # register/login/refresh/logout/me
│   ├── me.php             # dados do usuário logado + KPI
│   ├── companies.php      # empresa + filiais + centros de custo
│   ├── installers.php     # instalador + docs + status
│   ├── orders.php         # ciclo completo da OS + timeline
│   ├── offers.php         # aceite/recusa/contra-proposta
│   ├── chat.php           # mensagens por OS
│   ├── tracking.php       # pings de localização
│   ├── ratings.php        # avaliações bidirecionais
│   ├── payments.php       # cobrança PIX/cartão → escrow
│   ├── wallets.php        # saldo, extrato, saque PIX
│   ├── admin.php          # KPIs, financeiro, tickets, disputas
│   ├── leads.php          # captura do site + gestão
│   ├── webhook.php        # PSP webhooks (Mercado Pago)
│   └── notifications.php  # in-app notifications
├── portals/               # SPAs (HTML+JS vanilla)
│   ├── login.html
│   ├── empresa.html
│   ├── instalador.html
│   └── admin.html
├── site/index.html        # landing + lead capture
├── legal/                 # termos, privacidade, LGPD, sobre, ...
├── assets/
│   ├── css/app.css
│   └── js/app.js          # ER.api, ER.auth, ER.ws, ER.theme, ER.toast
├── uploads/               # storage local (permissão 775)
└── scripts/install.sh     # setup one-shot
```

## Instalação rápida (VPS Linux)

```bash
# 1. Clone o repositório na raiz do site
cd /var/www && sudo git clone <repo> bemind && cd bemind/euresolvo

# 2. Configure o .env
cp .env.example .env && nano .env
#   → DB_HOST, DB_NAME, DB_USER, DB_PASS
#   → APP_URL, JWT_SECRET (gere: php -r "echo bin2hex(random_bytes(32));")
#   → MP_ACCESS_TOKEN (sandbox primeiro)

# 3. Rode o instalador (cria schema, valida extensões)
./scripts/install.sh

# 4. Suba o WebSocket
cd ../websocket && npm install && pm2 start server.js --name er-ws

# 5. Configure o virtualhost (Apache OU Nginx)
#    - Apache: aponte DocumentRoot para euresolvo/ (o .htaccess resolve tudo)
#    - Nginx:  use docker/nginx/euresolvo.conf como base
```

Acesse `https://SEU_DOMINIO/`.  
Admin bootstrap: **admin@euresolvo.com.br** / **admin123** — troque imediatamente.

## Hospedagem compartilhada (cPanel, HostGator, etc.)

1. Envie tudo dentro de `euresolvo/` para o `public_html/` do domínio.
2. Crie o banco pelo painel e edite `.env` com as credenciais.
3. Abra `https://SEUDOMINIO/` — o `installDB()` cria as tabelas automaticamente na primeira request.
4. Para WebSocket em shared host, use um servidor separado (VPS pequena) ou desative real-time inicialmente (o app degrada com polling manual).

## Extensibilidade (o que muda no futuro sem dor)

- **Novos endpoints**: crie `routes/foo.php`, adicione um `case` em `index.php`.
- **Novos campos**: acrescente `ALTER TABLE` em `config/database.php` (função `installDB` é idempotente com `CREATE TABLE IF NOT EXISTS`; para migração use scripts numerados em `migrations/`).
- **Pesos do algoritmo de match**: ajuste `W_DISTANCE`, `W_RATING` etc. no `.env` — sem tocar código.
- **Comissão**: cadastre `commission_rules` por categoria e nível pelo Portal Admin.
- **Trocar PSP**: `config/payments.php` isola Mercado Pago; adicione `stripePayoutPix()` seguindo o padrão.
- **Trocar mapa**: `.env` `MAPS_PROVIDER=google|mapbox` + `MAPS_API_KEY` (portais usam Leaflet+OSM por padrão, gratuito).
- **App mobile**: reuse a mesma API REST + WebSocket. O padrão Uber está descrito no handoff — construa em Flutter/React Native contra `/api/v1/*`.

## Segurança embutida

- **JWT HS256** curto (24h) + refresh rotativo (30d) armazenado hasheado.
- **Rate limiting** por IP no MySQL (`er_rate_limits`), reforço extra em `/auth/*` e `/leads`.
- **bcrypt cost 12** para senhas + lock automático (5 tentativas → 10min).
- **Validação de CPF/CNPJ** com dígitos verificadores.
- **CORS restrito** a `APP_URL`.
- **Headers**: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.
- **Uploads**: extensão whitelist + limite de tamanho + PHP bloqueado dentro de `/uploads`.
- **Idempotência de webhook**: dedup por `event_id` em `webhook_events`.
- **Escrow ledger append-only**: saldo é sempre derivado — nunca alterado diretamente. Toda linha de `ledger_entries` gera o novo saldo dentro de uma transação com `FOR UPDATE`.
- **Auditoria imutável**: toda ação sensível em `audit_logs`.

## Regras de negócio implementadas

- **Máquina de estados da OS**: `draft → published → matched → accepted → en_route → checked_in → in_progress → completed → paid_out` (com `cancelled` e `disputed` como ramos).
- **Match ponderado**: distância (30) + especialidade (20) + nota (15) + aceitação (10) + cancelamento (10) + nível (10) + requisitos (5). Pesos ajustáveis via `.env`. Boost de +5 para instaladores online.
- **Modo automático** envia oferta ao melhor score; **manual** envia para top 5.
- **Escrow**: valor da empresa vai para carteira da plataforma marcado como `hold`. Na conclusão, `release` + `commission` + `debit` na plataforma + `credit` no instalador — tudo dentro de uma única transação SQL.
- **Comissão configurável** por categoria e nível — regra mais específica vence.
- **Níveis**: bronze → prata → ouro → diamante (dispara boost no match).
- **Payouts PIX** on-demand com trava de KYC (só se `status='aprovado'` e `pix_key` cadastrada).

## Integrações externas

| Serviço | Onde | Como habilitar |
|---|---|---|
| Mercado Pago (PIX/cartão/payout) | `config/payments.php` | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` no `.env` |
| Stripe (opcional) | placeholder em `payments.php` + `webhook.php` | Adicione as chaves e implemente `stripe*` |
| n8n (automação) | `notifications.php` `n8nTrigger()` | `N8N_WEBHOOK_BASE` no `.env` |
| WebSocket | `websocket/server.js` | `pm2 start websocket/server.js --name er-ws` |
| Mapas | Leaflet + OpenStreetMap por padrão (grátis) | Troque em `assets/js/app.js` se quiser Google/Mapbox |

## Endpoints principais

Todos sob `/api/v1/`, com `Authorization: Bearer <token>`.

- `POST /auth/register` `{role, name, email, password, cpf|cnpj, phone}`
- `POST /auth/login` `{email, password}` → `{token, refresh, user}`
- `GET  /me` → dados do usuário + empresa/instalador + KPIs
- `POST /service-orders` cria OS em `draft`
- `POST /service-orders/:id/publish` roda o match, envia ofertas
- `POST /offers/:id/accept|reject|counter`
- `POST /service-orders/:id/status {to: en_route|checked_in|in_progress|completed}`
- `POST /payments/fund/:order_id` cria cobrança PIX/cartão
- `POST /webhook/mercadopago` (público, idempotente)
- `GET  /wallets/me/statement` extrato completo
- `POST /wallets/me/payout {amount}` saca PIX
- `GET  /admin/dashboard | /financials | /audit | /heatmap`
- `POST /leads` (público, com rate limit)

Documentação completa das rotas está em `routes/*.php` — cada handler traz o método, corpo esperado e retorno.

## Observabilidade

- `GET /api/v1/health` responde estado do DB e WS.
- `audit_logs` para tudo que é sensível.
- Logs de erro do PHP em `error_log` (stderr do webserver).

## Roadmap sugerido (fora do escopo desta entrega)

- App mobile Flutter/React Native (a API já suporta — só consumir).
- Migração para Postgres + PostGIS caso a base geoespacial cresça (o `matching.php` já isola a busca).
- Habilitar Metabase (docker-compose já traz) apontando para o banco `euresolvo` para BI executivo.
- CI/CD via Jenkins (Jenkinsfile já presente).
- Registro como Instituição de Pagamento (IP) no BACEN se o volume ultrapassar o teto dos parceiros PSP.

---

**Suporte técnico**: consulte os comentários em cada arquivo — foram deixados propositalmente para você não precisar de mim a cada evolução.
