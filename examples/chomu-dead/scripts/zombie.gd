class_name Zombie
extends CharacterBody3D
## The undead. One script for every kind — walker, runner, cop, nurse, bloater
## and the Warden — driven by the table in Data.ENEMIES. They shuffle until
## they see or hear Rohan, then come straight for him, sliding along walls.

signal died(z: Zombie)

var game: Game
var kind := "walker"
var def: Dictionary
var hp := 70.0
var max_hp := 70.0
var height := 1.8
var dead := false
var alerted := false
var boss := false

var _mats: Array = []
var _holder: Node3D
var _phase := 0.0
var _stride := 0.0
var _wander := Vector3.ZERO
var _wander_t := 0.0
var _atk := 0.0           # >0: winding up a strike
var _cool := 0.0
var _flash := 0.0
var _stagger := 0.0
var _groan_t := 0.0
var _side := 1.0
var _side_t := 0.0
var _special_cd := 4.0
var _charge_t := 0.0
var _charge_dir := Vector3.ZERO
var _slam := 0.0
var _phase2 := false
var _limp := 0.0
var _lean := 0.3
var _yaw := 0.0


func setup(g: Node, k: String, pos: Vector3) -> void:
	game = g
	kind = k
	def = Data.ENEMIES[k]
	height = float(def.size)
	max_hp = float(def.hp)
	hp = max_hp
	boss = k == "warden"
	position = pos
	_yaw = randf() * TAU
	_phase = randf() * TAU
	_limp = 1.0 if randf() < 0.3 and k == "walker" else 0.0
	_lean = {"walker": 0.35, "runner": 0.55, "cop": 0.25, "nurse": 0.3, "bloater": 0.15, "warden": 0.2}.get(k, 0.3)
	_groan_t = randf_range(1.0, 5.0)
	_wander_t = randf_range(0.0, 3.0)


func _ready() -> void:
	collision_layer = Data.L_ENEMY
	collision_mask = Data.L_WORLD | Data.L_PLAYER
	add_to_group("enemies")
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	var r := 0.38 * height / 1.8 * (1.3 if kind == "bloater" else 1.0)
	cap.radius = r
	cap.height = height
	cs.shape = cap
	cs.position.y = height * 0.5
	add_child(cs)
	_holder = Assets.make(def.model, height, false, true, def.tint)
	add_child(_holder)
	_mats = _holder.get_meta("puppet_mats", [])


func chest() -> Vector3:
	return global_position + Vector3(0, height * 0.66, 0)


## A noise at `pos` that carries `radius` metres wakes this one up.
func hear(pos: Vector3, radius: float) -> void:
	if dead or alerted:
		return
	if global_position.distance_to(pos) < radius:
		alerted = true


func take_damage(amount: float, at: Vector3, dir: Vector3, head := false) -> void:
	if dead:
		return
	hp -= amount
	alerted = true
	_flash = 1.0
	_stagger = 0.12 if not boss else 0.0
	game.fx.blood(at, dir, head)
	game.sfx.play_at("hit", at, -2.0, randf_range(0.9, 1.15))
	game.hud.hit_marker(head, hp <= 0.0)
	if boss:
		game.hud.boss_hp(hp / max_hp)
	if hp <= 0.0:
		_die()
	elif not boss and amount > 40.0:
		velocity += dir * 2.0


func _die() -> void:
	dead = true
	remove_from_group("enemies")
	collision_layer = 0
	collision_mask = Data.L_WORLD
	game.hud.hit_marker(false, true)
	game.fx.splat(global_position, height * 0.9)
	game.sfx.play_at("groan3", global_position, -2.0, 1.2 if not boss else 0.7)
	if kind == "bloater":
		game.explode(global_position, 5.0, 40.0)
	game.loot_from(self)
	var tw := create_tween()
	var back := -1.0 if randf() < 0.5 else 1.0
	tw.tween_property(_holder, "rotation:x", back * 1.5, 0.55).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(_holder, "position:y", 0.12, 0.55)
	for m in _mats:
		(m as ShaderMaterial).set_shader_parameter("speed", 0.0)
		(m as ShaderMaterial).set_shader_parameter("dark", 0.5)
	tw.tween_interval(14.0)
	tw.tween_property(_holder, "position:y", -height * 0.7, 3.0)
	tw.tween_callback(queue_free)
	died.emit(self)


func _physics_process(delta: float) -> void:
	if dead:
		velocity.y -= 19.0 * delta
		velocity.x = 0.0
		velocity.z = 0.0
		move_and_slide()
		return
	var p: Player = game.player
	if p == null or p.dead:
		_idle(delta)
		_animate(delta, Vector3.ZERO)
		return
	var to := p.global_position - global_position
	to.y = 0.0
	var dist := to.length()
	# Far-away ghouls that nothing has woken stand still: cheap, and quiet.
	if dist > 95.0 and not alerted:
		return

	_cool = maxf(0.0, _cool - delta)
	_stagger = maxf(0.0, _stagger - delta)
	_groan_t -= delta
	if _groan_t <= 0.0:
		_groan_t = randf_range(3.0, 8.0) if not alerted else randf_range(1.8, 4.5)
		var s := "scream" if kind == "runner" and alerted else ("roar" if boss else "groan%d" % randi_range(1, 3))
		game.sfx.play_at(s, global_position + Vector3(0, height * 0.8, 0), 0.0 if dist < 30.0 else -6.0, randf_range(0.9, 1.1) * (1.0 / (height / 1.8) * 0.4 + 0.6))

	if not alerted and dist < float(def.sense) * 0.45:
		# Close enough to smell him, whatever the lamp is doing.
		alerted = true
	elif not alerted and dist < float(def.sense) and _sees(p):
		alerted = true

	var move := Vector3.ZERO
	if not alerted:
		move = _idle(delta)
	else:
		move = _hunt(delta, p, to, dist)

	_separate(delta)
	velocity.x = move_toward(velocity.x, move.x, 22.0 * delta)
	velocity.z = move_toward(velocity.z, move.z, 22.0 * delta)
	velocity.y = velocity.y - 19.0 * delta if not is_on_floor() else -0.5
	move_and_slide()
	_animate(delta, move)


func _sees(p: Player) -> bool:
	var from := global_position + Vector3(0, height * 0.9, 0)
	var q := PhysicsRayQueryParameters3D.create(from, p.global_position + Vector3(0, 1.3, 0), Data.L_WORLD, [get_rid()])
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _idle(delta: float) -> Vector3:
	_wander_t -= delta
	if _wander_t <= 0.0:
		_wander_t = randf_range(2.0, 6.0)
		if randf() < 0.55:
			var a := randf() * TAU
			_wander = Vector3(sin(a), 0, cos(a)) * float(def.speed) * 0.3
		else:
			_wander = Vector3.ZERO
	return _wander


func _hunt(delta: float, p: Player, to: Vector3, dist: float) -> Vector3:
	var dir := to / maxf(dist, 0.001)
	var spd := float(def.speed)
	if _stagger > 0.0:
		spd *= 0.2
	if kind == "runner" and dist > 6.0:
		spd *= 1.0
	if boss:
		return _boss(delta, p, dir, dist)

	# Feeler: if a wall is straight ahead, slide along it to whichever side is open.
	_side_t -= delta
	var ahead := _feel(dir, 1.6)
	if ahead:
		if _side_t <= 0.0:
			_side = -_side if randf() < 0.5 else _side
			_side_t = 0.8
		dir = (dir + Vector3(-dir.z, 0, dir.x) * _side * 1.6).normalized()

	# Strike when close.
	if _atk > 0.0:
		_atk -= delta
		if _atk <= 0.0:
			_strike(p)
		return Vector3.ZERO
	if dist < float(def.reach) and _cool <= 0.0:
		_atk = 0.5 if kind != "runner" else 0.32
		_cool = 1.2 if kind != "runner" else 0.8
		_face(dir, 1.0)
		return Vector3.ZERO
	if dist < float(def.reach) * 0.85:
		_face(dir, delta * 8.0)
		return Vector3.ZERO
	_face(dir, delta * 7.0)
	return dir * spd


func _strike(p: Player) -> void:
	var to := p.global_position - global_position
	to.y = 0.0
	if to.length() < float(def.reach) * 1.3:
		p.take_damage(float(def.dmg), global_position)


func _boss(delta: float, p: Player, dir: Vector3, dist: float) -> Vector3:
	_special_cd -= delta
	if not _phase2 and hp < max_hp * 0.5:
		_phase2 = true
		game.sfx.play("roar", 2.0, 0.8)
		game.boss_phase2(self)
	if _slam > 0.0:
		_slam -= delta
		_face(dir, delta * 3.0)
		if _slam <= 0.0:
			game.explode(global_position + dir * 2.2, 4.8, float(def.dmg) * 0.8, false)
			game.sfx.play_at("slam", global_position, 4.0)
		return Vector3.ZERO
	if _charge_t > 0.0:
		_charge_t -= delta
		if dist < 2.4 and _cool <= 0.0:
			p.take_damage(float(def.dmg) * 1.2, global_position)
			_cool = 1.0
			_charge_t = 0.0
		return _charge_dir * 10.5
	if dist < 4.5 and _special_cd <= 0.0:
		_slam = 0.9
		_special_cd = 4.5 if not _phase2 else 3.0
		return Vector3.ZERO
	if dist > 9.0 and dist < 40.0 and _special_cd <= 0.0:
		_charge_t = 1.0
		_charge_dir = dir
		_special_cd = 6.0 if not _phase2 else 4.0
		game.sfx.play_at("roar", global_position, 1.0, 1.1)
		_face(dir, 1.0)
		return Vector3.ZERO
	if dist < float(def.reach) and _cool <= 0.0:
		p.take_damage(float(def.dmg), global_position)
		_cool = 1.3
	_face(dir, delta * 5.0)
	var s := float(def.speed) * (1.35 if _phase2 else 1.0)
	return dir * s if dist > float(def.reach) * 0.9 else Vector3.ZERO


func _feel(dir: Vector3, length: float) -> bool:
	var from := global_position + Vector3(0, 0.6, 0)
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * length, Data.L_WORLD, [get_rid()])
	return not get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _face(dir: Vector3, weight: float) -> void:
	if dir.length_squared() < 0.0001:
		return
	_yaw = lerp_angle(_yaw, atan2(-dir.x, -dir.z), clampf(weight, 0.0, 1.0))
	rotation.y = _yaw


func _separate(delta: float) -> void:
	# Soft push so a pack spreads out instead of stacking in one capsule.
	var push := Vector3.ZERO
	for e in get_tree().get_nodes_in_group("enemies"):
		if e == self:
			continue
		var o := e as Zombie
		var d := global_position - o.global_position
		d.y = 0.0
		var l := d.length()
		var min_d := (height + o.height) * 0.22
		if l < min_d and l > 0.01:
			push += d / l * (min_d - l)
	if push != Vector3.ZERO:
		velocity += push * 6.0 * delta * 8.0


func _animate(delta: float, move: Vector3) -> void:
	var sp := Vector2(velocity.x, velocity.z).length()
	_phase += sp * delta * (2.0 / maxf(0.5, height / 1.8) + 1.0)
	_stride = lerpf(_stride, clampf(sp / maxf(float(def.speed), 0.5) * 0.9, 0.0, 1.0), minf(1.0, delta * 6.0))
	_flash = maxf(0.0, _flash - delta * 5.0)
	var up := float(def.arms) if alerted else 0.0
	if _atk > 0.0 or _slam > 0.0:
		up = 1.0
	for m in _mats:
		var sm := m as ShaderMaterial
		sm.set_shader_parameter("phase", _phase)
		sm.set_shader_parameter("speed", _stride)
		sm.set_shader_parameter("lean", _lean + (0.25 if alerted else 0.0))
		sm.set_shader_parameter("arms_up", up)
		sm.set_shader_parameter("limp", _limp)
		sm.set_shader_parameter("flash", _flash)
	if _mats.is_empty() and _holder != null:
		# Stand-in model: sway the whole body so it still reads as walking.
		_holder.rotation.z = sin(_phase) * 0.08 * _stride
		_holder.position.y = absf(sin(_phase)) * 0.05 * _stride
