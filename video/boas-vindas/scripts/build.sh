#!/usr/bin/env bash
# Gera o vídeo final de 30 s: narração → trilha/efeitos → quadros → mixagem → MP4.
# Requisitos: python3, node 18+, playwright (Chromium), ffmpeg.
# Uso: scripts/build.sh [voz] [velocidade]   (padrão: pm_alex 1.32)
set -euo pipefail
cd "$(dirname "$0")/.."

VOICE="${1:-pm_alex}"
SPEED="${2:-1.32}"
WORK="${WORK:-.work}"
MODEL="$WORK/kokoro"
OUT=out/bemind-boas-vindas-30s.mp4

mkdir -p "$WORK" out "$MODEL"
if [ ! -x "$WORK/venv/bin/python" ]; then
  python3 -m venv "$WORK/venv"
  "$WORK/venv/bin/pip" install -q kokoro-onnx soundfile numpy
fi
REL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f "$MODEL/kokoro-v1.0.onnx" ] || curl -sSL -o "$MODEL/kokoro-v1.0.onnx" "$REL/kokoro-v1.0.onnx"
[ -f "$MODEL/voices-v1.0.bin" ] || curl -sSL -o "$MODEL/voices-v1.0.bin" "$REL/voices-v1.0.bin"

echo "1/4 Narração"
"$WORK/venv/bin/python" -I scripts/narracao.py "$MODEL" "$VOICE" "$SPEED"
echo "2/4 Trilha e efeitos"
"$WORK/venv/bin/python" -I scripts/trilha.py
echo "3/4 Quadros (1920×1080, 30 fps)"
node scripts/render-frames.mjs video "$WORK/video.mp4" 30

echo "4/4 Mixagem e exportação"
# Narração com leve compressão; trilha com ducking (sidechain) sob a voz; efeitos discretos.
ffmpeg -y -loglevel error \
  -i "$WORK/video.mp4" -i out/narracao.wav -i out/trilha.wav -i out/efeitos.wav \
  -filter_complex "
    [1:a]aformat=channel_layouts=stereo,highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=1.0,asplit=2[vo][key];
    [2:a]volume=0.42[mus];
    [mus][key]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=350[duck];
    [3:a]volume=0.55[fx];
    [vo][duck][fx]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,atrim=0:30,apad=whole_dur=30[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 256k -ar 48000 -t 30 -movflags +faststart "$OUT"

# Versão com legendas como faixa selecionável (além das legendas já gravadas na imagem).
ffmpeg -y -loglevel error -i "$OUT" -i out/legendas.srt -map 0 -map 1 -c copy -c:s mov_text \
  -metadata:s:s:0 language=por out/bemind-boas-vindas-30s-cc.mp4

ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
echo "Pronto: $OUT"
