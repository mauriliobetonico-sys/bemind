# VisCom – Sistema de Gestão para Comunicação Visual

Sistema web completo para gestão de empresas de comunicação visual (placas, banners, adesivos, fachadas, letras caixa, envelopamento, etc.).

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.x + Alembic |
| Banco | PostgreSQL 16 |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS + shadcn/ui |
| PDF | WeasyPrint + Jinja2 |
| Infra | Docker + docker-compose + Nginx |

## Como subir localmente (Docker)

### Pré-requisitos
- Docker ≥ 24
- docker-compose ≥ 2.x (plugin)
- make

### Passos

```bash
# 1. Clone o repositório
git clone <repo-url>
cd viscom

# 2. Configure o ambiente
cp .env.example .env
# Edite .env e troque SECRET_KEY e POSTGRES_PASSWORD

# 3. Suba os serviços
make up

# 4. Execute as migrations
make migrate

# 5. Popule com dados de demonstração
make seed

# 6. Acesse
open http://localhost
```

### Credenciais de teste

| Usuário | E-mail | Senha | Papel |
|---------|--------|-------|-------|
| Administrador | admin@viscom.com | admin123 | Admin |
| Vendedor | vendedor@viscom.com | vendedor123 | Vendedor |

## Comandos make disponíveis

```bash
make up              # Sobe todos os serviços
make down            # Para todos os serviços
make build           # Reconstrói as imagens
make migrate         # Executa migrations Alembic
make makemigrations MSG="descricao"  # Cria nova migration
make seed            # Popula dados iniciais
make test            # Roda pytest
make logs            # Exibe logs
make shell-api       # Shell no container da API
make shell-db        # psql no banco
make backup-db       # Backup do banco
make reset-db        # ⚠ APAGA e recria o banco
```

## Estrutura do projeto

```
viscom/
├── backend/
│   ├── app/
│   │   ├── api/v1/routes/   # Endpoints FastAPI
│   │   ├── core/            # Config, DB, segurança
│   │   ├── models/          # SQLAlchemy ORM
│   │   ├── schemas/         # Pydantic validações
│   │   ├── services/        # PDF, Excel
│   │   ├── templates/pdf/   # Templates Jinja2
│   │   └── utils/           # Formatadores
│   ├── alembic/             # Migrations
│   ├── tests/               # pytest
│   ├── seed.py              # Dados iniciais
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/           # Páginas React
│       ├── components/      # Componentes UI
│       ├── hooks/           # Hooks customizados
│       ├── lib/             # API, utils, validadores
│       └── types/           # TypeScript interfaces
├── nginx/                   # Configuração Nginx
├── docker-compose.yml
├── Makefile
└── .env.example
```

## Deploy em cloud própria

### 1. Preparar servidor (Ubuntu 22.04+)

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Instalar make
sudo apt-get install make
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Variáveis obrigatórias para produção:
```env
SECRET_KEY=<gere com: openssl rand -hex 32>
POSTGRES_PASSWORD=<senha forte>
COMPANY_NAME=<nome da sua empresa>
COMPANY_CNPJ=<CNPJ>
CORS_ORIGINS=https://seudominio.com
```

### 3. Certificado SSL (Let's Encrypt)

Para HTTPS, use um reverse proxy externo (Nginx, Caddy, Traefik) ou configure o Let's Encrypt antes de subir:

```bash
# Exemplo com Caddy (mais simples)
# Adicione ao Caddyfile:
# seudominio.com {
#   reverse_proxy localhost:80
# }
```

### 4. Deploy

```bash
make up
make migrate
make seed
```

### 5. Backup automatizado

```bash
# Adicione ao crontab:
0 2 * * * cd /path/to/viscom && make backup-db
```

## Módulos do sistema

| Módulo | Funcionalidade |
|--------|---------------|
| Clientes | Cadastro PF/PJ com validação CPF/CNPJ e CEP automático |
| Revendedores | Clientes com % desconto e preço especial |
| Produtos | Tabela de preços dupla (cliente/revenda) por m², unidade ou metro linear |
| Orçamentos | Com cálculo automático de área (m²), conversão em OS |
| Ordens de Serviço | Gestão completa com status, materiais, instalação, assinatura |
| Recibos | Emissão com valor por extenso em português |
| Financeiro | Contas a receber, parcelamento, baixa, caixa, inadimplência |
| Relatórios | Vendas por período/vendedor/cliente/material, inadimplência, top produtos |
| Configurações | Dados da empresa, tipos de material, instalação, acabamento, pagamento |

## API Docs

Com os serviços rodando, acesse:
- Swagger UI: http://localhost/api/v1/docs
- ReDoc: http://localhost/api/v1/redoc

## Testes

```bash
# Backend (pytest)
make test

# Frontend (vitest)
make test-frontend
```

## Perfis de acesso

| Função | Permissões |
|--------|-----------|
| Admin | Acesso total: financeiro, relatórios, configurações, usuários |
| Vendedor | Clientes, orçamentos, OS e financeiro dos próprios clientes |
