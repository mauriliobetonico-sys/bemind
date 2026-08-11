# BE MIND PROPOSALS

Sistema interno da Be Mind Marketing para criar, enviar, rastrear e fechar propostas comerciais.
Stack: **PHP 8.2 + MySQL 8**, deploy por FTP em Apache/Nginx, sem Node em produção.

Este repositório está no passo 1 da ordem de implementação (`BACKEND.md`):
esqueleto do servidor + instalador web + `schema.sql`/`seeds.sql`.

## Estrutura

```
bemind_proposals/
├── public/                    docroot
│   ├── index.php              front controller
│   ├── .htaccess              rewrite + segurança
│   ├── assets/css/app.css     tokens do design (coral, ink, jakarta, manrope)
│   ├── install/index.php      instalador wizard (APAGAR após uso)
│   └── uploads/               logo e anexos (PHP bloqueado)
├── app/
│   ├── Core/                  Router, Db, Session, Csrf, Env, Config, View, Money
│   ├── Controllers/           Auth, Dashboard, Public (placeholders)
│   ├── Models/                (passos 2+)
│   ├── Services/              (passos 3+)
│   └── Views/
│       ├── layout/            app.php (autenticado), auth.php (login)
│       ├── auth/login.php
│       └── dashboard/index.php
├── config/                    config.php, routes.php
├── database/                  schema.sql, seeds.sql, migrations/
├── storage/                   logs/, pdf/, backups/, installed.lock (após instalar)
├── .env.example
└── .gitignore
```

## Instalação local (rápida)

Requisitos: PHP ≥ 8.1 com `pdo_mysql`, `mbstring`, `gd`, `openssl`; MySQL 8 ou MariaDB 10.6+.

```bash
cd bemind_proposals
php -S localhost:8080 -t public public/index.php
# abra http://localhost:8080/install/
```

Passos do instalador:

1. **Requisitos** — versão e permissões.
2. **Banco** — dados de conexão + URL do site → grava `.env`, cria database, roda `schema.sql` + `seeds.sql`.
3. **Administrador** — nome, e-mail, senha (mínimo 8 caracteres).
4. **Empresa** — razão social, CNPJ, WhatsApp, prefixo (`BEMIND-`), PIX e upload do logo.
5. **Confirmação** — grava `storage/installed.lock`.
6. **Concluído** — apague `/public/install` por FTP e siga para `/login`.

## Publicação por FTP (produção)

1. Apontar o docroot do domínio para `bemind_proposals/public`.
2. Se o docroot for a **raiz do projeto** (limitação da hospedagem), o `.htaccess` da raiz reencaminha tudo para `/public`.
3. Enviar `/app`, `/config`, `/database`, `/storage` **fora do docroot** ou proteger com o `.htaccess` da raiz.
4. Acessar `/install/`, concluir os 5 passos, **apagar `/public/install`**.
5. Conferir: HTTPS ativo, `.env` inacessível, `/storage` sem listagem, upload de logo funcionando.

## Rotas já existentes

Autenticadas:
- `GET /` — redireciona para `/dashboard` ou `/login`.
- `GET /dashboard` — placeholder com tokens do design aplicados.
- `POST /logout`.

Autenticação:
- `GET /login`, `POST /login` (com CSRF).

Placeholders (retornam 501 no passo 1, ganham corpo nos passos 4 e 6):
- `GET /p/{token}`, `POST /p/{token}/accept|request-change|decline`
- `GET /b/{token}`, `POST /b/{token}/save|submit`

## Segurança já garantida

- Sessão com cookie `HttpOnly`, `SameSite=Lax`, `Secure` (config), regeneração no login.
- `password_hash()` / `password_verify()` (bcrypt padrão do PHP) + `password_needs_rehash`.
- CSRF em todo POST autenticado.
- PDO com `ATTR_EMULATE_PREPARES = false` e prepared statements.
- Cabeçalhos: HSTS, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`.
- `.env` fora do docroot; `/uploads` bloqueia execução de `.php`.
- Após instalação, `storage/installed.lock` bloqueia o `/install`.

## Próximos passos (roadmap `BACKEND.md`)

- [x] 1. Esqueleto + `/install` + schema/seeds.
- [ ] 2. Clientes e biblioteca de serviços (CRUD).
- [ ] 3. Proposta Express + numeração + autosave + link com token.
- [ ] 4. Proposta pública + tracking + aceite digital + PDF.
- [ ] 5. Wizard completo (seções, itens, desconto, cronograma, condições).
- [ ] 6. Briefings (público 4 passos + respostas + "gerar proposta a partir do briefing").
- [ ] 7. Envio por WhatsApp/e-mail, duplicar, arquivar, templates.
- [ ] 8. Be Mind Cloud, relatórios, notificações, configurações/PIX, exportações CSV.
- [ ] 9. Modo escuro, papéis/permissões, backup, revisão de segurança e responsividade.
