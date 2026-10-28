"""Real recorded sound effects for the game (all CC0), cut and packed small for a phone:
  * The Free Firearm Sound Library (CC0, opengameart.org/content/the-free-firearm-sound-library): each recording holds several
    shots; the first shot is found (the first sample past a third of the peak), cut from just before it, faded out.
  * Kenney Interface Sounds and Sci-fi Sounds (CC0, kenney.nl, mirrored on opengameart.org): UI clicks, pickups, explosions.
Output: assets/sfx/<name>.ogg, mono 22.05 kHz Vorbis, peak-normalised. Audio picks a file up by name and synthesises only what is missing.
    python3 tools/prep_sfx.py <firearm_library_dir> <kenney_interface_dir> <kenney_scifi_dir> <out_dir>"""
import os
import subprocess
import sys
import tempfile

import numpy as np

RATE = 22050
fire, ui, scifi, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)

# game sound -> (source, start mode, length s, gain)
PLAN = {
    'zap': (os.path.join(fire, '1911', 'A_34P.wav'), 'shot', 0.55, 1.0),          # light guns: a pistol crack
    'zap_alt': (os.path.join(fire, 'Walther PPQ', 'X_31P.wav'), 'shot', 0.55, 1.0),
    'zap_low': (os.path.join(fire, 'AK-47', 'C_27P.wav'), 'shot', 0.6, 1.0),        # heavy guns: a rifle
    'shotgun': (os.path.join(fire, 'Mossberg', 'N_30P.wav'), 'shot', 0.8, 1.0),
    'boom': (os.path.join(scifi, 'lowFrequency_explosion_000.ogg'), 'whole', 1.6, 1.0),
    'shatter': (os.path.join(scifi, 'explosionCrunch_000.ogg'), 'whole', 0.9, 0.9),
    'hurt': (os.path.join(scifi, 'impactMetal_002.ogg'), 'whole', 0.5, 0.8),
    'place': (os.path.join(ui, 'drop_002.ogg'), 'whole', 0.5, 0.9),
    'coin': (os.path.join(ui, 'confirmation_002.ogg'), 'whole', 0.6, 0.8),
    'ui': (os.path.join(ui, 'toggle_001.ogg'), 'whole', 0.3, 0.8),
    'ping': (os.path.join(ui, 'click_001.ogg'), 'whole', 0.3, 0.8),
    'pickup': (os.path.join(ui, 'maximize_006.ogg'), 'whole', 0.6, 0.8),
    'error': (os.path.join(ui, 'error_004.ogg'), 'whole', 0.6, 0.7),
}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def encode(x, path):
    with tempfile.NamedTemporaryFile(suffix='.f32') as tmp:
        tmp.write(x.astype(np.float32).tobytes())
        tmp.flush()
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', tmp.name,
                        '-c:a', 'libvorbis', '-q:a', '4', path], check=True)


for name, (src, mode, length, gain) in PLAN.items():
    if not os.path.exists(src):
        print('missing', name, src)
        continue
    x = decode(src)
    if mode == 'shot':
        peak = np.max(np.abs(x))
        i = int(np.argmax(np.abs(x) > peak * 0.33))
        start = max(0, i - int(0.004 * RATE))
    else:
        loud = np.nonzero(np.abs(x) > np.max(np.abs(x)) * 0.02)[0]
        start = int(loud[0]) if len(loud) else 0
    y = x[start:start + int(length * RATE)]
    n = len(y)
    fade = min(n, int(0.25 * n))
    y[n - fade:] *= np.linspace(1.0, 0.0, fade) ** 2
    y = y / max(1e-6, np.max(np.abs(y))) * 0.95 * gain
    encode(y, os.path.join(out, name + '.ogg'))
    print('%-8s %.2fs from %s' % (name, n / RATE, os.path.relpath(src)))
