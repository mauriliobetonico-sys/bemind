# Prompt inicial para o Claude Code

Cole isto na primeira mensagem, com esta pasta aberta no projeto.

---

Nesta pasta está o handoff de design do **BE MIND PROPOSALS**, sistema de propostas comerciais da Be Mind Marketing.

Leia, na ordem: `README.md` (design completo, tokens e todas as telas) e `BACKEND.md`
(stack, banco, endpoints, segurança, instalação e deploy por FTP).

Contexto importante:
- `design/BE MIND PROPOSALS App.dc.html` é um **protótipo de referência em HTML** (abra no navegador para ver
  e clicar em todas as telas). **Não é código de produção** — não copie o arquivo nem o runtime `support.js` /
  as molduras de device `ios-frame.jsx` / `android-frame.jsx`.
- Ainda não existe codebase. Implemente do zero na stack de `BACKEND.md`:
  PHP 8 + MySQL, deploy por FTP em Apache/Nginx, sem Node em produção (build local, saída estática).
- O design é **alta fidelidade**: reproduza cores, tipografia, espaçamentos e raios exatamente como no README.
- Tudo em **português do Brasil**, moeda sempre `R$ 1.500,00`.
- Não altere o logo (`assets/bemind-logo.png`). Em fundo escuro, ele vai sobre cartão branco.

O que eu preciso no fim: aplicação funcional e pronta para produção — não protótipo visual.
Prioridades: velocidade para criar uma proposta, proposta online impressionante no celular,
geração de PDF, aceite digital com registro, rastreamento de visualizações e segurança.

Comece pelo passo 1 da "Ordem de implementação sugerida" do `BACKEND.md`
(esqueleto + instalador + schema/seeds) e me mostre a estrutura de pastas e o `schema.sql`
antes de seguir para as telas.
