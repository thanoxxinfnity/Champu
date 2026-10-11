class_name Player
extends CharacterBody3D
## You, in first person. Walk, run (loud), crouch (quiet), a torch, the EMP stunner, and a look-ray that finds what you can use.
## There is no health bar: being hurt shakes the picture, reddens its edges and, when you are nearly done, you hear your heart.

signal hurt_taken(health: int)
signal died

const WALK := 2.6
const RUN := 4.8
const CROUCH_SPEED := 1.4
const EYE := 1.6
const EYE_CROUCH := 1.0
const REACH := 2.8
const MAX_HEALTH := 3
const EMP_RANGE := 15.0
const EMP_COOLDOWN := 1.3
const THROW_COOLDOWN := 0.7
const THROW_RANGE := 16.0
## How far each thing you do carries, in metres (a creature's own ears scale it). Standing still carries nowhere.
const NOISE_CROUCH := 0.8
const NOISE_WALK := 4.2
const NOISE_RUN := 10.0
const NOISE_CLANG := 20.0

var game: Game
var yaw := 0.0
var pitch := 0.0
var move_input := Vector2.ZERO     # x = right, y = back (like Input.get_vector)
var sprint_held := false
var crouching := false
var use_edge := false              # set by the UI for one frame
var torch_on := true
var stamina := 1.0
var hidden := false
var dead := false
var frozen := false
var has_emp := false
var emp_charges := 0
var health := MAX_HEALTH
var focus: Use = null
var push := Vector3.ZERO           # conveyor belts and the like
var noise_level := 0.0             # 0..1: how loud you are right now (the HUD's sound meter reads it)
var _noise_target := 0.0
var _throw_cd := 0.0

var head: Node3D
var cam: Camera3D
var torch: SpotLight3D
var _hide_use: Use
var _step_t := 0.0
var _bob := 0.0
var _eye := EYE
var _shake := 0.0
var _emp_cd := 0.0
var _regen := 0.0
var _viewmodel: Node3D


func _ready() -> void:
	collision_layer = Data.L_PLAYER
	collision_mask = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.7
	cs.shape = cap
	cs.position.y = 0.85
	cs.name = "Body"
	add_child(cs)
	head = Node3D.new()
	head.position.y = EYE
	add_child(head)
	cam = Camera3D.new()
	cam.fov = 74.0
	cam.near = 0.05
	cam.far = 70.0
	head.add_child(cam)
	cam.make_current()
	torch = SpotLight3D.new()
	torch.spot_range = 16.0
	torch.spot_angle = 30.0
	torch.spot_angle_attenuation = 0.9
	torch.light_energy = 4.5
	torch.light_color = Color(0.95, 0.97, 1.0)
	torch.position = Vector3(0.14, -0.12, -0.1)
	cam.add_child(torch)
	var ambient := OmniLight3D.new()
	ambient.light_energy = 0.1
	ambient.omni_range = 4.0
	ambient.light_color = Color(0.6, 0.7, 1.0)
	head.add_child(ambient)


func look(dx: float, dy: float) -> void:
	if dead or frozen:
		return
	var lim := 0.7 if hidden else 1.45
	yaw -= dx
	pitch = clampf(pitch - dy, -lim, lim)
	if hidden and _hide_use:
		yaw = clampf(yaw, deg_to_rad(_hide_use.hide_yaw) - 0.75, deg_to_rad(_hide_use.hide_yaw) + 0.75)


func aim_dir() -> Vector3:
	return -cam.global_transform.basis.z


func eye_pos() -> Vector3:
	return head.global_position


func toggle_torch() -> void:
	if dead or hidden:
		return
	torch_on = not torch_on
	game.sfx.play("torch", -6.0)


## The EMP stunner: a ray from the eye. Whatever walks and is hit freezes for five seconds.
func fire_emp() -> bool:
	if dead or frozen or hidden or not has_emp or _emp_cd > 0.0:
		return false
	if emp_charges <= 0:
		game.sfx.play("error", -8.0)
		return false
	emp_charges -= 1
	_emp_cd = EMP_COOLDOWN
	game.sfx.play("emp", -2.0)
	game.noise(global_position, 9.0, "emp")
	var q := PhysicsRayQueryParameters3D.create(cam.global_position, cam.global_position + aim_dir() * EMP_RANGE, Data.L_ENEMY | Data.L_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var end: Vector3 = hit.position if not hit.is_empty() else cam.global_position + aim_dir() * EMP_RANGE
	game.emp_bolt(cam.global_position + cam.global_transform.basis * Vector3(0.2, -0.18, -0.4), end)
	var target: Enemy = hit.collider as Enemy if (not hit.is_empty() and hit.collider is Enemy) else _assist(end)
	if target != null:
		target.stun(5.0)
	return true


## On a touch screen nobody aims at a crawling thing's knees: the nearest creature within a few degrees of where you point is hit.
func _assist(end: Vector3) -> Enemy:
	var best: Enemy = null
	var best_ang := 0.3
	var from := cam.global_position
	var dir := aim_dir()
	for e in game.enemies:
		if not is_instance_valid(e):
			continue
		var chest: Vector3 = e.global_position + Vector3(0, e._cfg.height * 0.5, 0)
		var to := chest - from
		if to.length() > EMP_RANGE or to.length() > from.distance_to(end) + 1.5:
			continue
		var ang := dir.angle_to(to)
		if ang < best_ang:
			var q := PhysicsRayQueryParameters3D.create(from, chest, Data.L_WORLD)
			if get_world_3d().direct_space_state.intersect_ray(q).is_empty():
				best = e
				best_ang = ang
	return best


## Throw a lump of scrap where you are looking. It clangs where it lands, and everything that listens goes there.
## Returns the landing spot, or ZERO if there was nothing to throw.
func throw_scrap() -> Vector3:
	if dead or frozen or hidden or _throw_cd > 0.0 or not game.take_item("scrap"):
		return Vector3.ZERO
	_throw_cd = THROW_COOLDOWN
	game.sfx.play("toss", -4.0)
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from + aim_dir() * THROW_RANGE, Data.L_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var spot: Vector3
	if hit.is_empty():
		spot = from + aim_dir() * THROW_RANGE
	else:
		spot = (hit.position as Vector3) + (hit.normal as Vector3) * 0.15
	# It comes down on the floor under that point (a thing thrown at a wall drops to the base of it).
	var down := PhysicsRayQueryParameters3D.create(spot + Vector3(0, 0.2, 0), spot + Vector3(0, -6.0, 0), Data.L_WORLD)
	var floor_hit := get_world_3d().direct_space_state.intersect_ray(down)
	spot = Vector3(spot.x, (floor_hit.position as Vector3).y if not floor_hit.is_empty() else 0.0, spot.z)
	game.scrap_flies(from + cam.global_transform.basis * Vector3(0.15, -0.2, -0.4), spot)
	return spot


func hurt(amount := 1) -> void:
	if dead:
		return
	health = maxi(0, health - amount)
	_shake = 1.0
	_regen = 25.0
	hurt_taken.emit(health)
	if health <= 0:
		dead = true
		died.emit()


func shake_amount() -> float:
	return _shake


func shake(amount: float) -> void:
	_shake = clampf(maxf(_shake, amount), 0.0, 1.0)
	if amount >= 0.6 and not game.headless_test:
		Input.vibrate_handheld(int(120.0 * amount))


func _physics_process(delta: float) -> void:
	rotation.y = yaw
	head.rotation.x = pitch
	_emp_cd = maxf(0.0, _emp_cd - delta)
	_throw_cd = maxf(0.0, _throw_cd - delta)
	_noise_target = 0.0
	# Hurt, and then left alone for a while: you get better.
	if not dead and health < MAX_HEALTH:
		_regen -= delta
		if _regen <= 0.0:
			health += 1
			_regen = 20.0
	torch.light_energy = 4.5 if torch_on else 0.0
	torch.visible = torch_on
	if dead or frozen:
		velocity = Vector3.ZERO
		_camera(delta, 0.0)
		return
	if hidden:
		velocity = Vector3.ZERO
		_camera(delta, 0.0)
		_find_focus()
		if use_edge or move_input.length() > 0.5:
			use_edge = false
			exit_hide()
		return
	var want := move_input.limit_length(1.0)
	var moving := want.length() > 0.1
	var running := moving and sprint_held and not crouching and stamina > 0.05
	var speed := CROUCH_SPEED if crouching else (RUN if running else WALK)
	var dir := (global_transform.basis * Vector3(want.x, 0, want.y)).normalized() * want.length()
	var target := dir * speed
	velocity.x = move_toward(velocity.x, target.x, 22.0 * delta)
	velocity.z = move_toward(velocity.z, target.z, 22.0 * delta)
	velocity.y = -2.0
	velocity += push
	move_and_slide()
	if running:
		stamina = maxf(0.0, stamina - delta / 6.0)
	else:
		stamina = minf(1.0, stamina + delta / (3.5 if not moving else 5.0))
	# Footsteps are noises the enemies can hear; in water they are shouts.
	var flat := Vector2(velocity.x - push.x, velocity.z - push.z).length()
	var in_water: bool = game.world.current != "" and Dressing.in_water(game.world.current, global_position)
	if flat > 0.4:
		_step_t -= delta * (flat / 2.6)
		_bob += delta * flat * 2.4
		if _step_t <= 0.0:
			_step_t = 0.6
			var radius := NOISE_CROUCH if crouching else (NOISE_RUN if running else NOISE_WALK)
			if in_water:
				radius = maxf(radius * 2.2, 9.0)
			game.noise(global_position, radius, "step")
			_noise_target = radius / NOISE_RUN
			game.sfx.play("splash" if in_water else ("run" if running else ("soft" if crouching else ("step" if int(_bob) % 2 == 0 else "step2"))), -10.0 if crouching else (-3.0 if running else -8.0))
	noise_level = move_toward(noise_level, maxf(_noise_target, 0.0), delta * (6.0 if _noise_target > noise_level else 1.1))
	_camera(delta, flat)
	_find_focus()
	if use_edge:
		use_edge = false
		if focus != null:
			focus.use()


func _camera(delta: float, flat: float) -> void:
	_eye = lerpf(_eye, EYE_CROUCH if crouching else EYE, clampf(delta * 9.0, 0.0, 1.0))
	_shake = move_toward(_shake, 0.0, delta * 1.2)
	var t := Time.get_ticks_msec() * 0.001
	if not hidden:
		head.position.y = _eye + sin(_bob) * 0.025 * clampf(flat / 2.6, 0.0, 1.5) - _shake * 0.06
	cam.rotation.z = -move_input.x * 0.012 + _shake * 0.05 * sin(t * 38.0)
	cam.position = Vector3(_shake * 0.03 * sin(t * 53.0), _shake * 0.03 * cos(t * 47.0), 0.0)


func _find_focus() -> void:
	var q := PhysicsRayQueryParameters3D.create(cam.global_position, cam.global_position + aim_dir() * REACH, Data.L_WORLD | Data.L_USE)
	q.collide_with_areas = false
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	focus = null
	if not hit.is_empty() and hit.collider is Use and (hit.collider as Use).enabled:
		focus = hit.collider as Use


func hiding_in() -> Use:
	return _hide_use if hidden else null


func enter_hide(u: Use) -> void:
	game.remember_hide(u.hide_pos)
	game.noise(global_position, 2.0, "locker")
	hidden = true
	torch_on = false
	_hide_use = u
	global_position = Vector3(u.hide_pos.x, 0.0, u.hide_pos.z)
	yaw = deg_to_rad(u.hide_yaw)
	pitch = 0.0
	crouching = false
	collision_layer = 0
	head.position.y = u.hide_pos.y
	_eye = u.hide_pos.y


func exit_hide() -> void:
	if not hidden:
		return
	hidden = false
	var out := Vector3(-sin(deg_to_rad(_hide_use.hide_yaw)), 0, -cos(deg_to_rad(_hide_use.hide_yaw)))
	global_position = Vector3(_hide_use.hide_pos.x, 0.0, _hide_use.hide_pos.z) + out * 1.05
	collision_layer = Data.L_PLAYER
	_hide_use = null
	torch_on = true
	game.sfx.play("locker", -4.0)


## The stunner in the right hand, low in the frame; its tip glows when it has a charge.
func equip_emp() -> void:
	has_emp = true
	if _viewmodel != null:
		return
	_viewmodel = Node3D.new()
	_viewmodel.name = "Stunner"
	_viewmodel.position = Vector3(0.22, -0.2, -0.48)
	_viewmodel.rotation_degrees = Vector3(-6, -14, 0)
	cam.add_child(_viewmodel)
	var m := Assets.make("emp_stunner", 0.17, true)
	m.rotation_degrees.y = 90.0
	_viewmodel.add_child(m)
	var tip := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.012
	sm.height = 0.024
	tip.mesh = sm
	tip.material_override = Assets.mat(Color(0.4, 0.8, 1.0), 0.3, 0.0, 5.0)
	tip.position = Vector3(0, 0.01, -0.1)
	tip.name = "Tip"
	_viewmodel.add_child(tip)


func respawn(pos: Vector3, yaw_deg: float) -> void:
	hidden = false
	_hide_use = null
	dead = false
	frozen = false
	health = MAX_HEALTH
	collision_layer = Data.L_PLAYER
	global_position = pos
	velocity = Vector3.ZERO
	push = Vector3.ZERO
	yaw = deg_to_rad(yaw_deg)
	pitch = 0.0
	crouching = false
	_eye = EYE
	head.position.y = EYE
	# Coming back, the stunner is never empty: a death must not leave you without the one thing that holds them off.
	if has_emp:
		emp_charges = maxi(emp_charges, 3)
