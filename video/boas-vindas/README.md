# Vídeo de boas-vindas — Be Mind Marketing (30 s)

Vídeo institucional para clientes que acabaram de registrar um domínio: domínio → DNS → Cloud próprio → desenvolvimento → SSL → publicação → oferta → logotipo.

## Entregáveis (`out/`)

| Arquivo | Conteúdo |
|---|---|
| `bemind-boas-vindas-30s.mp4` | Vídeo final 1920×1080, 30 fps, exatamente 30,0 s, H.264 + AAC 256 kbps, −14 LUFS, legendas gravadas na imagem |
| `bemind-boas-vindas-30s-cc.mp4` | Mesmo vídeo + faixa de legenda selecionável (pt-BR) |
| `legendas.srt` | Legendas sincronizadas (para YouTube, redes sociais, players) |
| `narracao.wav` | Stem de narração já posicionado na linha do tempo |
| `trilha.wav` | Stem da trilha eletrônica (sem ducking) |
| `efeitos.wav` | Stem de efeitos sonoros |
| `timeline.json` | Tempos de cenas, frases e legendas |

## Roteiro como foi montado

| Cena | Tempo | Na tela | Narração |
|---|---|---|---|
| 1 Boas-vindas | 0,0–4,8 s | Domínio digitado com selo "Registrado", linhas luminosas conectando a uma rede, logotipo em selo branco no canto, "Seu domínio é o primeiro passo." | Seu domínio está registrado. Agora, vamos transformar essa ideia em um site de verdade. |
| 2 DNS | 4,8–8,8 s | "01. Configuração de DNS"; painel do domínio troca os servidores DNS pelos da Be Mind, barra de propagação, aviso de que a propagação pode levar algumas horas | Primeiro, configuramos os DNS para conectar seu domínio à nossa infraestrutura. |
| 3 Cloud próprio | 8,8–14,0 s | Nuvem se condensa em uma instância própria com limite "Ambiente dedicado"; outras instâncias aparecem separadas e esmaecidas; site começa a ser montado no ambiente. "Seu próprio Cloud. Sua própria operação." / "Infraestrutura dedicada ao seu projeto." | Seu site terá seu próprio ambiente Cloud, preparado para executar sua operação de forma independente. |
| 4 Desenvolvimento e SSL | 14,0–18,9 s | "02. Desenvolvimento": código legível vira o site. "03. Segurança SSL": cadeado se fecha e voa para a barra de endereço, que passa de http:// para https:// | A Be Mind desenvolve seu site, configura o certificado SSL e prepara tudo para entrar no ar. |
| 5 Publicação e suporte | 18,9–24,0 s | Checklist "Testes concluídos" e "Aprovação do cliente", clique em "Publicar site", site no notebook e no celular com "Online"; "Seu site pronto para o mundo." / "Suporte 24 horas, grátis." | Depois dos testes e da sua aprovação, publicamos seu site, com suporte 24 horas incluído. |
| 6 Oferta e encerramento | 24,0–30,0 s | "SEU PRÓPRIO CLOUD", **R$ 150,00/mês**, "Certificado SSL + suporte 24h grátis"; transição para fundo claro e logotipo formado por partículas no centro, "Tecnologia para sua operação crescer." e faixa da oferta | Tudo isso por cento e cinquenta reais por mês. Be Mind Marketing. Sua operação, conectada ao futuro. |

Uma barra de progresso discreta no topo (Domínio · DNS · Cloud · Desenvolvimento · SSL · Publicação) liga as cenas em uma única jornada.

Decisões de conteúdo:
- Os servidores DNS aparecem como "Servidor DNS Be Mind", sem endereços inventados. Troque pelos nameservers reais em `src/index.html` se quiser mostrá-los.
- O vídeo fala em "ambiente dedicado" e "infraestrutura dedicada ao seu projeto". Não afirma isolamento físico nem hardware exclusivo.
- A publicação aparece só depois dos testes e da aprovação do cliente.
- O logotipo usado é o arquivo oficial (`assets/logo-bemind.png`), sem alterações. A formação por partículas usa as cores reais do próprio arquivo.

## Sobre a narração e a trilha

- **Narração:** voz sintética pt-BR (Kokoro TTS, voz `pm_alex`), gerada offline. Serve como guia de locução com o tempo já certo. Para a versão comercial, recomendo gravar com um locutor profissional (ou um TTS premium) usando o texto da tabela acima. Cada frase tem início marcado em `out/timeline.json`. Se a nova locução tiver duração parecida, basta substituir `out/narracao.wav` e rodar só a etapa 4 do `build.sh`.
- **Trilha e efeitos:** sintetizados por código (`scripts/trilha.py`), sem amostras de terceiros, ou seja, sem pendência de licença. A trilha abaixa automaticamente sob a voz (ducking por sidechain).

## Como regerar

Requisitos: `python3`, `node` 18+, `playwright` (Chromium) e `ffmpeg`.

```bash
cd video/boas-vindas
scripts/build.sh            # voz pm_alex, velocidade 1.32
scripts/build.sh pf_dora    # mesma peça com voz feminina
```

Na primeira execução, o script cria `.work/` com o ambiente Python e baixa o modelo de voz (~350 MB, do GitHub). A renderização leva cerca de 10 minutos.

- Pré-visualizar a animação em tempo real: sirva a pasta (`npx http-server .`) e abra `src/index.html?play`.
- Conferir quadros específicos: `node scripts/render-frames.mjs stills 3.5 12 27.8` (gera PNGs em `out/stills/`).

Arquivos-fonte:
- `scripts/narracao.py`: texto da narração, pronúncia (DNS, SSL, Cloud, Be Mind), legendas e linha do tempo.
- `src/index.html`, `src/style.css`, `src/main.js`: as seis cenas. Cada quadro é função pura do tempo (`window.render(t)`).
- `scripts/trilha.py`: música e efeitos sincronizados com a linha do tempo.
- `scripts/render-frames.mjs`: exportação quadro a quadro.
- `scripts/build.sh`: pipeline completo e mixagem final.

## Montagem em editor (Premiere / DaVinci / CapCut)

Para refinar em um editor, importe `.work/video.mp4` (imagem sem áudio, gerado pelo build) ou o MP4 final, junto com os três stems de `out/`, todos alinhados em 0 s:
1. V1: vídeo. Legendas: importar `legendas.srt`, ou usar as legendas já gravadas.
2. A1: `narracao.wav` a 0 dB.
3. A2: `trilha.wav` a cerca de −8 dB, com ducking de −10 dB sob a voz.
4. A3: `efeitos.wav` a cerca de −6 dB.
5. Exportar em 1920×1080, H.264, alvo de −14 LUFS e duração de 30:00.
