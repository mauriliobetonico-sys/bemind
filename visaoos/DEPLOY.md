# 🚀 Guia de Deploy — VisãoOS (FileZilla + VPS)

Este guia leva o sistema do GitHub até o seu VPS funcionando. Siga na ordem.

---

## ⚠️ ANTES DE TUDO: a causa raiz dos problemas

Nas tentativas anteriores, o **FileZilla estava PULANDO os arquivos antigos** —
ele não sobrescrevia `index.php`, `config/*` etc. Por isso o servidor continuava
com código velho e quebrado, mesmo após o "upload".

**Solução definitiva (faça isto SEMPRE):**

No FileZilla, vá em **Transferência → Ação de arquivo padrão...** (ou, durante a
transferência, na janela que pergunta o que fazer):

- Direção: **Upload**
- Ação: **Sobrescrever** (Overwrite)
- ❌ **NÃO** marque "somente se origem for mais recente"
- ✅ Marque "Aplicar somente à fila atual" se quiser

Alternativa garantida: **apague a pasta no servidor antes de subir** a nova.

---

## 1. O que enviar para o servidor

Envie **todo o conteúdo da pasta `visaoos/`** para a raiz do site no VPS
(geralmente a pasta `public_html`, `www` ou a pasta do domínio).

```
✅ ENVIAR:
   index.php
   index.html
   .htaccess
   .env.example
   config/        (pasta inteira: database.php, auth.php, notifications.php, storage.php)
   routes/        (pasta inteira: todos os .php)
   uploads/       (pasta vazia, mas precisa existir e ser gravável)

❌ NÃO ENVIAR (são de manutenção/desenvolvimento):
   diag.php
   repair.php
   repair2.php
   DEPLOY.md
   schema.sql      (só se for importar o banco manualmente — ver passo 4)
   .git/           (nunca envie a pasta .git)
```

> Se `diag.php`, `repair.php` ou `repair2.php` já estiverem no servidor de
> tentativas anteriores, **APAGUE-OS** — eles expõem informações internas.

---

## 2. Onde colocar no VPS

Coloque os arquivos na **raiz pública do domínio**. Exemplos comuns:

| Painel/Servidor | Caminho típico |
|---|---|
| cPanel | `/home/USUARIO/public_html/` |
| Cloudways / LiteSpeed | `/srv/.../www/` (a pasta `www`) |
| Apache puro | `/var/www/html/` |
| Nginx puro | `/var/www/SEU_DOMINIO/` |

A regra: o `index.php` precisa ficar onde o domínio aponta.

---

## 3. Criar o arquivo `.env` (OBRIGATÓRIO)

Na **mesma pasta do `index.php`**, crie um arquivo chamado `.env`
(copie o `.env.example` e renomeie). Preencha com os dados reais do VPS:

```env
# Banco de Dados (pegue no painel do seu VPS)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=NOME_DO_SEU_BANCO
DB_USER=USUARIO_DO_BANCO
DB_PASS=SENHA_DO_BANCO

# URL do site (sem barra no final)
APP_URL=https://www.bemindmarketing.com.br

# Segurança JWT — gere uma string aleatória longa
# (rode no terminal: php -r "echo bin2hex(random_bytes(32));")
JWT_SECRET=COLE_AQUI_UMA_STRING_ALEATORIA_LONGA
JWT_EXPIRES=86400

# E-mail do primeiro administrador (criado automaticamente)
ADMIN_EMAIL=mauriliobetonico@gmail.com

# Em produção mantenha false (não exibe erros na tela)
APP_DEBUG=false
```

> **IMPORTANTE (open_basedir):** o `.env` PRECISA ficar **dentro** da pasta do
> site (junto do `index.php`). Não coloque em pasta acima — o servidor bloqueia.

---

## 4. Banco de dados

### Opção A — Automático (recomendado, padrão)
**Você não precisa importar nada.** Na primeira vez que o sistema for acessado,
ele **cria todas as tabelas sozinho** (função `installDB()` em
`config/database.php`) e cadastra:
- 1 usuário admin (e-mail do `ADMIN_EMAIL`, senha inicial **`admin123`**)
- materiais e serviços de exemplo

Basta o `.env` estar correto e o banco (vazio) existir.

### Opção B — Manual (opcional)
Se preferir criar as tabelas manualmente, importe o `schema.sql`:
- **phpMyAdmin:** selecione o banco → aba *Importar* → escolha `schema.sql` → *Executar*
- **Linha de comando:**
  ```bash
  mysql -u USUARIO -p NOME_DO_BANCO < schema.sql
  ```

---

## 5. Permissões dos arquivos

No FileZilla (clique direito → *Permissões de arquivo*) ou via SSH:

| Item | Permissão | Octal |
|---|---|---|
| Arquivos `.php`, `.html`, `.env` | leitura/escrita dono, leitura outros | **644** |
| Pastas (`config`, `routes`) | **755** |
| Pasta `uploads/` (precisa gravar) | **755** (ou 775 se necessário) |

Via SSH (opcional):
```bash
find . -type f -exec chmod 644 {} \;
find . -type d -exec chmod 755 {} \;
chmod -R 755 uploads
```

---

## 6. Testar (nesta ordem)

1. **Health check da API:**
   ```
   https://www.bemindmarketing.com.br/index.php?resource=health
   ```
   Esperado:
   ```json
   {"status":"ok","db":"ok","php":"7.4.33", ...}
   ```
   - `"db":"ok"` → banco conectado ✅
   - `"db":"error: ..."` → revise o `.env` (host/usuário/senha/nome do banco)

2. **Abrir o sistema:**
   ```
   https://www.bemindmarketing.com.br
   ```
   Deve aparecer a tela de login do VisãoOS.

3. **Login inicial:**
   - E-mail: o que você definiu em `ADMIN_EMAIL`
   - Senha: `admin123`
   - **Troque a senha** logo após entrar (menu Usuários).

---

## 7. Checklist final de produção

- [ ] FileZilla configurado para **sobrescrever** (não pular arquivos)
- [ ] Todos os arquivos enviados (confira tamanhos: `index.html` ~107KB, `index.php` ~6,8KB)
- [ ] `.env` criado na raiz, com dados reais do banco e `APP_URL` correto
- [ ] `APP_DEBUG=false` no `.env`
- [ ] `JWT_SECRET` trocado por string aleatória longa
- [ ] Pasta `uploads/` existe e é gravável
- [ ] `diag.php`, `repair.php`, `repair2.php` **apagados** do servidor
- [ ] Health check retornando `"db":"ok"`
- [ ] Login funcionando e senha do admin trocada

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| **Erro 500** | Arquivo antigo não sobrescrito (sintaxe PHP 8 no PHP 7.4) | Reenvie sobrescrevendo, ou apague a pasta e reenvie |
| **"Rota não encontrada"** | `index.php` desatualizado | Confirme que `index.php` tem ~6,8KB |
| **`"db":"error"`** | Credenciais erradas no `.env` | Confira DB_HOST/USER/PASS/NAME no painel |
| **`.env não encontrado`** | `.env` fora da raiz (open_basedir) | Mova o `.env` para junto do `index.php` |
| **Login não responde** | API retornando HTML em vez de JSON | Veja o health check; cheque o log de erros do PHP |
