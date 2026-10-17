"""Sintetiza a trilha eletrônica corporativa e os efeitos sonoros, sincronizados com out/timeline.json.

Saídas: out/trilha.wav (música) e out/efeitos.wav (efeitos), estéreo 48 kHz.
Tudo é gerado por código — sem amostras de terceiros, sem questões de licença.
"""
import json
import os

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
TL = json.load(open(os.path.join(ROOT, "out", "timeline.json"), encoding="utf-8"))
DUR = TL["duration"]
N = int(DUR * SR)
S = TL["scenes"]
LOGO = TL["logoForm"]
rng = np.random.default_rng(42)

BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def lp_fast(x, cutoff):
    """Passa-baixa via FFT (corte suave) — rápido para sinais longos."""
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1 / SR)
    resp = 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X * (resp[:, None] if x.ndim == 2 else resp), n=x.shape[0], axis=0)


def hp_fast(x, cutoff):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(x.shape[0], 1 / SR)
    resp = 1 - 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X * (resp[:, None] if x.ndim == 2 else resp), n=x.shape[0], axis=0)


def reverb(x, seconds=2.2, mix=0.25):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * np.exp(-t * 6.9 / seconds)[:, None]
    ir = lp_fast(ir, 6000)
    ir /= np.sqrt((ir ** 2).sum(0))
    L = x.shape[0] + n
    size = 1 << (L - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[: x.shape[0]]
    return x * (1 - mix) + wet * mix * 1.6


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    if sig.ndim == 1:
        sig = np.stack([sig * np.sqrt(0.5 - pan / 2), sig * np.sqrt(0.5 + pan / 2)], 1) * np.sqrt(2)
    buf[i: i + len(sig)] += sig * gain


def env_ad(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(t / max(a, 1e-4), 1) * np.exp(-np.maximum(t - a, 0) / d)


# ---------------- música ----------------
# Progressão em Lá menor/Dó maior: Am9 · Fmaj7 · C(add9) · G6 — acordes de 2 compassos (4 s)
CHORDS = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [48, 55, 60, 62, 64], [55, 59, 62, 64, 67]]
ROOTS = [45, 41, 36, 43]
music = np.zeros((N, 2))
t_all = np.arange(N) / SR


def chord_at(t):
    return int(t // (BAR * 2)) % 4


# Pad: osciladores dente-de-serra aditivos levemente desafinados
pad = np.zeros((N, 2))
for c in range(int(np.ceil(DUR / (BAR * 2)))):
    t0 = c * BAR * 2
    n = int(min(BAR * 2 + 0.6, DUR - t0) * SR)
    if n <= 0:
        continue
    t = np.arange(n) / SR
    seg = np.zeros((n, 2))
    for note in CHORDS[c % 4]:
        for det, side in ((-0.09, 0), (0.0, None), (0.09, 1)):
            f = hz(note + det)
            w = sum(np.sin(2 * np.pi * f * k * t + k) / k ** 1.3 for k in range(1, 9))
            if side is None:
                seg += w[:, None] * 0.5
            else:
                seg[:, side] += w
    fade = np.minimum(t / 0.8, 1) * np.minimum((n / SR - t) / 0.6, 1)
    pad[int(t0 * SR): int(t0 * SR) + n] += seg * fade[:, None]
pad = lp_fast(pad, 1400)
pad *= (0.55 + 0.45 * np.minimum(t_all / 4, 1))[:, None]
music += pad / np.abs(pad).max() * 0.22

# Arpejo em semicolcheias (a partir da cena 1, intensifica na cena 3)
arp = np.zeros((N, 2))
step = BEAT / 4
pattern = [0, 2, 4, 2, 1, 3, 4, 3]
n_note = int(0.45 * SR)
tt = np.arange(n_note) / SR
for i in range(int(DUR / step)):
    t0 = i * step
    if t0 < 1.0 or t0 > LOGO + 0.2:
        continue
    notes = CHORDS[chord_at(t0)]
    m = notes[pattern[i % 8]] + 12
    f = hz(m)
    tone = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.12 * np.sin(6 * np.pi * f * tt)) * env_ad(n_note, 0.004, 0.12)
    g = 0.5 + 0.5 * min(max((t0 - S[2]) / 3, 0), 1)
    place(arp, tone, t0, 0.09 * g * (1.0 if i % 4 == 0 else 0.75), pan=0.35 * np.sin(i * 0.7))
# delay pontuado
d = int(BEAT * 0.75 * SR)
for k in range(1, 4):
    arp[d * k:, 0 if k % 2 else 1] += arp[: -d * k, 0 if k % 2 else 1] * (0.32 ** k)
music += lp_fast(arp, 5200)

# Bateria discreta: kick a partir da cena 2, hi-hat a partir da cena 3, pausa na oferta
drums = np.zeros((N, 2))
nk = int(0.35 * SR)
tk = np.arange(nk) / SR
kick = np.sin(2 * np.pi * (45 * tk + (110 - 45) * 0.035 * (1 - np.exp(-tk / 0.035)))) * np.exp(-tk / 0.16)
nh = int(0.06 * SR)
hat = hp_fast(rng.standard_normal(nh), 7000) * env_ad(nh, 0.001, 0.018)
for i in range(int(DUR / BEAT)):
    t0 = i * BEAT
    if S[1] - 0.05 <= t0 < S[5] - 0.1:
        if t0 >= S[2] or i % 2 == 0:
            place(drums, kick, t0, 0.42)
    if S[2] <= t0 < S[5] - 0.1:
        place(drums, hat, t0 + BEAT / 2, 0.07, pan=0.2)
        place(drums, hat, t0 + BEAT / 4 * 3, 0.03, pan=-0.2)
music += drums

# Baixo pulsante em colcheias (cenas 3 a 5)
bass = np.zeros((N, 2))
nb = int(BEAT / 2 * SR)
tb = np.arange(nb) / SR
for i in range(int(DUR / (BEAT / 2))):
    t0 = i * BEAT / 2
    if not (S[2] <= t0 < S[5] - 0.1):
        continue
    f = hz(ROOTS[chord_at(t0)])
    tone = (np.sin(2 * np.pi * f * tb) + 0.25 * np.sin(4 * np.pi * f * tb)) * env_ad(nb, 0.005, 0.12)
    place(bass, tone, t0, 0.2)
music += bass

# Subida (riser) para o encerramento e impacto na formação do logotipo
nr = int((LOGO - (S[5] + 0.4)) * SR)
tr = np.arange(nr) / SR
noise = rng.standard_normal(nr)
riser = hp_fast(noise, 2500) * (tr / tr[-1]) ** 2.5
place(music, riser, S[5] + 0.4, 0.08)
ni = int(3.5 * SR)
ti = np.arange(ni) / SR
boom = np.sin(2 * np.pi * (38 * ti + 50 * 0.08 * (1 - np.exp(-ti / 0.08)))) * np.exp(-ti / 0.9)
shimmer = sum(np.sin(2 * np.pi * hz(m) * ti) for m in (72, 76, 79, 84, 88)) * env_ad(ni, 0.25, 1.4) * 0.25
place(music, boom, LOGO + 0.05, 0.55)
# acorde final (Dó maior aberto) sustentado até o fim
nf = int((DUR - LOGO) * SR)
tf = np.arange(nf) / SR
final = sum(sum(np.sin(2 * np.pi * hz(m) * k * tf + k) / k ** 1.4 for k in range(1, 6)) for m in (48, 55, 60, 64, 67, 71))
final = lp_fast(final * np.minimum(tf / 0.5, 1), 1800)
place(music, final / np.abs(final).max() * 0.22, LOGO + 0.1)
place(music, shimmer, LOGO + 1.3, 0.09)

music = reverb(music, 2.4, 0.22)
# fade-in e fade-out
fade = np.minimum(t_all / 0.4, 1) * np.minimum((DUR - t_all) / 1.2, 1)
music *= fade[:, None]

# ---------------- efeitos ----------------
sfx = np.zeros((N, 2))


def whoosh(length=0.7, lo=400, hi=4000):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    # varredura de filtro passa-banda aproximada por janelas na FFT
    out = np.zeros(n)
    win = 2048
    for s in range(0, n, win // 2):
        seg = x[s:s + win]
        if len(seg) < 8:
            break
        k = s / n
        fc = lo * (hi / lo) ** np.sin(np.pi * k)
        X = np.fft.rfft(seg * np.hanning(len(seg)))
        f = np.fft.rfftfreq(len(seg), 1 / SR)
        X *= np.exp(-((np.log2(f + 1) - np.log2(fc)) ** 2) / 0.6)
        out[s:s + len(seg)] += np.fft.irfft(X, len(seg))
    return out * np.sin(np.pi * t / length) ** 2


def blip(f, length=0.12, d=0.05):
    n = int(length * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env_ad(n, 0.002, d)


def click(length=0.03):
    n = int(length * SR)
    return hp_fast(rng.standard_normal(n), 3000) * env_ad(n, 0.0005, 0.004)


def chime(notes, length=1.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for j, m in enumerate(notes):
        o = int(j * 0.07 * SR)
        f = hz(m)
        out[o:] += (np.sin(2 * np.pi * f * t[: n - o]) + 0.2 * np.sin(2 * np.pi * 2.01 * f * t[: n - o])) * env_ad(n - o, 0.003, 0.35)
    return out


for k in range(1, 6):
    w = whoosh()
    place(sfx, w / np.abs(w).max(), S[k] - 0.35, 0.16, pan=-0.3 + 0.12 * k)
# digitação do domínio
for i in range(21):
    place(sfx, click(), 0.35 + i * 0.9 / 21, 0.05 + 0.02 * (i % 3), pan=0.1)
place(sfx, chime([84, 91], 0.8), 1.38, 0.12)                          # "Registrado"
place(sfx, blip(1200), S[1] + 0.8, 0.12)                              # DNS 1 atualizado
place(sfx, blip(1500), S[1] + 1.1, 0.12)                              # DNS 2 atualizado
place(sfx, chime([79, 84, 88]), S[1] + 3.0, 0.14)                     # domínio conectado
place(sfx, whoosh(0.9, 200, 1800), S[2] + 1.3, 0.12)                  # nuvem vira instância
place(sfx, blip(220, 0.4, 0.15), S[2] + 1.5, 0.3)
for i in range(8):
    place(sfx, blip(1700 + 140 * i, 0.06, 0.02), S[2] + 2.9 + i * 0.2, 0.05, pan=0.3)
for i in range(30):
    place(sfx, click(), S[3] + 0.25 + i * 1.35 / 30, 0.035, pan=-0.3)  # código
ssl = S[3] + 1.7
place(sfx, click(0.05), ssl + 0.62, 0.35)                              # cadeado fecha
place(sfx, chime([76, 83, 88], 1.4), ssl + 0.66, 0.16)
place(sfx, blip(1300), S[4] + 0.55, 0.1)                               # checklist
place(sfx, blip(1600), S[4] + 1.35, 0.1)
place(sfx, click(0.05), S[4] + 2.2, 0.5)                               # clique em publicar
place(sfx, chime([72, 79, 84, 88], 1.5), S[4] + 2.3, 0.15)
place(sfx, blip(900, 0.25, 0.1), S[4] + 3.4, 0.1)                     # suporte 24h
place(sfx, reverb(np.stack([shimmer, shimmer], 1), 2.0, 0.4)[:, 0], LOGO + 1.45, 0.1)

sf.write(os.path.join(ROOT, "out", "trilha.wav"), music / np.abs(music).max() * 0.9, SR, subtype="PCM_24")
sf.write(os.path.join(ROOT, "out", "efeitos.wav"), sfx / np.abs(sfx).max() * 0.9, SR, subtype="PCM_24")
print("Trilha e efeitos gerados.")
