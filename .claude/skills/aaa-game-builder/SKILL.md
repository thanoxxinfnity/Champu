---
name: aaa-game-builder
description: Build a polished, tested, shippable mobile 3D game (Godot 4.x, GL Compatibility, Android APK) from a design document or idea. Use when asked to make a game, a horror/survival game, "AAA" quality, a game from a GDD, or when a game build needs rigging, enemy AI, streaming, touch controls, UI bounds, headless tests, gameplay video or APK release. Covers the whole pipeline: intake, scope, systems, assets, rigging, dread, UI rules, tests, CI, recording, release.
---

# AAA game builder

A pipeline that turns a game idea into an APK that has been *played by a bot, looked at by eye and tested for the bugs players actually hit*. It was extracted from building Grinworks and Project OVERRIDE; every rule below exists because skipping it cost a rework.

## 0. Be honest about what AAA means here

"AAA" is a studio-years budget. What one agent session can ship is a **vertical slice with AAA craft**: a few hours of designed content at most, one polished loop, real systems (rig, AI, streaming, inventory), real tests. Say so up front, in one sentence, and never claim stars, ratings or hours that were not measured. Report what was verified (test names, frame counts, a video) and what was not.

## 1. Intake (15 minutes, no code)

1. Read the whole design document. List every **hard rule** it states (frame rate, UI rules, physics layers, systems named). Hard rules become tests, not intentions.
2. Write the **pillars** (3 lines): the feeling, the loop, the fear/fun source.
3. Cut to a slice: one place, one enemy that is *excellent*, one puzzle that has exactly one answer, one ending. Content is added after the slice passes its gates.
4. Pick the engine contract and keep it: Godot 4.3, GL Compatibility renderer, GDScript, touch-first.

## 2. Mobile renderer contract (GL Compatibility)

Available: fog (exponential), glow, omni/spot lights (max 8 per mesh), GPUParticles3D, skinned meshes, OccluderInstance3D, navigation, canvas shaders with `hint_screen_texture` (blur works).
**Not available**: SSR, SSAO, volumetric fog, SDFGI, decals. Substitutes: wet floor = low roughness + specular + emissive reflection quads under lamps; volumetric fog = exp fog + additive light-cone meshes (`shaders/shaft.gdshader` in Grinworks) + dust particles; decals = alpha quads.
Budget: < 300 draw calls per loaded room, < 150k triangles on screen, ≤ 8 lights near the player, shadows off on small props. Stream rooms (see §6) rather than hoping.
Never ship anything the design says "SSR / volumetric" for without telling the user the substitute.

## 3. Repository layout

```
examples/<game>/
  project.godot  export_presets.cfg  scenes/main.tscn
  scripts/ (data, player, ui, sfx, rig, enemy, level/streamer, dread, game)
  shaders/  assets/  tools/ (generators, rig baker)  tests/
.github/workflows/<game>-apk.yml     # gates first, then export, then release
```
Reuse engine-layer files from `examples/grinworks/scripts` (player touch controls, sfx synthesis, dread, detail, rig) instead of rewriting; read `reference/engine-layer.md`.

## 4. Assets

* Models: NVIDIA NIM TRELLIS (`src/lib/suites/godot/trellis.ts`), prompts **short** (long ones stall); the word "zombie" is filtered (say "ghoul"); retry — the service fails at random. Pixal3D on Kaggle needs a phone-verified account. Textures via FLUX if needed.
* Prep every raw GLB (`tools/prep_*.py`): strip the ground plate, simplify to a triangle budget, JPEG textures. Phone budgets: hero creature 6–7k tris, props 500–2.5k.
* Always have a **stand-in** (box/cylinder) for every model so the game and tests run without assets.
* Procedural everything else: textures by shader (no UV needed), sounds synthesised at start-up on a thread, UI icons drawn with `draw_*`.

## 4b. Rigging (real skeletons, not shader wobble)

Recipe proven on a TRELLIS T-pose mascot (`reference/rigging.md`):
1. Measure the mesh in its own box (slice heights/extents) and write joint positions as fractions of the box (`Rig.JOINTS`).
2. `tools/bake_rig.gd` (run under xvfb with a real renderer — the headless dummy renderer cannot read mesh arrays) weights each vertex to the 4 nearest limb segments of its own side by distance^-3 and saves a skinned `ArrayMesh` (`.res`).
3. At run time build `Skeleton3D` (identity rest rotations) + `Skin` (binds = −joint position) from the same table; animations are code-built `Animation` resources (rotation tracks per bone, position on pelvis, scale for stretched arms), looped, blended by `AnimationPlayer.play(name, 0.25)`.
4. Verify with a contact sheet of poses from front and side (`tests/rigshot.gd`) before touching gameplay. Lean-forward poses push arms down: add `lift` to compensate.
5. Add what makes it a monster on the head bone (`BoneAttachment3D`): teeth, glowing eyes. Statues = same rig, grey, paused.

## 5. Enemy AI

State machine: Dormant → Patrol → Investigate (a sound) → Chase → Stunned → Flee/Lurk. Use `NavigationAgent3D` on a `CharacterBody3D`; build the navmesh in code from a grid of quads so it works headless. Sound is the main sense (footsteps, sprint, interaction, gadget); sight is a ray test. Fairness rules that made Grinworks playable: a grace period after respawn, escalating stun threshold, never kill from out of view in the first second, one tell before every attack (sound or animation), hiding must work.
Test: `hollow_test`-style headless script that asserts each transition and that the creature reaches a target through the navmesh.

## 6. Streaming and physics

* Rooms are data; a streamer keeps the current room and its neighbours, `queue_free()`s the rest, rebuilds on re-entry from a state dictionary (items taken, doors opened). Trigger = `Area3D` at each doorway. Add `OccluderInstance3D` boxes behind walls.
* Layers: 1 player, 2 enemies/debris, 3 world, 4 interactables (or as the design says). Debris = `RigidBody3D` with convex shapes, damping so it slides off the player.
* Test: walk the bot through every doorway, assert the set of loaded rooms and that freed rooms are really freed.

## 7. UI rules (these caused real bugs)

* **Text never leaves its box.** Paper/quest UI = `TextureRect` → `MarginContainer` (≥20 px) → `RichTextLabel` with `autowrap_mode = WORD`, `clip_contents = true`. World text: size it to the wall (`Label3D` measured with the font), keep it off lintels and other signs.
* Floating HUD text overlaps world signs: either have none (icons only) or put a dim backing strip behind it.
* Buttons are white line-art glyphs on smoked-glass discs, drawn in code. Interact prompt = a hand icon only when a ray hits something usable.
* No health bar: camera shake, red edge shader, heartbeat.
* Tests: `signs_test` (every wall label fits its wall, nothing overlaps), `ui_test` (the longest string of each kind lies on screen, off the buttons, not over other text, at 1280×720).

## 8. Fear (if it is a horror game)

A **director** with a tension value (darkness, enemy distance, battery) drives grain/vignette/heartbeat/room tone and schedules events: light stutter, distant sound, a shape at a corridor's end that vanishes when looked at. One tell, then the payoff. Broken set (holes, rubble, cracks, fallen tiles, blood trails), plaster statues, a monitor that shows a grin for one blink. Story through found tapes/papers, not floating text. Details: `reference/horror-craft.md`.

## 9. Tests are the gate

Required before any build is called done (all headless, all in CI, all printing `ALL OK`; a script that fails to parse still exits 0, so grep the verdict line):
`puzzles_test` (each puzzle has exactly one answer, brute-forced) · `map_test` (graph connected, every use-point reachable and aimable, counts in the world match the clues) · enemy test · stream test · `signs_test` · `ui_test` · `dread_test` (rig clips and bones) · `playthrough` (a bot plays the whole game with the real controls; `S9_LIVE=1` with the enemy hunting).
Bot rules: close notes like a player (4 s), aim with eased yaw/pitch, never rely on teleports.

## 10. Look at it, then film it

* Screenshots at each place: `xvfb-run godot --rendering-driver opengl3 -s tests/shots.gd` → contact sheet → read it. Fix what you see (clutter, text over text, flat lighting).
* Film: `godot --write-movie out.avi --fixed-fps 30 --resolution 960x540 -s tests/playthrough.gd` under xvfb (≈30 % real time), a `S9_FILM=1` mode that lingers on title/win and reads the story items. Concatenate extra showcase clips, encode `libx264 -b:v 600k` (≤ 30 MB for chat delivery), and **extract frames at 10+ timestamps and look at them** before sending.

## 11. CI and release

Workflow: import project → every test gate → export APK with `barichello/godot-ci:4.3` (set `HOME=/root`) → bump version → publish a release tag. Keep the debug/sideload keystore for sideload builds only; a Play-signed build needs the owner's release keystore, which must never be generated silently. Never commit tokens; keys live in an env file outside the repo. Do not open a PR unless asked.

## 11b. Pitfalls found building Project OVERRIDE (each cost a debugging round)

* `Tween.set_ignore_time_scale` does not exist in 4.3. If the world is frozen with `Engine.time_scale = 0` (pack, paper), animate the UI by wall clock (`Time.get_ticks_msec()`) instead of tweens.
* A hand-made navigation mesh must keep a margin from walls (inset room cells by 0.5 m) or paths graze door jambs and the bot/creatures stick. Doorways are strips through the wall that join the inset cells either side.
* Two rooms that share a doorway both build a trigger for it: make the handler idempotent (decide by player position/heading, not "the other room").
* A node freed with `queue_free()` still owns its name for a frame: a room rebuilt at once gets an auto-generated `@Node3D@n` name. Keep ids in `set_meta`, never parse names.
* Anything raised more than ~0.1 m off the floor (planks over water) is a wall to a `CharacterBody3D` without step logic: lay boards at 0.07 m.
* Objects spawned "from the ceiling" must start below it, or the physics body is born inside the ceiling collider and sleeps there.
* Do not `queue_free()` a node a game field still points at (`warden`): guard with `is_instance_valid`.
* `await create_timer` inside a bot loop runs at the fixed physics rate in headless, so a bot that "waits 3 s" costs 180 frames; keep film-only lingering behind a flag.
* A hearing-and-sight bot that plays with creatures live needs real tactics (stun, sprint, creep) and is slow to tune; gate CI on the creatures-off bot plus targeted creature tests, and record the live run with a clearly labelled safety net.
* GitHub workflow step names containing `: ` must be quoted, or the whole file is invalid and no job even starts.
* GDScript `:=` cannot infer from an untyped `Array`/`Dictionary` element: annotate (`var x: float = r[0]`).

## 12. Reporting

Short, in the user's language. Say: what was built, what the tests prove, what the video shows, what is *not* done. List limits plainly (hours of content, renderer substitutes, anything unverified on a real phone).
