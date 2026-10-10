class_name Player
extends CharacterBody3D
## You, in first person. Walk, run (loud), crouch (quiet), a torch that runs down, a crank to
## recharge it (loud, and your hands are busy), and a look-ray that finds whatever you can use.

signal died

const WALK := 2.7
const RUN := 5.2
const CROUCH_SPEED := 1.5
const EYE := 1.6
const EYE_CROUCH := 1.0
const REACH := 2.7

var game: Game
var yaw := 0.0
var pitch := 0.0
var move_input := Vector2.ZERO     # x = right, y = back (like Input.get_vector)
var sprint_held := false
var crouching := false
var crank_held := false
var use_edge := false              # set by the UI for one frame
var torch_on := true
var battery := 100.0
var stamina := 1.0
var hidden := false
var dead := false
var frozen := false                # cut-scenes: the pod launch, the title screen
var focus: Use = null
var noise := 0.0                   # 0..1 how loud you are right now, for the HUD

var head: Node3D
var cam: Camera3D
var torch: SpotLight3D
var _hide_use: Use
var _step_t := 0.0
var _bob := 0.0
var _eye := EYE
var _crank_t := 0.0
var _flicker := 0.0
var _kick := 0.0


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
	cam.far = 90.0
	head.add_child(cam)
	cam.make_current()
	torch = SpotLight3D.new()
	torch.spot_range = 17.0
	torch.spot_angle = 27.0
	torch.spot_angle_attenuation = 0.9
	torch.light_energy = 6.0
	torch.light_color = Color(1.0, 0.95, 0.82)
	torch.shadow_enabled = not OS.has_feature("mobile")
	torch.position = Vector3(0.14, -0.12, -0.1)
	cam.add_child(torch)
	var ambient := OmniLight3D.new()
	ambient.light_energy = 0.07
	ambient.omni_range = 4.0
	ambient.light_color = Color(0.6, 0.75, 1.0)
	head.add_child(ambient)


func look(dx: float, dy: float) -> void:
	if dead or frozen:
		return
	var lim := 0.7 if hidden else 1.45
	yaw -= dx
	pitch = clampf(pitch - dy, -lim, lim)
	if hidden:
		var base := _hide_use.hide_yaw if _hide_use else 0.0
		yaw = clampf(yaw, deg_to_rad(base) - 0.75, deg_to_rad(base) + 0.75)


func torch_dir() -> Vector3:
	return -cam.global_transform.basis.z


func eye_pos() -> Vector3:
	return head.global_position


func toggle_torch() -> void:
	if dead:
		return
	if not torch_on and battery <= 0.5:
		game.sfx.play("error", -10.0)
		game.ui.toast("The torch is dead. Hold CRANK to charge it.")
		return
	torch_on = not torch_on
	game.sfx.play("torch", -6.0)


func _physics_process(delta: float) -> void:
	rotation.y = yaw
	head.rotation.x = pitch
	if dead or frozen:
		velocity = Vector3.ZERO
		_update_torch(delta)
		return
	if hidden:
		velocity = Vector3.ZERO
		_update_torch(delta)
		_find_focus()
		if use_edge or move_input.length() > 0.5:
			use_edge = false
			exit_hide()
		return

	var want := move_input.limit_length(1.0)
	var moving := want.length() > 0.1 and not crank_held
	var running := moving and sprint_held and not crouching and stamina > 0.05
	var speed := CROUCH_SPEED if crouching else (RUN if running else WALK)
	var dir := (global_transform.basis * Vector3(want.x, 0, want.y)).normalized() * want.length()
	var target := dir * speed if not crank_held else Vector3.ZERO
	velocity.x = move_toward(velocity.x, target.x, 24.0 * delta)
	velocity.z = move_toward(velocity.z, target.z, 24.0 * delta)
	velocity.y = -2.0
	move_and_slide()

	# Stamina: running spends it, anything else gives it back.
	if running:
		stamina = maxf(0.0, stamina - delta / 6.0)
	else:
		stamina = minf(1.0, stamina + delta / (3.5 if not moving else 5.0))

	# Footsteps are the whole game: every one is a noise the Hollow can hear.
	var flat := Vector2(velocity.x, velocity.z).length()
	var loud := 0.0
	if flat > 0.4:
		_step_t -= delta * (flat / 2.7)
		_bob += delta * flat * 2.4
		if _step_t <= 0.0:
			_step_t = 0.6
			var radius := 1.4 if crouching else (10.0 if running else 4.2)
			loud = radius
			game.noise(global_position, radius, "step")
			game.sfx.play("run" if running else ("soft" if crouching else ("step" if int(_bob) % 2 == 0 else "step2")), -10.0 if crouching else (-3.0 if running else -8.0))
	noise = move_toward(noise, clampf(loud / 10.0, 0.0, 1.0) if loud > 0.0 else (0.0 if flat < 0.4 else noise), delta * 1.6)

	# Cranking: noisy, and it needs both hands.
	if crank_held and battery < 100.0:
		battery = minf(100.0, battery + 16.0 * delta)
		_crank_t -= delta
		if _crank_t <= 0.0:
			_crank_t = 0.55
			game.sfx.play("crank", -4.0)
			game.noise(global_position, 11.0, "crank")
			noise = 0.8
	# Camera: eye height, a little bob, a kick when something scares you.
	_eye = lerpf(_eye, EYE_CROUCH if crouching else EYE, clampf(delta * 9.0, 0.0, 1.0))
	_kick = move_toward(_kick, 0.0, delta * 2.0)
	head.position.y = _eye + sin(_bob) * 0.025 * clampf(flat / 2.7, 0.0, 1.5) - _kick * 0.1
	cam.rotation.z = -move_input.x * 0.012 + _kick * 0.04 * sin(Time.get_ticks_msec() * 0.03)
	_update_torch(delta)
	_find_focus()
	if use_edge:
		use_edge = false
		if focus != null:
			focus.use()


func _update_torch(delta: float) -> void:
	if torch_on and battery > 0.0:
		battery = maxf(0.0, battery - 1.15 * delta)
		_flicker = 1.0
		if battery < 20.0:
			_flicker = 0.55 + 0.45 * absf(sin(Time.get_ticks_msec() * 0.013 + sin(Time.get_ticks_msec() * 0.05)))
			if randf() < 0.03:
				_flicker = 0.1
		if battery <= 0.0:
			torch_on = false
			game.ui.toast("The torch died.")
	torch.light_energy = (6.0 * _flicker) if (torch_on and battery > 0.0) else 0.0
	torch.visible = torch.light_energy > 0.01


func _find_focus() -> void:
	var space := get_world_3d().direct_space_state
	var from := cam.global_position
	var to := from + torch_dir() * REACH
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD | Data.L_USE)
	q.collide_with_areas = false
	var hit := space.intersect_ray(q)
	var found: Use = null
	if not hit.is_empty() and hit.collider is Use:
		var u := hit.collider as Use
		if u.enabled:
			found = u
	focus = found


func enter_hide(u: Use) -> void:
	hidden = true
	torch_on = false   # a light in a locker would give you away
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
	game.sfx.play("locker", -4.0)


func scare(amount := 1.0) -> void:
	_kick = clampf(_kick + amount, 0.0, 1.0)


func respawn(pos: Vector3, yaw_deg: float) -> void:
	hidden = false
	_hide_use = null
	dead = false
	frozen = false
	collision_layer = Data.L_PLAYER
	global_position = pos
	velocity = Vector3.ZERO
	yaw = deg_to_rad(yaw_deg)
	pitch = 0.0
	crouching = false
	_eye = EYE
	head.position.y = EYE
	if battery < 25.0:
		battery = 25.0
