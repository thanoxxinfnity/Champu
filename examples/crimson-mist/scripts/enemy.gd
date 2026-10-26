class_name Enemy
extends CharacterBody3D
## One Mist-touched creature. State machine: Dormant -> Patrol -> Investigate (a sound, a flare) -> Chase -> Windup (the tell) -> Strike -> Stunned -> Dead.
## Walkers lurch, crawlers scuttle, bloaters burst into slowing spores, Veil Weepers freeze while you look at them, the Bellkeeper tolls its bell.

signal died(e: Enemy)

enum S { DORMANT, PATROL, INVESTIGATE, CHASE, WINDUP, STRIKE, STUNNED, DEAD }

const GRAVITY := 19.0

var game: Game
var kind := "mist_walker"
var def: Dictionary
var state := S.DORMANT
var hp := 60.0
var max_hp := 60.0
var height := 1.75
var boss := false
var alerted := false
var marked := 0.0
var frozen := false
var phase2 := false
var zone := ""
var trait_id := "shambler"
var female := false

var visual: Node3D
var view: CharacterView
var _last_state := -1

const RIGS := {
	"mist_walker": ["rig_mist_walker", "zombie", 1.75], "crawler": ["rig_crawler", "crawler", 1.5], "bloater": ["rig_bloater", "bloater", 2.0],
	"weeper": ["rig_weeper", "weeper", 1.7], "bellkeeper": ["rig_bellkeeper", "boss", 4.2],
}
var _mark: MeshInstance3D
var _target_pos := Vector3.ZERO
var _path := PackedVector3Array()
var _repath := 0.0
var _sight_t := 0.0
var _cd := 0.0
var _timer := 0.0
var _anim_t := randf() * 10.0
var _patrol_home := Vector3.ZERO
var _patrol_dir := Vector3.ZERO
var _patrol_wait := 0.0
var _knock := Vector3.ZERO
var _speed_mul := 1.0
var _toll_t := 8.0
var _flash := 0.0
var _mats: Array[ShaderMaterial] = []
var _death_t := 0.0
var _investigate_t := 0.0
var _last_pos := Vector3.ZERO
var _stuck_t := 0.0
var _aura_t := 0.0
var _scream_cd := 3.0
var _lunge_t := 0.0
var _lunge_hit := false
var _intent := ""          # what the wind-up in progress is for: "" (a swing), "spit", "scream", "lunge"


func setup(g: Game, k: String, pos: Vector3, home_zone := "") -> void:
	game = g
	kind = k
	zone = home_zone
	def = Bestiary.def(k)
	trait_id = Bestiary.trait_of(k)
	female = Bestiary.sex_of(k) == "F"
	max_hp = float(def.hp)
	hp = max_hp
	height = float(def.height)
	boss = k == "bellkeeper"
	position = pos
	_patrol_home = pos
	add_to_group("enemies")


func _ready() -> void:
	collision_layer = Data.L_ENEMY
	collision_mask = Data.L_WORLD | Data.L_PLAYER
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 1.4 if boss else (0.6 if trait_id == "burst" and kind == "bloater" else (0.42 if trait_id == "crawl" else 0.36))
	cap.height = maxf(height * (0.9 if trait_id != "crawl" else 1.0), cap.radius * 2.0 + 0.1)
	cs.shape = cap
	cs.position.y = cap.height * 0.5
	add_child(cs)
	visual = Node3D.new()
	add_child(visual)
	var rig_info: Array = RIGS[kind] if RIGS.has(kind) else [String(def.body), String(def.style), float(def.height)]
	view = CharacterView.new()
	visual.add_child(view)
	var rigged := view.setup_model("res://assets/world/%s.glb" % rig_info[0], float(rig_info[2]), def.tint, String(rig_info[1]))
	if not rigged and kind != "bellkeeper" and String(rig_info[0]) != "rig_mist_walker":      # a body that is not built yet: the walker stands in, same behaviour, same tint
		view.queue_free()
		view = CharacterView.new()
		visual.add_child(view)
		rigged = view.setup_model("res://assets/world/rig_mist_walker.glb", float(rig_info[2]), def.tint, String(rig_info[1]))
	if not rigged and kind == "crawler":      # the crawler reuses the walker's body when it has none of its own
		view.queue_free()
		view = CharacterView.new()
		visual.add_child(view)
		rigged = view.setup_model("res://assets/world/rig_mist_walker.glb", float(rig_info[2]), def.tint, "crawler")
	if not rigged:
		view.queue_free()
		view = null
	var model := Assets.prop(String(def.model), height, false, 0.02, 0.1) if view == null else Node3D.new()
	visual.add_child(model)
	model.rotation.y = PI if bool(model.get_meta("stand_in", false)) == false else 0.0
	for n in model.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null or DisplayServer.get_name() == "headless":
			continue
		for s in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(s)
			if m is ShaderMaterial:
				var sm := (m as ShaderMaterial).duplicate() as ShaderMaterial
				sm.next_pass = (m as ShaderMaterial).next_pass
				mi.set_surface_override_material(s, sm)
				_mats.append(sm)
	if def.has("aura"):
		for m in _mats:
			m.set_shader_parameter("emission_color", Color(1.0, 0.38, 0.08))
			m.set_shader_parameter("emission_energy", 0.55)
	_mark = MeshInstance3D.new()
	var dm := SphereMesh.new()
	dm.radius = 0.16
	dm.height = 0.32
	dm.radial_segments = 4
	dm.rings = 2
	_mark.mesh = dm
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(1.0, 0.25, 0.35)
	mm.emission_enabled = true
	mm.emission = Color(1.0, 0.2, 0.3)
	mm.emission_energy_multiplier = 2.5
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.no_depth_test = true
	mm.render_priority = 5
	_mark.material_override = mm
	_mark.position.y = height + 0.45
	_mark.visible = false
	add_child(_mark)
	var shadow := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(1.0, 1.0) * (3.5 if boss else (1.3 if trait_id == "burst" else 0.9))
	shadow.mesh = pm
	var sm2 := StandardMaterial3D.new()
	sm2.albedo_color = Color(0, 0, 0, 0.45)
	sm2.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm2.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	shadow.material_override = sm2
	shadow.position.y = 0.03
	shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(shadow)


func wake(alert := true) -> void:
	if state == S.DEAD:
		return
	game.meet(kind)
	if state == S.DORMANT or state == S.PATROL or state == S.INVESTIGATE:
		state = S.CHASE
		alerted = alert
		game.sfx.play_at("groan%d" % (1 + randi() % 3), global_position, -3.0, randf_range(0.85, 1.1) * (0.7 if boss else (1.25 if female else 1.0)))


func hear(pos: Vector3, radius: float) -> void:
	if state == S.DEAD or state == S.STUNNED:
		return
	var d := global_position.distance_to(pos)
	if d > radius * float(def.hear) / 20.0:
		return
	if state == S.DORMANT or state == S.PATROL:
		if d < 9.0:
			wake()
		else:
			state = S.INVESTIGATE
			_target_pos = pos
			_investigate_t = 7.0


func distract(pos: Vector3) -> void:
	if state == S.DEAD or boss or state == S.WINDUP or state == S.STRIKE:
		return
	if state == S.CHASE and game.player.global_position.distance_to(global_position) < 4.0:
		return
	state = S.INVESTIGATE
	_target_pos = pos
	_investigate_t = 9.0


func is_dead() -> bool:
	return state == S.DEAD


func chest() -> Vector3:
	return global_position + Vector3(0, height * 0.65, 0)


func take_damage(dmg: float, from: Vector3, knock := 3.0, head := false) -> void:
	if state == S.DEAD:
		return
	var armor := float(def.get("armor", 1.0))
	game.meet(kind)
	hp -= dmg * (1.6 if head else 1.0) * (lerpf(armor, 1.0, 0.6) if head else armor)
	_flash = 1.0
	game.sfx.play_at("hit", global_position, 0.0, randf_range(0.9, 1.1))
	game.fx.blood(chest(), (from - global_position).normalized(), false)
	if state == S.DORMANT or state == S.PATROL or state == S.INVESTIGATE:
		state = S.CHASE
		alerted = true
	if hp <= 0.0:
		_die()
		return
	if not boss and state != S.WINDUP:
		var away := (global_position - from)
		away.y = 0
		_knock = away.normalized() * knock * (0.5 if trait_id == "burst" else (0.55 if armor < 1.0 else 1.0))
		state = S.STUNNED
		_timer = 0.28 if trait_id != "burst" else 0.12
	if boss:
		game.hud.boss_hp(hp / max_hp)
		if not phase2 and hp < max_hp * 0.5:
			phase2 = true
			_speed_mul = 1.4
			game.on_boss_phase2(self)


func _die() -> void:
	state = S.DEAD
	_death_t = 0.0
	collision_layer = 0
	collision_mask = Data.L_WORLD
	remove_from_group("enemies")
	game.sfx.play_at("scream" if (kind == "weeper" or (female and randf() < 0.5)) else "groan3", global_position, -1.0, 1.1 if not boss else 0.6)
	game.fx.splat(global_position, 1.4 if not boss else 4.0)
	if bool(def.get("burst", false)):
		_burst(0.6)
	_mark.visible = false
	died.emit(self)


func _burst(strength := 1.0) -> void:
	game.fx.spores(global_position + Vector3(0, 1.0, 0), 3.4)
	game.sfx.play_at("boom", global_position, -4.0, 1.4)
	var p := game.player
	if not p.dead and p.global_position.distance_to(global_position) < 3.4:
		p.take_damage(16.0 * strength, global_position)
		p.slow(3.5)
	for e in get_tree().get_nodes_in_group("enemies"):
		var o := e as Enemy
		if o != self and o.global_position.distance_to(global_position) < 3.4:
			o.take_damage(35.0, global_position, 2.0)
	if state != S.DEAD:
		_die_silent()


func _die_silent() -> void:
	hp = 0.0
	_die()


func _physics_process(delta: float) -> void:
	_anim_t += delta
	_cd = maxf(0.0, _cd - delta)
	_flash = maxf(0.0, _flash - delta * 5.0)
	marked = maxf(0.0, marked - delta)
	_mark.visible = marked > 0.0 and state != S.DEAD
	for m in _mats:
		m.set_shader_parameter("flash", _flash * 0.6)
	if state == S.DEAD:
		_update_death(delta)
		return
	var p := game.player
	if p == null or p.dead:
		_idle_anim(delta)
		velocity = Vector3(0, velocity.y - GRAVITY * delta, 0)
		move_and_slide()
		return
	var to_p := p.global_position - global_position
	to_p.y = 0
	var dist := to_p.length()
	# far from the player and asleep: nothing to see or animate (saves a skeleton per sleeper on a phone)
	if state == S.DORMANT and dist > 42.0 and not alerted:
		visual.visible = false
		return
	visual.visible = true
	_sight_t -= delta
	if _sight_t <= 0.0:
		_sight_t = 0.2
		_look_for_player(dist)
	frozen = false
	if def.has("aura") and dist < 2.5 and not p.dead and state != S.DORMANT:
		_aura_t -= delta
		if _aura_t <= 0.0:
			_aura_t = 0.7
			p.take_damage(float(def.aura) * 0.7, global_position)
			Bestiary.note(kind, float(def.aura) * 0.7)
	_scream_cd = maxf(0.0, _scream_cd - delta)
	match state:
		S.DORMANT:
			velocity.x = move_toward(velocity.x, 0, 20 * delta)
			velocity.z = move_toward(velocity.z, 0, 20 * delta)
			_idle_anim(delta)
		S.PATROL:
			_patrol(delta)
		S.INVESTIGATE:
			_investigate_t -= delta
			if global_position.distance_to(_target_pos) < 1.4 or _investigate_t <= 0.0:
				state = S.PATROL if def.patrol > 0.0 else S.DORMANT
			else:
				_move_toward(_target_pos, float(def.speed) * 0.7 * _speed_mul, delta)
		S.CHASE:
			_chase(p, dist, delta)
		S.WINDUP:
			_timer -= delta
			_face(p.global_position, delta, 10.0)
			velocity.x = move_toward(velocity.x, 0, 30 * delta)
			velocity.z = move_toward(velocity.z, 0, 30 * delta)
			if _timer <= 0.0:
				_strike(p)
		S.STRIKE:
			_timer -= delta
			if _lunge_t > 0.0:
				_lunge_t -= delta
				var fwd := -global_transform.basis.z
				velocity.x = fwd.x * 13.0
				velocity.z = fwd.z * 13.0
				if not _lunge_hit and dist < 1.5 and not p.dead:
					_lunge_hit = true
					p.take_damage(float(def.dmg), global_position)
					Bestiary.note(kind, float(def.dmg))
					game.sfx.play_at("hit", p.global_position, 2.0)
				if _lunge_t <= 0.0:
					velocity.x = 0.0
					velocity.z = 0.0
			if _timer <= 0.0:
				state = S.CHASE
		S.STUNNED:
			_timer -= delta
			velocity.x = _knock.x
			velocity.z = _knock.z
			_knock = _knock.move_toward(Vector3.ZERO, 14.0 * delta)
			if _timer <= 0.0:
				state = S.CHASE
	velocity.y = velocity.y - GRAVITY * delta if not is_on_floor() else -0.5
	move_and_slide()
	_animate(delta)
	if boss:
		_boss_tick(delta)


func _look_for_player(dist: float) -> void:
	if state == S.CHASE or state == S.WINDUP or state == S.STRIKE or state == S.STUNNED:
		return
	var p := game.player
	var sight := float(def.sight) * (0.5 if game.player_hidden() else 1.0)
	if dist > sight:
		return
	var fwd := -global_transform.basis.z
	var to_p := (p.global_position - global_position)
	var ang := fwd.angle_to(Vector3(to_p.x, 0, to_p.z))
	if dist > 5.0 and ang > deg_to_rad(65.0):
		return
	if state == S.DORMANT and dist > sight * 0.7:
		return
	var from := global_position + Vector3(0, height * 0.8, 0)
	var to := p.global_position + Vector3(0, 1.2, 0)
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD)
	if get_world_3d().direct_space_state.intersect_ray(q).is_empty():
		wake()


func _patrol(delta: float) -> void:
	_patrol_wait -= delta
	if _patrol_dir == Vector3.ZERO or _patrol_wait <= 0.0:
		var a := randf() * TAU
		_patrol_dir = Vector3(cos(a), 0, sin(a))
		_patrol_wait = randf_range(2.5, 5.0)
		if randf() < 0.35:
			_patrol_dir = Vector3.ZERO
	var tgt := global_position + _patrol_dir * 3.0
	if _patrol_dir == Vector3.ZERO or _patrol_home.distance_to(global_position) > 9.0:
		tgt = _patrol_home
		if _patrol_dir == Vector3.ZERO and global_position.distance_to(_patrol_home) < 1.0:
			velocity.x = move_toward(velocity.x, 0, 20 * delta)
			velocity.z = move_toward(velocity.z, 0, 20 * delta)
			_idle_anim(delta)
			return
	_move_toward(tgt, float(def.patrol) * _speed_mul, delta)


func _chase(p: Player, dist: float, delta: float) -> void:
	if trait_id == "weeper":
		if game.player_looking_at(chest()) and dist > 1.8:
			frozen = true
			velocity.x = 0
			velocity.z = 0
			return
	if bool(def.get("burst", false)) and dist < 2.2:
		_burst(1.0)
		return
	var reach := float(def.reach)
	var sees := _clear_to(p)
	# the specials: each one is a wind-up the player can read, then the thing itself
	if _cd <= 0.0 and sees:
		if def.has("spit") and dist >= 5.0 and dist <= 15.0:
			_begin("spit", 0.65, 0.9)
			return
		if def.has("lunge") and dist >= reach + 1.2 and dist <= float(def.lunge) * 2.4:
			_begin("lunge", 0.5, 1.4)
			return
	if def.has("scream") and _scream_cd <= 0.0 and sees and dist < 20.0:
		_begin("scream", 0.8, 1.0)
		return
	if dist <= reach and _cd <= 0.0:
		state = S.WINDUP
		_intent = ""
		_timer = 0.9 if boss else (0.35 if trait_id == "crawl" else 0.5)
		game.sfx.play_at("groan%d" % (1 + randi() % 3), global_position, -2.0, (1.3 if not burst_like() else 0.8) * (1.2 if female else 1.0))
		return
	var spd := float(def.speed) * _speed_mul
	# a spitter holds its ground at range instead of walking into the fight
	if def.has("spit") and dist < 13.0 and dist > 6.0 and sees:
		_face(p.global_position, delta, 8.0)
		velocity.x = move_toward(velocity.x, 0, 16 * delta)
		velocity.z = move_toward(velocity.z, 0, 16 * delta)
		return
	_move_toward(p.global_position, spd, delta, true)


func burst_like() -> bool:
	return bool(def.get("burst", false))


func _clear_to(p: Player) -> bool:
	var q := PhysicsRayQueryParameters3D.create(global_position + Vector3(0, height * 0.8, 0), p.global_position + Vector3(0, 1.2, 0), Data.L_WORLD)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _begin(intent: String, windup: float, cooldown: float) -> void:
	state = S.WINDUP
	_intent = intent
	_timer = windup
	_cd = cooldown
	match intent:
		"scream":
			game.sfx.play_at("scream", global_position, -4.0, 1.0 if female else 0.8)
		"spit", "lunge":
			game.sfx.play_at("groan%d" % (1 + randi() % 3), global_position, -2.0, 1.5 if female else 1.2)


func _strike(p: Player) -> void:
	state = S.STRIKE
	_timer = 0.3
	_cd = float(def.cd)
	match _intent:
		"spit":
			_cd = float(def.spit)
			var from := global_position + Vector3(0, height * 0.75, 0)
			var glob := Glob.new()
			glob.setup(game, from, p.global_position + Vector3(0, 0.2, 0) + p.velocity * 0.35, float(def.dmg))
			game.add_child(glob)
			_intent = ""
			return
		"scream":
			_scream()
			_intent = ""
			return
		"lunge":
			_lunge_t = 0.34
			_lunge_hit = false
			_timer = 0.55
			_cd = float(def.cd) + 1.2
			_intent = ""
			return
	if boss:
		game.sfx.play_at("slam", global_position, 2.0, 0.7)
		game.shake(0.6)
		game.fx.dust(global_position + (-global_transform.basis.z) * 2.2)
	var to := p.global_position - global_position
	to.y = 0
	var reach := float(def.reach) * 1.35
	if to.length() <= reach and not p.dead:
		p.take_damage(float(def.dmg), global_position)
		Bestiary.note(kind, float(def.dmg))
		game.sfx.play_at("hit", p.global_position, 2.0)


## The scream: everything within earshot wakes and comes, and the player is shaken.
func _scream() -> void:
	_scream_cd = float(def.scream)
	game.sfx.play_at("scream", global_position, 3.0, 1.1 if female else 0.85)
	game.shake(0.45)
	for e in get_tree().get_nodes_in_group("enemies"):
		var o := e as Enemy
		if o != self and o.state != S.DEAD and o.global_position.distance_to(global_position) < 32.0:
			o.wake()


func _move_toward(target: Vector3, speed: float, delta: float, repath := false) -> void:
	_repath -= delta
	var here := global_position
	var flat := Vector3(target.x - here.x, 0, target.z - here.z)
	var direct := flat.length() < 5.0 or not game.world.nav.walkable(target)
	if not direct:
		var q := PhysicsRayQueryParameters3D.create(here + Vector3(0, 0.6, 0), target + Vector3(0, 0.6, 0), Data.L_WORLD)
		direct = get_world_3d().direct_space_state.intersect_ray(q).is_empty()
	var dest := target
	if not direct:
		if _repath <= 0.0 or _path.is_empty():
			_repath = 0.5
			_path = game.world.nav.path(here, target)
		while not _path.is_empty() and Vector2(_path[0].x - here.x, _path[0].z - here.z).length() < 0.7:
			_path.remove_at(0)
		if not _path.is_empty():
			dest = _path[0]
	var dir := Vector3(dest.x - here.x, 0, dest.z - here.z)
	if dir.length() > 0.05:
		dir = dir.normalized()
		var sep := Vector3.ZERO
		for e in get_tree().get_nodes_in_group("enemies"):
			var o := e as Enemy
			if o != self:
				var d := here - o.global_position
				d.y = 0
				var l := d.length()
				if l < 1.2 and l > 0.01:
					sep += d / l * (1.2 - l)
		dir = (dir + sep * 0.8).normalized()
		velocity.x = move_toward(velocity.x, dir.x * speed, 18.0 * delta)
		velocity.z = move_toward(velocity.z, dir.z * speed, 18.0 * delta)
		var yaw := atan2(-dir.x, -dir.z)
		rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, delta * 8.0))
	if (global_position - _last_pos).length() < 0.02 * delta * 60.0 * 0.2:
		_stuck_t += delta
		if _stuck_t > 1.2:
			_stuck_t = 0.0
			_path = PackedVector3Array()
			_repath = 0.0
	else:
		_stuck_t = 0.0
	_last_pos = global_position


func _face(pos: Vector3, delta: float, rate: float) -> void:
	var d := pos - global_position
	rotation.y = lerp_angle(rotation.y, atan2(-d.x, -d.z), minf(1.0, delta * rate))


func _idle_anim(delta: float) -> void:
	if view != null:
		_animate_rig()
		return
	visual.rotation = Vector3(sin(_anim_t * 0.9) * 0.03, 0, sin(_anim_t * 0.7) * 0.04)
	visual.position.y = 0.0


func _animate_rig() -> void:
	var spd := Vector2(velocity.x, velocity.z).length()
	view.ground_speed = spd
	view.clip_speed_scale = 0.0 if frozen else 1.0
	if state != _last_state:
		_last_state = state
		match state:
			S.STUNNED:
				view.start_pose(CharacterView.Pose.HURT)
			S.DEAD:
				view.start_pose(CharacterView.Pose.DEAD)
			S.WINDUP, S.STRIKE:
				view.start_pose(CharacterView.Pose.SWING)
	match state:
		S.DEAD:
			view.pose = CharacterView.Pose.DEAD
		S.STUNNED:
			view.pose = CharacterView.Pose.HURT
		S.WINDUP:
			view.pose = CharacterView.Pose.SWING
			view.swing_phase = 0
			view.swing_k = clampf(1.0 - _timer / (0.9 if boss else (0.8 if _intent == "scream" else (0.65 if _intent == "spit" else 0.5))), 0.0, 1.0)
		S.STRIKE:
			view.pose = CharacterView.Pose.SWING
			view.swing_phase = 1 if _timer > 0.12 else 2
			view.swing_k = clampf(1.0 - _timer / 0.3, 0.0, 1.0) if _timer > 0.12 else clampf(1.0 - _timer / 0.12, 0.0, 1.0)
		_:
			view.pose = CharacterView.Pose.IDLE if spd < 0.25 else (CharacterView.Pose.WALK if spd < float(def.speed) * 0.85 or spd < 2.2 else CharacterView.Pose.RUN)


func _animate(delta: float) -> void:
	if view != null:
		_animate_rig()
		return
	var spd := Vector2(velocity.x, velocity.z).length()
	var k := clampf(spd / maxf(float(def.speed), 0.1), 0.0, 1.0)
	var rot := Vector3.ZERO
	var y := 0.0
	match kind:
		"crawler":
			y = absf(sin(_anim_t * 13.0)) * 0.05 * k
			rot = Vector3(0.0, sin(_anim_t * 9.0) * 0.14 * k, sin(_anim_t * 9.0) * 0.1 * k)
		"bloater":
			y = absf(sin(_anim_t * 3.0)) * 0.05 * k
			rot = Vector3(0.0, 0.0, sin(_anim_t * 3.0) * 0.1 * k)
		"weeper":
			y = 0.0
			rot = Vector3(0.12 * k, sin(_anim_t * 31.0) * 0.04, sin(_anim_t * 2.0) * 0.05)
			if frozen:
				rot = Vector3(0.0, sin(_anim_t * 55.0) * 0.03, 0.0)
		"bellkeeper":
			y = absf(sin(_anim_t * 2.0)) * 0.12 * k
			rot = Vector3(0.05 * k, 0.0, sin(_anim_t * 2.0) * 0.07 * k)
		_:
			y = absf(sin(_anim_t * 5.0)) * 0.05 * k
			rot = Vector3(0.16 * k, 0.0, sin(_anim_t * 2.5) * 0.1 * k)
	if state == S.WINDUP:
		var t := clampf(1.0 - _timer / (0.9 if boss else 0.5), 0.0, 1.0)
		rot.x = -0.45 * t
		y += 0.05 * t
	elif state == S.STRIKE:
		rot.x = 0.55
	elif state == S.STUNNED:
		rot.x = -0.3
	visual.rotation = visual.rotation.lerp(rot, minf(1.0, delta * 14.0))
	visual.position.y = y


func _update_death(delta: float) -> void:
	_death_t += delta
	if view != null:
		_animate_rig()
		velocity.x = move_toward(velocity.x, 0, 20 * delta)
		velocity.z = move_toward(velocity.z, 0, 20 * delta)
		velocity.y = velocity.y - GRAVITY * delta if not is_on_floor() else -0.5
		move_and_slide()
		if _death_t > 9.0 and not boss:
			queue_free()
		return
	var k := clampf(_death_t / 0.7, 0.0, 1.0)
	visual.rotation.x = lerpf(visual.rotation.x, -1.45 if kind != "crawler" else -0.3, minf(1.0, delta * 8.0))
	visual.position.y = lerpf(0.0, -0.05, k)
	velocity.x = move_toward(velocity.x, 0, 20 * delta)
	velocity.z = move_toward(velocity.z, 0, 20 * delta)
	velocity.y = velocity.y - GRAVITY * delta if not is_on_floor() else -0.5
	move_and_slide()
	if _death_t > 7.0 and not boss:
		queue_free()


func _boss_tick(delta: float) -> void:
	_toll_t -= delta
	if _toll_t <= 0.0:
		_toll_t = 7.0 if phase2 else 10.0
		game.toll(self)
