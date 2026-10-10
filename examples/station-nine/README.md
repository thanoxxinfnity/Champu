# Station Nine

A first-person horror puzzle game for phones, made with Godot 4 and Chomugiri.

*Station Nine, a deep-sea research platform, lost contact 41 days ago. Backup power failed in every
section and something living in the dark took the corridors. You dock at the airlock with a torch,
a hand crank and one job: restore the power, and get out in the escape pod.*

## The rules of the thing in the dark

The **Hollow** is built on three rules, and the puzzles are what you do about them.

1. **It hunts by sound.** Walking is quiet, running is loud, crouching is nearly silent. Every valve you
   turn, every wrong answer, every crank of the torch is a noise it can hear. The NOISE bar shows you
   how loud you are right now.
2. **It fears light.** Hold the torch on it for about a second and it recoils and runs. It flinches
   less easily each time, and the torch runs down (hold CRANK to charge it — loudly).
3. **It cannot enter a lit room.** Restore power to a section and that section is safe. Light a room it
   is standing in and it is burned out of it.

Lockers hide you, as long as it did not see you go in.

## The four puzzles (each has exactly one answer — `tests/puzzles_test.gd` proves it)

| Where | Puzzle | Reward |
|---|---|---|
| Dormitory | **Who sleeps where.** Four crew, four bunks, the name plates are gone. Four clues on two notes give the 4-digit crew-locker code. | Fuse, and the cipher key |
| Engine room | **The valves.** Five coolant valves, five rules from two pages of the manual. A wrong setting makes the pipes hammer — the whole station hears. | Generator on, lab door unlocked, power cell |
| Laboratory | **The breakers.** A 3×3 board where each switch flips itself and its neighbours. Needs the fuse. | Power cell and a keycard |
| Control room | **The radio.** The lab whiteboard shows a scrambled word; the locker note says how far each letter was shifted (the bunk number of one of the crew). Needs the keycard. | Last power cell, pod shutter opens |

Three cells go into the pod console in the Pod Bay. Launch takes 25 seconds, the lights fail while it
charges, and the Hollow comes. Survive with the torch.

## The map

A hub with four corridors and four sectors, an airlock and a pod bay — about 66 × 55 m, built from boxes
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

Every prop and the Hollow are generated: a reference picture with **FLUX** (NVIDIA NIM), lifted to a
textured mesh by **Pixal3D** (TencentARC, SIGGRAPH 2026) running on a Kaggle GPU.

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
