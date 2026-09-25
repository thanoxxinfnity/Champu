# Chomu Horizon

An open-world racer in the style of Forza Horizon, built in Godot 4.3 for
Android phones: a car-shop showroom, three cars with separately animated
parts, raycast-suspension driving physics with a handbrake drift model, and
multitouch on-screen controls.

## Build and play

Open `project.godot` in Godot 4.3 (desktop or the Android editor) and press
Play. A mouse works as a touchscreen; on a keyboard use arrows/WASD, Space
(handbrake), Shift (nitro), C (camera), R (reset), Esc (garage).

Android APK (Godot 4.3 export templates, Android SDK and a keystore installed):

```sh
GODOT_ANDROID_KEYSTORE_RELEASE_PATH=/path/to/release.keystore \
GODOT_ANDROID_KEYSTORE_RELEASE_USER=<alias> \
GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=<password> \
godot --headless --path . --export-release "Android" build/ChomuHorizon.apk
```

The preset builds arm64 only, landscape, immersive fullscreen, with the
VIBRATE permission for button haptics.

## Controls

| Where | Button | Does |
| --- | --- | --- |
| Left | ◀ ▶ (or analog joystick, switch in the garage) | Steer |
| Right | GAS / BRAKE | Throttle; brake, then reverse once stopped |
| Right | DRIFT | Handbrake: rear wheels lock and lose grip |
| Right | 🔥 ring | Nitro (the ring is the tank; drifting refills it) |
| Top left | Home · Camera · Reset | Garage, cycle 4 cameras, back onto the road |

Every finger is tracked by its touch index, so steering, gas and nitro can
all be held at once, and a finger can slide from GAS onto BRAKE (or ◀ onto ▶)
without lifting.

## Folder structure

```
chomu-horizon/
├── project.godot            Godot 4.3, Compatibility renderer, landscape, 60 Hz physics
├── export_presets.cfg       Android preset (no keystore secrets inside)
├── scenes/main.tscn         A single node; everything else is built by game.gd
├── scripts/
│   ├── game.gd              Flow: garage ⇄ drive, fades, speed trap, drift zone, quality
│   ├── car_catalog.gd       CarCatalog: every car as data (shape, physics, stats)
│   ├── car_builder.gd       CarBuilder: builds car models with separate parts; .glb load/export
│   ├── paint_customizer.gd  PaintCustomizer: paint finishes, rims, underglow, save file
│   ├── vehicle_controller.gd VehicleController: raycast vehicle, gearbox, drift, nitro
│   ├── mobile_input_manager.gd MobileInputManager: multitouch controls → input floats
│   ├── camera_follow.gd     CameraFollow: chase/hood/cinematic, dynamic FOV, shake
│   ├── showroom_manager.gd  ShowroomManager: studio, reflections, orbit cam, swipe, doors
│   ├── garage_ui.gd         GarageUI: car shop overlay (stats, paint, rims, glow, DRIVE)
│   ├── world_builder.gd     WorldBuilder: highway loop, hub, trees, sky and time of day
│   ├── vehicle_fx.gd        VehicleFX: tyre smoke, skid marks, nitro flames
│   ├── engine_audio.gd      EngineAudio: RPM-pitched engine, tyre squeal, nitro
│   └── hud.gd               DriveHUD: speedometer, drift score, minimap, toasts
├── shaders/car_paint.gdshader  Metallic flakes / matte / pearlescent flip + clearcoat
├── audio/                   Synthesized engine, squeal, nitro and click samples
├── models/*.glb             The three cars exported with their part hierarchy
└── tests/                   Headless checks (see below)
```

## Car model hierarchy

`CarBuilder.build()` produces, and `CarBuilder.load_glb_car()` expects, this
hierarchy. Origin on the ground between the axles, **+Z is the nose**, metres.

```
<car id>                     Node3D
├── Body                     MeshInstance3D — paint + underbody surfaces
├── Cabin                    MeshInstance3D — glass + painted roof
├── Door_L / Door_R          Node3D at the hinge → Panel (paint outside, trim inside)
├── DoorGap_L / DoorGap_R    dark aperture shown while a door is open
├── Details                  trim, mirrors, spoiler, exhausts
├── HeadLights / TailLights  emissive meshes (+ SpotLight3D beams, on at night)
├── Wheel_FL / FR / RL / RR  Node3D at the wheel centre, axle along X → Tire, Rim
├── Underglow                Strip + OmniLight3D (hidden until switched on)
└── ContactShadow            soft blob under the car (cheap ambient occlusion)
```

When driving, `VehicleController` creates one `VehicleWheel3D` per `Wheel_*`
node (suspension ray, steering, torque) and re-parents the visual wheel under
it, so the wheels steer and spin with the physics. Doors open with
`CarBuilder.set_doors(model, amount, "scissor" | "swing")`.

### Using your own car (.glb)

1. Name the nodes `Body`, `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`
   (and optionally `Door_L`, `Door_R` with their origin on the hinge). Put each
   wheel's origin at its centre with the axle along X, and the nose along +Z.
2. Name the body paint material `paint` so the garage can recolour it.
3. Load it with `CarBuilder.load_glb_car("res://models/my_car.glb", car_dict)`
   where you would call `CarBuilder.build(car_dict)`.

A model with no named parts (for example straight out of an image-to-3D
generator) still loads: the whole mesh becomes `Body` and built wheels are
added, so it drives. The files in `models/` are the built cars exported
through `CarBuilder.export_glb()` — open one in Blender to see the layout.

## Graphics on a phone

Phones run the **Compatibility** (OpenGL ES 3) renderer, which is what the
earlier Chomugiri games ran on reliably. It has bloom, real-time shadows,
MSAA, fog, sky reflections and custom shaders, but no SSAO, screen-space
reflections or reflection probes, so:

- The showroom's glossy floor is a translucent layer over a mirrored copy of
  the car, and the paint reflects a procedural studio panorama.
- Ambient occlusion under each car is a soft contact-shadow blob.
- Trees are chunked MultiMeshes so whole groups are culled; skid marks are
  one MultiMesh ring buffer; the drive view renders about 100k triangles in
  100–300 draw calls.

The garage's GFX button switches HIGH (4× MSAA, full resolution, shadows to
110 m), BALANCED (2× MSAA, 90% resolution — the default on phones) and
BATTERY (no MSAA, 75% resolution, no shadows or bloom).

## Tests

```sh
godot --headless --path . --fixed-fps 60 -s tests/drive_test.gd   # physics, every car
godot --headless --path . --fixed-fps 60 -s tests/flow_test.gd    # garage → drive, multitouch
godot --headless --path . -s tests/glb_test.gd                    # .glb round-trip
xvfb-run godot --path . --rendering-driver opengl3 --fixed-fps 60 -s tests/shots.gd -- <dir>
```

`drive_test` checks for each car: level at rest, 0–100 km/h under 6 s, top
speed, braking, that steering right turns right without rolling over, that
the handbrake starts a held drift, and reverse.
