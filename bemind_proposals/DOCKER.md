# BE MIND PROPOSALS — Rodar 100% local com Docker

Ambiente completo (PHP + MySQL + Adminer) em uma máquina só. Ideal para
desenvolvimento, testes e demonstrações — sem depender de hospedagem.

## Requisitos
- **Docker Desktop** (Windows/Mac) ou **Docker + Compose** (Linux). Nada mais.

## Como rodar

### 1. Baixe o código
Sem Git? Baixe o ZIP:
👉 https://github.com/mauriliobetonico-sys/bemind/archive/refs/heads/claude/docs-handoff-claude-code-36pfzz.zip

Descompacte. Você vai ter uma pasta `bemind-*/bemind_proposals/`.

Com Git:
```bash
git clone https://github.com/mauriliobetonico-sys/bemind.git
cd bemind
git checkout claude/docs-handoff-claude-code-36pfzz
```

### 2. Suba os containers
Abra o terminal **dentro da pasta `bemind_proposals/`** e rode:

```bash
docker compose up -d --build
```

Na primeira vez demora ~2 minutos (baixa PHP + MySQL). Depois sobe em segundos.

### 3. Abra o instalador no navegador
👉 **http://localhost:8080/install/**

Preencha o wizard com os dados abaixo:

**Tela 2 · Banco de dados**

| Campo               | Valor                        |
|--------------------|-------------------------------|
| URL do site        | `http://localhost:8080`       |
| Host MySQL         | `db`  ← nome do container     |
| Porta              | `3306`                        |
| Nome do banco      | `bemind`                      |
| Usuário            | `bemind`                      |
| Senha              | `bemind_dev_only`             |
| WhatsApp           | (seu número com DDI)          |

**Tela 3 · Administrador**
Nome, e-mail e uma senha de pelo menos 8 caracteres — essa vai ser sua senha
de login.

**Tela 4 · Empresa**
Dados da Be Mind Marketing (nome, CNPJ, WhatsApp, PIX, upload do logo).

**Tela 5 · Confirmação** → Finalizar.

### 4. Apague a pasta `install`
Na sua máquina, dentro de `bemind_proposals/public/`, delete a pasta
`install/`. (Em ambiente local não é crítico como em produção, mas o próprio
instalador vai avisar.)

### 5. Entre no sistema
👉 **http://localhost:8080/login** — e-mail + senha do admin que você criou.

## Ferramentas extras

**Adminer** (painel web para o MySQL): 👉 http://localhost:8081
- Sistema: MySQL
- Servidor: `db`
- Usuário: `bemind`
- Senha: `bemind_dev_only`
- Banco: `bemind`

**Conectar direto do host** (TablePlus, DBeaver): host `127.0.0.1`, porta `3307`,
usuário/senha/banco iguais.

## Comandos úteis

| Ação                                    | Comando                                  |
|-----------------------------------------|------------------------------------------|
| Ver logs em tempo real                  | `docker compose logs -f app`             |
| Parar tudo (mantendo o banco)           | `docker compose stop`                    |
| Voltar a rodar                          | `docker compose start`                   |
| Reiniciar                               | `docker compose restart`                 |
| **Zerar TUDO (apaga o banco)**          | `docker compose down -v`                 |
| Entrar no container do app              | `docker exec -it bemind-app bash`        |
| Entrar no MySQL                         | `docker exec -it bemind-db mysql -ubemind -pbemind_dev_only bemind` |
| Rodar o smoke test                      | `docker exec bemind-app php scripts/smoke.php` |

## Hot reload
Como o código está montado em volume, qualquer edição em `.php`, `.css` ou
`.js` aparece na hora ao dar F5 no navegador. Não precisa rebuild.

## Portas usadas
| Porta local | Serviço                     |
|-------------|-----------------------------|
| 8080        | Aplicação (Apache + PHP)    |
| 8081        | Adminer (painel MySQL)      |
| 3307        | MySQL exposto para clientes |

Se alguma dessas estiver em uso na sua máquina, edite `docker-compose.yml` e
troque só o lado esquerdo do `":"` (ex.: `"9090:80"` para acessar em `9090`).

## Quando quiser subir para hospedagem real
Este ambiente Docker é para uso local. Para produção, siga `README.md` (upload
via FTP e wizard `/install/` no domínio real).
