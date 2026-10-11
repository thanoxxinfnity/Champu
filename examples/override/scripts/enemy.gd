class_name Enemy
extends CharacterBody3D
## The things that walk the facility. Three kinds, one state machine (Patrol, Investigate, Chase, Stunned, Search):
##   crawler  a broken maintenance unit: sees a little, hears well, calls its pack, and pounces after a visible crouch
##   hunter   BLIND: it lives by its ears. Anything you do that carries (steps, a bang, a pick-up) draws it and, while you keep making
##            noise, kills; stand still or crouch and it only listens. A thrown scrap clangs and it goes there instead of to you.
##   warden   the huge one: sees and hears, cannot be hurt, can only be stopped for a few seconds, checks the lockers when it loses you
## They move on the shared navigation mesh with a NavigationAgent3D. The EMP stunner holds any of them still.
## Every attack has a tell: a wind-up the player can see and hear, and a window to step out of reach.

enum S { PATROL, INVESTIGATE, CHASE, STUNNED, SEARCH }

const KINDS := {
	"crawler": {"size": 1.7, "walk": 1.1, "chase": 2.6, "hear": 0.7, "sight": 5.0, "radius": 0.4, "height": 1.0, "damage": 1, "gravity": true, "windup": 0.45, "reach": 1.5, "search": 2},
	"hunter": {"size": 2.0, "walk": 1.6, "chase": 3.4, "hear": 1.5, "sight": 0.0, "radius": 0.4, "height": 1.9, "damage": 1, "gravity": true, "windup": 0.5, "reach": 1.7, "search": 3},
	"warden": {"size": 3.2, "walk": 1.8, "chase": 4.2, "hear": 1.3, "sight": 16.0, "radius": 0.45, "height": 3.0, "damage": 2, "gravity": false, "windup": 0.6, "reach": 2.0, "search": 3},
}

## A blind creature only strikes while it has heard the player this recently.
const HEARD_WINDOW := 0.75
## Colours of the creature's eyes / band by what it is doing, so the player can read it.
const LOOK := {S.PATROL: Color(0.2, 0.5, 1.0), S.INVESTIGATE: Color(1.0, 0.75, 0.2), S.CHASE: Color(1.0, 0.1, 0.05), S.STUNNED: Color(0.1, 0.15, 0.25), S.SEARCH: Color(1.0, 0.55, 0.15)}
const WARDEN_LOOK := {S.PATROL: Color(1.0, 0.35, 0.1), S.INVESTIGATE: Color(1.0, 0.6, 0.1), S.CHASE: Color(1.0, 0.02, 0.02), S.STUNNED: Color(0.15, 0.1, 0.2), S.SEARCH: Color(1.0, 0.5, 0.1)}

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
var _look_t := 0.0
var _drag: Use = null
var _heard_player_t := 99.0     # seconds since it last heard the player (not a decoy)
var _windup := 0.0              # > 0 while it is winding up a strike
var _pounce_t := 0.0
var _pounce_dir := Vector3.ZERO
var _alert_cd := 0.0
var _search_pts: Array = []
var _search_i := -1
var _search_moving := false
var _stuck_t := 0.0
var _prog_t := 0.0
var _prog_pos := Vector3.ZERO
var _stuck_n := 0
var _nudge_t := 0.0
var _nudge_dir := 1.0
var _stun_immune := 0.0
var _look_state := -1
var _glow: Array = []
var _glow_base: Array = []       # each glow material's normal brightness (for the flicker)
var _decoys := 0                 # clangs it has been led to: after two it stops believing them
var _decoy_t := 0.0
var _roar_t := 0.0               # lock-on roar: it stops and screams before it comes
var _twitch_t := 6.0
var _flicker := 0.0
var _check_u: Use = null         # the locker it is banging on
var _check_t := 0.0


func _ready() -> void:
	_cfg = KINDS[kind]
	collision_layer = Data.L_ENEMY
	collision_mask = Data.L_WORLD | Data.L_BLOCK | Data.L_PLAYER      # the barrier round a safe station stops them; the player is solid, not a ghost it walks through
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
	agent.set_navigation_map(game.world.enemy_map)
	model = Rig.make(kind, _cfg.size)
	if model != null:
		_anim = model.get_meta("anim")
		_glow = model.get_meta("glow_mats", [])
		for m in _glow:
			_glow_base.append((m as StandardMaterial3D).emission_energy_multiplier)
	else:
		model = Assets.make(kind, _cfg.size)
	add_child(model)
	_last_known = global_position
	_play("idle")
	_show_state()
	if not patrol.is_empty():
		_go(patrol[0])


func _exit_tree() -> void:
	if game != null:
		game.enemies.erase(self)


# ── senses ───────────────────────────────────────────────────────────────────

## Is this noise the player's own doing (so a blind creature may kill by it), or a decoy?
static func is_player_noise(what: String) -> bool:
	return what != "clang" and what != "pack" and what != "beep"


## Something made a noise at `pos`, audible `radius` metres away (scaled by how well this kind hears).
func hear(pos: Vector3, radius: float, what: String) -> void:
	if state == S.STUNNED or not is_inside_tree():
		return
	var reach: float = radius * float(_cfg.hear)
	if global_position.distance_to(pos) > reach:
		return
	# Walls muffle it: a sound with no clear line to the creature carries little more than half as far.
	var from := global_position + Vector3(0, float(_cfg.height) * 0.6, 0)
	var q := PhysicsRayQueryParameters3D.create(from, pos + Vector3(0, 0.6, 0), Data.L_WORLD)
	if not get_world_3d().direct_space_state.intersect_ray(q).is_empty() and global_position.distance_to(pos) > reach * 0.55:
		return
	if what == "clang":
		_decoys += 1
		_decoy_t = 50.0
	# Only what the player does at the player's own spot counts as the player (a fake bang across the room is just a sound).
	var by_player := is_player_noise(what) and pos.distance_to(game.player.global_position) < 3.5
	if by_player and Safe.inside(game.player.global_position):
		by_player = false      # it cannot reach them: it only goes and looks
	if by_player:
		_heard_player_t = 0.0
	if state == S.CHASE:
		if by_player or _cfg.sight > 0.0:
			_last_known = pos if (by_player or _lost > 1.0) else _last_known
		elif _heard_player_t > 1.2:
			# A blind creature that has lost you follows a decoy.
			_last_known = pos
			_set_state(S.INVESTIGATE)
			_go(pos)
		return
	_last_known = pos
	if _cfg.sight <= 0.0 and by_player:
		# The blind kill by sound: what you do out loud, it comes for.
		_enter_chase(game.player)
		_last_known = pos
		_go(pos)
		return
	_set_state(S.INVESTIGATE)
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

func _set_state(s: S) -> void:
	state = s
	_state_t = 0.0
	if s != S.CHASE:
		_windup = 0.0
		_pounce_t = 0.0
	_show_state()


## The creature shows what it is doing in its eyes: blue and calm, amber when it heard something, red when it hunts.
func _show_state() -> void:
	if _look_state == state or _glow.is_empty():
		return
	_look_state = state
	var table: Dictionary = WARDEN_LOOK if kind == "warden" else LOOK
	var c: Color = table[state]
	if kind == "crawler" and state == S.PATROL:
		c = Color(1.0, 0.45, 0.1)
	for m in _glow:
		var sm := m as StandardMaterial3D
		sm.albedo_color = c
		sm.emission = c


func stun(seconds: float) -> void:
	if state == S.STUNNED or _stun_immune > 0.0:
		return
	_set_state(S.STUNNED)
	_wait = seconds
	velocity = Vector3.ZERO
	_play("recoil")
	game.sfx.play_at("zap", global_position + Vector3(0, 1.2, 0), 0.0)
	game.sparks_at(global_position + Vector3(0, _cfg.height * 0.6, 0))


func drag_from(u: Use) -> void:
	_drag = u
	_set_state(S.CHASE)
	_last_known = u.hide_pos
	_lost = 0.0


func _physics_process(delta: float) -> void:
	if game == null or game.player == null or game.paused_world() or game.enemies_off:
		return
	_show_state()
	_state_t += delta
	_hit_cd = maxf(0.0, _hit_cd - delta)
	_alert_cd = maxf(0.0, _alert_cd - delta)
	_stun_immune = maxf(0.0, _stun_immune - delta)
	_heard_player_t += delta
	_decoy_t = maxf(0.0, _decoy_t - delta)
	if _decoy_t <= 0.0:
		_decoys = 0
	_devil(delta)
	var p := game.player
	match state:
		S.STUNNED:
			if _state_t >= _wait:
				_stun_immune = 2.0 if kind != "warden" else 3.0
				_set_state(S.INVESTIGATE)
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
	if state == S.CHASE or Safe.inside(p.global_position):
		return
	_set_state(S.CHASE)
	_lost = 0.0
	_last_known = p.global_position
	_roar_t = {"crawler": 0.45, "hunter": 0.7, "warden": 1.0}[kind]
	game.sfx.play_at("growl", global_position + Vector3(0, 1.2, 0), -2.0, 0.6 if kind == "warden" else (0.8 if kind == "hunter" else 1.0))
	p.shake(0.4)
	if kind == "crawler":
		_call_pack(p.global_position)


## Crawlers hunt in packs: one that sees you screeches, and the others near it come to where you were.
func _call_pack(pos: Vector3) -> void:
	if _alert_cd > 0.0:
		return
	_alert_cd = 4.0
	game.sfx.play_at("screech", global_position + Vector3(0, 0.8, 0), -4.0, 1.1)
	for e in game.enemies:
		if is_instance_valid(e) and e != self and e.kind == kind and e.global_position.distance_to(global_position) < 16.0:
			if e.state == S.PATROL or e.state == S.SEARCH:
				e.hear(pos, 999.0, "pack")


## The unsettling bits: now and then, while it is not hunting, it glitches (a flinch, the eyes stutter, a crackle), and the
## glow flickers like bad wiring. These are tells that something is near, never a way to hurt you.
func _devil(delta: float) -> void:
	_flicker = maxf(0.0, _flicker - delta)
	if not _glow.is_empty():
		for i in range(_glow.size()):
			var m := _glow[i] as StandardMaterial3D
			var base: float = _glow_base[i]
			if _flicker > 0.0:
				m.emission_energy_multiplier = base * (0.0 if randf() < 0.5 else randf_range(0.5, 1.8))
			elif state == S.CHASE:
				m.emission_energy_multiplier = base * (1.4 + 0.3 * sin(_state_t * 14.0))
			else:
				m.emission_energy_multiplier = base
	if state == S.PATROL or state == S.SEARCH:
		_twitch_t -= delta
		if _twitch_t <= 0.0:
			_twitch_t = randf_range(4.0, 9.0)
			_flicker = 0.5
			_clip = ""
			_play("recoil")
			if kind != "warden":
				game.sfx.play_at("zap", global_position + Vector3(0, 1.0, 0), -14.0, randf_range(1.2, 1.8))


func _locker_near() -> Use:
	for u in game.world.uses:
		if is_instance_valid(u) and u.id == "hide" and Vector2(u.hide_pos.x - global_position.x, u.hide_pos.z - global_position.z).length() < 3.4:
			return u
	return null


## The longer you survive and the more you die, the keener they get (up to 15 % faster).
func _adapt() -> float:
	return 1.0 + minf(0.15, float(game.s.deaths) * 0.03)


func _pack_mates() -> int:
	var n := 0
	for e in game.enemies:
		if is_instance_valid(e) and e != self and e.kind == kind and e.state == S.CHASE and e.global_position.distance_to(global_position) < 9.0:
			n += 1
	return n


func _walk_clip() -> String:
	return "stomp" if kind == "warden" else ("crawl" if kind == "crawler" else "sweep")


func _patrol(delta: float) -> void:
	if patrol.is_empty():
		_play("idle")
		_apply(delta, 0.0)
		return
	if _wait > 0.0:
		_wait -= delta
		_play("idle" if kind != "hunter" else "sweep")
		_apply(delta, 0.0)
		return
	if agent.is_navigation_finished() or global_position.distance_to(patrol[_wp]) < 1.2:
		_wp = (_wp + 1) % patrol.size()
		_wait = randf_range(1.0, 3.0)
		_go(patrol[_wp])
		return
	_move(delta, _cfg.walk, _walk_clip())


func _investigate(delta: float) -> void:
	if agent.is_navigation_finished() or global_position.distance_to(_target) < 1.2:
		_begin_search()
		return
	_move(delta, float(_cfg.walk) * 1.5 * rage * _adapt(), _walk_clip())


## After a sound, it does not give up at once: it stands and listens, then checks a few places around the spot.
## The Warden also walks up to the lockers near it.
func _begin_search() -> void:
	_set_state(S.SEARCH)
	_search_pts.clear()
	_search_i = -1
	_search_moving = false
	_wait = 1.6
	for i in range(int(_cfg.search)):
		var off := Vector3(randf_range(-6.0, 6.0), 0.0, randf_range(-6.0, 6.0))
		_search_pts.append(_last_known + off)
	# Fooled twice by thrown scrap, it stops believing it: it also goes to where the throw came from.
	if _decoys >= 2 and game.last_throw_from != Vector3.ZERO:
		_search_pts.push_front(game.last_throw_from)
	# It remembers the lockers you have hidden in, and goes to bang on them (a creature that can see; the blind cannot know).
	if _cfg.sight > 0.0:
		var asked := 0
		for spot in game.hid_spots:
			if asked < 2 and (spot as Vector3).distance_to(_last_known) < 14.0:
				for u in game.world.uses:
					if is_instance_valid(u) and u.id == "hide" and u.hide_pos.distance_to(spot) < 0.5:
						_search_pts.push_front(Vector3(u.hide_pos.x, 0.0, u.hide_pos.z) + Vector3(-sin(deg_to_rad(u.hide_yaw)), 0, -cos(deg_to_rad(u.hide_yaw))) * 1.6)
						asked += 1
						break


func _search(delta: float) -> void:
	if _wait > 0.0:
		_wait -= delta
		_apply(delta, 0.0)
		_play("sweep" if kind != "crawler" else "idle")
		return
	if _check_u != null:
		_check_t -= delta
		_apply(delta, 0.0)
		_play("lunge")
		if _check_t <= 0.0:
			var u := _check_u
			_check_u = null
			if game.player.hiding_in() == u:
				drag_from(u)
		return
	if _search_moving:
		if agent.is_navigation_finished() or global_position.distance_to(_target) < 1.3 or _state_t > 40.0:
			_search_moving = false
			_wait = 1.4
			var lk := _locker_near() if _cfg.sight > 0.0 else null
			if lk != null:
				# It hammers on the door before it opens it: the way out is the next second.
				_check_u = lk
				_check_t = 1.1
				_wait = 0.0
				game.sfx.play_at("crash", lk.global_position + Vector3(0, 1.0, 0), -3.0, 1.3)
				game.player.shake(0.5 if kind == "warden" else 0.25)
			return
		_move(delta, _cfg.walk, _walk_clip())
		return
	_search_i += 1
	if _search_i >= _search_pts.size():
		_set_state(S.PATROL)
		_wait = 0.0
		if not patrol.is_empty():
			_go(patrol[_wp])
		return
	_go(_search_pts[_search_i])
	_search_moving = true


func _chase(delta: float, p: Player) -> void:
	# Someone in the water of a safe station cannot be reached: it gives up and goes to look at the edge.
	if _drag == null and Safe.inside(p.global_position):
		_last_known = p.global_position
		_set_state(S.INVESTIGATE)
		_go(_last_known)
		return
	if _drag != null:
		_target = Vector3(_drag.hide_pos.x, 0.0, _drag.hide_pos.z)
		if global_position.distance_to(_target) < 1.5:
			game.pull_from_hide(self)
			_drag = null
			_hit_cd = 1.4
		else:
			_move(delta, _cfg.chase * rage, "run")
		return
	var dist := global_position.distance_to(p.global_position)
	var blind: bool = _cfg.sight <= 0.0
	var seen := _can_see(p)
	# The lock-on roar: it stops, turns to you and screams. A beat to run, or to freeze.
	if _roar_t > 0.0:
		_roar_t -= delta
		_apply(delta, 0.0)
		var face := p.global_position - global_position
		face.y = 0.0
		if face.length() > 0.1:
			rotation.y = lerp_angle(rotation.y, atan2(-face.x, -face.z), clampf(delta * 10.0, 0.0, 1.0))
		_play("scream")
		return
	if seen:
		_lost = 0.0
		_last_known = p.global_position
	elif blind:
		_lost = _heard_player_t
	else:
		_lost += delta
	# A sighted creature gives up after seven seconds without you; a blind one after two without a sound.
	if _lost > (7.0 if not blind else 2.4) or (p.hidden and _drag == null and _lost > 1.0):
		_set_state(S.INVESTIGATE)
		_go(_last_known)
		return
	# Wind-up: it stops and shows the strike is coming; you can still step out of reach.
	if _windup > 0.0:
		_windup -= delta
		_apply(delta, 0.0)
		var to := (p.global_position - global_position)
		to.y = 0.0
		if to.length() > 0.1:
			rotation.y = lerp_angle(rotation.y, atan2(-to.x, -to.z), clampf(delta * 8.0, 0.0, 1.0))
		_play("lunge")
		if _windup <= 0.0:
			_strike(p, dist)
		return
	if _pounce_t > 0.0:
		_pounce_t -= delta
		velocity.x = _pounce_dir.x * 7.5
		velocity.z = _pounce_dir.z * 7.5
		_apply(delta, 7.5)
		if global_position.distance_to(p.global_position) < 1.2 and not p.hidden:
			_pounce_t = 0.0
			_hit_cd = 2.2
			game.hurt_player(_cfg.damage, global_position)
		elif _pounce_t <= 0.0:
			_hit_cd = 1.6
		return
	var tgt := _last_known
	if seen and kind != "hunter":
		# It does not run to where you are but to where you are going; a crawler in a pack takes a side.
		var lead := 0.7 if kind == "warden" else 0.4
		tgt = p.global_position + Vector3(p.velocity.x, 0.0, p.velocity.z) * lead
		if kind == "crawler" and dist > 4.0 and _pack_mates() > 0:
			var side := 1.0 if get_instance_id() % 2 == 0 else -1.0
			var across := Vector3(-(p.global_position - global_position).z, 0.0, (p.global_position - global_position).x).normalized()
			tgt += across * side * 2.4
	if agent.target_position.distance_to(tgt) > 0.8:
		_go(tgt)
	var heard_now := _heard_player_t < HEARD_WINDOW
	var can_strike := not p.hidden and _hit_cd <= 0.0 and (seen or (blind and heard_now))
	if can_strike:
		if kind == "crawler" and dist < 3.4 and dist > 1.6:
			_pounce_dir = (p.global_position - global_position)
			_pounce_dir.y = 0.0
			_pounce_dir = _pounce_dir.normalized()
			_windup = _cfg.windup
			game.sfx.play_at("growl", global_position + Vector3(0, 0.6, 0), -3.0, 1.4)
			return
		if dist < float(_cfg.reach) + (0.3 if kind == "warden" else 0.0):
			_windup = _cfg.windup
			game.sfx.play_at("growl", global_position + Vector3(0, 1.2, 0), -3.0, 0.7 if kind != "crawler" else 1.3)
			return
	# A blind creature on top of a silent player can only listen.
	if blind and not heard_now and dist < 2.4:
		_apply(delta, 0.0)
		_play("sweep")
		return
	var clip := "lunge" if (dist < 3.0 and kind != "crawler") else ("crawl" if kind == "crawler" else "run")
	var sp: float = float(_cfg.chase) * rage * _adapt()
	if kind == "crawler":
		# Skittering: it freezes and bursts forward, never at an even pace.
		sp *= 0.3 + 1.5 * clampf(sin(_state_t * 7.0) * 1.7, 0.0, 1.0)
	_move(delta, sp, clip)


## The wind-up has run out: it hits whatever is still in reach (a crawler leaps instead).
func _strike(p: Player, dist: float) -> void:
	if kind == "crawler" and dist > 1.7:
		_pounce_t = 0.4
		return
	var blind: bool = _cfg.sight <= 0.0
	var reach: float = float(_cfg.reach) + 0.7
	var ok := dist < reach and not p.hidden
	if blind:
		# It must have heard the player again during the wind-up: freeze when you hear it coming and the blow lands on air.
		ok = ok and _heard_player_t < float(_cfg.windup) + 0.15
	if ok:
		_hit_cd = 1.4
		game.hurt_player(_cfg.damage, global_position)
	else:
		_hit_cd = 0.8      # it missed: you moved, or you went quiet


# ── movement ─────────────────────────────────────────────────────────────────

func _go(pos: Vector3) -> void:
	_target = pos
	_stuck_t = 0.0
	_prog_t = 0.0
	_prog_pos = global_position
	var synced := NavigationServer3D.map_get_iteration_id(game.world.enemy_map) > 0
	agent.target_position = game.world.snap_enemy(pos) if synced else pos


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
	if _nudge_t > 0.0:
		_nudge_t -= delta
		velocity.x += -dir.z * _nudge_dir * speed * 0.9
		velocity.z += dir.x * _nudge_dir * speed * 0.9
	rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), clampf(delta * 6.0, 0.0, 1.0))
	_play(clip)
	if _anim != null:
		var base := {"crawl": 1.1, "sweep": 1.6, "stomp": 1.8, "run": 4.2, "lunge": 4.2}
		_anim.speed_scale = clampf(speed / float(base.get(clip, 2.0)), 0.5, 2.0)
	_step(delta, speed)
	_apply(delta, speed)
	# Stuck on a corner or a prop (the navigation mesh does not know about furniture): every two seconds, has it got anywhere?
	# First it asks the mesh again and sidesteps; if that does not free it either, it gives the errand up.
	_prog_t += delta
	if _prog_t >= 2.0:
		_prog_t = 0.0
		if global_position.distance_to(_prog_pos) < 0.45:
			_stuck_n += 1
			if _stuck_n == 1:
				_go(_target)
				_nudge_t = 0.7
				_nudge_dir = (1.0 if randf() < 0.5 else -1.0)
			else:
				_stuck_n = 0
				match state:
					S.INVESTIGATE:
						_begin_search()
					S.SEARCH:
						_search_moving = false
						_wait = 0.1
					S.PATROL:
						if not patrol.is_empty():
							_wp = (_wp + 1) % patrol.size()
							_go(patrol[_wp])
		else:
			_stuck_n = 0
		_prog_pos = global_position


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
