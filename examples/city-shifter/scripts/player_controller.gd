class_name PlayerController
extends CharacterBody3D
## One survivor on the train roof. The local player reads the touch HUD (left stick = move relative to the camera, right-side drag = look, JUMP/JET = jump,
## then hold in the air for the jetpack, tap again in the air for an air dash); a remote player is only an avatar that follows the snapshots the other
## phone sends, drawn ~160 ms in the past between two of them so 200 ms of ping looks smooth.
## The game is non-lethal: a fall or a spent stability bar puts you back on the last safe roof.

signal hurt(amount: float)
signal respawned(reason: String)
signal fuel_empty

const CAM_DIST := 4.2

var game: Node
var world: TrainWorld
var spawner: OptimizedSkySpawner
var char_id := "outlaw"
var info: Dictionary = {}
var peer_id := 1
var is_local := true
var avatar: Avatar
var tool: GauntletTool
var cam: Camera3D
var pivot: Node3D
var arm: SpringArm3D
var yaw := 0.0
var pitch := -0.18
var move_input := Vector2.ZERO          # x right, y forward (stick up = +1)
var look_delta := Vector2.ZERO          # radians this frame (set by the HUD)
var jet_held := false
var fuel := Data.JET_FUEL
var max_fuel := Data.JET_FUEL
var hp := 100.0
var max_hp := 100.0
var speed_mult := 1.0
var stun := 0.0
var coins := 0
var last_safe := Vector3(0, Data.DECK_Y + 0.2, -6)
var boost_t := 0.0
var _safe_t := 0.0
var _jet_edge := false
var _jump_buffer := 0.0
var _was_floor := false
var _dash_t := 0.0
var _jetting := false
var _hit_cd := 0.0
# remote smoothing
var _snaps: Array = []                   # [time, pos, yaw, speed, jet, air]
var _net_clock := 0.0
const INTERP_DELAY := 0.16


func setup(g: Node, w: TrainWorld, sp: OptimizedSkySpawner, id: String, pid := 1, local := true) -> void:
	game = g
	world = w
	spawner = sp
	char_id = id
	peer_id = pid
	is_local = local
	info = Data.CAST.get(id, Data.CAST["outlaw"])
	max_hp = float(info.hp)
	hp = max_hp
	max_fuel = float(info.fuel) * float(info.get("fuel_mult", 1.0))
	fuel = max_fuel
	name = "Player%d" % pid
	collision_layer = 4 if local else 0
	collision_mask = 1
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.36
	cap.height = 1.75
	cs.shape = cap
	cs.position.y = 0.88
	add_child(cs)
	avatar = Avatar.new()
	add_child(avatar)
	avatar.setup(id)
	floor_snap_length = 0.3
	floor_max_angle = deg_to_rad(50.0)
	if local:
		pivot = Node3D.new()
		pivot.position.y = 1.55
		add_child(pivot)
		arm = SpringArm3D.new()
		arm.spring_length = CAM_DIST
		arm.margin = 0.25
		arm.collision_mask = 1
		arm.shape = null
		pivot.add_child(arm)
		cam = Camera3D.new()
		cam.fov = 64.0
		cam.near = 0.1
		cam.far = 260.0
		cam.h_offset = 0.5
		cam.v_offset = 0.15
		arm.add_child(cam)
		cam.make_current()
	tool = GauntletTool.new()
	tool.player = self
	add_child(tool)
	set_physics_process(true)


func respawn_at(pos: Vector3, reason := "") -> void:
	global_position = pos
	velocity = Vector3.ZERO
	stun = 0.0
	if reason != "":
		respawned.emit(reason)


# ── per frame ────────────────────────────────────────────────────────────────

func _physics_process(delta: float) -> void:
	if not is_local:
		_follow_snapshots(delta)
		return
	_hit_cd = maxf(0.0, _hit_cd - delta)
	stun = maxf(0.0, stun - delta)
	boost_t = maxf(0.0, boost_t - delta)
	_dash_t = maxf(0.0, _dash_t - delta)
	_jump_buffer = maxf(0.0, _jump_buffer - delta)
	# look
	yaw -= look_delta.x
	pitch = clampf(pitch - look_delta.y, -0.75, 0.4)
	look_delta = Vector2.ZERO
	pivot.rotation = Vector3(pitch, yaw, 0)
	# camera pull-back while jetting so the whole gap stays in view
	arm.spring_length = lerpf(arm.spring_length, CAM_DIST + (0.8 if _jetting else 0.0), minf(1.0, delta * 3.0))
	cam.fov = lerpf(cam.fov, 70.0 if (_jetting or _dash_t > 0.0) else 64.0, minf(1.0, delta * 4.0))
	var on_floor := is_on_floor()
	# horizontal: camera-relative stick
	var basis_y := Basis(Vector3.UP, yaw)
	var dir := basis_y * Vector3(move_input.x, 0.0, -move_input.y)
	var spd: float = float(info.speed) * speed_mult * (1.0 if stun <= 0.0 else 0.25) * (1.7 if boost_t > 0.0 else 1.0)
	var accel := 38.0 if on_floor else 14.0
	var target := dir * spd
	if _dash_t > 0.0:
		target = -basis_y.z * 16.0
		accel = 80.0
	velocity.x = move_toward(velocity.x, target.x, accel * delta)
	velocity.z = move_toward(velocity.z, target.z, accel * delta)
	# vertical: gravity, jump, jetpack
	var g := float(ProjectSettings.get_setting("physics/3d/default_gravity"))
	_jetting = false
	if on_floor:
		if not _was_floor:
			_on_land()
		fuel = minf(max_fuel, fuel + 30.0 * delta)
		velocity.y = maxf(velocity.y, -1.0)
		if (_jump_buffer > 0.0 or jet_held) and stun <= 0.0 and _jet_edge:
			velocity.y = 9.0
			_jump_buffer = 0.0
			_jet_edge = false
			_play("whoosh", -10.0, 1.3)
	else:
		velocity.y -= g * delta
		if jet_held and fuel > 0.0 and stun <= 0.0 and not _jet_edge:
			_jetting = true
			velocity.y = minf(velocity.y + (Data.JET_THRUST) * delta, 8.5)
			fuel = maxf(0.0, fuel - 26.0 * delta)
			if fuel <= 0.0:
				fuel_empty.emit()
		elif _jet_edge and fuel >= 18.0:
			# a second press in the air: a dash forward
			_jet_edge = false
			var cost := 18.0 * float(info.get("dash_mult", 1.0))
			fuel -= cost
			_dash_t = 0.22
			velocity.y = maxf(velocity.y, 2.0)
			_play("whoosh", -4.0, 0.8)
	if on_floor and jet_held and _jet_edge:
		_jet_edge = false
	_was_floor = on_floor
	# face where you go (or where you aim while the weapon fires)
	var flat := Vector2(velocity.x, velocity.z)
	if flat.length() > 0.8:
		var want := atan2(-velocity.x, -velocity.z)
		avatar.rotation.y = lerp_angle(avatar.rotation.y, want, minf(1.0, delta * 12.0))
	if tool != null and tool.firing_t > 0.0:
		avatar.rotation.y = lerp_angle(avatar.rotation.y, yaw, minf(1.0, delta * 20.0))
	move_and_slide()
	_check_blocks()
	_check_debris()
	# the avatar
	avatar.ground_speed = flat.length() if on_floor else flat.length()
	avatar.airborne = not is_on_floor()
	avatar.jetting = _jetting
	avatar.thrust = 1.0 if _jetting else (0.5 if _dash_t > 0.0 else 0.0)
	# safe spot + falling out
	if is_on_floor() and TrainWorld.over_roof(global_position):
		_safe_t += delta
		if _safe_t > 0.4 and _roof_is_solid_here():
			last_safe = global_position + Vector3(0, 0.1, 0)
	else:
		_safe_t = 0.0
	if global_position.y < Data.FALL_Y:
		fall_out("fell")


func _roof_is_solid_here() -> bool:
	return get_floor_normal().y > 0.9


func fall_out(reason: String) -> void:
	hp = maxf(hp, max_hp * 0.5)
	respawn_at(last_safe + Vector3(0, 0.6, 0), reason)


func _on_land() -> void:
	if velocity.y < -14.0:
		game.fx.shards(global_position, Color(0.8, 0.85, 1.0), 6, 3.0)
		_play("place", -8.0, 0.8)


func press_jump() -> void:
	_jump_buffer = 0.14
	_jet_edge = true


func _check_blocks() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var col := c.get_collider()
		if col != null and col.has_meta("block") and c.get_normal().y > 0.5:
			var kind := String(col.get_meta("block"))
			if kind == "bounce" and velocity.y < 11.0:
				velocity.y = 15.0
				_play("zap_low", -6.0, 1.4)
				game.fx.ring(global_position, Color(0.2, 0.95, 0.55), 1.8)
			elif kind == "boost":
				boost_t = 1.4


func _check_debris() -> void:
	if spawner == null or _hit_cd > 0.0 or stun > 0.0:
		return
	for d in spawner.hits_on(global_position, 0.5):
		_hit_cd = 0.5
		var away := (global_position + Vector3(0, 0.9, 0) - d.global_position)
		away.y = 0.3
		velocity += away.normalized() * 7.0 + Vector3(0, 3.0, 0)
		take_hit(5.0 + d.size * 5.0)
		break


func take_hit(amount: float) -> void:
	hp -= amount * float(info.get("dmg_taken", 1.0))
	avatar.hurt_t = 0.4
	_play("hurt", -4.0, 1.0)
	hurt.emit(amount)
	if hp <= 0.0:
		stun = 1.4
		hp = max_hp * 0.5
		respawn_at(last_safe + Vector3(0, 0.6, 0), "stability")


func _play(name: String, db := 0.0, pitch := 1.0) -> void:
	if game != null and game.get("audio") != null:
		game.audio.play(name, db, pitch)


# ── aiming ───────────────────────────────────────────────────────────────────

func aim_dir() -> Vector3:
	return (Basis.from_euler(Vector3(0, yaw, 0)) * Basis.from_euler(Vector3(pitch, 0, 0))) * Vector3(0, 0, -1)


func flat_forward() -> Vector3:
	return Vector3(-sin(yaw), 0.0, -cos(yaw))


func eye() -> Vector3:
	return global_position + Vector3(0, 1.45, 0)


## The point the crosshair is on: a world hit within `max_range`, else the end of the ray.
func aim_point(max_range: float) -> Vector3:
	var from := cam.global_position if cam != null else eye()
	var dir := aim_dir()
	var to := from + dir * (max_range + (CAM_DIST if cam != null else 0.0))
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to, 1)
	var hit := space.intersect_ray(q)
	return hit.position if not hit.is_empty() else to


# ── network ──────────────────────────────────────────────────────────────────

func snapshot() -> Array:
	return [global_position, avatar.rotation.y, Vector2(velocity.x, velocity.z).length(), _jetting, not is_on_floor(), hp]


func push_snapshot(s: Array, clock: float) -> void:
	_net_clock = clock
	_snaps.append([clock, s[0], float(s[1]), float(s[2]), bool(s[3]), bool(s[4])])
	if s.size() > 5:
		hp = float(s[5])
	while _snaps.size() > 12:
		_snaps.pop_front()


func _follow_snapshots(delta: float) -> void:
	_net_clock += delta
	if _snaps.is_empty():
		return
	var t := _net_clock - INTERP_DELAY
	var a: Array = _snaps[0]
	var b: Array = _snaps[_snaps.size() - 1]
	for i in range(_snaps.size() - 1):
		if _snaps[i][0] <= t and _snaps[i + 1][0] >= t:
			a = _snaps[i]
			b = _snaps[i + 1]
			break
	var k := 1.0
	if b[0] > a[0]:
		k = clampf((t - float(a[0])) / (float(b[0]) - float(a[0])), 0.0, 1.0) if t <= float(b[0]) else 1.0
	var pos: Vector3 = (a[1] as Vector3).lerp(b[1] as Vector3, k)
	if t > float(b[0]):
		# no newer data yet: carry on in the last direction for a moment (never more than 0.3 s)
		var ahead := minf(t - float(b[0]), 0.3)
		var f := Vector3(-sin(float(b[2])), 0, -cos(float(b[2])))
		pos = (b[1] as Vector3) + f * float(b[3]) * ahead
	global_position = global_position.lerp(pos, minf(1.0, delta * 18.0))
	avatar.rotation.y = lerp_angle(avatar.rotation.y, lerp_angle(float(a[2]), float(b[2]), k), minf(1.0, delta * 14.0))
	avatar.ground_speed = float(b[3])
	avatar.jetting = bool(b[4])
	avatar.airborne = bool(b[5])
	avatar.thrust = 1.0 if bool(b[4]) else 0.0
