# Generated textures

Empty on purpose — ~2 MB of JPEG is *output*. Chomugiri paints these with
FLUX.1-dev on NVIDIA NIM; the plan and the prompts live in
`src/lib/suites/godot/textures.ts`.

`road_0..4.jpg`, `rail_0..4.jpg` (one pair per stage), plus `obstacle.jpg`,
`barrier.jpg`, `coin.jpg`, `hero_skin.jpg` and `hero_cloth.jpg`.

Without them the game still runs: `track.gd` and `character.gd` both fall back
to flat colours, which is why those colours are still in the code.
