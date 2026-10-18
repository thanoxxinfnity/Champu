class_name Data
extends RefCounted
## Physics layers and the few numbers every system shares. Layers are bit values for collision_layer / collision_mask.

const L_PLAYER := 1      # layer 1: the player on foot
const L_DYNAMIC := 2     # layer 2: vehicles and NPCs
const L_WORLD := 4       # layer 3: roads, buildings, props, floors
const L_INTERACT := 8    # layer 4: Area3D triggers the player can use (doors, lifts, beds, cars)

## 24 in-game hours pass in 24 real minutes: one real minute is one in-game hour.
const GAME_HOURS_PER_REAL_SECOND := 1.0 / 60.0

## The player's start (the safehouse's front step) — world.gd moves this to the real door once the city exists.
const SPAWN := Vector3(0, 0.1, 0)

## The four cars. `yaw` turns the generated model so its nose points down +Z (the way VehicleBody3D drives); `length` is the real-world
## length in metres the model is scaled to; engine / top speed (m/s) / mass are tuned by driving them in tests/vehicle_test.gd.
const VEHICLES := {
	"sedan": {"file": "car_sedan", "length": 4.7, "yaw": 180.0, "paint": Color(0.5, 0.5, 0.53), "engine": 7600.0, "top": 38.0, "mass": 1300.0, "grip": 3.6},
	"muscle": {"file": "car_muscle", "length": 4.9, "yaw": 0.0, "paint": Color(0.05, 0.05, 0.06), "engine": 11500.0, "top": 52.0, "mass": 1650.0, "grip": 3.2},
	"police": {"file": "car_police", "length": 5.0, "yaw": 90.0, "paint": Color(0.92, 0.92, 0.94), "engine": 10000.0, "top": 50.0, "mass": 1750.0, "grip": 3.4},
	"hypercar": {"file": "car_hypercar", "length": 4.6, "yaw": 0.0, "paint": Color(0.75, 0.05, 0.05), "engine": 15500.0, "top": 76.0, "mass": 1450.0, "grip": 4.2},
}

## Humanoids that share the Rig skeleton and animation set. `file` is the generated model in assets/generated/raw; `height` is the
## real-world height in metres they are scaled to. Their bone-height profiles come from RigNet (see tools/rignet_profile.py).
const CHARACTERS := {
	"npc_business": {"file": "npc_business", "height": 1.80},
	"npc_casual": {"file": "npc_casual", "height": 1.68},
	"npc_street": {"file": "npc_street", "height": 1.78},
	"npc_police": {"file": "npc_police", "height": 1.82},
}


## Where a generated model lives: the game-sized copy in assets/generated/lod when tools/prep_assets.sh has made one, else the raw download.
static func model_path(name: String) -> String:
	var lod := "res://assets/generated/lod/%s.glb" % name
	return lod if ResourceLoader.exists(lod) else "res://assets/generated/raw/%s.glb" % name
