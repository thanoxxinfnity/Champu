# Project OVERRIDE

A first-person survival-horror game for phones (Godot 4.3, GL Compatibility, Android APK), built from `Project OVERRIDE – Master GDD`.
You wake in a cryo chamber at the bottom of a wrecked science lab and have to go down through four chapters, past things that
cannot be killed, to plant a bomb on the reactor core and get out in three minutes.

| chapter | place | enemy | task |
|---|---|---|---|
| 1 The Safe Room | cryo chamber, dark corridor, server closet, store | **crawlers** (broken maintenance robots, crawl towards sound) | cable + 3 fuses → fuse box → lift |
| 2 Sparking Corridors | flooded lobby (the water is live), pipe tunnel, pump room | **blind hunters** (hear everything, see nothing) | cross on the dry planks, find the timer and wiring, throw three levers in the one right order |
| 3 The Factory | assembly floor with conveyor belts, locker room, foreman's office, workshop | **the Warden** (cannot be hurt; hide in lockers) | office switch → keycard, gel, craft the detonator, lift |
| 4 The Core Escape | descent, reactor, waste hall, return tunnel | the Warden, enraged, and everything else | craft the mega-bomb, plant it, **3 minutes**, run |

**Honest scope.** The GDD asks for 4 hours. This build is four complete, playable chapters of roughly 5–10 minutes each (the bot plays
the whole thing in about 2½ minutes; a person will take longer). Every system the GDD names exists and is tested; the amount of content
is a vertical slice, not four hours.

## The GDD, rule by rule

| GDD rule | where it is | proof |
|---|---|---|
| Player = `CharacterBody3D`, virtual joystick, swipe-to-look | `scripts/player.gd`, `scripts/ui.gd` (`_input`) | `playthrough` drives it with the real controls |
| No useless UI text; only a **hand icon** that appears when you look at something usable | `ui.gd` (`_hit`, `_draw_pad`); the HUD is stick, swipe area, line-art buttons, the hand | the only text anywhere is the title and the papers |
| Enemies: `NavigationAgent3D` + NavMesh, states Patrol / Investigate (sound) / Chase | `scripts/enemy.gd`, navmesh built in `world.gd` | `enemy_test` |
| The Warden: cannot be killed, heavy steps shake the screen, hide in lockers/vents | `enemy.gd`, `player.gd` (`shake`), `dressing.gd` (lockers) | `enemy_test` (footstep shake, hiding, no damage API) |
| EMP stunner: `RayCast3D`, 5 s stun, battery to find | `player.gd` (`fire_emp`), `cell_*` pick-ups | `enemy_test`, `game_test` |
| Mega-bomb crafting from parts, inventory | `data.gd` (recipes), `game.gd` (`craft`), `ui.gd` (pack) | `puzzles_test`, `ui_test`, `playthrough` |
| Falling debris: `Area3D` triggers, `RigidBody3D`, layers right, slides off the player | `dressing.gd` (`_debris`), `game.gd` (`drop_debris`) | `game_test` |
| No health bar: camera shake, red edges (shader), heartbeat when low | `player.gd`, `shaders/post.gdshader`, `sfx.gd` | `showcase` frame 05 |
| Pack: `Engine.time_scale = 0`, frosted-glass blur, 3×3 `GridContainer`, drag-and-drop or click to craft | `ui.gd` (`show_pack`, `InvSlot`), `shaders/frost.gdshader` | `ui_test` |
| Paper quest: `TextureRect` → `MarginContainer` (20 px) → `RichTextLabel` (autowrap Word, clip) so text never leaves the paper | `ui.gd` (`show_paper`) | `ui_test` checks every paper at 1280×720 and 960×540 |
| Transparent HUD, left stick, right swipe, centre hand | `ui.gd` | `ui_test` (buttons on screen, off each other and the hand) |
| Chunk streaming: `Area3D` door triggers, `queue_free()` the rooms behind, `OccluderInstance3D` | `world.gd` | `stream_test` |
| Layers: player 1, debris/enemies 2, tight convex shapes | `data.gd`, `project.godot` | `game_test` (debris layer) |
| 60 FPS | draw-call and primitive budget per room | `perf` (worst view: 248 draw calls, ~52k primitives) — a proxy, not a measured frame rate on a phone |
| SSR wet floor, volumetric fog | **not available in the phone renderer**; substitutes: low-roughness floor with red light reflections, exponential fog + light-cone meshes + dust | — |

## Tests (all headless unless noted)

`puzzles_test` · `map_test` · `stream_test` · `enemy_test` · `ui_test` · `game_test` · `playthrough` (a bot plays chapters 1–4;
`OV_LIVE=1` with the creatures hunting, `OV_FILM=1` for a recording) · `perf` and `showcase` / `shots` (need a renderer: `xvfb-run`).

## Assets

Creatures and props: NVIDIA NIM TRELLIS (`tools/gen_trellis.mjs`), reduced with `tools/prep.py`. The three robots are skinned to a real
skeleton (Rigger's 49-bone humanoid contract, 30 finger bones included) by `tools/bake_rig.gd` and animated by `scripts/rig.gd` (idle, walk, stomp, run, lunge, recoil, sweep, crawl). Conveyors, server
racks and the bomb are built from primitives. Everything else (sounds, textures, icons) is generated in code.

## Rigs

`Rig.make(model, size)` builds a `Skeleton3D` with the 49 Rigger bones, a baked skinned mesh and the clips. `assets/rigger/*.glb` are the same characters in Rigger's export layout (`Character > Rig + Mesh`, clip `Take`), written by `tools/export_rigger_glb.gd`; `tests/rig_test.gd` and `tests/rigger_glb_test.gd` check them. `tests/rigshot.gd` and `tests/handshot.gd` render the poses and the hands.

## Sound, the creatures and the pack

* **The pack holds 25 things** (5 x 5 frosted-glass grid, tap or drag to combine, a full pack refuses a 26th pick-up).
* **Everything you do has a loudness** (metres it carries): standing still 0, crouch-walking 0.8, walking 4.2, running 10, a pick-up 2.5, a switch 8, the EMP 9, a thrown scrap's clang 20. The sound meter at the bottom of the screen (a speaker with up to three waves, white, amber, red) shows how loud you are right now.
* **Blind hunters kill by sound only.** A noise you make hears it come; while you keep making noise it kills; stand still or crouch and it only listens, even a metre away. Its strike has a half-second wind-up and only lands if it hears you *again* during it. A thrown **scrap** (found in eight places, button or `G`) is a decoy: it goes to the clang, not to you. Its sensor band shows blue (calm), amber (heard something), red (hunting).
* **Crawlers hunt as a pack** (the one that sees you screeches and the others near it come), and **leap after a visible crouch** you can dodge.
* **Every creature searches** after a sound (it stands and listens, then checks three spots around it; the Warden also walks up to the lockers near it), re-plans if it gets stuck, and can't be EMP-chained (a short immunity after a stun).
* Tests: `enemy_test` (silent player on top of a hunter is not hurt, a noisy one is, crouched step below hearing, scrap decoy, pack call, wind-up tell), `ui_test` (25 cells, full pack), `game_test`.
* **Drop system**: in the pack, pick an item and tap the drop button under the grid (a tray with an arrow), or drag the item onto it. The item lies on the floor about a metre in front of you (stopped short by a wall) as a normal pick-up with the hand icon; it stays there through room streaming and saves until you pick it up again, makes a small noise (3 m), and cannot be dropped while hiding. Test: `stream_test` (drop, leave the room, come back, pick it up), `ui_test`.
* **Item pictures**: the pack shows each item as its own 3D model rendered to a transparent PNG (`assets/icons/*.png`, made by `tools/render_icons.gd`: the render target is transparent, so there is no background to cut out). The old line drawings stay as a fallback. `ui_test` checks every item has a picture with transparent corners and a solid middle.
