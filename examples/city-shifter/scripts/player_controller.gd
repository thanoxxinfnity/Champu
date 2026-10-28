class_name PlayerController
extends CharacterBody3D
## One survivor on the train roof. The local player reads the touch HUD (left stick = move relative to the camera, right-side drag = look, JUMP/JET = jump,
## then hold in the air for the jetpack, tap again in the air for an air dash); a remote player is only an avatar that follows the snapshots the other
## phone sends, drawn ~160 ms in the past between two of them so 200 ms of ping looks smooth.
## The game is non-lethal: a fall or a spent stability bar puts you back on the last safe roof.

signal hurt(amount: float)
signal respawned(reason: String)
signal fuel_empty
signal died(killer: PlayerController)

const CAM_DIST := 4.2

var game: Node
var world: Node                          # TrainWorld or OpenWorld
var mount: Mount                         # what I sit on (a vehicle or a horse), or null
var _look_idle := 0.0
var _mount_seen := -1                    # remote players: the mount id of the last snapshot
var spawner: OptimizedSkySpawner
var char_id := "outlaw"
var info: Dictionary = {}
var peer_id := 1
var team := 0                            # team index (in solo every player is its own team)
var display_name := ""
var is_bot := false                      # simulated here by a BotBrain (no camera, no touch)
var lethal := false                      # the match: hp 0 is a death (the train run stays non-lethal)
var alive := true
var kills := 0
var deaths := 0
var shield := 0.0                        # seconds of spawn protection
var slow_t := 0.0                        # seconds of CHRONO/TETHER slowdown
var last_hit_by: PlayerController
var nametag: Label3D
var is_local := true
var avatar: Avatar
var tool: GauntletTool
var cam: Camera3D
var pivot: Node3D
var arm: SpringArm3D
var yaw := 0.0
var pitch := -0.18
var move_input := Vector2.ZERO          # x right, y forward (stick up = +1)
var assist_level := 2                    # aim assist, like Free Fire's default: 0 off, 1 low, 2 full lock-on (Settings)
var lock_target: PlayerController        # the enemy the assist is holding right now
var _lock_marker: Sprite3D
var _lock_scan := 0.0
var look_delta := Vector2.ZERO          # radians this frame (set by the HUD)
var jet_held := false
var jet := JetpackSystem.new()           # fuel tank and heat gauge
var fuel: float:
	get:
		return jet.fuel
	set(v):
		jet.fuel = v
var max_fuel: float:
	get:
		return jet.max_fuel
	set(v):
		jet.max_fuel = v
var hp := 100.0
var max_hp := 100.0
var speed_mult := 1.0
var stun := 0.0
var _since_hit := 99.0
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


func setup(g: Node, w: Node, sp: OptimizedSkySpawner, id: String, pid := 1, local := true) -> void:
	game = g
	world = w
	spawner = sp
	char_id = id
	peer_id = pid
	is_local = local
	info = Data.CAST.get(id, Data.CAST["outlaw"])
	if local and not is_bot and g != null and g.get("save") is Dictionary:
		info = Data.effective(id, g.get("save"))                # my own skill levels (other phones only draw me)
	max_hp = float(info.hp)
	hp = max_hp
	max_fuel = float(info.fuel) * float(info.get("fuel_mult", 1.0))
	fuel = max_fuel
	jet.cool_mult = float(info.get("cool_mult", 1.0))
	name = "Player%d" % pid
	collision_layer = 4 if local else 0
	add_to_group("actors")
	if display_name == "":
		display_name = String(info.get("short", info.name))
	collision_mask = 1
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.36
	cap.height = 1.75
	cs.shape = cap
	cs.position.y = 0.88
	add_child(cs)
	avatar = Avatar.new()
	avatar.outline = local and not is_bot
	add_child(avatar)
	avatar.setup(id)
	floor_snap_length = 0.3
	floor_max_angle = deg_to_rad(50.0)
	if local and not is_bot:
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
		cam.far = 260.0 if not (game != null and game.get("mode") == "world") else Data.VIEW_RADIUS * 2.4
		cam.h_offset = 0.5
		cam.v_offset = 0.15
		arm.add_child(cam)
		cam.make_current()
	tool = GauntletTool.new()
	tool.player = self
	add_child(tool)
	if not (local and not is_bot):
		nametag = Label3D.new()
		nametag.text = display_name
		nametag.font_size = 48
		nametag.pixel_size = 0.0075
		nametag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		nametag.no_depth_test = true
		nametag.render_priority = 5
		nametag.outline_size = 12
		nametag.position = Vector3(0, info.height + 0.55, 0)
		nametag.visibility_range_end = 60.0
		add_child(nametag)
	set_physics_process(true)


func respawn_at(pos: Vector3, reason := "") -> void:
	global_position = pos
	velocity = Vector3.ZERO
	stun = 0.0
	if reason != "":
		respawned.emit(reason)


# ── per frame ────────────────────────────────────────────────────────────────

## Enemies are easy to pick out: their name is red with a dark outline, team mates' blue.
func _tint_tag() -> void:
	if nametag == null or game == null:
		return
	var me = game.get("player")
	var foe: bool = me != null and me != self and me.team != team
	nametag.modulate = Color(1.0, 0.32, 0.3) if foe else Color(0.45, 0.8, 1.0)
	nametag.outline_modulate = Color(0.15, 0.0, 0.0) if foe else Color(0.0, 0.08, 0.2)


func _physics_process(delta: float) -> void:
	_tint_tag()
	if not is_local:
		_follow_snapshots(delta)
		return
	shield = maxf(0.0, shield - delta)
	slow_t = maxf(0.0, slow_t - delta)
	_since_hit += delta
	if not is_bot and cam != null:
		_update_lock(delta)
	if alive and lethal and _since_hit > 5.0 and hp < max_hp and float(info.get("regen", 0.0)) > 0.0:
		hp = minf(max_hp, hp + float(info.regen) * delta)
	if nametag != null:
		nametag.visible = alive
	avatar.modulate_blink(shield > 0.0)
	if not alive:
		return
	if mount != null:
		_mounted(delta)
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
	if pivot != null:
		pivot.rotation = Vector3(pitch, yaw, 0)
		# camera pull-back while jetting so the whole gap stays in view
		arm.spring_length = lerpf(arm.spring_length, CAM_DIST + (0.8 if _jetting else 0.0), minf(1.0, delta * 3.0))
		cam.fov = lerpf(cam.fov, 70.0 if (_jetting or _dash_t > 0.0) else 64.0, minf(1.0, delta * 4.0))
	var on_floor := is_on_floor()
	# horizontal: camera-relative stick
	var basis_y := Basis(Vector3.UP, yaw)
	var dir := basis_y * Vector3(move_input.x, 0.0, -move_input.y)
	var spd: float = float(info.speed) * speed_mult * (1.0 if stun <= 0.0 else 0.25) * (1.7 if boost_t > 0.0 else 1.0) * (0.55 if slow_t > 0.0 else 1.0)
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
		jet.rest(delta, true)
		velocity.y = maxf(velocity.y, -1.0)
		if (_jump_buffer > 0.0 or jet_held) and stun <= 0.0 and _jet_edge:
			velocity.y = 9.0
			_jump_buffer = 0.0
			_jet_edge = false
			_play("whoosh", -10.0, 1.3)
	else:
		velocity.y -= g * delta
		if global_position.y > 25.0:
			velocity.y = maxf(velocity.y, -32.0)     # skydive: the body falls flat at a steady speed, the stick steers
		if jet_held and stun <= 0.0 and not _jet_edge and jet.burn(delta):
			_jetting = true
			velocity.y = minf(velocity.y + (Data.JET_THRUST) * delta, 8.5)
			if fuel <= 0.0:
				fuel_empty.emit()
		elif _jet_edge and fuel >= 18.0 and not jet.hot:
			# a second press in the air: a dash forward
			_jet_edge = false
			var cost := 18.0 * float(info.get("dash_mult", 1.0))
			fuel -= cost
			_dash_t = 0.22
			velocity.y = maxf(velocity.y, 2.0)
			_play("whoosh", -4.0, 0.8)
	if not on_floor and not _jetting:
		jet.rest(delta, false)
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
	if is_on_floor() and (world is OpenWorld or TrainWorld.over_roof(global_position)):
		_safe_t += delta
		if _safe_t > 0.4 and _roof_is_solid_here():
			last_safe = global_position + Vector3(0, 0.1, 0)
	else:
		_safe_t = 0.0
	if global_position.y < Data.FALL_Y:
		fall_out("fell")


## Sitting on a mount: the mount does the moving (its own input, set by Main), I follow the seat and keep the camera behind it.
func _mounted(delta: float) -> void:
	yaw -= look_delta.x
	pitch = clampf(pitch - look_delta.y, -0.75, 0.4)
	_look_idle = 0.0 if look_delta.length() > 0.0005 else _look_idle + delta
	look_delta = Vector2.ZERO
	if _look_idle > 1.1:
		yaw = lerp_angle(yaw, mount.yaw, minf(1.0, delta * 1.6))
	pivot.rotation = Vector3(pitch, yaw, 0)
	arm.spring_length = lerpf(arm.spring_length, mount.cam_dist, minf(1.0, delta * 3.0))
	cam.fov = lerpf(cam.fov, 64.0 + clampf(absf(mount.speed) / 30.0, 0.0, 1.0) * 14.0, minf(1.0, delta * 3.0))
	global_position = mount.seat_global()
	velocity = Vector3.ZERO
	avatar.rotation.y = mount.yaw
	avatar.ground_speed = absf(mount.speed)
	avatar.airborne = false
	avatar.jetting = false
	avatar.thrust = 0.0
	if global_position.y < Data.FALL_Y:
		leave()


func board(m: Mount) -> void:
	mount = m
	m.occupant = peer_id
	m.is_driven = is_local
	m.skill = float(info.get("ride_mult" if m is Horse else "drive_mult", 1.0)) if is_local else 1.0
	m.clear_snaps()
	velocity = Vector3.ZERO
	avatar.riding = m is Horse
	avatar.visible = m is Horse
	_look_idle = 0.0
	global_position = m.seat_global()


func leave() -> void:
	if mount == null:
		return
	var m := mount
	m.occupant = 0
	m.is_driven = false
	m.skill = 1.0
	m.throttle = 0.0
	m.steer = 0.0
	m.action = false
	var side := Basis(Vector3.UP, m.yaw) * Vector3(2.3 + m.radius * 0.4, 0, 0)
	mount = null
	avatar.riding = false
	avatar.visible = true
	global_position = Vector3(m.global_position.x + side.x, 0.3, m.global_position.z + side.z)
	velocity = Vector3.ZERO
	last_safe = global_position
	if is_local:
		arm.spring_length = CAM_DIST


func _roof_is_solid_here() -> bool:
	return get_floor_normal().y > 0.9


func fall_out(reason: String) -> void:
	hp = maxf(hp, max_hp * 0.5)
	if reason == "fell" and game != null and game.get("hud") != null and is_local and not is_bot:
		game.hud.falls_caught += 1
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


## A weapon or a fall hurts me. In the match (`lethal`) hp 0 is a death; no friendly fire. `from` may be null (a block, the world).
func take_damage(amount: float, from: PlayerController = null, knock := Vector3.ZERO, slow := 0.0) -> void:
	if not alive or shield > 0.0:
		return
	if from != null and from != self and from.team == team and lethal:
		return
	hp -= amount * float(info.get("dmg_taken", 1.0))
	_since_hit = 0.0
	last_hit_by = from if from != null else last_hit_by
	avatar.hurt_t = 0.35
	velocity += knock
	slow_t = maxf(slow_t, slow)
	_play("hurt", -6.0, randf_range(0.9, 1.15))
	hurt.emit(amount)
	if hp <= 0.0 and lethal:
		die(from if from != null else last_hit_by)


func die(killer: PlayerController) -> void:
	if not alive:
		return
	alive = false
	hp = 0.0
	deaths += 1
	if mount != null:
		leave()
	velocity = Vector3.ZERO
	if tool != null and tool.held != null:
		tool.held.visible = false
	# the hero falls first (a captured death), then bursts into petals
	avatar.play_clip("death", 1.1)
	get_tree().create_timer(1.0).timeout.connect(func() -> void:
		if is_instance_valid(self) and not alive:
			avatar.visible = false
			if game != null and game.get("fx") != null:
				game.fx.shards(global_position + Vector3(0, 0.4, 0), Color(1.0, 0.8, 0.9), 10, 4.0))
	if game != null and game.get("fx") != null:
		game.fx.shards(global_position + Vector3(0, 1.0, 0), Color(1.0, 0.8, 0.9), 16, 6.0)
		game.fx.ring(global_position + Vector3(0, 0.2, 0), Color(1.0, 0.5, 0.7), 3.0)
	died.emit(killer)


func revive(pos: Vector3) -> void:
	alive = true
	hp = max_hp
	shield = 3.0
	stun = 0.0
	slow_t = 0.0
	jet.refill()
	global_position = pos
	last_safe = pos
	velocity = Vector3.ZERO
	avatar.clip_left = 0.0
	avatar.visible = true
	if tool != null and tool.held != null:
		tool.held.visible = true


func take_hit(amount: float) -> void:
	hp -= amount * float(info.get("dmg_taken", 1.0))
	avatar.hurt_t = 0.4
	_play("hurt", -4.0, 1.0)
	hurt.emit(amount)
	if hp <= 0.0 and lethal:
		die(null)
	elif hp <= 0.0:
		stun = 1.4
		hp = max_hp * 0.5
		respawn_at(last_safe + Vector3(0, 0.6, 0), "stability")


func _play(name: String, db := 0.0, pitch := 1.0) -> void:
	if game != null and game.get("audio") != null:
		game.audio.play(name, db, pitch)


# ── aiming ───────────────────────────────────────────────────────────────────

func aim_dir() -> Vector3:
	return (Basis.from_euler(Vector3(0, yaw, 0)) * Basis.from_euler(Vector3(pitch, 0, 0))) * Vector3(0, 0, -1)


## The enemy the crosshair is closest to: inside a cone (wider at full assist), in range, alive, on another team and not behind a wall.
func find_lock(reach := 55.0) -> PlayerController:
	if assist_level <= 0 or not is_local or is_bot or not alive:
		return null
	var half := deg_to_rad(34.0 if assist_level >= 2 else 14.0)
	var dir := aim_dir()
	var from := eye()
	var best: PlayerController = null
	var best_a := half
	for t in Combat.enemies(self):
		var to := Combat.center(t) - from
		var d := to.length()
		if d < 1.0 or d > reach:
			continue
		var a := dir.angle_to(to / d)
		if d < 8.0:
			a *= 0.5                              # close ones are easy to hold
		if a >= best_a:
			continue
		var q := PhysicsRayQueryParameters3D.create(from, Combat.center(t), 1)
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty() and (hit.position as Vector3).distance_to(Combat.center(t)) > 1.5:
			continue
		best = t
		best_a = a
	return best


## The direction a shot really takes: straight at the locked enemy (full assist), or leaning towards it (low), else where the crosshair points.
func assisted_dir(dir: Vector3) -> Vector3:
	var t := find_lock()
	if t == null:
		return dir
	var want := (Combat.center(t) - eye()).normalized()
	var k := 1.0 if assist_level >= 2 else 0.5
	var out := dir.slerp(want, k) if dir.dot(want) < 0.9999 else want
	yaw = lerp_angle(yaw, atan2(-out.x, -out.z), 0.6 * k)     # the hero turns to face the target
	pitch = clampf(lerpf(pitch, asin(clampf(out.y, -1.0, 1.0)), 0.6 * k), -0.75, 0.4)
	return out.normalized()


func _update_lock(delta: float) -> void:
	_lock_scan -= delta
	if _lock_scan > 0.0:
		return
	_lock_scan = 0.1
	lock_target = find_lock() if (game != null and game.get("state") == 2) else null
	if _lock_marker == null:
		_lock_marker = Sprite3D.new()
		var img := Image.create(96, 96, false, Image.FORMAT_RGBA8)
		for y in 96:
			for x in 96:
				var r := Vector2(x - 47.5, y - 47.5).length()
				var a := clampf(1.0 - absf(r - 38.0) / 3.5, 0.0, 1.0)
				var ang := fposmod(atan2(y - 47.5, x - 47.5), TAU)
				if r < 30.0 and (absf(x - 47.5) < 2.0 or absf(y - 47.5) < 2.0) and r > 14.0:
					a = 1.0                       # cross hairs
				img.set_pixel(x, y, Color(1.0, 0.25, 0.3, a))
		_lock_marker.texture = ImageTexture.create_from_image(img)
		_lock_marker.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_lock_marker.fixed_size = true
		_lock_marker.pixel_size = 0.0007
		_lock_marker.no_depth_test = true
		_lock_marker.shaded = false
		_lock_marker.render_priority = 5
		get_tree().root.add_child(_lock_marker)
	_lock_marker.visible = lock_target != null and is_instance_valid(lock_target)
	if _lock_marker.visible:
		_lock_marker.global_position = Combat.center(lock_target)


func _exit_tree() -> void:
	if _lock_marker != null and is_instance_valid(_lock_marker):
		_lock_marker.queue_free()


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
	var out := [global_position, avatar.rotation.y, Vector2(velocity.x, velocity.z).length(), _jetting, not is_on_floor(), hp]
	if mount != null:
		out.append(mount.mount_id)
		out.append(mount.state())
	return out


func push_snapshot(s: Array, clock: float) -> void:
	_net_clock = clock
	_snaps.append([clock, s[0], float(s[1]), float(s[2]), bool(s[3]), bool(s[4])])
	if s.size() > 5:
		hp = float(s[5])
		if lethal and not is_local and not is_bot:
			var up := hp > 0.0                                 # a remote player is dead on my screen while its hp is 0
			if up != alive:
				alive = up
				avatar.visible = up
				if tool != null and tool.held != null:
					tool.held.visible = up
	var mid := int(s[6]) if s.size() > 6 else -1
	if mid != _mount_seen and world != null and world.has_method("get_mount"):
		if mid >= 0:
			var m: Mount = world.get_mount(mid)
			if m != null:
				board(m)
				m.is_driven = false
		elif mount != null:
			leave()
		_mount_seen = mid
	if mid >= 0 and mount != null and s.size() > 7:
		mount.push_state(s[7], clock)
	while _snaps.size() > 12:
		_snaps.pop_front()


func _follow_snapshots(delta: float) -> void:
	_net_clock += delta
	if mount != null:
		global_position = mount.seat_global()
		avatar.rotation.y = mount.yaw
		avatar.ground_speed = absf(mount.speed)
		avatar.airborne = false
		avatar.jetting = false
		avatar.thrust = 0.0
		return
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
