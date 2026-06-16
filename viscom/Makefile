.PHONY: help up down build migrate seed test logs shell-api shell-db

# Load .env if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

help: ## Mostra este help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Sobe todos os serviços
	@if [ ! -f .env ]; then cp .env.example .env && echo "⚠  Arquivo .env criado a partir de .env.example. Configure as variáveis antes de continuar."; fi
	docker compose up -d --build

down: ## Para todos os serviços
	docker compose down

build: ## Reconstrói as imagens
	docker compose build --no-cache

migrate: ## Executa as migrations do Alembic
	docker compose exec api alembic upgrade head

makemigrations: ## Cria uma nova migration (use: make makemigrations MSG="descricao")
	docker compose exec api alembic revision --autogenerate -m "$(MSG)"

seed: ## Popula o banco com dados iniciais
	docker compose exec api python seed.py

test: ## Roda os testes do backend
	docker compose exec api pytest tests/ -v

test-frontend: ## Roda os testes do frontend
	docker compose exec web npm test

logs: ## Exibe logs de todos os serviços
	docker compose logs -f

logs-api: ## Exibe logs da API
	docker compose logs -f api

logs-db: ## Exibe logs do banco
	docker compose logs -f db

shell-api: ## Abre shell no container da API
	docker compose exec api bash

shell-db: ## Abre psql no banco
	docker compose exec db psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

restart-api: ## Reinicia apenas a API
	docker compose restart api

status: ## Status dos serviços
	docker compose ps

reset-db: ## ⚠ APAGA o banco e recria (DESTRUTIVO)
	@echo "ATENÇÃO: Isso vai apagar todos os dados. Tem certeza? [y/N]" && read ans && [ $${ans:-N} = y ]
	docker compose down -v
	docker compose up -d db
	sleep 5
	$(MAKE) migrate
	$(MAKE) seed

backup-db: ## Faz backup do banco para ./backups/
	@mkdir -p backups
	docker compose exec db pg_dump -U $(POSTGRES_USER) $(POSTGRES_DB) | gzip > backups/viscom_$(shell date +%Y%m%d_%H%M%S).sql.gz
	@echo "Backup salvo em backups/"
