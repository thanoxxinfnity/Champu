# Engine layer to reuse (from examples/grinworks/scripts)

| file | what it gives |
|------|---------------|
| `player.gd` | CharacterBody3D first-person controller, floating stick + swipe-look + buttons (multi-touch), crouch, sprint, noise radius, hide-in-locker, torch/battery |
| `ui.gd` | HUD, white line-art glyph buttons (`_glyph`), typed text helpers (`_type`, `_glitch_in`), cinematic text, VHS tape reader, modal panels, backing strips |
| `sfx.gd` | every sound synthesised at start-up on a thread (steps, doors, growl, screech, heartbeat, music box, ambience) |
| `dread.gd` | tension director + events (flicker, distant sound, whisper, peek decoy) |
| `detail.gd` | set dressing: pipes, cables, posters, drip streaks, puddles, dust particles, hanging toys, rubble, cracks, holes, glass, trails, statues, monitors |
| `rig.gd` + `tools/bake_rig.gd` | skeleton + auto-skin + animation library |
| `shaders/` | `station` (procedural walls/floor with relief), `post` (vignette, grain, dread, beat), `shaft` (light cone), `tv`, `vhs`, `puppet` (fallback) |
| `tests/` | `map_test`, `signs_test`, `ui_test`, `dread_test`, `playthrough` (bot, film mode), `shots`, `showcase`, `rigshot` |

Copy, rename the class, delete what the new game does not need. Keep the tests when you copy code: they are what lets the copy be trusted.
