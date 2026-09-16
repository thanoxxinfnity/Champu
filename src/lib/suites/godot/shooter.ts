/**
 * The shooter scaffold.
 *
 * The generic project in `project.ts` is a character in a field: correct, and
 * not a game. Ask the suite for a zombie survival shooter and that is still all
 * it wrote — the plan said `shooter` and `first-person`, and nothing downstream
 * read either. This is what reads them.
 *
 * Everything here is deliberately built in code rather than in extra `.tscn`
 * files. A generated scene that references another generated scene has two ways
 * to break — a wrong `load_steps` and a dangling `ExtResource` — and both fail
 * at load with an empty window rather than an error anyone can act on. Nodes
 * created from GDScript cannot have either problem.
 *
 * Godot 4.3 notes that cost real debugging time and are easy to undo:
 *   - `:=` through an untyped expression is a *parse* error, not a warning. The
 *     whole script fails to load, so every inferred local here comes off an
 *     expression whose type Godot can see.
 *   - `RayCast3D` collides with its own parent unless the parent is excluded.
 *   - A `CharacterBody3D` created in code has no collision until a
 *     `CollisionShape3D` child exists, and it silently falls through the world.
 */

import { ENEMY_NAVIGATION } from './navigation.ts';

/**
 * Input actions a shooter needs on top of the movement ones.
 *
 * `fire` is deliberately bound to **nothing**. Godot emulates a mouse click
 * from every touch, and that setting has to stay on or the buttons in the
 * mission-select screen stop responding — `BaseButton` only reads
 * `InputEventMouseButton`, never `InputEventScreenTouch`. So a `fire` bound to
 * mouse button 1 is a gun that goes off when you push the movement stick, which
 * is what the first build did.
 *
 * Instead both presenters press the action themselves: the on-screen button on
 * a phone, and `weapon.gd` on a desktop where the mouse is captured. One action,
 * two presenters, and the mouse mode tells them apart.
 */
export function shooterInput(): string {
  return `fire={
"deadzone": 0.2,
"events": []
}
reload={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":82,"pressed":true)]
}
sprint={
"deadzone": 0.2,
"events": [Object(InputEventKey,"keycode":4194325,"pressed":true)]
}
`;
}

/**
 * Looking around.
 *
 * Mouse only. Touch is not read here and must not be — `touch.gd` owns every
 * finger and hands this one a relative movement through the `look` signal.
 *
 * The version this replaced listened for `InputEventScreenDrag` in
 * `_unhandled_input`, and never received one: the movement stick was a
 * full-rect Control with the default `mouse_filter`, so it consumed every touch
 * in `_gui_input` first. The camera could not turn, which no amount of reading
 * this file would have explained.
 */
export function lookScript(): string {
  return `extends Node
## First-person look. Yaw turns the player, pitch tilts the camera — never both
## on one node, or the body leans and the capsule catches on the floor.

@export var sensitivity: float = 0.0025
@export var pitch_limit: float = 1.4

var _player: CharacterBody3D
var _camera: Camera3D


func _ready() -> void:
	_player = get_parent() as CharacterBody3D
	_camera = _player.get_node_or_null("Camera") as Camera3D
	# Captured on desktop so the mouse turns the player instead of leaving the
	# window. Not on a phone: there is no cursor, and capturing one there has
	# been known to swallow the touch events the controls need.
	if DisplayServer.has_feature(DisplayServer.FEATURE_MOUSE) and not DisplayServer.is_touchscreen_available():
		Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)


func _unhandled_input(event: InputEvent) -> void:
	if _player == null or _camera == null:
		return
	if event is InputEventMouseMotion and Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
		_turn((event as InputEventMouseMotion).relative * sensitivity)


## Called by the touch layer, which owns the fingers. The amount arrives already
## scaled, so there is one sensitivity for touch and one for the mouse rather
## than two multiplications that have to agree.
func _on_look(relative: Vector2) -> void:
	_turn(relative)


func _turn(amount: Vector2) -> void:
	_player.rotate_y(-amount.x)
	# Clamped, or looking far enough up rolls the camera over and the world is
	# upside down with no way back.
	var pitch: float = _camera.rotation.x - amount.y
	_camera.rotation.x = clampf(pitch, -pitch_limit, pitch_limit)
`;
}

/**
 * The gun.
 *
 * Hitscan rather than projectiles: a bullet you can outrun is the single most
 * common reason a generated shooter feels broken, and a ray cannot miss because
 * of frame timing.
 */
export function weaponScript(): string {
  return `extends Node3D
## Hitscan weapon. Fires on \`fire\`, reloads on \`reload\` or automatically when
## the magazine runs dry.

signal ammo_changed(in_magazine: int, reserve: int)
signal fired
signal hit_enemy
## Where a shot landed, which way, and whether it hit something alive.
signal struck(at: Vector3, normal: Vector3, was_alive: bool)

@export var damage: float = 34.0
@export var rounds_per_second: float = 7.5
@export var magazine: int = 30
@export var reserve_ammo: int = 180
@export var reload_seconds: float = 1.6
@export var range_metres: float = 120.0
@export var spread: float = 0.012

var _in_magazine: int = 30
var _reserve: int = 180
var _cooldown: float = 0.0
var _reloading: bool = false

var _camera: Camera3D
var _body: CollisionObject3D

@onready var _flash: OmniLight3D = $Flash


## Found by walking up the tree rather than by a fixed path. The weapon hangs
## off the camera so it tilts when the player looks up — it used to hang off the
## player, and the gun stayed level while the view pitched — and a hardcoded
## get_parent().get_node("Camera") breaks the moment it is reparented.
func _resolve() -> void:
	var node: Node = get_parent()
	while node != null:
		if _camera == null and node is Camera3D:
			_camera = node as Camera3D
		if _body == null and node is CollisionObject3D:
			_body = node as CollisionObject3D
		node = node.get_parent()
	if _camera == null:
		_camera = get_viewport().get_camera_3d()


func _ready() -> void:
	_resolve()
	_in_magazine = magazine
	_reserve = reserve_ammo
	_flash.visible = false
	ammo_changed.emit(_in_magazine, _reserve)


func _process(delta: float) -> void:
	if _cooldown > 0.0:
		_cooldown -= delta
		# The muzzle light is only on for the first sliver of the cooldown, so a
		# held trigger flickers rather than glowing steadily.
		_flash.visible = _cooldown > (1.0 / rounds_per_second) - 0.04

	if Input.is_action_just_pressed("reload"):
		reload()

	if Input.is_action_pressed("fire"):
		fire()


## Desktop only, and the mouse mode is what says so.
##
## On a phone the on-screen button presses \`fire\` directly. Reading the mouse
## here as well would fire on every tap, because Godot turns every touch into a
## mouse click — including the one that grabs the movement stick.
func _unhandled_input(event: InputEvent) -> void:
	if Input.get_mouse_mode() != Input.MOUSE_MODE_CAPTURED:
		return
	if not (event is InputEventMouseButton):
		return
	var click := event as InputEventMouseButton
	if click.button_index != MOUSE_BUTTON_LEFT:
		return
	if click.pressed:
		Input.action_press("fire")
	else:
		Input.action_release("fire")


func fire() -> void:
	if _reloading or _cooldown > 0.0:
		return
	if _in_magazine <= 0:
		reload()
		return

	_in_magazine -= 1
	_cooldown = 1.0 / rounds_per_second
	_flash.visible = true
	fired.emit()
	ammo_changed.emit(_in_magazine, _reserve)

	if _camera == null:
		return

	var origin: Vector3 = _camera.global_position
	# Spread is applied to the direction, not the origin: moving the origin puts
	# shots through walls the player is standing against.
	var direction: Vector3 = -_camera.global_transform.basis.z
	direction += Vector3(
		randf_range(-spread, spread), randf_range(-spread, spread), randf_range(-spread, spread))

	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction.normalized() * range_metres)
	# Without this the first thing every shot hits is the player's own capsule.
	if _body != null:
		query.exclude = [_body.get_rid()]
	var hit: Dictionary = get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return

	var point: Vector3 = hit.get("position", origin)
	var normal: Vector3 = hit.get("normal", Vector3.UP)
	var body: Node = hit.get("collider")

	if body != null and body.has_method("take_damage"):
		body.take_damage(damage, direction.normalized())
		hit_enemy.emit()
		struck.emit(point, direction.normalized(), true)
	else:
		# The world, not something alive: sparks rather than blood. Telling the
		# two apart is most of what makes a hit read as a hit.
		struck.emit(point, normal, false)


func reload() -> void:
	if _reloading or _reserve <= 0 or _in_magazine == magazine:
		return
	_reloading = true
	await get_tree().create_timer(reload_seconds).timeout
	var wanted: int = magazine - _in_magazine
	var moved: int = mini(wanted, _reserve)
	_in_magazine += moved
	_reserve -= moved
	_reloading = false
	ammo_changed.emit(_in_magazine, _reserve)


func is_reloading() -> bool:
	return _reloading
`;
}

/**
 * A zombie.
 *
 * Steers straight at the player rather than using a navigation mesh. A baked
 * NavigationRegion3D in a generated project is the most fragile thing in it —
 * bake it wrong and every enemy stands still, with nothing in the log — and an
 * arena with no interior walls does not need pathfinding to look right.
 */
export function enemyScript(): string {
  return `extends CharacterBody3D
## One zombie: walks at the player, hits them at arm's length, dies on damage.

signal died(position: Vector3)

@export var speed: float = 2.4
@export var health: float = 100.0
@export var damage: float = 12.0
@export var attack_range: float = 1.9
@export var attack_seconds: float = 1.1
${ENEMY_NAVIGATION.fields}

var target: Node3D
var _attack_cooldown: float = 0.0
var _dying: bool = false
var _flash: float = 0.0
var _material: StandardMaterial3D


func _ready() -> void:
	# Held so a hit can tint the whole zombie without walking the tree on every
	# frame of the flash.
	var mesh := get_node_or_null("Mesh") as MeshInstance3D
	if mesh != null and mesh.get_surface_override_material(0) is StandardMaterial3D:
		_material = mesh.get_surface_override_material(0) as StandardMaterial3D

${ENEMY_NAVIGATION.ready}


func _physics_process(delta: float) -> void:
	if _dying:
		return

	if _flash > 0.0:
		_flash -= delta
		if _material != null:
			_material.emission_energy_multiplier = maxf(0.0, _flash * 8.0)

	if not is_on_floor():
		velocity += get_gravity() * delta

	if target == null or not is_instance_valid(target):
		velocity.x = 0.0
		velocity.z = 0.0
		move_and_slide()
		return

	var to_target: Vector3 = target.global_position - global_position
	to_target.y = 0.0
	var distance: float = to_target.length()

	if distance > attack_range:
		# Around the block, not through it. Ten of sixteen used to press into a
		# building and stay there, which is a wave that never clears.
		var direction: Vector3 = _walk_direction(to_target, delta)
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
		# Faces where it is going. Only the yaw, or it tips forward into the floor.
		look_at(Vector3(target.global_position.x, global_position.y, target.global_position.z), Vector3.UP)
	else:
		velocity.x = 0.0
		velocity.z = 0.0
		_attack_cooldown -= delta
		if _attack_cooldown <= 0.0:
			_attack_cooldown = attack_seconds
			if target.has_method("take_damage"):
				target.take_damage(damage)

	move_and_slide()


${ENEMY_NAVIGATION.direction}


func take_damage(amount: float, _from: Vector3 = Vector3.ZERO) -> void:
	if _dying:
		return
	health -= amount
	_flash = 0.14
	if health <= 0.0:
		_die()


func _die() -> void:
	_dying = true
	died.emit(global_position)
	# Falls over rather than blinking out, then clears itself up.
	var fall := create_tween()
	fall.set_parallel(true)
	fall.tween_property(self, "rotation:x", -PI * 0.5, 0.45)
	fall.tween_property(self, "position:y", position.y - 0.4, 0.45)
	await fall.finished
	queue_free()
`;
}

/**
 * Waves, spawning and score.
 *
 * Builds each zombie in code from the model the suite generated, or from a
 * capsule when there is none. Spawns on a ring outside the arena so they walk
 * in rather than appearing in front of the player's face.
 */
export function directorScript(): string {
  return `extends Node3D
## Runs the game: waves in, score up, a pause between rounds.

signal wave_started(number: int, enemies: int)
signal score_changed(score: int)
signal wave_cleared(number: int)
## One zombie down. The mission counts these; the director does not care why.
signal enemy_killed

@export var enemy_scene_path: String = ""
@export var first_wave_size: int = 5
## Scales speed and health on top of the per-wave ramp. The mission sets it.
@export var difficulty: float = 1.0
@export var wave_growth: int = 3
@export var spawn_radius: float = 26.0
## Street and alley mouths, set by the scene. A ring of a fixed radius around
## the origin was fine on an empty square and puts a zombie inside a wall the
## moment the block has buildings in it — where it stands still, hits nothing,
## and keeps the wave counter from ever reaching zero.
@export var spawn_points: PackedVector3Array = PackedVector3Array()
@export var break_seconds: float = 5.0
## Each wave's zombies are a little faster and a little tougher. Without a ramp
## wave twelve plays exactly like wave one.
@export var speed_step: float = 0.12
@export var health_step: float = 14.0

var wave: int = 0
var score: int = 0

var _alive: int = 0
var _running: bool = false
var _enemy_scene: PackedScene
var _player: Node3D


func _ready() -> void:
	_player = get_parent().get_node_or_null("Player") as Node3D
	if enemy_scene_path != "" and ResourceLoader.exists(enemy_scene_path):
		_enemy_scene = load(enemy_scene_path) as PackedScene
	# Not started here. The mission sets the difficulty and the wave size first,
	# and a wave that spawned before that would be the wrong wave.


func start() -> void:
	if _running:
		return
	_running = true
	# One frame, so the scene has finished entering the tree before the first
	# zombie is built out of it.
	await get_tree().process_frame
	_next_wave()


func _next_wave() -> void:
	wave += 1
	var count: int = first_wave_size + (wave - 1) * wave_growth
	_alive = count
	wave_started.emit(wave, count)
	for i in count:
		_spawn(i, count)
		# Staggered so a wave arrives as a crowd rather than as one frame that
		# drops to single digits — but only just. This waits between *every*
		# zombie, so a tenth of a second here is three seconds by wave ten, and
		# anything larger means late waves are still walking on when the player
		# has already cleared the ones that arrived.
		await get_tree().create_timer(randf_range(0.03, 0.11)).timeout


func _spawn(index: int, total: int) -> void:
	var zombie := CharacterBody3D.new()
	zombie.set_script(load("res://enemy.gd"))
	zombie.collision_layer = 2
	zombie.collision_mask = 1 | 2

	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.height = 1.9
	capsule.radius = 0.4
	shape.shape = capsule
	shape.position = Vector3(0.0, 0.95, 0.0)
	zombie.add_child(shape)

	var mesh := MeshInstance3D.new()
	mesh.name = "Mesh"
	if _enemy_scene != null:
		# The generated model, when there is one: parented so the code-built
		# capsule still owns collision and the art is only art.
		var art := _enemy_scene.instantiate()
		zombie.add_child(art)
		art.position = Vector3(0.0, 0.0, 0.0)
	var body := CapsuleMesh.new()
	body.height = 1.9
	body.radius = 0.4
	mesh.mesh = body
	var skin := StandardMaterial3D.new()
	skin.albedo_color = Color(0.31, 0.42, 0.27, 1.0)
	skin.roughness = 0.9
	skin.emission_enabled = true
	skin.emission = Color(0.9, 0.2, 0.15, 1.0)
	skin.emission_energy_multiplier = 0.0
	mesh.set_surface_override_material(0, skin)
	mesh.position = Vector3(0.0, 0.95, 0.0)
	mesh.visible = _enemy_scene == null
	zombie.add_child(mesh)

	zombie.position = _spawn_point(index, total)

	zombie.set("target", _player)
	zombie.set("speed", (2.4 + float(wave - 1) * speed_step) * difficulty)
	zombie.set("health", (100.0 + float(wave - 1) * health_step) * difficulty)
	zombie.connect("died", _on_enemy_died)
	# Deferred, always. The first wave starts from _ready, and a plain add_child
	# while the parent is still setting up its own children fails with "Parent
	# node is busy setting up children" — which is not an exception, so the wave
	# counter says five and three of those zombies never exist.
	get_parent().add_child.call_deferred(zombie)


## Where the next one walks in from.
##
## Spread around the given mouths rather than taken at random: picking randomly
## means the same corner three times running, which reads as the game forgetting
## the other three sides of the map exist. Starting at a different mouth each
## wave keeps the pressure from always coming from the north.
func _spawn_point(index: int, total: int) -> Vector3:
	if spawn_points.is_empty():
		# No block, no streets: the old ring, which is right on an open arena.
		var angle: float = TAU * (float(index) / float(maxi(total, 1))) + randf_range(-0.2, 0.2)
		var distance: float = spawn_radius + randf_range(-1.5, 1.5)
		return Vector3(cos(angle) * distance, 1.2, sin(angle) * distance)

	var count: int = spawn_points.size()
	var step: int = maxi(1, int(round(float(count) / float(maxi(total, 1)))))
	var at: Vector3 = spawn_points[(wave * 3 + index * step) % count]
	# A metre or so of jitter, so six arriving at one mouth are a crowd rather
	# than a column standing inside each other.
	return at + Vector3(randf_range(-1.2, 1.2), 0.0, randf_range(-1.2, 1.2))


func _on_enemy_died(_where: Vector3) -> void:
	score += 100
	score_changed.emit(score)
	enemy_killed.emit()
	_alive -= 1
	if _alive > 0:
		return
	wave_cleared.emit(wave)
	await get_tree().create_timer(break_seconds).timeout
	if _running:
		_next_wave()


func stop() -> void:
	_running = false
`;
}

/**
 * The HUD.
 *
 * Built in code for the same reason the zombies are: a Control tree written
 * into a `.tscn` is four more resources whose ids have to line up, and it looks
 * identical either way.
 */
export function hudScript(): string {
  return `extends CanvasLayer
## Health, ammo, wave and score, plus the game-over card.

@onready var _health_bar: ProgressBar = $Health
@onready var _health_label: Label = $HealthLabel
@onready var _ammo: Label = $Ammo
@onready var _wave: Label = $Wave
@onready var _score: Label = $Score
@onready var _centre: Label = $Centre
@onready var _crosshair: Control = $Crosshair
@onready var _over: Panel = $GameOver
@onready var _objective: Label = $Objective

var _dead: bool = false


func _ready() -> void:
	_over.visible = false
	_centre.text = ""


func set_health(current: float, maximum: float) -> void:
	_health_bar.max_value = maximum
	_health_bar.value = current
	_health_label.text = "%d" % int(maxf(current, 0.0))


func set_ammo(in_magazine: int, reserve: int) -> void:
	_ammo.text = "%d / %d" % [in_magazine, reserve]


func set_objective(text: String, progress: int, target: int) -> void:
	# Counted objectives show their count; a one-shot "get to the gate" does not
	# need "0 / 1" after it.
	_objective.text = text if target <= 1 else "%s  (%d/%d)" % [text, mini(progress, target), target]


func set_mission(name: String, brief: String) -> void:
	_flash_centre("%s\n%s" % [name, brief.replace("\\n", "  ")])


func mission_complete(name: String, score: int) -> void:
	if _dead:
		return
	_dead = true
	_centre.text = ""
	_crosshair.visible = false
	_over.visible = true
	var label := _over.get_node("Text") as Label
	label.text = "%s\n\nCOMPLETE\n\nScore %06d\n\nTap to continue" % [name.to_upper(), score]


func set_wave(number: int, enemies: int) -> void:
	_wave.text = "WAVE %d" % number
	_flash_centre("WAVE %d — %d ZOMBIES" % [number, enemies])


func set_score(value: int) -> void:
	_score.text = "%06d" % value


func wave_cleared(number: int) -> void:
	_flash_centre("WAVE %d CLEARED" % number)


func game_over(score: int, wave: int) -> void:
	if _dead:
		return
	_dead = true
	_centre.text = ""
	_crosshair.visible = false
	_over.visible = true
	var label := _over.get_node("Text") as Label
	label.text = "YOU DIED\n\nWave %d\nScore %06d\n\nTap to try again" % [wave, score]


func _flash_centre(text: String) -> void:
	_centre.text = text
	_centre.modulate.a = 1.0
	var fade := create_tween()
	fade.tween_interval(1.4)
	fade.tween_property(_centre, "modulate:a", 0.0, 0.8)


func _input(event: InputEvent) -> void:
	if not _dead:
		return
	var tapped: bool = event is InputEventScreenTouch and (event as InputEventScreenTouch).pressed
	var clicked: bool = event is InputEventMouseButton and (event as InputEventMouseButton).pressed
	if tapped or clicked:
		# Back to the mission list rather than straight into the same fight:
		# a mission you just finished is not the one you want replayed.
		get_tree().change_scene_to_file("res://mission_select.tscn")
`;
}

/**
 * The player, in a shooter.
 *
 * Replaces the generic controller rather than extending it: the movement is
 * camera-relative instead of body-relative (the body *is* the camera here),
 * there is health to lose, and sprinting exists because a horde you cannot
 * outrun is not a fight, it is a countdown.
 */
export function shooterPlayerScript(): string {
  return `extends CharacterBody3D
## First-person player: moves, sprints, bleeds.

signal health_changed(current: float, maximum: float)
signal died

@export var speed: float = 4.6
@export var sprint_speed: float = 7.2
@export var jump_velocity: float = 4.5
@export var max_health: float = 100.0
## Comes back slowly after a few seconds clear of the horde, which is what makes
## backing off a tactic rather than a delay.
@export var regen_per_second: float = 4.0
@export var regen_delay: float = 6.0

var health: float = 100.0
var touch_direction := Vector2.ZERO

var _since_hit: float = 999.0
var _dead: bool = false


func _ready() -> void:
	health = max_health
	health_changed.emit(health, max_health)


func _physics_process(delta: float) -> void:
	if _dead:
		return

	_since_hit += delta
	if _since_hit > regen_delay and health < max_health:
		health = minf(max_health, health + regen_per_second * delta)
		health_changed.emit(health, max_health)

	if not is_on_floor():
		velocity += get_gravity() * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if input == Vector2.ZERO:
		input = touch_direction

	# Relative to where the player is facing, which in first person is where the
	# camera is pointing.
	var direction := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()
	var current: float = sprint_speed if Input.is_action_pressed("sprint") else speed
	if direction:
		velocity.x = direction.x * current
		velocity.z = direction.z * current
	else:
		velocity.x = move_toward(velocity.x, 0.0, current)
		velocity.z = move_toward(velocity.z, 0.0, current)

	move_and_slide()


func take_damage(amount: float) -> void:
	if _dead:
		return
	health -= amount
	_since_hit = 0.0
	health_changed.emit(health, max_health)
	if health <= 0.0:
		_dead = true
		died.emit()


func is_dead() -> bool:
	return _dead


## Fed by the touch layer. Analog, so it stays a vector rather than a synthesised
## action: a thumb half way up the stick should walk, not run.
func set_move_input(direction: Vector2) -> void:
	touch_direction = direction
`;
}

/**
 * The glue node.
 *
 * Wiring six signals through `[connection]` lines in the scene file means six
 * more chances for a typo that fails silently at load. One script that connects
 * them in `_ready` fails loudly instead.
 */
export function wiringScript(): string {
  return `extends Node
## Connects player, weapon, director, mission and HUD. Kept in one place so a
## rename breaks here, visibly, instead of in a scene file that just stops
## working.

@onready var _player: CharacterBody3D = get_parent().get_node("Player")
@onready var _weapon: Node3D = get_parent().get_node("Player/Camera/Weapon")
@onready var _director: Node3D = get_parent().get_node("Director")
@onready var _hud: CanvasLayer = get_parent().get_node("HUD")
@onready var _mission: Node = get_parent().get_node("Mission")
@onready var _missions: Node = get_parent().get_node("Missions")
@onready var _effects: Node3D = get_parent().get_node("Effects")
@onready var _look: Node = get_parent().get_node("Player/Look")
@onready var _touch: Control = _hud.get_node("Touch")


func _ready() -> void:
	# The controls first. Everything below is scoring; this is whether the game
	# can be played at all, and a get_node that fails here should fail before
	# the player is looking at a scene they cannot move in.
	_touch.moved.connect(_player.set_move_input)
	_touch.look.connect(_look._on_look)

	_player.health_changed.connect(_hud.set_health)
	_player.died.connect(_on_player_died)
	_weapon.ammo_changed.connect(_hud.set_ammo)
	_weapon.struck.connect(_on_struck)
	_director.wave_started.connect(_hud.set_wave)
	_director.wave_cleared.connect(_hud.wave_cleared)
	_director.score_changed.connect(_hud.set_score)
	_director.enemy_killed.connect(_on_enemy_killed)
	_mission.objective_changed.connect(_hud.set_objective)
	_mission.mission_complete.connect(_on_complete)
	_hud.set_score(0)

	_start_mission()


## Which mission the select screen chose. Read from the same file it wrote,
## because change_scene_to_file cannot carry an argument.
func _start_mission() -> void:
	var config := ConfigFile.new()
	var index: int = 0
	if config.load("user://progress.cfg") == OK:
		var chosen: int = config.get_value("progress", "playing", 0)
		index = chosen
	var data: Dictionary = _missions.get_mission(index)
	if data.is_empty():
		data = _missions.get_mission(0)
	_director.difficulty = float(data.get("difficulty", 1.0))
	_director.first_wave_size = int(data.get("first_wave", 5))
	_hud.set_mission(String(data.get("name", "")), String(data.get("brief", "")))
	_mission.start(data)
	_director.start()


func _on_enemy_killed() -> void:
	_mission.record("eliminate")


func _on_struck(at: Vector3, normal: Vector3, was_alive: bool) -> void:
	if was_alive:
		_effects.hit(at, normal)
	else:
		_effects.impact(at, normal)


func _on_complete(name: String) -> void:
	_director.stop()
	_hud.mission_complete(name, _director.score)
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	# Unlocked only on a win, which is what makes the win mean something.
	var config := ConfigFile.new()
	config.load("user://progress.cfg")
	var played: int = config.get_value("progress", "playing", 0)
	_missions.unlock(played + 1)


func _on_player_died() -> void:
	_director.stop()
	_mission.fail("You died.")
	_hud.game_over(_director.score, _director.wave)
	# Freed rather than hidden: a captured mouse on a dead player is a window
	# you cannot click out of.
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
`;
}
