"""Batch 3D models for City Shifter through Triverse (keys from the environment, never from the repo).
    python3 tools/gen_assets.py [shard_index shard_count]
Image jobs use reference/<name>.png (the concept art), text jobs use the prompt below. Everything lands in raw/<name>_tv.glb; what exists is skipped.
Run each shard with its own TRIVERSE_KEYS so two accounts work side by side."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import triverse_gen as tv

STYLE = 'stylized cartoon game asset, clean bright colors, low poly, no ground plate'
WEAPONS = ["shift_gauntlet", "vortex_blaster", "quantum_breaker", "gravity_carver", "plasma_magnet", "sonic_impactor", "force_gauntlet", "seismic_rebounder",
           "saber_grapple", "orbital_crush", "tactical_beamer", "thermo_vaporizer", "chrono_sliders", "nexus_tether", "meteor_burster"]
IMAGE_JOBS = [("tracker", 15000, 1024)] + [("w_" + w, 10000, 1024) for w in WEAPONS]
TEXT_JOBS = [
    ("loco", "futuristic cartoon locomotive engine, red and cream paint, boxy cab and rounded nose, flat roof, side view", 20000),
    ("car_a", "cartoon train carriage with a flat roof and rows of windows, teal and white paint, side view", 20000),
    ("car_b", "cartoon cargo boxcar with a flat roof, orange paint with white stripes, sliding door, side view", 20000),
    ("car_c", "cartoon flatbed train car with a flat grey metal deck, cargo crates strapped on, side view", 20000),
    ("tower_a", "stylized brick apartment tower with lit windows and a water tank on the roof, warm colors", 14000),
    ("tower_b", "stylized glass office skyscraper with blue lit windows and an antenna, cool colors", 14000),
    ("tower_c", "stylized industrial warehouse building with chimneys and pipes, rusty colors", 14000),
    ("tower_d", "stylized art deco tower with a stepped top and neon sign, purple and gold", 14000),
    ("airship", "dark sci-fi war airship hovering, armored hull, glowing orange underside engines", 20000),
    ("lamp", "sci-fi street lamp post with a glowing head, dark metal", 6000),
    ("crate", "stylized wooden shipping crate with metal corners", 6000),
    ("block", "stylized grey concrete block with orange and black hazard stripes", 6000),
]
idx, cnt = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, 1)
ok = True
jobs = [("i",) + j for j in IMAGE_JOBS] + [("t",) + j for j in TEXT_JOBS]
for n, job in enumerate(jobs):
    if n % cnt != idx:
        continue
    if job[0] == "i":
        os.environ['TV_POLY'] = str(job[2])
        os.environ['TV_TEX'] = str(job[3])
        ok &= bool(tv.gen(job[1]))
    else:
        os.environ['TV_POLY'] = str(job[3])
        os.environ['TV_TEX'] = '1024'
        ok &= bool(tv.gen_text(job[1], f'{job[2]}, {STYLE}'))
sys.exit(0 if ok else 1)
