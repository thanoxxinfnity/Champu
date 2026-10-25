# Crimson Mist — credits and licences

Original game code, shaders, story ("The Red Bell", Harrow Cove) and tests: this repository.

## Characters
The public build ships **generated stand-in heroes** (`assets/cast/*.glb`) made with Triverse text/image-to-3D and auto-rigged by `tools/autorig_obj.py`.
Licensed character packs (Rachel Gardner, Rina Nakajima, Mococo Abyssgard, Kafu conversions) are **not redistributed**: they live in the gitignored
`private/models/` folder and are only used in local builds. Credit the original model authors when you use them.

## Tools and research
- Triverse — text/image to 3D for enemies, survivors and props.
- MDM (Human Motion Diffusion Model, Tevet et al.) — text-to-motion, converted into `assets/anim/*.json` clips via `tools/mdm_sample.py` / `tools/joints_to_clip.py`.
- CLIP (OpenAI) — text encoder used by MDM.
- Blender 4.2 (headless) for rigging/export, Godot 4.3 for the game.
