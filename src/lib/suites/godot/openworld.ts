/**
 * The open-world scene: a city you walk around and drive through.
 *
 * Built on exactly the same block as the shooter — the same streets, the same
 * alleys, the same navigation mesh — because the level was already a city and
 * what was missing was never the geometry. It was the camera and the car.
 *
 * ── What is deliberately *not* here ─────────────────────────────────────────
 *
 * There is no gun. A third-person shooting rig is a different problem from a
 * third-person walking rig — where the character aims versus where the camera
 * points, an aim mode that changes the camera, a crosshair that means something
 * at a distance — and half of one is worse than none. The threat model here is
 * "get to the car and go", and the jobs are reach, collect, hold and survive,
 * which is most of what an open-world game actually asks you to do anyway.
 *
 * Saying so is the point: a game that quietly ships a gun that does not aim
 * properly is worse than one that says it has no gun yet.
 */

import { cityBlock } from './layout.ts';
import { navigationMeshResource } from './navigation.ts';
import type { Mission } from './missions.ts';

/** Whether this spec is the one this file builds. */
export function isOpenWorld(spec: { genre?: string; dimension?: string }): boolean {
  return spec.genre === 'open-world' && (spec.dimension ?? '3d') === '3d';
}

/** `use` — get in, get out. The one action a car needs that walking does not. */
export function openWorldInput(): string {
  return `use={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":69,"pressed":true)]
}
sprint={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":4194325,"pressed":true)]
}
`;
}

/**
 * Where the cars are parked.
 *
 * On the street, against the kerb, facing along the road — which is where cars
 * are. Scattered at angles in the middle of a plaza is the tell that nobody
 * placed them.
 */
export const PARKED_CARS: Array<{ name: string; at: [number, number]; facing: number }> = [
  // Just off the plaza, the first thing you see.
  { name: 'Sedan', at: [3.2, 9.5], facing: 0 },
  // Down the north street, against the annex.
  { name: 'Pickup', at: [-3.4, -13], facing: Math.PI },
  // On the east street, by the ramp.
  { name: 'Van', at: [22, 3.4], facing: Math.PI / 2 },
];

/**
 * The jobs.
 *
 * Reach, collect, hold, survive — the four the mission runner already knows how
 * to check, and between them most of what an open-world game asks of anyone.
 * No `eliminate`, because there is nothing to eliminate with.
 */
export function cityJobs(gameName: string): Mission[] {
  return [
    {
      id: 'the-drop',
      name: 'The Drop',
      brief: `Somebody left a package at the gate and wants it at the yard.\nTake a car. It will be quicker.`,
      objectives: [
        { kind: 'reach', target: 1, text: 'Get to the gate', at: [0, 0.25, 30] },
        { kind: 'reach', target: 1, text: 'Take it to the north yard', at: [-16, 0.25, -24] },
      ],
      difficulty: 1,
      firstWave: 0,
    },
    {
      id: 'scattered',
      name: 'Scattered',
      brief: `The load came off the back somewhere on the block.\nFind all of it.`,
      objectives: [{ kind: 'collect', target: 6, text: 'Recover 6 crates' }],
      difficulty: 1.1,
      firstWave: 0,
    },
    {
      id: 'the-lookout',
      name: 'The Lookout',
      brief: `There is a roof over the plaza with a ramp up to it.\nSit on it for a minute and watch the street.`,
      objectives: [{ kind: 'defend', target: 60, text: 'Hold the overlook for 60 seconds', at: [18, 4.25, -6] }],
      difficulty: 1.3,
      firstWave: 0,
    },
    {
      id: 'the-long-way',
      name: 'The Long Way',
      brief: `Four corners, one run, and ${gameName} is watching the clock.\nDrive it.`,
      objectives: [
        { kind: 'reach', target: 1, text: 'North-west corner', at: [-29, 0.25, -29] },
        { kind: 'reach', target: 1, text: 'North-east corner', at: [29, 0.25, -29] },
        { kind: 'reach', target: 1, text: 'South-east corner', at: [29, 0.25, 29] },
        { kind: 'reach', target: 1, text: 'South-west corner', at: [-29, 0.25, 29] },
      ],
      difficulty: 1.5,
      firstWave: 0,
    },
  ];
}

/** The player's body, seen from behind — so it has to actually look like something. */
function playerBody(): string {
  return `[node name="Body" type="MeshInstance3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.95, 0)
mesh = SubResource("CapsuleMesh_player")
material_override = SubResource("StandardMaterial3D_player")

[node name="Head" type="MeshInstance3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.78, 0)
mesh = SubResource("SphereMesh_head")
material_override = SubResource("StandardMaterial3D_skin")

[node name="Nose" type="MeshInstance3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.75, -0.2)
mesh = SubResource("BoxMesh_nose")
material_override = SubResource("StandardMaterial3D_skin")`;
}

/** One parked car, chassis and all. */
function carNode(car: { name: string; at: [number, number]; facing: number }): string {
  const c = Math.cos(car.facing);
  const s = Math.sin(car.facing);
  const basis = [c, 0, s, 0, 1, 0, -s, 0, c].map((n) => Number(n.toFixed(4))).join(', ');
  return `[node name="${car.name}" type="VehicleBody3D" parent="Cars"]
transform = Transform3D(${basis}, ${car.at[0]}, 0.85, ${car.at[1]})
script = ExtResource("20_car")

[node name="Collision" type="CollisionShape3D" parent="Cars/${car.name}"]
shape = SubResource("BoxShape3D_car")

[node name="Chassis" type="MeshInstance3D" parent="Cars/${car.name}"]
mesh = SubResource("BoxMesh_car")
material_override = SubResource("StandardMaterial3D_car")

[node name="Cabin" type="MeshInstance3D" parent="Cars/${car.name}"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.55, 0.1)
mesh = SubResource("BoxMesh_cabin")
material_override = SubResource("StandardMaterial3D_glass")

[node name="Door" type="Area3D" parent="Cars/${car.name}"]
script = ExtResource("21_door")

[node name="Reach" type="CollisionShape3D" parent="Cars/${car.name}/Door"]
shape = SubResource("BoxShape3D_door")`;
}

/** Everything the scene needs that is not a script or the block itself. */
export function openWorldResources(): string[] {
  return [
    `[sub_resource type="CapsuleMesh" id="CapsuleMesh_player"]
height = 1.8
radius = 0.35`,
    `[sub_resource type="SphereMesh" id="SphereMesh_head"]
radius = 0.19
height = 0.38`,
    `[sub_resource type="BoxMesh" id="BoxMesh_nose"]
size = Vector3(0.08, 0.08, 0.14)`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_player"]
albedo_color = Color(0.2, 0.3, 0.45, 1)
roughness = 0.75`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_skin"]
albedo_color = Color(0.78, 0.6, 0.48, 1)
roughness = 0.6`,
    `[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_player"]
height = 1.8
radius = 0.35`,
    // The chassis, low and long. A VehicleBody3D's collision box is what the
    // wheels hang off, so getting it wrong is a car that drives on its bumper.
    `[sub_resource type="BoxMesh" id="BoxMesh_car"]
size = Vector3(1.9, 0.75, 4.2)`,
    `[sub_resource type="BoxShape3D" id="BoxShape3D_car"]
size = Vector3(1.9, 0.75, 4.2)`,
    `[sub_resource type="BoxMesh" id="BoxMesh_cabin"]
size = Vector3(1.6, 0.6, 2.0)`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_car"]
albedo_color = Color(0.62, 0.16, 0.13, 1)
metallic = 0.55
roughness = 0.35`,
    `[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_glass"]
albedo_color = Color(0.12, 0.16, 0.2, 0.75)
metallic = 0.3
roughness = 0.1
transparency = 1`,
    // Wider than the car: the reach is "standing next to it", not "touching it".
    `[sub_resource type="BoxShape3D" id="BoxShape3D_door"]
size = Vector3(4.4, 2.2, 5.6)`,
  ];
}

/** The nodes: player, camera rig, cars. */
export function openWorldNodes(): string {
  return `[node name="Player" type="CharacterBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 4)
collision_layer = 1
collision_mask = 1
script = ExtResource("1_player")

[node name="Collision" type="CollisionShape3D" parent="Player"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.95, 0)
shape = SubResource("CapsuleShape3D_player")

${playerBody()}

[node name="CameraRig" type="SpringArm3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.5, 0)
script = ExtResource("22_orbit")

[node name="Camera" type="Camera3D" parent="CameraRig"]
current = true
far = 250.0

[node name="Cars" type="Node3D" parent="."]

${PARKED_CARS.map(carNode).join('\n\n')}`;
}

/**
 * The glue.
 *
 * Same reasoning as the shooter's: six `[connection]` lines in a scene file are
 * six typos that fail silently at load, and one script that connects them in
 * `_ready` fails loudly instead.
 */
export function openWorldWiringScript(): string {
  return `extends Node
## Connects the player, the camera, the cars and the HUD.

@onready var _player: CharacterBody3D = get_parent().get_node("Player")
@onready var _rig: SpringArm3D = get_parent().get_node("CameraRig")
@onready var _hud: CanvasLayer = get_parent().get_node("HUD")
@onready var _touch: Control = _hud.get_node("Touch")
@onready var _mission: Node = get_parent().get_node("Mission")
@onready var _missions: Node = get_parent().get_node("Missions")
@onready var _cars: Node3D = get_parent().get_node("Cars")

## The car the player is standing next to, if any.
var _nearby: VehicleBody3D


func _ready() -> void:
	# Controls first: everything below is scoring, and this is whether the game
	# can be played at all.
	_touch.look.connect(_rig._on_look)
	_touch.moved.connect(_on_moved)

	_player.health_changed.connect(_hud.set_health)
	_player.died.connect(_on_died)
	_player.driving_changed.connect(_on_driving_changed)
	_mission.objective_changed.connect(_hud.set_objective)
	_mission.mission_complete.connect(_on_complete)

	for car in _cars.get_children():
		var door := car.get_node_or_null("Door")
		if door != null:
			door.driver_nearby.connect(_on_car_nearby)

	_start_job()


## One stick, two meanings. Whoever is being driven gets the input; nothing
## reads it twice, which is how a car and a player both moving from one stick
## ends up with a car that steers itself.
func _on_moved(direction: Vector2) -> void:
	if _player.is_driving() and _player.car != null:
		_player.car.set_move_input(direction)
	else:
		_player.set_move_input(direction)


func _on_car_nearby(car: VehicleBody3D, near: bool) -> void:
	_nearby = car if near else null
	if not _player.is_driving():
		_hud.set_prompt("Get in" if near else "")


func _input(event: InputEvent) -> void:
	if not event.is_action_pressed("use"):
		return
	if _player.is_driving():
		_player.leave_car()
	elif _nearby != null:
		_player.enter_car(_nearby)


func _on_driving_changed(driving: bool) -> void:
	_hud.set_prompt("Get out" if driving else ("Get in" if _nearby != null else ""))
	# The camera pulls back in a car: the same distance that frames a person
	# puts a four-metre car half off the screen.
	_rig.distance = 8.0 if driving else 4.5
	_rig.spring_length = _rig.distance


func _start_job() -> void:
	var config := ConfigFile.new()
	var index: int = 0
	if config.load("user://progress.cfg") == OK:
		var chosen: int = config.get_value("progress", "playing", 0)
		index = chosen
	var data: Dictionary = _missions.get_mission(index)
	if data.is_empty():
		data = _missions.get_mission(0)
	_hud.set_mission(String(data.get("name", "")), String(data.get("brief", "")))
	_mission.start(data)


func _on_complete(name: String) -> void:
	_hud.mission_complete(name, 0)
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	var config := ConfigFile.new()
	config.load("user://progress.cfg")
	var played: int = config.get_value("progress", "playing", 0)
	_missions.unlock(played + 1)


func _on_died() -> void:
	_mission.fail("You went down.")
	_hud.game_over(0, 1)
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
`;
}

/**
 * The city's HUD.
 *
 * Its own script rather than the shooter's, because the shooter's reaches for
 * an ammo counter, a wave label and a crosshair that do not exist here — and
 * `$Ammo.text = "…"` on a node that is not there is not a warning, it is a
 * script that throws on the first frame and takes the whole HUD with it. Which
 * is what it did.
 */
export function cityHudScript(): string {
  return `extends CanvasLayer
## Health, the current job, and a prompt when there is a car within reach.

@onready var _health: ProgressBar = $Health
@onready var _health_label: Label = $HealthLabel
@onready var _objective: Label = $Objective
@onready var _prompt: Label = $Prompt
@onready var _centre: Label = $Centre
@onready var _over: Panel = $GameOver
@onready var _over_text: Label = $GameOver/Text

var _fade: float = 0.0


func _ready() -> void:
	_over.visible = false
	_centre.text = ""
	_prompt.text = ""


func _process(delta: float) -> void:
	if _fade <= 0.0:
		return
	_fade -= delta
	if _fade <= 0.0:
		_centre.text = ""


func set_health(current: float, maximum: float) -> void:
	_health.max_value = maximum
	_health.value = current
	_health_label.text = "%d" % int(maxf(current, 0.0))


func set_objective(text: String, progress: int, target: int) -> void:
	# The count only appears when it counts to something above one: "Get to the
	# gate (0/1)" is noise pretending to be information.
	_objective.text = text if target <= 1 else "%s  (%d/%d)" % [text, progress, target]


## Shown only when there is something to do. A permanent "Get in" with no car
## near it is how a player learns to stop reading the HUD.
func set_prompt(text: String) -> void:
	_prompt.text = text


func set_mission(name: String, brief: String) -> void:
	_centre.text = name if brief == "" else "%s\\n%s" % [name, brief.replace("\\n", "  ")]
	_fade = 4.0


func mission_complete(name: String, _score: int) -> void:
	_centre.text = "%s — done" % name
	_fade = 6.0


func game_over(_score: int, _wave: int) -> void:
	_over.visible = true
	_over_text.text = "YOU WENT DOWN"
`;
}
