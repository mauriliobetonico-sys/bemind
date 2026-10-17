"""Gera a narração (pt-BR) e a linha do tempo do vídeo de boas-vindas.

Saídas em out/:
  narracao.wav     narração posicionada na linha do tempo de 30 s
  legendas.srt     legendas sincronizadas
  timeline.json    tempos de cenas, frases e legendas (usado pela trilha)
  ../src/timeline.js  mesmo conteúdo, carregado pela animação HTML

Uso: python narracao.py <dir-modelo-kokoro> [voz] [velocidade]
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
SR = 48000
DURATION = 30.0

# (cena, texto exibido na legenda, texto falado com grafia fonética)
PHRASES = [
    (1, "Seu domínio está registrado.", "Seu domínio está registrado."),
    (1, "Agora, vamos transformar essa ideia em um site de verdade.",
        "Agora, vamos transformar essa ideia em um site de verdade."),
    (2, "Primeiro, configuramos os DNS para conectar seu domínio à nossa infraestrutura.",
        "Primeiro, configuramos os DNS para conectar seu domínio à nossa infraestrutura."),
    (3, "Seu site terá seu próprio ambiente Cloud, preparado para executar sua operação de forma independente.",
        "Seu site terá seu próprio ambiente cláud, preparado para executar sua operação de forma independente."),
    (4, "A Be Mind desenvolve seu site, configura o certificado SSL e prepara tudo para entrar no ar.",
        "A Bi Máind desenvolve seu site, configura o certificado SSL e prepara tudo para entrar no ar."),
    (5, "Depois dos testes e da sua aprovação, publicamos seu site, com suporte 24 horas incluído.",
        "Depois dos testes e da sua aprovação, publicamos seu site, com suporte vinte e quatro horas incluído."),
    (6, "Tudo isso por R$ 150,00 por mês.", "Tudo isso por cento e cinquenta reais por mês."),
    (6, "Be Mind Marketing.", "Bi Máind Márketin."),
    (6, "Sua operação, conectada ao futuro.", "Sua operação, conectada ao futuro."),
]

FIRST_START = 0.35
GAP_SAME_SCENE = 0.12
GAP_NEW_SCENE = 0.22
MAX_CAPTION = 52

# Correções fonéticas aplicadas após o espeak (ex.: "Márketin" sem vogal extra).
PHONEME_FIXES = {"ɾəke": "ɾke", "ˈɔɾæs": "ˈɔɾɐs"}


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    n = int(round(len(x) * sr_out / sr_in))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def trim(x, thr=0.008):
    idx = np.where(np.abs(x) > thr)[0]
    return x[max(idx[0] - 240, 0): idx[-1] + 960]


def split_caption(text):
    """Divide frases longas em blocos equilibrados (preferindo vírgulas) de até MAX_CAPTION caracteres."""
    if len(text) <= MAX_CAPTION:
        return [text]
    mid = len(text) / 2
    words = text.split(" ")
    cuts, pos = [], 0
    for w in words[:-1]:
        pos += len(w) + 1
        # vírgulas pesam como se estivessem mais perto do meio
        cuts.append((abs(pos - mid) - (12 if w.endswith(",") else 0), pos))
    cut = min(cuts)[1]
    return split_caption(text[:cut].strip()) + split_caption(text[cut:].strip())


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def main():
    model_dir = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else "pm_alex"
    speed = float(sys.argv[3]) if len(sys.argv) > 3 else 1.2
    kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))

    clips = []
    for scene, shown, spoken in PHRASES:
        phonemes = kokoro.tokenizer.phonemize(spoken, "pt-br")
        for wrong, right in PHONEME_FIXES.items():
            phonemes = phonemes.replace(wrong, right)
        audio, sr = kokoro.create(phonemes, voice=voice, speed=speed, lang="pt-br", is_phonemes=True,
                                  clause_pause=0.04, sentence_pause=0.0)
        clips.append((scene, shown, resample(trim(audio), sr, SR)))

    # Posiciona as frases e garante que a última termine antes de 29,4 s.
    total = sum(len(c[2]) for c in clips) / SR
    gaps = [0.0] + [GAP_NEW_SCENE if clips[i][0] != clips[i - 1][0] else GAP_SAME_SCENE
                    for i in range(1, len(clips))]
    room = 29.4 - FIRST_START - total
    if room < sum(gaps):
        scale = max(room, 0) / sum(gaps)
        gaps = [g * scale for g in gaps]
    if room < 0:
        sys.exit(f"Narração longa demais ({total:.2f}s). Aumente a velocidade.")

    track = np.zeros(int(DURATION * SR), dtype=np.float32)
    t = FIRST_START
    phrases, captions = [], []
    for (scene, shown, audio), gap in zip(clips, gaps):
        t += gap
        start, dur = t, len(audio) / SR
        i0 = int(start * SR)
        track[i0:i0 + len(audio)] += audio
        phrases.append({"scene": scene, "text": shown, "start": round(start, 3), "end": round(start + dur, 3)})
        chunks = split_caption(shown)
        weights = np.array([len(c) for c in chunks], dtype=float)
        bounds = start + np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * dur
        for c, a, b in zip(chunks, bounds[:-1], bounds[1:]):
            captions.append({"text": c, "start": round(float(a), 3), "end": round(float(b), 3)})
        t = start + dur

    # Cenas começam um pouco antes da primeira frase de cada uma.
    scenes = {}
    for p in phrases:
        scenes.setdefault(p["scene"], max(p["start"] - 0.2, 0.0))
    scenes[1] = 0.0
    scene_starts = [round(scenes[k], 3) for k in sorted(scenes)]

    # Mantém cada legenda na tela até a próxima (sem piscar entre frases próximas).
    for a, b in zip(captions, captions[1:]):
        if b["start"] - a["end"] < 0.45:
            a["end"] = b["start"]
    captions[-1]["end"] = round(min(captions[-1]["end"] + 0.4, DURATION - 0.05), 3)

    timeline = {
        "duration": DURATION,
        "voice": voice,
        "speed": speed,
        "scenes": scene_starts,
        "phrases": phrases,
        "captions": captions,
        # Momento em que o logotipo começa a se formar: início de "Be Mind Marketing".
        "logoForm": phrases[-2]["start"] - 0.35,
    }

    os.makedirs(OUT, exist_ok=True)
    peak = np.max(np.abs(track))
    sf.write(os.path.join(OUT, "narracao.wav"), track / peak * 0.9, SR, subtype="PCM_24")
    with open(os.path.join(OUT, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ROOT, "src", "timeline.js"), "w", encoding="utf-8") as f:
        f.write("window.TIMELINE = " + json.dumps(timeline, ensure_ascii=False) + ";\n")
    with open(os.path.join(OUT, "legendas.srt"), "w", encoding="utf-8") as f:
        for i, c in enumerate(captions, 1):
            f.write(f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}\n\n")

    print(f"Narração: {total:.2f}s de fala, termina em {phrases[-1]['end']:.2f}s")
    print("Cenas:", scene_starts, "| logo:", round(timeline["logoForm"], 2))


if __name__ == "__main__":
    main()
