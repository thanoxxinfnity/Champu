# Grinworks

A first-person horror puzzle game for phones, made with Godot 4 and Chomugiri. Poppy-Playtime-style: a
colourful, abandoned toy factory, and a smiling mascot who is not switched off.

*Grinworks Toy Factory closed eleven years ago. Tonight the lights are out in every room and somebody has
to turn them on. The factory's mascot, **Mr. Grin**, never stopped smiling — and he still walks the halls.
You have a torch, a hand crank, a reach glove and four puzzles between you and the factory gate.*

## The rules of Mr. Grin

**Mr. Grin** is built on three rules, and the puzzles are what you do about them.

1. **He hunts by sound.** Walking is quiet, running is loud, crouching is nearly silent. Every valve you
   turn, every wrong answer, every crank of the torch is a noise it can hear. The NOISE bar shows you
   how loud you are right now.
2. **He hates bright light.** Hold the torch on him for a moment and he recoils and runs. He flinches
   less easily each time, and the torch runs down (hold CRANK to charge it — loudly).
3. **He cannot enter a lit room.** Restore power to a room and it is safe. Light a room he is standing in and
   he is driven out of it.

Cubbies hide you, as long as he did not see you go in. The **Reach Glove** grabs valves and pick-ups from across the room.

## The four puzzles (each has exactly one answer — `tests/puzzles_test.gd` proves it)

| Where | Puzzle | Reward |
|---|---|---|
| Nap room | **Who sleeps where.** Four toys (Bruno, Pip, Zippy, Quackers), four beds, the name tags are gone. Four clues on two notes give the 4-digit code of cubby 7. | Fuse, and the cipher key |
| Boiler room | **The steam valves.** Five valves, five rules from two pages of the manual. A wrong setting makes the pipes hammer — the whole factory hears. | Generator on, toy lab door unlocked, power cell |
| Toy lab | **The breakers.** A 3×3 board where each switch flips itself and its neighbours. Needs the fuse. | Power cell and a keycard |
| Mascot office | **The intercom.** The toy lab whiteboard shows a scrambled word; the note in cubby 7 says how far each letter was shifted (Pip's bed number). Needs the keycard. | Last power cell, delivery bay shutter opens |

Three cells go into the pod console in the Pod Bay. Launch takes 25 seconds, the lights fail while it
charges, and the Hollow comes. Survive with the torch.

## The map

A main hall with four corridors and four rooms, a loading dock and a delivery bay — about 66 × 55 m, built from boxes
so every wall is solid. `tests/map_test.gd` sweeps a person-sized capsule along every route, checks that every
one of the 41 things you can press USE on can be reached and aimed at, and that every waypoint stands on a floor.

## Tests

```bash
godot --headless --path . -s tests/puzzles_test.gd                     # one answer per puzzle
godot --headless --path . -s tests/map_test.gd                         # the map is not broken
godot --headless --path . --fixed-fps 60 -s tests/hollow_test.gd       # hearing, sight, torch, lit rooms, lockers
godot --headless --path . --fixed-fps 60 -s tests/playthrough.gd       # a bot plays airlock to escape with the real controls
xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/shots.gd -- /tmp/shots [light]   # screenshots
```

(Headless prints `mesh_get_surface_count` errors: that is the dummy renderer, not the game.)

## The 3D models

Every prop and Mr. Grin are generated. Text-to-3D with **TRELLIS** (NVIDIA NIM) fills the factory first
(`tools/gen_trellis.mjs`); a reference picture from **FLUX** lifted by **Pixal3D** (TencentARC) on a Kaggle GPU
is the higher-quality path (`tools/gen_refs.mjs`, `tools/pixal3d_batch.mjs`).

```bash
export NVIDIA_NIM_API_KEY=nvapi-...
node tools/gen_refs.mjs                          # tools/assets.json -> tools/ref/<name>.jpg
node --experimental-strip-types tools/pixal3d_batch.mjs   # needs KAGGLE_API_TOKEN; writes assets/s9/<name>.glb
godot --headless --path . --import
```

A model that is missing is replaced by a hand-built stand-in of the same size, so the game always runs.

## Controls

Touch: left thumb moves (push to the edge to run), right thumb looks, USE / TORCH / CRANK / CROUCH on the right,
NOTES for the journal. Keyboard: WASD, mouse, E use, F torch, C crouch, R crank, Shift run, Tab journal, Esc pause.
