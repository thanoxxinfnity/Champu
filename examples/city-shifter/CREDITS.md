# Credits

World models (train, city, airship, lamp, crate) are real models from Sketchfab (CC0 / CC-BY only), converted to GLB, decimated and re-oriented with Blender (`tools/prep_sf.py`).

The six characters (`assets/cast/`) and the 15 gauntlet weapons (`assets/weapons/`) were generated with Triverse image-to-model from the reference art in `reference/` (the characters rigged with `tools/autorig_obj.py`).

| Asset | Title | Author | License | Source |
|---|---|---|---|---|
| airship | AOT Marley Airship | Solarliu | CC BY | https://sketchfab.com/3d-models/aot-marley-airship-0c79a8305c524872a6fd55f92425eccf |
| car_a | Passenger Car(Rail) | Lyskilde | CC BY | https://sketchfab.com/3d-models/passenger-carrail-1ec9ef29c1604487a2f498df7e744c88 |
| car_b | Train with Interior Low Poly | 00amza | CC BY | https://sketchfab.com/3d-models/train-with-interior-low-poly-c59afdd9e83b4eaa805bd3f657ad8803 |
| car_c | Railway carriage (wagon) demo | Vladimir_Sofyanov | CC BY | https://sketchfab.com/3d-models/railway-carriage-wagon-demo-78fc50d66e6d4e4faea410dbe13d895b |
| city_a | Low-poly City Buildings | smooth998 | CC BY | https://sketchfab.com/3d-models/low-poly-city-buildings-e0209ac5bb684d2d85e5ade96c92d2ff |
| city_b | Asian Themed Low Poly Night City Buildings | 99.Miles | CC BY | https://sketchfab.com/3d-models/asian-themed-low-poly-night-city-buildings-9f0343aff4814b758dc6e905aba5b5e0 |
| city_c | Low Poly Night City Building Skyline | 99.Miles | CC BY | https://sketchfab.com/3d-models/low-poly-night-city-building-skyline-b0035b8713b048bb8ddf311ee67c28c8 |
| city_d | Low Poly Urban Metropolis1 | Inditrion Dradnon | CC BY | https://sketchfab.com/3d-models/low-poly-urban-metropolis1-5fa11d921ecf44cba0dc825fb142ec71 |
| city_e | Low Poly Urban Metropolis3 | Inditrion Dradnon | CC BY | https://sketchfab.com/3d-models/low-poly-urban-metropolis3-576141c30c2141b4aa70744091127da9 |
| crate_a | Wooden Crate | YadroGames | CC BY | https://sketchfab.com/3d-models/wooden-crate-e12fde1101b84b6da40056336a7b309d |
| lamp | Street Lamp | bez_glaza | CC BY | https://sketchfab.com/3d-models/street-lamp-6881aa1e84b047d79860fa9297e05e22 |
| loco | Fantasy Locomotive Train FREE | Daniil Kulinich | CC BY | https://sketchfab.com/3d-models/fantasy-locomotive-train-free-f0b7fdaaacd2473f877f62f350a766a5 |

## Open world (generated models)

All of these were generated for this game, then prepared for phones with Blender (`tools/prep_world.sh`, `tools/prep_vehicles.sh`, `tools/autorig_quad.py`):

* **Triverse** (text-to-model, `tools/gen_world.py tv`): the jetpack, the rigged horse, every car body (hatchback, supercar, pickup, taxi, cargo truck, fire engine, monster truck and the rest of the garage) and the tyres.
* **NVIDIA TRELLIS** (text-to-model, `tools/nv_gen.py`): the trees, bushes, rocks, the town (shop houses, torii gates, lanterns, vending machines, pagoda, windmill, stable, bridge) and the camping props.
* The road, grass, river and sky are shaders (`shaders/`), the anime colour grade is `shaders/grade.gdshader`.

## Fonts

* **Bangers** (Vernon Adams, SIL Open Font License 1.1) for titles; **M PLUS Rounded 1c** Bold (Coji Morishita, SIL OFL 1.1) for text. Both from github.com/google/fonts.

## Heroes, cards and effects (v0.4)
- Kafu, Rachel and Rina are the generated, auto-rigged stand-in heroes of Crimson Mist (Triverse text/image-to-3D, `tools/autorig_obj.py`); Mococo is generated with NVIDIA TRELLIS and rigged the same way. No licensed character pack is shipped.
- Battle-card portraits (`assets/ui/cards`, `assets/ui/full`) and the weapon icons (`assets/ui/weapons`) are rendered from the game's own models by `tests/portrait_baker.gd` and `tests/icon_baker.gd`.
- The cel shader (`shaders/toon_char.gdshader`), the loading screen, the hero cards and the destructible downtown are original code of this repository.
