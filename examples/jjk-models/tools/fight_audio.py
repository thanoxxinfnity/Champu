"""Synthesises the sound track for fight_anim.py: no audio files, every sound is made from noise and sine waves (numpy only).

    python3 tools/fight_audio.py events.txt out.wav 13.5
"""
import sys
import wave

import numpy as np

SR = 32000
rng = np.random.default_rng(11)


def tt(d):
    return np.arange(int(d * SR)) / SR


def env(n, a=0.005, r=0.3, curve=3.0):
    x = np.arange(n) / SR
    e = np.minimum(1.0, x / max(a, 1e-4)) * np.exp(-curve * x / max(r, 1e-3))
    return e


def band(noise, lo, hi):
    f = np.fft.rfft(noise)
    fr = np.fft.rfftfreq(len(noise), 1 / SR)
    f[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(f, len(noise))


def thump(d, f0, f1, amp=1.0):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * 18)
    return amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.002, d * 0.5, 4)


def noise_burst(d, lo, hi, amp=1.0, r=0.1):
    n = rng.standard_normal(int(d * SR))
    return amp * band(n, lo, hi) * env(len(n), 0.002, r, 4) * 3


def whoosh(d=0.45, amp=0.5):
    n = rng.standard_normal(int(d * SR))
    out = np.zeros_like(n)
    parts = 6
    for i in range(parts):
        lo = 300 + i * 500
        hi = lo + 900
        w = np.sin(np.pi * (np.arange(len(n)) / len(n) * parts - i).clip(0, 1)) ** 2
        out += band(n, lo, hi) * w
    return amp * out * np.sin(np.pi * np.arange(len(n)) / len(n)) ** 1.5 * 3


def sweep(d, f0, f1, amp=0.4, trem=0.0):
    t = tt(d)
    f = f0 + (f1 - f0) * (t / d) ** 2
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * amp
    if trem:
        s *= 0.7 + 0.3 * np.sin(2 * np.pi * trem * t)
    return s * np.minimum(1, t / 0.1) * np.minimum(1, (d - t) / 0.05 + 0.0001)


def ring_metal(d=0.5, amp=0.3):
    t = tt(d)
    s = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((1900, 1), (3100, 0.7), (4700, 0.4)))
    return amp * s * env(len(t), 0.001, d, 5)


def reverb(x, wet=0.25):
    out = x.copy()
    for delay, g in ((0.037, 0.5), (0.071, 0.38), (0.113, 0.28), (0.167, 0.2)):
        k = int(delay * SR)
        out[k:] += x[:-k] * g * wet * 2
    return out


def mixs(*arrs):
    n = max(len(a) for a in arrs)
    out = np.zeros(n)
    for a in arrs:
        out[: len(a)] += a
    return out


def place(buf, snd, at):
    i = int(at * SR)
    j = min(len(buf), i + len(snd))
    if i < len(buf):
        buf[i:j] += snd[: j - i]


def main(events_path, out_path, duration):
    n = int(duration * SR)
    buf = np.zeros(n)
    # a night-city bed: low drone, slow pulse, thin wind
    t = np.arange(n) / SR
    bed = 0.10 * np.sin(2 * np.pi * 55 * t) + 0.05 * np.sin(2 * np.pi * 82.4 * t + 0.4 * np.sin(2 * np.pi * 0.2 * t))
    bed *= 0.7 + 0.3 * np.sin(2 * np.pi * 0.5 * t)
    bed += 0.05 * band(rng.standard_normal(n), 200, 900) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * t)) * 3
    # a pulse that quickens with the fight
    for k in range(int(duration * 2.2)):
        at = k / 2.2 if k / 2.2 < 6 else 6 + (k / 2.2 - 6) * 0.9
        place(buf, thump(0.18, 90, 45, 0.18), min(at, duration - 0.3))
    buf += bed
    for line in open(events_path):
        at, kind = line.split()
        at = float(at)
        if kind == 'hit':
            place(buf, mixs(thump(0.22, 140, 50, 0.9), noise_burst(0.12, 800, 6000, 0.5, 0.05)), at)
        elif kind == 'big':
            place(buf, reverb(mixs(thump(0.6, 110, 32, 1.2), noise_burst(0.35, 300, 7000, 0.8, 0.15), ring_metal(0.4, 0.1))), at)
        elif kind == 'thud':
            place(buf, mixs(thump(0.4, 70, 28, 1.0), noise_burst(0.2, 100, 900, 0.5, 0.1)), at)
        elif kind == 'whoosh':
            place(buf, whoosh(0.5, 0.6), at - 0.12)
        elif kind == 'charge':
            place(buf, mixs(sweep(1.2, 180, 900, 0.35, 9), 0.15 * sweep(1.2, 360, 1800, 0.2, 5)), at)
        elif kind == 'charge2':
            place(buf, mixs(sweep(1.0, 220, 1100, 0.3, 7), sweep(1.0, 330, 1650, 0.25, 11)), at)
        elif kind == 'blast':
            place(buf, reverb(mixs(thump(1.0, 90, 25, 1.4), noise_burst(0.9, 80, 5000, 0.9, 0.4)), 0.4), at)
        elif kind == 'slash':
            place(buf, mixs(noise_burst(0.18, 2500, 9000, 1.0, 0.06), ring_metal(0.5, 0.25)), at)
        elif kind == 'clash':
            place(buf, mixs(ring_metal(0.8, 0.4), noise_burst(0.15, 1500, 8000, 0.6, 0.05), thump(0.3, 200, 60, 0.6)), at)
        elif kind == 'purple':
            place(buf, reverb(mixs(thump(1.6, 80, 20, 1.6), noise_burst(1.4, 60, 6000, 1.0, 0.7), sweep(1.0, 600, 60, 0.4)), 0.5), at)
    # fade in/out, normalise, soft clip
    buf *= np.minimum(1.0, t / 0.4) * np.minimum(1.0, (duration - t) / 0.6)
    buf = np.tanh(buf / (np.max(np.abs(buf)) + 1e-6) * 1.8) * 0.85
    pcm = (buf * 32767).astype('<i2')
    with wave.open(out_path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', out_path, len(pcm) / SR, 's')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]))
