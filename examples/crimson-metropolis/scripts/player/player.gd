class_name Player
extends CharacterBody3D
## The protagonist on foot, third person: camera-relative movement with inertia, walk / jog / sprint, jump,
## a shoulder camera on a SpringArm3D that pulls in against walls, and a nearest-usable-thing focus for E / F.
## Everything the keyboard, mouse and touch controls do goes through set_move_input / add_look / the
## press_* methods, so the tests (and the on-screen controls) drive exactly what a person drives.

signal focus_changed(target: Node)
signal died
signal hurt_taken(health: int)

const WALK_SPEED := 2.1
const JOG_SPEED := 4.6
const SPRINT_SPEED := 7.4
const ACCEL := 26.0
const AIR_ACCEL := 5.0
const JUMP_VELOCITY := 6.6
const TURN_RATE := 13.0
const CHAR_HEIGHT := 1.8
const EYE_HEIGHT := 1.55
const CAM_DISTANCE := 3.4
const SHOULDER := 0.55
const PITCH_MIN := -1.2
const PITCH_MAX := 0.7
const FOV_BASE := 68.0
const FOV_SPRINT := 78.0
const MOUSE_SENS := 0.0028
const MAX_HEALTH := 100

var move_input := Vector2.ZERO    # the movement actually used this frame: x = right, y = back (Input.get_vector's convention)
var ext_move := Vector2.ZERO      # what the on-screen stick / a test sets; the keyboard overrides it while a key is down
var ext_sprint := false
var sprint_held := false
var yaw := 0.0                    # the camera's heading; move input is relative to it
var pitch := -0.22
var shoulder_side := 1.0          # +1 right shoulder, -1 left
var health := MAX_HEALTH
var dead := false
var active := true                # false while driving, in a cutscene, or asleep
var aiming := false
var cinematic := false            # a scripted moment (walking to a car door): visible and animated, but no input and no collision
var focus: Node = null

var model: Node3D                 # the rigged character; turns to face where it is going
var anim: AnimationPlayer
var cam_pivot: Node3D
var cam_arm: SpringArm3D
var cam: Camera3D

var _gravity := float(ProjectSettings.get_setting("physics/3d/default_gravity", 19.0))
var _state := &""
var _jumping := false
var _near: Array[Node] = []
var _use_area: Area3D
var _fov := FOV_BASE
var _cam_follow := Vector3.ZERO


func _ready() -> void:
	collision_layer = Data.L_PLAYER
	collision_mask = Data.L_WORLD | Data.L_DYNAMIC
	floor_snap_length = 0.35
	floor_max_angle = deg_to_rad(50.0)

	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = CHAR_HEIGHT
	cs.shape = cap
	cs.position.y = CHAR_HEIGHT * 0.5
	cs.name = "Body"
	add_child(cs)

	model = Rig.make_character(CHAR_HEIGHT)
	if model != null:
		add_child(model)
		anim = model.get_meta("anim") as AnimationPlayer
		_play(&"idle")

	cam_pivot = Node3D.new()
	cam_pivot.name = "CameraPivot"
	cam_pivot.top_level = true
	add_child(cam_pivot)
	cam_arm = SpringArm3D.new()
	var probe := SphereShape3D.new()
	probe.radius = 0.28
	cam_arm.shape = probe
	cam_arm.spring_length = CAM_DISTANCE
	cam_arm.collision_mask = Data.L_WORLD
	cam_arm.margin = 0.1
	cam_arm.add_excluded_object(get_rid())
	cam_pivot.add_child(cam_arm)
	cam = Camera3D.new()
	cam.fov = FOV_BASE
	cam.near = 0.08
	cam.far = 600.0
	cam_arm.add_child(cam)
	cam.make_current()

	_use_area = Area3D.new()
	_use_area.collision_layer = 0
	_use_area.collision_mask = Data.L_INTERACT
	_use_area.monitorable = false
	var us := CollisionShape3D.new()
	var sph := SphereShape3D.new()
	sph.radius = 1.9
	us.shape = sph
	us.position.y = 1.0
	_use_area.add_child(us)
	add_child(_use_area)
	_use_area.area_entered.connect(_on_use_enter)
	_use_area.area_exited.connect(_on_use_exit)

	_cam_follow = global_position + Vector3(0, EYE_HEIGHT, 0)
	_update_camera(0.0)


func set_move_input(v: Vector2, sprint := false) -> void:
	ext_move = v.limit_length(1.0)
	ext_sprint = sprint


func add_look(dx: float, dy: float) -> void:
	if dead or not active:
		return
	yaw -= dx
	pitch = clampf(pitch - dy, PITCH_MIN, PITCH_MAX)


## Hand the body to a script: it stops obeying input and collisions, but stays visible, so a tween can walk it somewhere.
func set_cinematic(on: bool) -> void:
	cinematic = on
	velocity = Vector3.ZERO
	move_input = Vector2.ZERO
	ext_move = Vector2.ZERO
	var body := get_node_or_null("Body") as CollisionShape3D
	if body != null:
		body.disabled = on


## Play a one-shot clip (push_door, ...) and come back to locomotion afterwards.
func play_clip(clip: StringName) -> void:
	if anim == null or not anim.has_animation(clip):
		return
	_state = clip
	anim.speed_scale = 1.0
	anim.play(clip, 0.1)


func face(dir: Vector3) -> void:
	if model != null and Vector2(dir.x, dir.z).length() > 0.001:
		model.rotation.y = atan2(dir.x, dir.z)


func switch_shoulder() -> void:
	shoulder_side = -shoulder_side


func set_active(on: bool) -> void:
	active = on
	visible = on
	if not on:
		velocity = Vector3.ZERO
		move_input = Vector2.ZERO
		ext_move = Vector2.ZERO
	set_physics_process(on)
	for c in get_children():
		if c is CollisionShape3D:
			(c as CollisionShape3D).disabled = not on
	if _use_area != null:
		_use_area.monitoring = on
	if on and cam != null:
		cam.make_current()


func hurt(amount: int) -> void:
	if dead or amount <= 0:
		return
	health = maxi(0, health - amount)
	hurt_taken.emit(health)
	if health == 0:
		dead = true
		move_input = Vector2.ZERO
		ext_move = Vector2.ZERO
		died.emit()


func heal_full() -> void:
	health = MAX_HEALTH


## The direction the camera looks along the ground — "forward" for the movement keys.
func cam_forward() -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))


func cam_right() -> Vector3:
	return Vector3(cos(yaw), 0.0, -sin(yaw))


func _unhandled_input(event: InputEvent) -> void:
	if not active or dead:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var mm := event as InputEventMouseMotion
		add_look(mm.relative.x * MOUSE_SENS, mm.relative.y * MOUSE_SENS)
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed("camera_switch"):
		switch_shoulder()
	elif focus != null and event.is_action_pressed(_focus_action()):
		_use_focus()


func _physics_process(delta: float) -> void:
	if dead or not active:
		return
	if cinematic:
		velocity = Vector3.ZERO
		_update_camera(delta)      # the script that took over plays the animations itself (play_clip)
		return
	var kb := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	move_input = kb if kb != Vector2.ZERO else ext_move
	sprint_held = ext_sprint or Input.is_action_pressed("sprint")
	if Input.is_action_just_pressed("jump"):
		press_jump()
	_move(delta)
	_pick_focus()
	_animate()
	_update_camera(delta)


func press_jump() -> void:
	if active and not dead and is_on_floor():
		velocity.y = JUMP_VELOCITY
		_jumping = true


func _move(delta: float) -> void:
	var dir := cam_right() * move_input.x + cam_forward() * -move_input.y
	var mag := minf(dir.length(), 1.0)
	var top := WALK_SPEED
	if mag > 0.6:
		top = JOG_SPEED
	if sprint_held and mag > 0.6:
		top = SPRINT_SPEED
	if aiming:
		top = minf(top, WALK_SPEED)
	var want := Vector3.ZERO
	if mag > 0.01:
		want = dir.normalized() * top * (mag if mag <= 0.6 else 1.0)
	var accel := ACCEL if is_on_floor() else AIR_ACCEL
	var horiz := Vector3(velocity.x, 0.0, velocity.z)
	horiz = horiz.move_toward(want, accel * delta)
	velocity.x = horiz.x
	velocity.z = horiz.z
	if not is_on_floor():
		velocity.y -= _gravity * delta
	elif velocity.y < 0.0:
		velocity.y = 0.0
	move_and_slide()
	if is_on_floor():
		_jumping = false
	if model != null:
		var face := horiz if horiz.length() > 0.25 else Vector3.ZERO
		if aiming:
			face = cam_forward()
		if face != Vector3.ZERO:
			model.rotation.y = lerp_angle(model.rotation.y, atan2(face.x, face.z), 1.0 - exp(-TURN_RATE * delta))


func horizontal_speed() -> float:
	return Vector2(velocity.x, velocity.z).length()


func _animate() -> void:
	if anim == null:
		return
	var sp := horizontal_speed()
	if _jumping and not is_on_floor():
		_play(&"jump")
	elif sp < 0.3:
		_play(&"idle")
	elif sp < JOG_SPEED * 0.75:
		_play(&"walk")
		anim.speed_scale = clampf(sp / WALK_SPEED, 0.6, 1.6)
	else:
		_play(&"run")
		anim.speed_scale = clampf(sp / JOG_SPEED, 0.8, 1.7)


func _play(name: StringName) -> void:
	if anim == null or _state == name:
		return
	_state = name
	if name == &"idle" or name == &"jump":
		anim.speed_scale = 1.0
	anim.play(name, 0.2)


func animation_state() -> StringName:
	return _state


func _update_camera(delta: float) -> void:
	var target := global_position + Vector3(0, EYE_HEIGHT, 0)
	_cam_follow = target if delta <= 0.0 else _cam_follow.lerp(target, 1.0 - exp(-18.0 * delta))
	cam_pivot.global_position = _cam_follow
	cam_pivot.global_basis = Basis.from_euler(Vector3(pitch, yaw, 0.0), EULER_ORDER_YXZ)
	cam_arm.position.x = lerpf(cam_arm.position.x, shoulder_side * SHOULDER, 1.0 if delta <= 0.0 else 1.0 - exp(-10.0 * delta))
	var fov_target := FOV_BASE
	if sprint_held and horizontal_speed() > JOG_SPEED:
		fov_target = FOV_SPRINT
	if aiming:
		fov_target = 52.0
	_fov = fov_target if delta <= 0.0 else lerpf(_fov, fov_target, 1.0 - exp(-7.0 * delta))
	cam.fov = _fov


# ── interactables ─────────────────────────────────────────────────────────────

func _on_use_enter(a: Area3D) -> void:
	if a.has_method("interact") and not _near.has(a):
		_near.append(a)


func _on_use_exit(a: Area3D) -> void:
	_near.erase(a)
	if a == focus:
		_set_focus(null)


## The usable thing to act on: nearest, and in front of the player rather than behind.
func _pick_focus() -> void:
	var best: Node = null
	var best_score := INF
	var fwd := Vector3(sin(model.rotation.y), 0.0, cos(model.rotation.y)) if model != null else cam_forward()
	for n in _near:
		if not is_instance_valid(n) or not (n as Node3D).is_inside_tree():
			continue
		if n.has_method("can_interact") and not n.can_interact(self):
			continue
		var to: Vector3 = (n as Node3D).global_position - global_position
		to.y = 0.0
		var d := to.length()
		var behind := 0.0 if d < 0.8 else maxf(0.0, -fwd.dot(to / d)) * 2.0
		var score := d + behind
		if score < best_score:
			best_score = score
			best = n
	_set_focus(best)


func _set_focus(n: Node) -> void:
	if n != focus:
		focus = n
		focus_changed.emit(n)


func _focus_action() -> StringName:
	return focus.get("key_action") if focus != null and focus.get("key_action") != null else &"interact"


func use_focus() -> bool:
	return _use_focus()


func _use_focus() -> bool:
	if focus == null or not is_instance_valid(focus):
		return false
	focus.interact(self)
	return true
