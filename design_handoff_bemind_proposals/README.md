# Handoff: BE MIND PROPOSALS — app mobile (interno + cliente)

## Overview

BE MIND PROPOSALS é o sistema interno da **Be Mind Marketing** para criar, enviar, acompanhar e fechar propostas
comerciais de Marketing, Design, Web, Branding, Comunicação Visual e Hospedagem Cloud.
Posicionamento usado na interface: *"Propostas que transformam oportunidades em negócios."*

Este pacote cobre a **camada mobile** do produto, em duas frentes:

1. **App interno** (iOS/Android, 402×874 de referência) — 15 telas: dashboard, Proposta Express,
   wizard de proposta completa, propostas + rastreamento, clientes, briefings, biblioteca de serviços,
   Be Mind Cloud, relatórios, notificações, configurações.
2. **Páginas públicas do cliente** (412×892 de referência) — proposta online com aceite digital
   e formulário de briefing em 4 passos, ambos acessados por link com token, **sem login**.

O objetivo funcional é: *criar uma proposta em minutos, enviar por link, saber quando o cliente viu, e receber o aceite registrado.*

## About the Design Files

Os arquivos em `design/` são **referências de design escritas em HTML** — protótipos que mostram
aparência e comportamento pretendidos, **não código de produção para copiar**.

- `design/BE MIND PROPOSALS App.dc.html` — o protótipo completo. Abre direto no navegador.
  É um "Design Component": um template HTML com estilos **inline** + uma classe de lógica
  (`class Component extends DCLogic`) que devolve valores/handlers para o template.
  `design/support.js`, `design/ios-frame.jsx` e `design/android-frame.jsx` são o runtime e as molduras de
  device — servem só para o protótipo rodar; **não portar para produção**.
- A tarefa é **recriar essas telas no ambiente do projeto real**, com os padrões e bibliotecas dele.
  Ainda não existe codebase: a stack alvo definida pelo cliente está em `BACKEND.md`
  (PHP 8 + MySQL, deploy por FTP em Apache/Nginx, sem Node em produção).

Como ler o protótipo:
- Cada tela do app interno é um bloco `<sc-if value="{{ vNomeDaTela }}">` dentro da moldura iOS.
- Listas são `<sc-for list="{{ nome }}" as="item">`; os dados e handlers vêm de `renderVals()` na classe de lógica.
- A navegação é `state.view` (string) + `this.go('view')`. O lado do cliente é `state.pubTab` (`proposta` | `briefing`).

## Fidelity

**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos, raios, sombras, copy em português e estados
interativos são finais. Recriar pixel-a-pixel. Os únicos placeholders conscientes:

- Ícones da tab bar são quadrados de 20×20 com borda 2px — substituir por um set de ícones real
  (sugestão: Lucide/Phosphor), mantendo tamanho e as cores de ativo/inativo.
- Ícones das notificações são glifos de texto (`👁 ✓ ↺ → !`) — trocar pelos ícones do set escolhido.
- Campos de texto do briefing e do aceite aparecem **preenchidos** (é um protótipo): em produção são
  `<input>` / `<textarea>` reais com o mesmo box (borda `#E4E0DA`, raio 14px, padding 14px, fundo `#FCFBFA`).
- Não há imagens além do logo. Onde entrar foto/vídeo do cliente, usar placeholder.

## Design Tokens

Extrair para variáveis/tema antes de codar as telas.

### Cores

| Token | Hex | Uso |
|---|---|---|
| `coral` | `#FB6D62` | cor de ação da marca: CTAs, valores, barras de progresso, chips ativos |
| `coral-dark` | `#E85C51` | hover/gradiente, texto coral sobre branco |
| `coral-text` | `#C74A40` | texto de chip ativo |
| `coral-wash` | `#FFF1EF` | fundo de chip ativo, avatar, blocos de aviso |
| `coral-line` | `#FBD8D3` | borda de blocos coral |
| `ink` | `#2B2E35` | texto principal, blocos escuros (investimento, hero público) |
| `ink-700` | `#3C4149` | fim do gradiente escuro, texto de resposta |
| `ink-600` | `#4E535A` | corpo de texto secundário |
| `ink-500` | `#5A6068` | corpo de texto em página pública |
| `gray-500` | `#6B7078` | texto de chip inativo |
| `gray-400` | `#7C8189` | subtítulos |
| `gray-350` | `#8A9098` | legendas |
| `gray-300` | `#9AA0A7` | labels, captions, placeholders |
| `gray-250` | `#A8ADB4` | tab inativa, passo inativo |
| `gray-200` | `#C7C3BC` | chevrons, pontos de timeline concluída |
| `line` | `#EAE7E2` | borda padrão de card |
| `line-soft` | `#EFECE7` / `#F1EEE9` / `#F3F0EB` / `#F5F2ED` | divisores internos, trilhas de barra |
| `line-strong` | `#E4E0DA` / `#E8E5E0` / `#DFDBD5` / `#DAD6D0` | inputs, botões secundários, tracejados, botão desabilitado |
| `bg-app` | `#F6F4F1` | fundo do app interno |
| `bg-canvas` | `#EFEDE9` | fundo do quadro de apresentação |
| `bg-input` | `#FCFBFA` / `#FAF9F7` | campos e chips neutros |
| `white` | `#FFFFFF` | cards, página pública |

Gradientes: CTA Express `linear-gradient(135deg,#FB6D62 0%,#E85C51 100%)`;
Cloud hero `linear-gradient(140deg,#2B2E35 0%,#3C4149 100%)`.

### Status (badge = fundo + texto)

| Status | Fundo | Texto |
|---|---|---|
| Rascunho | `#EFEDE9` | `#6B7078` |
| Enviada | `#E8F0FE` | `#2A5DB0` |
| Visualizada | `#FFF3E0` | `#A15C00` |
| Aprovada | `#E7F6EC` | `#1E7A45` |
| Recusada | `#FDEAE8` | `#B23A2E` |
| Alteração solicitada | `#F3EAFD` | `#6B3FA0` |
| Expirada | `#F1F1F1` | `#8A8A8A` |

Cores de dado: laranja `#E8A33D` (visualização), verde `#1E7A45` (aprovado), vermelho `#B23A2E` (recusa/desconto), azul `#2A5DB0` (pendente), roxo `#6B3FA0` (alteração).

### Tipografia

Duas famílias (Google Fonts, pesos 400–800):

- **Plus Jakarta Sans** — títulos, números grandes, nomes de card. Sempre com `letter-spacing` negativo.
- **Manrope** — corpo, labels, botões, dados.

Escala usada (tamanho/altura/peso · letter-spacing):

| Papel | Valor |
|---|---|
| Saudação do dashboard | Jakarta 800 · 26/1.15 · `-.025em` |
| Título de hero público | Jakarta 800 · 30/1.12 · `-.03em` |
| Número grande (valor aprovado, investimento) | Jakarta 800 · 32–40/1 · `-.03em`/`-.04em` |
| Título de seção em card | Jakarta 700 · 14/1 |
| Nome de card / cliente | Jakarta 700–800 · 14.5–15/1.25 · `-.01em` |
| KPI | Jakarta 700 · 24/1 · `-.03em` |
| Label de bloco | Manrope 700 · 10.5–11/1 · `letter-spacing .12em–.2em`, maiúsculas |
| Corpo | Manrope 500 · 12.5–15/1.5–1.65 |
| Botão principal | Manrope 800 · 14–14.5/1 · `.02em–.04em`, maiúsculas nos CTAs de aceite |
| Chip / linha de lista | Manrope 600 · 12–13.5/1 |
| Caption | Manrope 500 · 11–11.5/1 |
| Número / código | `ui-monospace, Menlo, monospace` 600 · 10.5–12 |

Regras: todo número monetário e contador usa `font-variant-numeric: tabular-nums`;
parágrafos e títulos longos usam `text-wrap: pretty`.

### Espaçamento, raio e sombra

- Padding de tela: `18px` (app interno), `24px` (página pública).
- Gap entre cards: `10px` (grade), `12–16px` (pilha), `24–34px` (seções da página pública).
- Padding de card: `14–20px`. Padding de hero público: `48px 24px 32px`.
- Raios: chip/campo `12–14px`, botão `14–16px`, card `16–22px`, hero/bloco `20–24px`,
  folha inferior `28px 28px 0 0`, pílula `999px`.
- Sombras: CTA coral `0 10px 22px rgba(251,109,98,.32)`; botão de aceite `0 10px 24px rgba(251,109,98,.34)`;
  card do quadro `0 1px 3px rgba(0,0,0,.06)`.
- Barras de tab e CTA fixos: fundo `rgba(...,.92–.95)` + `backdrop-filter: blur(14px)` + borda superior 1px.
- **Todo container com padding e `height:100%` ou `inset:0` precisa de `box-sizing:border-box`** (bug encontrado e corrigido no protótipo).
- Animações de entrada: fade+subida `bmIn` (`opacity 0→1`, `translateY(8px)→0`, `.3s ease both`) e
  `bmPop` (`scale(.94)→1`, `.34s`). **Em elementos `inset:0` usar só fade** (`bmFade`) — transform desloca o overlay para fora da moldura.

## Screens / Views — app interno

Shell comum (todas as telas internas):

- **Top bar** (fixa, não rola): padding `58px 18px 12px`, fundo `bg-app`, borda inferior `#EAE7E2`.
  Esquerda: logo 30px nas telas-raiz, ou botão voltar 34×34 (branco, borda `#E8E5E0`, raio 12px, chevron 9×16 `#2B2E35`).
  Centro: título da tela (Jakarta 700 16). Direita: sino 34×34 com ponto coral 7px (borda branca 1.5px) → Notificações.
- **Conteúdo**: rolável, padding `18px 18px 108px`.
- **Tab bar** (fixa no rodapé): padding `10px 14px 30px`, 4 itens (Início, Propostas, Clientes, Mais),
  ícone 20×20 + label Manrope 600 10.5. Ativo: `#E85C51` + preenchimento coral. Inativo: `#A8ADB4`, sem preenchimento.
  Telas-raiz: `dash`, `props`, `clients`, `more`. `prop`→aba Propostas, `client`→Clientes,
  `services|cloud|reports|settings|briefs|brief`→Mais.

### 1. Dashboard (`dash`)
Saudação "Olá, Maurílio 👋" + "Vamos criar uma proposta que impressione seu próximo cliente."
Depois, em pilha: card CTA coral ("MENOS DE 1 MINUTO" / "Proposta Express" / botão branco "Criar agora" +
botão translúcido "Completa"); grade 2 colunas com 6 KPIs (Criadas 34, Enviadas 28, Visualizadas 21,
Aprovadas 12, Pendentes 7, Recusadas 4 — cada um colorido pelo status); card escuro "VALOR APROVADO EM 2026"
`R$ 148.700,00` + linha coral "12 propostas aprovadas · ticket médio R$ 12.391,66"; card "Desempenho das propostas"
com 5 barras horizontais (label 86px + trilha `#F1EEE9` 9px + valor); card "Atividade" com 3 eventos
(ponto colorido 8px + texto + horário) e link "Ver tudo".

### 2. Proposta Express (`express`)
Quatro cards numerados: **1 · CLIENTE** (chips de cliente), **2 · SERVIÇO** (chips; ao escolher, o valor
padrão da biblioteca entra automaticamente + nota "Descrição, entregáveis e prazo são preenchidos automaticamente…"),
**3 · VALOR** (− / valor Jakarta 800 26 / +, passo R$ 50, mínimo R$ 50, mais 4 presets 500/800/1200/1900),
**4 · VALIDADE E CONDIÇÕES** (7/15/30 dias/Custom + 3 chips de condição).
Fecha com card escuro de resumo (cliente, número, serviço, total coral) + CTA "GERAR PROPOSTA" + "Salvo agora".

### 3. Proposta gerada (`done`)
Círculo verde 70px com check, "Proposta gerada", número + cliente, card com "LINK SEGURO DO CLIENTE"
(monospace), grade 2×2 de ações (WhatsApp, e-mail, PDF, copiar link) e link "Voltar ao dashboard".

### 4. Wizard completo (`wizard`)
Stepper de 4 trilhos 4px (coral até o passo atual) com labels Cliente / Escopo / Investimento / Condições.
- **Cliente**: campo de busca + 5 cards de cliente (avatar 36px com iniciais, nome, subtítulo, check coral quando selecionado) + "＋ Cadastrar novo cliente" tracejado.
- **Escopo**: chips de categoria roláveis (MARKETING, DESIGN, WEB, COM. VISUAL, BE MIND CLOUD) →
  lista de serviços da categoria com preço e periodicidade + botão `+` (adiciona ao escopo).
  Card "ESCOPO DA PROPOSTA · N itens": por item nome, "remover", − qtd +, −50/+50 no preço, total à direita;
  no fim, totais Mensal recorrente e Investimento único.
- **Investimento**: desconto geral (Sem/5%/10%/15%), 4 linhas (mensal, único, desconto em vermelho, total do 1º mês),
  card escuro com investimento mensal grande + "Anual … · único …".
- **Condições**: forma de pagamento (4 chips), validade (4 chips), bloco de observações com barra de editor rico simulada (B, I, Lista, Link).
CTA "Continuar" nos passos 0–2, "Revisar e gerar proposta" no 3 → abre a tela de proposta. "Voltar" a partir do passo 1.

### 5. Propostas (`props`)
Busca + filtros de status roláveis (Todas, Rascunho, Enviada, Visualizada, Aprovada, Recusada) que **filtram a lista**.
Card: número monospace + badge de status; nome do cliente (Jakarta 700 15); projeto; rodapé com contexto
("Vista há 12 min · 7 visualizações") e valor Jakarta 800 17. Toque abre o detalhe.

### 6. Detalhe da proposta (`prop`)
Card escuro: badge VISUALIZADA + número, cliente, "Gestão de Redes Sociais · 12 meses",
divisor e "Investimento mensal / R$ 2.150,00" em coral 24px.
Faixa âmbar (`#FFF3E0`/`#F6E3C4`): "Cliente visualizou sua proposta há 12 minutos."
Card "Rastreamento": timeline vertical de 5 eventos (ponto 10px + linha 1.5px `#EFECE7`) — criada, enviada,
primeira visualização, última visualização, aguardando aceite — e dois números: 7 visualizações, iPhone.
Grade 2×3 de ações: WhatsApp, e-mail, PDF, copiar link, duplicar, arquivar.

### 7. Clientes (`clients`) e 8. Ficha (`client`)
Lista: avatar colorido com iniciais, nome, segmento/contagem, valor contratado à direita.
Ficha: card de identificação (avatar 46px, nome, CNPJ) + 5 campos (responsável, e-mail, WhatsApp, cidade, cliente desde);
grade de 3 stats (propostas 5, aprovadas 3, recusadas 1); card escuro "TOTAL CONTRATADO R$ 32.400,00";
card "Propostas" com 3 linhas (projeto, número, badge, valor); CTA "Nova proposta para este cliente".

### 9. Briefings (`briefs`)
Card CTA coral "ANTES DA PROPOSTA / Enviar briefing" + explicação + botão "Novo briefing"
(abre o formulário público). Filtros: Todos, Aguardando, Respondido, Rascunho.
Card de briefing: número, badge, cliente, tipo, data + barra de progresso 64×6px e contador "12/12".

### 10. Briefing respondido (`brief`)
Card escuro: badge RESPONDIDO, número, cliente, "respondido em 04/08/2026, 4h após o envio",
dois stats (12/12 respostas · verba informada `R$ 1.500–3.000` em coral 15px `white-space:nowrap`).
Quatro cards de respostas (EMPRESA, PÚBLICO, OBJETIVOS, PROJETO) com pergunta em `#9AA0A7` 12px
e resposta em `#2B2E35` 13.5px. Bloco coral "SUGERIDO PELO BRIEFING" com 3 serviços + total sugerido
e CTA "Gerar proposta a partir do briefing" → abre o wizard no passo Escopo com os 3 serviços já adicionados
e o cliente selecionado. Grade 2×2: WhatsApp, PDF do briefing, pedir complemento, arquivar.

### 11. Serviços (`services`)
Nota "Preços padrão puxados para cada proposta e editáveis a qualquer momento." + chips de categoria +
card com linhas (nome, "periodicidade · ativo", preço, link "editar") + "＋ Novo serviço na biblioteca".

### 12. Be Mind Cloud (`cloud`)
Hero escuro em gradiente: "BE MIND CLOUD", texto institucional, "A partir de R$ 150,00/mês".
Aviso coral: "R$ 150,00 é o piso configurado. Você pode alterar qualquer valor manualmente na proposta."
Quatro planos (Básico R$ 150 — borda coral; Profissional R$ 280; Empresarial R$ 480; Personalizado "sob medida"),
cada um com chips de especificação e rodapé "Anual … / editar plano".

### 13. Relatórios (`reports`)
Taxa de aprovação 57% (Jakarta 800 40) + "+9 p.p. vs. trimestre anterior" + barra coral 57%.
Grade 2×2: valor enviado, aprovado, perdido, ticket médio. Card "Serviços mais vendidos" com 4 barras escuras.

### 14. Notificações (`notifs`)
Cards tintados por tipo (âmbar visualização, verde aprovação, roxo alteração, neutro envio/expiração),
com ícone 34px em quadro branco, texto e horário.

### 15. Mais (`more`) e 16. Configurações (`settings`)
Mais: 6 linhas com título + subtítulo + chevron (Briefings, Serviços, Be Mind Cloud, Modelos de proposta, Relatórios, Notificações, Configurações).
Configurações: card da empresa (logo 48px + nome + 5 campos, incluindo "Prefixo das propostas: BEMIND-2026-");
card PIX (tipo de chave, chave, favorecido, banco); três switches (mostrar PIX nas propostas ✓, salvamento automático ✓, modo escuro ✗);
card Equipe com 3 usuários e papel (Administrador, Comercial, Editor).

## Screens / Views — lado do cliente (público, sem login)

### A. Proposta online — `/p/{token}`
- **Capa** (fundo `#2B2E35`, padding `48px 24px 32px`): logo **dentro de cartão branco** (raio 14px, padding 11px 13px —
  obrigatório: o wordmark do logo é cinza escuro e desaparece em fundo escuro), "PROPOSTA COMERCIAL" em coral,
  título do projeto Jakarta 800 30, "Preparada para **Studio Vitória Odonto**", e três metadados (Nº, DATA, VÁLIDA ATÉ).
- **Abertura personalizada**: "OLÁ, DRA. VITÓRIA" + parágrafo institucional editável.
- **Escopo**: cards com nome, valor, descrição e lista de entregáveis (bullet coral 5px).
- **Investimento**: bloco escuro com valor mensal Jakarta 800 40 + 4 linhas (subtotal, desconto, anual, único).
- **Cronograma**: timeline numerada de 4 etapas (círculo coral claro 26px).
- **Diferenciais**: grade 2×2 (número/palavra coral + frase).
- **Condições comerciais**: 5 pares label/valor.
- **Fechamento**: "Vamos começar este projeto?" + botões secundários "Solicitar alteração" e "Recusar proposta".
- **CTA fixo no rodapé**: "ACEITAR PROPOSTA" coral, sempre acessível.
- **Folha de aceite** (bottom sheet, raio 28px topo): "Você está de acordo com esta proposta?",
  número + valor, 3 campos (nome, e-mail, CPF/CNPJ), checkbox "Li e concordo com os termos desta proposta."
  O botão só habilita com o checkbox marcado (desabilitado = `#DFDBD5`).
- **Aceite confirmado**: check verde 78px, "Proposta aprovada", agradecimento e card
  "REGISTRO DO ACEITE" com proposta, nome, e-mail, data/hora e IP.

### B. Briefing do cliente — `/b/{token}`
Capa escura igual (logo em cartão branco), "BRIEFING", "Conte sobre o seu projeto",
"12 perguntas, cerca de 5 minutos. Suas respostas montam a proposta — nada aqui é definitivo."
Stepper de 4 (Empresa, Público, Objetivos, Projeto). Perguntas por passo:

1. **Empresa** — nome/responsável (texto); segmento (escolha única: Saúde e estética, Alimentação, Varejo, Serviços, Indústria);
   tempo de mercado (única: <1 ano, 1–3, 3–10, >10); "O que a empresa faz, em uma frase?" (texto, hint "Escreva do seu jeito, sem formalidade.").
2. **Público** — cliente ideal (texto); faixa de idade (única: 18–24, 25–44, 45–60, 60+);
   canais atuais (múltipla: Instagram, Facebook, Google, TikTok, WhatsApp, Nenhum).
3. **Objetivos** — o que quer alcançar (múltipla: Vender mais, Ganhar seguidores, Reposicionar a marca, Lançar um produto, Ser encontrado no Google);
   o que já tentaram (texto); concorrentes de referência (texto).
4. **Projeto** — serviços de interesse (múltipla: Redes sociais, Vídeo, Identidade visual, Site, Tráfego pago, Hospedagem);
   investimento previsto por mês (única: até 1.500 / 1.500–3.000 / 3.000–6.000 / acima de 6.000, hint "Serve para calibrar o escopo, não é compromisso.");
   quando pretende começar (única: Imediato, 15 dias, Próximo mês, Ainda avaliando); links e observações (texto).

Rodapé fixo: "Voltar" (do passo 2 em diante) + CTA "Continuar" / "Enviar briefing" + linha
"Passo X de 4 · respostas salvas automaticamente". Envio → tela "Briefing recebido" com check coral.

## Interactions & Behavior

- **Navegação interna**: `view` string; tab bar troca de raiz; voltar mapeado (`prop→props`, `client→clients`, `brief→briefs`, `services|cloud|reports|settings|briefs→more`, resto `dash`).
- **Chips**: ativo = borda `#FB6D62`, fundo `#FFF1EF`, texto `#C74A40`; inativo = borda `#EAE7E2`, fundo branco, texto `#6B7078`. Escolha única substitui; múltipla alterna.
- **Cálculos** (validar no backend também): mensal = Σ itens com periodicidade mês (preço × qtd);
  único = Σ demais; desconto geral aplicado sobre ambos; anual = mensal líquido × 12;
  "total do 1º mês" = mensal líquido + único líquido. Quantidade mínima 1, preço mínimo R$ 50 no ajuste rápido.
- **Moeda**: sempre `R$ 1.500,00` (`pt-BR`, 2 casas, ponto de milhar). Nunca `1500.00`.
- **Filtros**: status de proposta e status de briefing filtram a lista no cliente e devem ter equivalente na API.
- **Aceite**: botão desabilitado até o checkbox; ao confirmar, registrar nome, e-mail, CPF/CNPJ, data/hora, IP e user-agent, mudar status para APROVADA e notificar internamente.
- **Autosave**: indicadores "Salvo agora" / "Salvando…" no Express, no wizard e no briefing público — salvar rascunho a cada mudança (debounce ~800ms).
- **Micro-interações**: hover de card muda a borda para `#FB6D62`; entrada de tela com fade+8px; folhas com fade.
- **Estados faltando no protótipo** (implementar): loading/skeleton, erro de rede, validação de campo,
  proposta expirada ("Esta proposta expirou."), fluxo "Solicitar alteração" (nome, e-mail, mensagem → status Alteração solicitada), recusa com motivo, modo escuro.
- **Responsivo**: as telas são fluidas (nada em largura fixa) — de 360px a tablet. Alvos de toque ≥44px.

## State Management

App interno (nomes do protótipo, em `state`):
`view`, `filter` (status de propostas), `bFilter` (status de briefings),
Express: `exCli`, `exSvc`, `exVal`, `exValid`, `exCond`;
Wizard: `wStep` (0–3), `wCli`, `cat`, `items[{id,n,p,q,per}]`, `disc`, `pay`.

Cliente: `pubTab` (`proposta`|`briefing`), `aceite` (0 fechado / 1 folha / 2 confirmado), `terms` (checkbox),
Briefing: `bStep` (0–3), `bDone`, e as respostas `bSeg`, `bTime`, `bAge`, `bChan[]`, `bObj[]`, `bSvc[]`, `bBudget`, `bPrazo`.

Dados a buscar: KPIs + série do gráfico + atividade (dashboard); lista/detalhe de propostas com eventos de tracking;
clientes e histórico; catálogo de serviços por categoria; planos Cloud; briefings e respostas; notificações; configurações da empresa e PIX.

## Assets

- `assets/bemind-logo.png` — logo oficial enviado pelo cliente (1863×1699, PNG com transparência). **Não alterar, recortar ou recolorir.**
  Em fundo escuro, sempre sobre cartão branco (raio 14px, padding 11px 13px).
- Fontes: Google Fonts — Plus Jakarta Sans (400–800) e Manrope (400–800). Em produção, servir localmente (`/assets/fonts`) para não depender de CDN.
- Sem outras imagens. O GIF do painel de hospedagem foi deliberadamente **não usado**, por decisão do cliente.

## Files

```
design/BE MIND PROPOSALS App.dc.html   protótipo completo (todas as telas, interativo)
design/support.js                       runtime do protótipo (não portar)
design/ios-frame.jsx                    moldura iPhone (não portar)
design/android-frame.jsx                moldura Android (não portar)
assets/bemind-logo.png                  logo oficial
BACKEND.md                              stack, banco, API, segurança, instalação e deploy FTP
```

Comece por `BACKEND.md` para o esqueleto do servidor, depois recrie as telas na ordem:
Proposta Express → proposta pública + aceite → propostas/tracking → wizard → briefing → clientes/serviços/cloud → relatórios/config.
