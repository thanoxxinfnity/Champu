class_name Player
extends CharacterBody3D
## The playable survivor: third-person over-the-shoulder camera, stick movement, stamina-fed sprint and dodge roll, crowbar combo with
## a pull toward the nearest enemy, a pistol with aim assist, thrown flares, bandages. The model is whichever cast member the lobby chose.

signal died
signal hurt(amount: float)

const GRAVITY := 19.0

var game: Game
var char_id := "rachel"
var info: Dictionary
var hp := 100.0
var max_hp := 100.0
var stamina := 100.0
var max_stamina := 100.0
var dead := false
var move_input := Vector2.ZERO     # x = right, y = back (like Input.get_vector)
var sprint := false
var yaw := 0.0
var pitch := -0.16
var inventory := {}
var has_crowbar := false
var has_pistol := false
var mag := 0
var torch_on := true
var kills := 0

var view: CharacterView
var pivot: Node3D
var arm: SpringArm3D
var cam: Camera3D
var torch: SpotLight3D
var iframes := 0.0
var _body_yaw := 0.0
var _atk := 0                      # 0 idle, 1 wind-up, 2 strike, 3 recover
var _atk_t := 0.0
var _atk_cd := 0.0
var _combo := 0
var _atk_dir := Vector3.ZERO
var _stam_wait := 0.0
var _roll_t := 0.0
var _roll_dir := Vector3.ZERO
var _slow_t := 0.0
var _hurt_t := 0.0
var _throw_t := 0.0
var _aim_hold := 0.0
var _shoot_cd := 0.0
var _reload_t := 0.0
var _step_t := 0.0
var _shake := 0.0
var _hit_done := false


func setup(g: Game, id: String) -> void:
	game = g
	char_id = id
	info = Data.CAST[id]
	max_hp = float(info.hp)
	hp = max_hp
	max_stamina = float(info.stamina)
	stamina = max_stamina


func _ready() -> void:
	collision_layer = Data.L_PLAYER
	collision_mask = Data.L_WORLD | Data.L_ENEMY
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = 1.5
	cs.shape = cap
	cs.position.y = 0.78
	add_child(cs)
	view = CharacterView.new()
	add_child(view)
	view.setup(char_id)
	for n in view.find_children("*", "MeshInstance3D", true, false):
		(n as MeshInstance3D).layers = 2   # visible to the camera, but the torch (cull mask 1) does not light the player
	pivot = Node3D.new()
	pivot.position.y = 1.45
	add_child(pivot)
	arm = SpringArm3D.new()
	arm.spring_length = 3.3
	arm.margin = 0.3
	arm.collision_mask = Data.L_WORLD
	arm.shape = null
	pivot.add_child(arm)
	cam = Camera3D.new()
	cam.fov = 66.0
	cam.near = 0.08
	cam.far = 220.0
	cam.h_offset = 0.55
	cam.v_offset = 0.12
	arm.add_child(cam)
	cam.make_current()
	torch = SpotLight3D.new()
	torch.spot_range = 22.0
	torch.spot_angle = 26.0
	torch.spot_angle_attenuation = 0.8
	torch.light_energy = 1.3
	torch.light_color = Color(1.0, 0.92, 0.82)
	torch.shadow_enabled = false
	torch.light_cull_mask = 1
	torch.position = Vector3(0.25, -0.1, -1.2)
	cam.add_child(torch)
	var near := OmniLight3D.new()
	near.light_energy = 0.22
	near.omni_range = 4.0
	near.light_color = Color(0.85, 0.7, 1.0)
	near.position.y = 1.7
	near.shadow_enabled = false
	add_child(near)
	var shadow := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(0.9, 0.9)
	shadow.mesh = pm
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(0, 0, 0, 0.4)
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	shadow.material_override = sm
	shadow.position.y = 0.03
	shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(shadow)


# ── inventory ────────────────────────────────────────────────────────────────

func stack_cap() -> int:
	return int(info.carry)


func count(item: String) -> int:
	return int(inventory.get(item, 0))


## Adds up to the stack cap; returns how many were actually taken.
func add_item(item: String, n := 1) -> int:
	var have := count(item)
	var cap := stack_cap() if item != "ammo" else 60
	var take := mini(n, cap - have)
	if take > 0:
		inventory[item] = have + take
	return take


func spend(item: String, n := 1) -> bool:
	if count(item) < n:
		return false
	inventory[item] = count(item) - n
	return true


func can_afford(needs: Dictionary) -> bool:
	for k in needs:
		if count(k) < int(needs[k]):
			return false
	return true


func craft(recipe: String) -> bool:
	var r: Dictionary = Data.RECIPES[recipe]
	var needs: Dictionary = r.needs.duplicate()
	if char_id == "rina" and recipe != "bandage" and needs.has("scrap"):
		needs["scrap"] = maxi(1, int(needs["scrap"]) - 1)
	if not can_afford(needs):
		return false
	for k in needs:
		spend(k, int(needs[k]))
	if recipe == "crowbar_plus":
		has_crowbar = true
		inventory["crowbar_plus"] = 1
	else:
		add_item(recipe, int(r.makes))
	return true


func weapon_name() -> String:
	if count("crowbar_plus") > 0:
		return "crowbar_plus"
	return "crowbar" if has_crowbar else ""


func heal(amount: float) -> void:
	hp = minf(max_hp, hp + amount)


func use_bandage() -> bool:
	if dead or hp >= max_hp - 1.0 or count("bandage") <= 0:
		return false
	spend("bandage")
	heal(35.0 * (1.5 if char_id == "rachel" else 1.0))
	game.sfx.play("pickup", -2.0, 0.8)
	game.hud.toast("BANDAGE USED")
	return true


# ── camera ───────────────────────────────────────────────────────────────────

func look(delta: Vector2) -> void:
	yaw -= delta.x
	pitch = clampf(pitch - delta.y, -1.0, 0.6)


func look_at_point(p: Vector3) -> void:
	var d := p - global_position
	yaw = atan2(-d.x, -d.z)


func shake(a: float) -> void:
	_shake = minf(1.0, _shake + a)


func camera_forward() -> Vector3:
	return -cam.global_transform.basis.z


# ── actions ──────────────────────────────────────────────────────────────────

func facing() -> Vector3:
	return Vector3(-sin(_body_yaw), 0, -cos(_body_yaw))


func nearest_enemy(max_dist: float, cone_deg := 180.0, from_dir := Vector3.ZERO) -> Enemy:
	var best: Enemy = null
	var bd := max_dist
	var dir := from_dir if from_dir != Vector3.ZERO else facing()
	for e in get_tree().get_nodes_in_group("enemies"):
		var en := e as Enemy
		if en == null or en.is_dead():
			continue
		var to := en.global_position - global_position
		to.y = 0
		var d := to.length()
		if d > bd:
			continue
		if cone_deg < 180.0 and dir.angle_to(to) > deg_to_rad(cone_deg * 0.5):
			continue
		bd = d
		best = en
	return best


func try_attack() -> void:
	if dead or _atk != 0 or _roll_t > 0.0 or _atk_cd > 0.0 or _throw_t > 0.0:
		return
	var w := weapon_name()
	var wd: Dictionary = Data.WEAPONS[w] if w != "" else {"dmg": 7.0, "reach": 1.5, "arc": 100.0, "rate": 0.5, "stam": 4.0, "knock": 1.5}
	if stamina < float(wd.stam) * 0.5:
		game.hud.toast("OUT OF BREATH")
		return
	stamina = maxf(0.0, stamina - float(wd.stam))
	_stam_wait = 0.9
	_atk = 1
	_atk_t = 0.13
	_hit_done = false
	var tgt := nearest_enemy(3.2, 150.0, _input_dir() if _input_dir() != Vector3.ZERO else facing())
	if tgt != null:
		var to := tgt.global_position - global_position
		to.y = 0
		_atk_dir = to.normalized()
	else:
		_atk_dir = _input_dir() if _input_dir() != Vector3.ZERO else facing()
	game.sfx.play("swing", -3.0, randf_range(0.9, 1.1) + _combo * 0.05)
	view.swing_combo = _combo


func _apply_hit() -> void:
	var w := weapon_name()
	var wd: Dictionary = Data.WEAPONS[w] if w != "" else {"dmg": 7.0, "reach": 1.5, "arc": 100.0, "rate": 0.5, "stam": 4.0, "knock": 1.5}
	var dmg := float(wd.dmg) * (1.35 if _combo == 2 else 1.0)
	var hit_any := false
	for e in get_tree().get_nodes_in_group("enemies"):
		var en := e as Enemy
		if en == null or en.is_dead():
			continue
		var to := en.global_position - global_position
		to.y = 0
		var reach := float(wd.reach) + (1.2 if en.boss else 0.0) + (0.5 if en.kind == "bloater" else 0.0)
		if to.length() > reach:
			continue
		if _atk_dir.angle_to(to) > deg_to_rad(float(wd.arc) * 0.5) and to.length() > 0.8:
			continue
		en.take_damage(dmg, global_position, float(wd.knock) * (1.4 if _combo == 2 else 1.0))
		hit_any = true
		if en.is_dead():
			kills += 1
	if hit_any:
		game.sfx.play("hit", 0.0, randf_range(0.9, 1.1))
		game.shake(0.12)
	game.noise(global_position, 22.0)


func try_roll() -> void:
	if dead or _roll_t > 0.0 or _atk != 0:
		return
	var cost := 12.0 if char_id == "mococo" else 22.0
	if stamina < cost:
		return
	stamina -= cost
	_stam_wait = 0.7 if char_id != "mococo" else 0.35
	_roll_t = 0.42
	iframes = maxf(iframes, 0.38)
	var d := _input_dir()
	_roll_dir = d if d != Vector3.ZERO else facing()
	view.start_pose(CharacterView.Pose.ROLL)
	game.sfx.play("step", -6.0, 0.7)


func try_shoot() -> void:
	if dead or not has_pistol or _shoot_cd > 0.0 or _reload_t > 0.0 or _roll_t > 0.0:
		return
	if mag <= 0:
		if count("ammo") > 0:
			reload()
		else:
			game.sfx.play("empty", -4.0)
			_shoot_cd = 0.3
		return
	mag -= 1
	_shoot_cd = float(Data.WEAPONS.pistol.rate)
	_aim_hold = 0.9
	var origin := cam.global_position
	var dir := camera_forward()
	var rng := float(Data.WEAPONS.pistol.range)
	var target_point := origin + dir * rng
	var space := get_world_3d().direct_space_state
	var best: Enemy = null
	var best_ang := deg_to_rad(8.0)
	for e in get_tree().get_nodes_in_group("enemies"):
		var en := e as Enemy
		if en == null or en.is_dead():
			continue
		var to := en.chest() - origin
		if to.length() > rng or to.length() < 1.0:
			continue
		var ang := dir.angle_to(to)
		if ang < best_ang:
			best_ang = ang
			best = en
	if best != null:
		target_point = best.chest()
	var from := global_position + Vector3(0, 1.3, 0) + facing() * 0.4
	var shot_dir := (target_point - from).normalized()
	var q := PhysicsRayQueryParameters3D.create(from, from + shot_dir * rng, Data.L_WORLD | Data.L_ENEMY, [get_rid()])
	var hit := space.intersect_ray(q)
	var end: Vector3 = hit.position if not hit.is_empty() else from + shot_dir * rng
	game.fx.muzzle(from + shot_dir * 0.4)
	game.fx.tracer(from, end)
	game.sfx.play("pistol", -2.0)
	game.noise(global_position, 40.0)
	pitch = minf(0.6, pitch + 0.03)
	if not hit.is_empty() and hit.collider is Enemy:
		var en2 := hit.collider as Enemy
		var head: bool = hit.position.y > en2.global_position.y + en2.height * 0.84
		en2.take_damage(float(Data.WEAPONS.pistol.dmg), global_position, 1.5, head)
		if en2.is_dead():
			kills += 1
		game.hud.hit_marker(head)
	elif not hit.is_empty():
		game.fx.spark(hit.position, hit.normal)


func reload() -> void:
	if not has_pistol or _reload_t > 0.0 or mag >= int(Data.WEAPONS.pistol.mag) or count("ammo") <= 0:
		return
	_reload_t = float(Data.WEAPONS.pistol.reload)
	game.sfx.play("reload", -2.0)


func try_flare() -> void:
	if dead or _throw_t > 0.0 or count("flare") <= 0 or _atk != 0:
		return
	spend("flare")
	_throw_t = 0.38
	view.start_pose(CharacterView.Pose.THROW)
	var from := global_position + Vector3(0, 1.4, 0) + facing() * 0.5
	var f := Flare.new()
	f.game = game
	game.add_child(f)
	f.global_position = from
	var dir := camera_forward()
	dir.y = clampf(dir.y + 0.35, 0.1, 0.8)
	f.velocity = dir.normalized() * 9.5
	game.sfx.play("swing", -6.0, 0.7)


func toggle_torch() -> void:
	torch_on = not torch_on
	torch.visible = torch_on
	game.sfx.play("swap", -8.0, 0.7)


func slow(t: float) -> void:
	_slow_t = maxf(_slow_t, t)


func take_damage(amount: float, from: Vector3) -> void:
	if dead or iframes > 0.0:
		return
	hp -= amount
	iframes = 0.6
	_hurt_t = 0.45
	_atk = 0
	_shake = minf(1.0, _shake + amount / 22.0)
	var away := global_position - from
	away.y = 0
	velocity += away.normalized() * 4.5
	view.start_pose(CharacterView.Pose.HURT)
	view.flash(0.5)
	game.sfx.play("hurt", -2.0)
	game.fx.blood(global_position + Vector3(0, 1.2, 0), (from - global_position).normalized(), false)
	hurt.emit(amount)
	if hp <= 0.0:
		hp = 0.0
		dead = true
		view.start_pose(CharacterView.Pose.DEAD)
		died.emit()


func revive(full := true) -> void:
	dead = false
	hp = max_hp if full else max_hp * 0.5
	stamina = max_stamina
	iframes = 1.5
	_atk = 0
	_roll_t = 0.0
	view.start_pose(CharacterView.Pose.IDLE)


# ── per frame ────────────────────────────────────────────────────────────────

func _input_dir() -> Vector3:
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var w := right * move_input.x + fwd * -move_input.y
	return w.normalized() if w.length() > 0.12 else Vector3.ZERO


func _physics_process(delta: float) -> void:
	_update_camera(delta)
	iframes = maxf(0.0, iframes - delta)
	_atk_cd = maxf(0.0, _atk_cd - delta)
	_shoot_cd = maxf(0.0, _shoot_cd - delta)
	_slow_t = maxf(0.0, _slow_t - delta)
	_hurt_t = maxf(0.0, _hurt_t - delta)
	_throw_t = maxf(0.0, _throw_t - delta)
	_aim_hold = maxf(0.0, _aim_hold - delta)
	if _reload_t > 0.0:
		_reload_t -= delta
		if _reload_t <= 0.0:
			var take := mini(int(Data.WEAPONS.pistol.mag) - mag, count("ammo"))
			mag += take
			spend("ammo", take)
	if dead:
		velocity = Vector3(velocity.x * 0.9, velocity.y - GRAVITY * delta, velocity.z * 0.9)
		move_and_slide()
		view.move_speed = 0.0
		return
	var want := _input_dir()
	var mag_in := minf(1.0, move_input.length())
	var base := float(info.speed)
	var speed := base * (0.55 if mag_in < 0.55 else 1.0)
	var running := sprint and mag_in > 0.5 and stamina > 3.0 and _atk == 0 and _roll_t <= 0.0
	if running:
		speed = base * 1.5
		stamina = maxf(0.0, stamina - 17.0 * delta)
		_stam_wait = 0.8
	if _slow_t > 0.0:
		speed *= 0.5
	if _atk != 0:
		speed *= 0.2
	if _throw_t > 0.0:
		speed *= 0.4
	var vel_target := want * speed * (1.0 if mag_in > 0.05 else 0.0)
	if _roll_t > 0.0:
		_roll_t -= delta
		vel_target = _roll_dir * 8.2
		velocity.x = vel_target.x
		velocity.z = vel_target.z
	else:
		velocity.x = move_toward(velocity.x, vel_target.x, 30.0 * delta)
		velocity.z = move_toward(velocity.z, vel_target.z, 30.0 * delta)
	velocity.y = velocity.y - GRAVITY * delta if not is_on_floor() else -0.5
	move_and_slide()
	# stamina
	if _stam_wait > 0.0:
		_stam_wait -= delta
	elif stamina < max_stamina:
		stamina = minf(max_stamina, stamina + (26.0 if char_id != "mococo" else 38.0) * delta)
	# attack phases
	if _atk != 0:
		_atk_t -= delta
		match _atk:
			1:
				view.swing_phase = 0
				view.swing_k = 1.0 - _atk_t / 0.13
				if _atk_t <= 0.0:
					_atk = 2
					_atk_t = 0.1
					_apply_hit()
			2:
				view.swing_phase = 1
				view.swing_k = 1.0 - _atk_t / 0.1
				if _atk_t <= 0.0:
					_atk = 3
					_atk_t = 0.26
			3:
				view.swing_phase = 2
				view.swing_k = 1.0 - _atk_t / 0.26
				if _atk_t <= 0.0:
					_atk = 0
					_atk_cd = maxf(0.0, float((Data.WEAPONS[weapon_name()] if weapon_name() != "" else {"rate": 0.5}).rate) - 0.49)
					_combo = (_combo + 1) % 3
	elif _atk_cd <= 0.0 and _atk == 0:
		pass
	# body turns
	var planar := Vector2(velocity.x, velocity.z)
	var target_yaw := _body_yaw
	if _atk != 0 and _atk_dir != Vector3.ZERO:
		target_yaw = atan2(-_atk_dir.x, -_atk_dir.z)
	elif _aim_hold > 0.0:
		target_yaw = yaw
	elif planar.length() > 0.4:
		target_yaw = atan2(-velocity.x, -velocity.z)
	_body_yaw = lerp_angle(_body_yaw, target_yaw, minf(1.0, delta * (16.0 if _atk != 0 else 11.0)))
	view.rotation.y = _body_yaw
	# pose
	var sp := planar.length() / maxf(base, 0.1)
	view.move_speed = clampf(sp * (1.0 if not running else 0.95), 0.0, 1.4)
	view.ground_speed = planar.length()
	if _atk != 0:
		view.pose = CharacterView.Pose.SWING
	elif _roll_t > 0.0:
		view.pose = CharacterView.Pose.ROLL
	elif _hurt_t > 0.0:
		view.pose = CharacterView.Pose.HURT
	elif _throw_t > 0.0:
		view.pose = CharacterView.Pose.THROW
	elif _aim_hold > 0.0:
		view.pose = CharacterView.Pose.AIM
	elif running:
		view.pose = CharacterView.Pose.RUN
	elif planar.length() > 0.3:
		view.pose = CharacterView.Pose.WALK
	else:
		view.pose = CharacterView.Pose.IDLE
	if view.pose != CharacterView.Pose.HURT and _hurt_t <= 0.0:
		view.flash(0.0)
	_step_t += planar.length() * delta
	if _step_t > (1.7 if running else 2.2):
		_step_t = 0.0
		game.sfx.play("step", -14.0, randf_range(0.85, 1.1))
		if running:
			game.noise(global_position, 14.0)


func _update_camera(delta: float) -> void:
	pivot.rotation = Vector3(pitch, yaw, 0)
	_shake = maxf(0.0, _shake - delta * 2.5)
	cam.rotation = Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * 0.03
	var run_fov := 72.0 if sprint and Vector2(velocity.x, velocity.z).length() > float(info.speed) * 1.2 else 66.0
	cam.fov = lerpf(cam.fov, run_fov, minf(1.0, delta * 5.0))
