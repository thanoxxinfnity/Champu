class_name Enemy
extends CharacterBody3D
## The things that walk the facility. Three kinds, one state machine (Patrol, Investigate, Chase, Stunned):
##   crawler  a broken maintenance unit that drags itself towards sound and sees a little
##   hunter   blind: it hears everything and sees nothing, so stillness is the only hiding place
##   warden   the huge one: sees and hears, cannot be hurt, can only be stopped for five seconds
## They move on the shared navigation mesh with a NavigationAgent3D. The EMP stunner holds any of them still.

enum S { PATROL, INVESTIGATE, CHASE, STUNNED, SEARCH }

const KINDS := {
	"crawler": {"size": 1.7, "walk": 1.1, "chase": 2.6, "hear": 0.7, "sight": 5.0, "radius": 0.4, "height": 1.0, "damage": 1, "gravity": true},
	"hunter": {"size": 2.0, "walk": 1.6, "chase": 3.4, "hear": 1.5, "sight": 0.0, "radius": 0.4, "height": 1.9, "damage": 1, "gravity": true},
	"warden": {"size": 3.2, "walk": 1.8, "chase": 4.2, "hear": 1.3, "sight": 16.0, "radius": 0.7, "height": 3.0, "damage": 2, "gravity": false},
}

var kind := "crawler"
var game: Game
var patrol: Array = []
var state := S.PATROL
var rage := 1.0                 # the Warden in the last chapter is faster

var agent: NavigationAgent3D
var model: Node3D
var _anim: AnimationPlayer
var _clip := ""
var _cfg: Dictionary
var _wp := 0
var _wait := 0.0
var _target := Vector3.ZERO
var _last_known := Vector3.ZERO
var _lost := 0.0
var _state_t := 0.0
var _step_t := 0.0
var _hit_cd := 0.0
var _sees := false
var _look_t := 0.0
var _drag: Use = null


func _ready() -> void:
	_cfg = KINDS[kind]
	collision_layer = Data.L_ENEMY
	collision_mask = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = _cfg.radius
	cap.height = _cfg.height
	cs.shape = cap
	cs.position.y = _cfg.height * 0.5
	add_child(cs)
	agent = NavigationAgent3D.new()
	agent.path_desired_distance = 0.6
	agent.target_desired_distance = 0.9
	agent.radius = _cfg.radius
	agent.avoidance_enabled = false
	add_child(agent)
	model = Rig.make(kind, _cfg.size)
	if model != null:
		_anim = model.get_meta("anim")
	else:
		model = Assets.make(kind, _cfg.size)
	add_child(model)
	_last_known = global_position
	_play("idle")
	if not patrol.is_empty():
		_go(patrol[0])


func _exit_tree() -> void:
	if game != null:
		game.enemies.erase(self)


# ── senses ───────────────────────────────────────────────────────────────────

## Something made a noise at `pos`, audible `radius` metres away (scaled by how well this kind hears).
func hear(pos: Vector3, radius: float, _what: String) -> void:
	if state == S.STUNNED or not is_inside_tree():
		return
	if global_position.distance_to(pos) > radius * _cfg.hear:
		return
	_last_known = pos
	if state == S.CHASE:
		return
	state = S.INVESTIGATE
	_state_t = 0.0
	_go(pos)


func _can_see(p: Player) -> bool:
	var sight: float = _cfg.sight
	if sight <= 0.0 or p.hidden:
		return false
	var from := global_position + Vector3(0, _cfg.height * 0.85, 0)
	var to := p.eye_pos()
	var d := from.distance_to(to)
	if d > sight:
		return false
	var fwd := -global_transform.basis.z
	if fwd.dot((to - from).normalized()) < 0.2 and d > 2.5:
		return false
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


## Whether it had a clear line to the player's position, hidden or not (used the moment a locker door closes).
func _can_see_from(p: Player) -> bool:
	if _cfg.sight <= 0.0:
		return false
	var from := global_position + Vector3(0, _cfg.height * 0.85, 0)
	var to := p.global_position + Vector3(0, 1.4, 0)
	if from.distance_to(to) > _cfg.sight * 1.2:
		return false
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


# ── states ───────────────────────────────────────────────────────────────────

func stun(seconds: float) -> void:
	if state == S.STUNNED:
		return
	state = S.STUNNED
	_state_t = 0.0
	_wait = seconds
	velocity = Vector3.ZERO
	_play("recoil")
	game.sfx.play_at("zap", global_position + Vector3(0, 1.2, 0), 0.0)
	game.sparks_at(global_position + Vector3(0, _cfg.height * 0.6, 0))


func drag_from(u: Use) -> void:
	_drag = u
	state = S.CHASE
	_last_known = u.hide_pos
	_lost = 0.0


func _physics_process(delta: float) -> void:
	if game == null or game.player == null or game.paused_world() or game.enemies_off:
		return
	_state_t += delta
	_hit_cd = maxf(0.0, _hit_cd - delta)
	var p := game.player
	match state:
		S.STUNNED:
			if _state_t >= _wait:
				state = S.INVESTIGATE
				_state_t = 0.0
				_go(_last_known if _last_known != Vector3.ZERO else p.global_position)
			_apply(delta, 0.0)
			return
		S.PATROL:
			_patrol(delta)
		S.INVESTIGATE:
			_investigate(delta)
		S.CHASE:
			_chase(delta, p)
		S.SEARCH:
			_search(delta)
	# Eyes: crawlers and the Warden notice you; the blind hunters never do.
	_look_t -= delta
	if _look_t <= 0.0 and state != S.CHASE and state != S.STUNNED:
		_look_t = 0.2
		if _can_see(p):
			_enter_chase(p)


func _enter_chase(p: Player) -> void:
	state = S.CHASE
	_lost = 0.0
	_last_known = p.global_position
	game.sfx.play_at("growl", global_position + Vector3(0, 1.2, 0), -2.0, 0.6 if kind == "warden" else 1.0)
	p.shake(0.4)


func _patrol(delta: float) -> void:
	if patrol.is_empty():
		_play("idle")
		_apply(delta, 0.0)
		return
	if _wait > 0.0:
		_wait -= delta
		_play("idle")
		_apply(delta, 0.0)
		return
	if agent.is_navigation_finished() or global_position.distance_to(patrol[_wp]) < 1.2:
		_wp = (_wp + 1) % patrol.size()
		_wait = randf_range(1.0, 3.0)
		_go(patrol[_wp])
		return
	_move(delta, _cfg.walk, "stomp" if kind == "warden" else ("crawl" if kind == "crawler" else "sweep"))


func _investigate(delta: float) -> void:
	if agent.is_navigation_finished() or global_position.distance_to(_target) < 1.2:
		state = S.SEARCH
		_state_t = 0.0
		return
	_move(delta, _cfg.walk * 1.5 * rage, "stomp" if kind == "warden" else ("crawl" if kind == "crawler" else "sweep"))


func _search(delta: float) -> void:
	_apply(delta, 0.0)
	_play("sweep" if kind != "crawler" else "idle")
	if _state_t > 4.0:
		state = S.PATROL
		_wait = 0.0
		if not patrol.is_empty():
			_go(patrol[_wp])


func _chase(delta: float, p: Player) -> void:
	if _drag != null:
		_target = Vector3(_drag.hide_pos.x, 0.0, _drag.hide_pos.z)
		if global_position.distance_to(_target) < 1.5:
			game.pull_from_hide(self)
			_drag = null
			_hit_cd = 1.4
		else:
			_move(delta, _cfg.chase * rage, "run")
		return
	var seen := _can_see(p)
	if seen or (_cfg.sight <= 0.0 and not p.hidden):
		_lost = 0.0 if seen else _lost
	if seen:
		_last_known = p.global_position
	else:
		_lost += delta
	# A blind hunter keeps coming to the last sound until it stops hearing anything new.
	if _lost > (7.0 if _cfg.sight > 0.0 else 5.0) or (p.hidden and _drag == null and _lost > 1.0):
		state = S.INVESTIGATE
		_state_t = 0.0
		_go(_last_known)
		return
	var tgt := _last_known
	if agent.target_position.distance_to(tgt) > 0.8:
		_go(tgt)
	var dist := global_position.distance_to(p.global_position)
	if dist < 1.6 + (0.3 if kind == "warden" else 0.0) and _hit_cd <= 0.0 and not p.hidden:
		_hit_cd = 1.4
		game.hurt_player(_cfg.damage, global_position)
		_play("lunge")
		return
	var clip := "lunge" if (dist < 3.0 and kind != "crawler") else ("crawl" if kind == "crawler" else "run")
	_move(delta, _cfg.chase * rage, clip)


# ── movement ─────────────────────────────────────────────────────────────────

func _go(pos: Vector3) -> void:
	_target = pos
	var synced := NavigationServer3D.map_get_iteration_id(game.world.get_world_3d().navigation_map) > 0
	agent.target_position = game.world.snap(pos) if synced else pos


func _move(delta: float, speed: float, clip: String) -> void:
	var next := agent.get_next_path_position()
	var to := next - global_position
	to.y = 0.0
	if to.length() < 0.05:
		_apply(delta, 0.0)
		return
	var dir := to.normalized()
	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), clampf(delta * 6.0, 0.0, 1.0))
	_play(clip)
	if _anim != null:
		var base := {"crawl": 1.1, "sweep": 1.6, "stomp": 1.8, "run": 4.2, "lunge": 4.2}
		_anim.speed_scale = clampf(speed / float(base.get(clip, 2.0)), 0.5, 2.0)
	_step(delta, speed)
	_apply(delta, speed)


func _apply(delta: float, speed: float) -> void:
	if speed == 0.0:
		velocity.x = move_toward(velocity.x, 0.0, 20.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 20.0 * delta)
	if _cfg.gravity:
		velocity.y = -2.0
	else:
		velocity.y = 0.0
	move_and_slide()


func _step(delta: float, speed: float) -> void:
	_step_t -= delta * speed
	if _step_t > 0.0:
		return
	_step_t = 1.6
	var d := global_position.distance_to(game.player.global_position)
	if kind == "warden":
		game.sfx.play_at("mech_step", global_position, 4.0, randf_range(0.8, 1.0))
		# Heavy metal footsteps shake the screen, more the nearer it is.
		if d < 18.0:
			game.player.shake(clampf(1.0 - d / 18.0, 0.0, 1.0) * 0.5)
	elif kind == "hunter":
		game.sfx.play_at("hollow_step", global_position, -2.0)
	else:
		game.sfx.play_at("scrape", global_position, -4.0)


func _play(clip: String) -> void:
	if _anim == null or clip == _clip:
		return
	if not _anim.has_animation(clip):
		return
	_clip = clip
	_anim.play(clip, 0.25)
