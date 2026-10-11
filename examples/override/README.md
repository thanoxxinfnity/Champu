# Project OVERRIDE

A first-person survival-horror game for phones (Godot 4.3, GL Compatibility, Android APK), built from `Project OVERRIDE – Master GDD`.
You wake in a cryo chamber at the bottom of a wrecked science lab and have to go down through four chapters, past things that
cannot be killed, to plant a bomb on the reactor core and get out in three minutes.

| chapter | place | enemy | task |
|---|---|---|---|
| 1 The Safe Room | cryo chamber, dark corridor, server closet, store | **crawlers** (broken maintenance robots, crawl towards sound) | cable + 2 fuses → fuse box → lift |
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
| EMP stunner: `RayCast3D`, 25 s stun, battery to find | `player.gd` (`fire_emp`), `cell_*` pick-ups | `enemy_test`, `game_test` |
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

* **The pack holds 25 things** (5 x 5 frosted-glass grid, tap or drag to combine, a full pack refuses a 26th pick-up). The bomb chain — wiring, a timer, gel, the detonator, the mega-bomb — never takes one of those slots: it has its own case, drawn above the grid, and builds itself (wiring + timer → detonator → + gel → mega-bomb) the moment the right parts are both in it, in whatever order they were found.
* **Everything you do has a loudness** (metres it carries): standing still 0, crouch-walking 0.8, walking 4.2, running 10, a pick-up 2.5, a switch 8, the EMP 9, a thrown scrap's clang 20. The sound meter at the bottom of the screen (a speaker with up to three waves, white, amber, red) shows how loud you are right now.
* **Blind hunters kill by sound only.** A noise you make hears it come; while you keep making noise it kills; stand still or crouch and it only listens, even a metre away. Its strike has a half-second wind-up and only lands if it hears you *again* during it. A thrown **scrap** (found in eight places, button or `G`) is a decoy: it goes to the clang, not to you. Its sensor band shows blue (calm), amber (heard something), red (hunting).
* **Crawlers hunt as a pack** (the one that sees you screeches and the others near it come), and **leap after a visible crouch** you can dodge.
* **Every creature searches** after a sound (it stands and listens, then checks three spots around it; the Warden also walks up to the lockers near it), re-plans if it gets stuck, and can't be EMP-chained (a short immunity after a stun).
* Tests: `enemy_test` (silent player on top of a hunter is not hurt, a noisy one is, crouched step below hearing, scrap decoy, pack call, wind-up tell), `ui_test` (25 cells, full pack), `game_test`.
* **Drop system**: in the pack, pick an item and tap the drop button under the grid (a tray with an arrow), or drag the item onto it. The item lies on the floor about a metre in front of you (stopped short by a wall) as a normal pick-up with the hand icon; it stays there through room streaming and saves until you pick it up again, makes a small noise (3 m), and cannot be dropped while hiding. Test: `stream_test` (drop, leave the room, come back, pick it up), `ui_test`.
* **Item pictures**: the pack shows each item as its own 3D model rendered to a transparent PNG (`assets/icons/*.png`, made by `tools/render_icons.gd`: the render target is transparent, so there is no background to cut out). The old line drawings stay as a fallback. `ui_test` checks every item has a picture with transparent corners and a solid middle.
* **Blood**: every room has splatters on the floor, a blood trail dragged to a doorway, bloody hand prints on the walls (some with a smear running down), and in big rooms a pane of observation glass with hands slid down it and drips from the top. All of a room's blood is one mesh (one draw call) from a single atlas (`assets/blood/atlas.png`, drawn by `tools/make_blood.gd`); nothing is painted across a doorway. When you are hurt, blood is thrown across the screen too (splatters and drips that slide down and fade). Tests: `blood_test`; the draw-call budget (`perf.gd`) stays at 349 of 420.
* **Smarter creatures**: walls muffle sound (a noise with no clear line carries about half as far); a creature that can see leads its target (runs to where you are going) and a crawler in a pack takes a side; a hunter led to two scrap clangs stops believing them and also searches where the throw came from; the Warden and crawlers remember the lockers you hid in, go to them first, hammer on the door for a second (the tell: get out) and then open it; after each death they are 3 % keener (max 15 %).
* **Devil moves**: on locking on, a creature stops and screams before it comes (0.45 s crawler, 0.7 hunter, 1 s Warden); crawlers skitter (freeze and burst forward); idle creatures glitch now and then (a flinch, the glow stutters, a crackle); the glow burns brighter when it hunts.

## v2: easier start, safe water, gadgets

* **Fewer, fairer robots**: one crawler in chapter 1, one hunter in chapter 2; the first mission needs only two fuses and the cable. Rooms are furnished (`Dressing._scatter`: benches, crates, barrels, carts along the walls, never in a doorway, on a belt or in the water).
* **Stunner holds 25 s** (`Data.STUN_SECONDS`).
* **Safe stations** (`scripts/safe.gd`, one at each chapter's arrival point): a pool of clean water with a green lamp and a dripping pipe. Creatures cannot cross it: an enemy-only collision layer (`L_BLOCK`) plus a hole in a second navigation map used only by creatures (`World.enemy_map`; the player and the bot test keep the full map), and a creature gives up on anyone standing in the water. The **charger** at the pool refills the stunner to six. Tests: `tests/safe_test.gd`.
* **Gadgets** lying in the rooms: **shield** (12 s, blocks all hits, blue frame), **medkit** (+2 health), **hush** (30 s, quiet steps), **beeper** (a decoy that beeps for 14 s). A round gadget button (key `X`) uses the first one in the pack.

## Speed on a weak phone (Redmi Note 8 class: Adreno 610, 4 GB)

It ran at 3 to 4 frames a second. What was wrong, and what was done (the numbers are the software renderer's frame time in `tests/bench.gd`, a relative measure: 127 ms before, 36 ms after):
* The picture was drawn at the phone's full 2340 x 1080 with 2x MSAA and glow. **Quality** (`scripts/quality.gd`) now starts a phone on LOW: 3D drawn at 854 x 480 (a fifth of the pixels), no MSAA, no glow, no light cones under the lamps, no glow on pick-ups, half the sparks, no film grain, the buttons redrawn 20 times a second, 30 fps, physics at 30 Hz. MEDIUM draws 1280 x 720 with the cones at 60 fps; HIGH is the screen's own resolution with 2x MSAA and glow (the default on a computer). The pack has a button (three bars) to change it; the choice is saved.
* The wall/floor shader computed noise for every pixel (dozens of operations, several times). It now reads a baked sheet (`assets/noise.png`, `tools/make_noise.gd`).
* The assembly floor had 168 draw calls for its belts alone. A stand-in built from many primitives is now merged into one mesh with a surface per material, and the belts use five-metre pieces. Worst view: 415 draw calls before, 216 now (`perf.gd` now fails above 260).
* Project settings: MSAA off, at most 4 lights per object.

## v3: solid creatures, a quieter synth, a fallback for aiming at a pick-up

* **The player and a creature are now solid to each other** (`player.gd`, `enemy.gd`): before this they shared a
  collision layer with nothing on each other's mask, so a robot and the player could walk straight through one
  another. Fixed by adding each to the other's `collision_mask`.
* **Aiming** (`player.gd` `_find_focus`): the straight centre-of-screen ray still does the normal case; when it
  grazes a nearby piece of room clutter instead of the thing you are actually looking at, a fallback checks every
  usable point within reach and a ~30° cone of where the camera is pointed, confirmed clear by its own ray — so a
  pick-up beside a crate is still reachable, and a real wall still blocks what is behind it. Tests: `focus_test.gd`.
* **The synth is cleaner** (`sfx.gd`): the sample rate is 32 kHz (was 16 kHz), a one-shot fades its first/last few
  ms instead of starting or ending on a click, the voice pool prefers an idle player over cutting an active sound
  short, and the growl/screech/jumpscare formant filter is clamped against the self-oscillating buzz a high
  formant could reach.
