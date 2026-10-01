class_name Player
extends CharacterBody3D
## Rohan: third-person, over the shoulder. Moves with the left stick, looks with
## the right thumb, shoots whatever is under the crosshair — with a little pull
## towards the nearest ghoul so a thumb on glass is as accurate as a mouse.

signal died
signal hurt(amount: float)
signal weapon_changed
signal reloaded

const WALK := 3.6
const RUN := 5.8
const EYE := 1.55

var game: Game
var hp := 100.0
var max_hp := 100.0
var dead := false
var weapons := {}                # name -> {"mag": int, "reserve": int}
var owned: Array[String] = []
var cur := "pistol"
var move_input := Vector2.ZERO   # x = right, y = back (like Input.get_vector)
var fire_held := false
var sprint := false
var yaw := 0.0
var pitch := -0.12
var flashlight_on := true
var reloading := 0.0
var kills := 0

var pivot: Node3D
var arm: SpringArm3D
var cam: Camera3D
var torch: SpotLight3D
var body: Node3D
var hand: Node3D
var muzzle: Marker3D
var _gun: Node3D
var _cd := 0.0
var _aim_hold := 0.0
var _body_yaw := 0.0
var _phase := 0.0
var _step_t := 0.0
var _mats: Array = []
var _shake := 0.0
var _kick := 0.0
var _hand_rest := Vector3(0.24, 1.12, -0.42)
var _flash := 0.0


func _ready() -> void:
	collision_layer = Data.L_PLAYER
	collision_mask = Data.L_WORLD | Data.L_ENEMY
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.34
	cap.height = 1.75
	cs.shape = cap
	cs.position.y = 0.875
	add_child(cs)

	body = Node3D.new()
	add_child(body)
	var model := Assets.make("player", 1.8, false, true, Color.WHITE)
	body.add_child(model)
	_mats = model.get_meta("puppet_mats", [])

	hand = Node3D.new()
	hand.position = _hand_rest
	body.add_child(hand)
	muzzle = Marker3D.new()
	hand.add_child(muzzle)

	pivot = Node3D.new()
	pivot.position.y = EYE
	add_child(pivot)
	arm = SpringArm3D.new()
	arm.spring_length = 3.1
	arm.margin = 0.3
	arm.collision_mask = Data.L_WORLD
	arm.shape = null
	pivot.add_child(arm)
	cam = Camera3D.new()
	cam.fov = 68.0
	cam.near = 0.08
	cam.far = 260.0
	cam.h_offset = 0.62
	cam.v_offset = 0.1
	arm.add_child(cam)
	cam.make_current()

	torch = SpotLight3D.new()
	torch.spot_range = 34.0
	torch.spot_angle = 30.0
	torch.spot_angle_attenuation = 0.8
	torch.light_energy = 4.5
	torch.light_color = Color(1.0, 0.93, 0.78)
	# Real-time shadows from the torch look great and cost a lot on a phone GPU.
	torch.shadow_enabled = not OS.has_feature("mobile")
	torch.position = Vector3(0.25, -0.1, -0.2)
	cam.add_child(torch)

	var near := OmniLight3D.new()
	near.light_energy = 0.35
	near.omni_range = 5.0
	near.light_color = Color(0.7, 0.8, 1.0)
	near.position.y = 1.6
	add_child(near)

	_equip_visual()


func give_weapon(name: String, with_ammo := true) -> void:
	if weapons.has(name):
		var d: Dictionary = Data.WEAPONS[name]
		weapons[name].reserve += int(d.reserve * 0.5)
		return
	var d2: Dictionary = Data.WEAPONS[name]
	weapons[name] = {"mag": int(d2.mag), "reserve": int(d2.reserve) if with_ammo else 0}
	owned.append(name)
	equip(name)


func equip(name: String) -> void:
	if not weapons.has(name) or name == cur and _gun != null:
		return
	cur = name
	reloading = 0.0
	_cd = 0.25
	_equip_visual()
	game.sfx.play("swap", -4.0)
	weapon_changed.emit()


func cycle_weapon(dir := 1) -> void:
	if owned.size() < 2:
		return
	var i := owned.find(cur)
	equip(owned[(i + dir + owned.size()) % owned.size()])


func _equip_visual() -> void:
	if _gun != null:
		_gun.queue_free()
	if not weapons.has(cur):
		return
	var d: Dictionary = Data.WEAPONS[cur]
	_gun = Assets.make(d.model, float(d.len), true)
	hand.add_child(_gun)
	# The model is centred on its footprint; lift it so the grip sits in the hand.
	_gun.position.y = -0.04
	muzzle.position = Vector3(0, 0.02, -float(d.len) * 0.5)


func ammo() -> Dictionary:
	return weapons.get(cur, {"mag": 0, "reserve": 0})


func add_ammo(amount_frac := 0.5) -> void:
	for n in owned:
		var d: Dictionary = Data.WEAPONS[n]
		weapons[n].reserve = mini(int(weapons[n].reserve + d.mag * 1.5 * amount_frac * 2.0), int(d.reserve) * 3)


func heal(amount: float) -> void:
	hp = minf(max_hp, hp + amount)


func reload() -> void:
	if reloading > 0.0 or not weapons.has(cur):
		return
	var w: Dictionary = weapons[cur]
	var d: Dictionary = Data.WEAPONS[cur]
	if w.mag >= d.mag or w.reserve <= 0:
		return
	reloading = float(d.reload)
	game.sfx.play("reload", -2.0)


func toggle_torch() -> void:
	flashlight_on = not flashlight_on
	torch.visible = flashlight_on
	game.sfx.play("swap", -8.0, 0.7)


func take_damage(amount: float, from: Vector3) -> void:
	if dead:
		return
	hp -= amount
	_shake = minf(1.0, _shake + amount / 25.0)
	hurt.emit(amount)
	game.sfx.play("hurt", -2.0)
	game.fx.blood(global_position + Vector3(0, 1.3, 0), (from - global_position).normalized(), false)
	if hp <= 0.0:
		hp = 0.0
		dead = true
		died.emit()


## Yaw the camera should have looked to point at `world_pos` — used by cutscenes
## and by the test harness to aim without a finger.
func look_at_point(world_pos: Vector3) -> void:
	var d := world_pos - global_position
	yaw = atan2(-d.x, -d.z)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		look((event as InputEventMouseMotion).relative * 0.0026)


func look(delta: Vector2) -> void:
	yaw -= delta.x
	pitch = clampf(pitch - delta.y, -1.1, 0.7)


func _physics_process(delta: float) -> void:
	if dead:
		velocity = Vector3(0, velocity.y - 19.0 * delta, 0)
		move_and_slide()
		_update_camera(delta)
		return
	_cd = maxf(0.0, _cd - delta)
	if reloading > 0.0:
		reloading -= delta
		if reloading <= 0.0:
			var w: Dictionary = weapons[cur]
			var d: Dictionary = Data.WEAPONS[cur]
			var need: int = int(d.mag) - int(w.mag)
			var take: int = mini(need, int(w.reserve))
			w.mag += take
			w.reserve -= take
			reloaded.emit()

	# Move relative to where the camera looks.
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var wish := (right * move_input.x + fwd * -move_input.y)
	var mag := minf(1.0, wish.length())
	var speed := RUN if sprint and mag > 0.6 else WALK
	if _aim_hold > 0.0:
		speed *= 0.8
	var target := wish.normalized() * speed * mag if mag > 0.05 else Vector3.ZERO
	velocity.x = move_toward(velocity.x, target.x, 28.0 * delta)
	velocity.z = move_toward(velocity.z, target.z, 28.0 * delta)
	velocity.y = velocity.y - 19.0 * delta if not is_on_floor() else -0.5
	move_and_slide()

	# Fire.
	_aim_hold = maxf(0.0, _aim_hold - delta)
	if fire_held:
		_try_fire()

	# Body turns to the aim while shooting, to the stride otherwise.
	var planar := Vector2(velocity.x, velocity.z)
	var want := _body_yaw
	if _aim_hold > 0.0:
		want = yaw
	elif planar.length() > 0.4:
		want = atan2(-velocity.x, -velocity.z)
	_body_yaw = lerp_angle(_body_yaw, want, minf(1.0, delta * 12.0))
	body.rotation.y = _body_yaw

	# Walk cycle and footsteps.
	var sp := planar.length() / RUN
	_phase += planar.length() * delta * 2.4
	for m in _mats:
		var sm := m as ShaderMaterial
		sm.set_shader_parameter("phase", _phase)
		sm.set_shader_parameter("speed", clampf(sp * 1.3, 0.0, 1.0))
		sm.set_shader_parameter("arms_up", 0.0)
		sm.set_shader_parameter("flash", _flash)
	_flash = maxf(0.0, _flash - delta * 4.0)
	_step_t += planar.length() * delta
	if _step_t > 2.2:
		_step_t = 0.0
		game.sfx.play("step", -14.0, randf_range(0.85, 1.1))

	# Gun recoil settles back.
	_kick = move_toward(_kick, 0.0, delta * 0.5)
	hand.position = _hand_rest + Vector3(0, 0, _kick)
	game.hud.set_heart(hp / max_hp)
	_update_camera(delta)


func _update_camera(delta: float) -> void:
	pivot.rotation = Vector3(pitch, yaw, 0)
	_shake = maxf(0.0, _shake - delta * 2.5)
	cam.rotation = Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * 0.025
	# Sprinting opens the lens a touch.
	cam.fov = lerpf(cam.fov, 74.0 if sprint and Vector2(velocity.x, velocity.z).length() > 4.5 else 68.0, minf(1.0, delta * 5.0))


## Where the crosshair is pointing: the aim ray's first hit.
func aim_point(max_range: float) -> Dictionary:
	var origin := cam.global_position
	var dir := -cam.global_transform.basis.z
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * max_range, Data.L_WORLD | Data.L_ENEMY, [get_rid()])
	var hit := space.intersect_ray(q)
	return {"origin": origin, "dir": dir, "hit": hit, "point": hit.position if not hit.is_empty() else origin + dir * max_range}


## The living ghoul closest to the crosshair, if one is inside the assist cone.
func assist_target(max_range: float, cone_deg: float) -> Node3D:
	var origin := cam.global_position
	var dir := -cam.global_transform.basis.z
	var best: Node3D = null
	var best_ang := deg_to_rad(cone_deg)
	for e in get_tree().get_nodes_in_group("enemies"):
		var z := e as Zombie
		if z == null or z.dead:
			continue
		var to := z.chest() - origin
		var dist := to.length()
		if dist > max_range or dist < 1.0:
			continue
		var ang := dir.angle_to(to)
		if ang < best_ang:
			best_ang = ang
			best = z
	return best


func _try_fire() -> void:
	if _cd > 0.0 or reloading > 0.0 or not weapons.has(cur):
		return
	var w: Dictionary = weapons[cur]
	var d: Dictionary = Data.WEAPONS[cur]
	if w.mag <= 0:
		_cd = 0.3
		if w.reserve > 0:
			reload()
		else:
			game.sfx.play("empty", -4.0)
		return
	w.mag -= 1
	_cd = float(d.rate)
	_aim_hold = 0.6
	# A thumb on glass cannot tap fast enough, so on touch every gun fires while held.
	if not d.auto and not game.is_touch:
		fire_held = false

	var rng := float(d.range)
	var aim := aim_point(rng)
	var target_point: Vector3 = aim.point
	var tgt := assist_target(rng, 9.0 if d.pellets == 1 else 14.0)
	if tgt != null:
		target_point = (tgt as Zombie).chest()
	var from := muzzle.global_position
	var base_dir := (target_point - from).normalized()
	var space := get_world_3d().direct_space_state

	game.fx.muzzle(from + base_dir * 0.2, 1.0 if d.pellets == 1 else 1.4)
	game.sfx.play(d.sfx, 0.0, randf_range(0.96, 1.04))
	game.noise(global_position, 55.0 if d.sfx != "pistol" else 38.0)
	_kick = float(d.kick) * 6.0
	pitch = minf(0.7, pitch + float(d.kick) * 0.7)
	yaw += randf_range(-1, 1) * float(d.kick) * 0.25

	for i in range(int(d.pellets)):
		var spread := deg_to_rad(float(d.spread))
		var dir := base_dir
		dir = dir.rotated(Vector3.UP, randf_range(-1, 1) * spread * 0.5)
		dir = dir.rotated(dir.cross(Vector3.UP).normalized() if absf(dir.y) < 0.99 else Vector3.RIGHT, randf_range(-1, 1) * spread * 0.5)
		var q := PhysicsRayQueryParameters3D.create(from, from + dir * rng, Data.L_WORLD | Data.L_ENEMY, [get_rid()])
		var hit := space.intersect_ray(q)
		var end: Vector3 = hit.position if not hit.is_empty() else from + dir * rng
		if i < 3 or d.pellets == 1:
			game.fx.tracer(from, end)
		if hit.is_empty():
			continue
		var col := hit.collider as Object
		if col is Zombie:
			var z := col as Zombie
			var head: bool = hit.position.y > z.global_position.y + z.height * 0.82
			var dmg := float(d.dmg) * (2.4 if head else 1.0)
			z.take_damage(dmg, hit.position, dir, head)
			_flash = 0.0
		else:
			game.fx.spark(hit.position, hit.normal)
	game.hud.pulse_crosshair()
