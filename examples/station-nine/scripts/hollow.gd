class_name Hollow
extends Node3D
## The creature. It lives in the dark, hunts by sound and by sight, and cannot cross into a lit
## room. A torch held on it makes it recoil. It walks the station's waypoint graph, so it never
## clips a wall, and it only ever steps on dark ground.

enum S { DORMANT, PATROL, INVESTIGATE, HUNT, STUNNED, FLEE, LURK, CAUGHT }

signal caught_player
signal state_changed(state: int)

const KILL_RANGE := 1.15
const SIGHT_TORCH := 13.0
const SIGHT_DARK := 5.5

var game: Game
var state := S.DORMANT
var model: Node3D
var _mats: Array = []
var _path: Array = []             # node ids still to walk
var _wait := 0.0
var _target_node := ""
var _last_known := Vector3.ZERO
var _lost := 0.0
var _dose := 0.0                  # seconds of torch light taken
var _need := 0.9                  # how many it takes to make it flinch (grows with every flinch)
var _state_t := 0.0
var _phase := 0.0
var _speed_now := 0.0
var _los_t := 0.0
var _sees := false
var _noise_cd := 0.0
var _growl_t := 6.0
var _step_t := 0.0
var _flash := 0.0
var _locker_target: Use = null
var speed_bonus := 0.0
var grace := 0.0                  # seconds it will not notice you (after a respawn)
var _yaw := 0.0


func _ready() -> void:
	model = Assets.make("hollow", 2.35, false, true)
	_mats = model.get_meta("puppet_mats", [])
	add_child(model)
	var eye := OmniLight3D.new()
	eye.light_color = Color(1.0, 0.7, 0.25)
	eye.light_energy = 0.9
	eye.omni_range = 3.2
	eye.position = Vector3(0, 2.2, -0.25)
	add_child(eye)
	visible = false


func place(node_id: String) -> void:
	global_position = game.level.nodes[node_id].pos
	_target_node = node_id
	_path.clear()


func wake(node_id: String) -> void:
	place(node_id)
	visible = true
	_enter(S.PATROL)
	_wait = 2.0


func sleep() -> void:
	visible = false
	_enter(S.DORMANT)
	game.sfx.breath_at(global_position, -80.0)


func _enter(s: int) -> void:
	if state == s:
		return
	state = s
	_state_t = 0.0
	state_changed.emit(s)


## Something made a noise at `pos`; `radius` is how far it carries.
func hear(pos: Vector3, radius: float, kind: String) -> void:
	if state == S.DORMANT or state == S.STUNNED or state == S.FLEE or state == S.CAUGHT or grace > 0.0:
		return
	if game.level.is_lit(game.level.zone_at(pos)) and kind != "bang":
		return
	var d := global_position.distance_to(pos)
	if d > radius:
		return
	if state == S.HUNT:
		_last_known = pos
		return
	_last_known = pos
	_go_to_point(pos)
	_enter(S.INVESTIGATE)
	_wait = 2.5


func _go_to_point(pos: Vector3) -> void:
	var from := game.level.nearest_node(global_position, true)
	var to := game.level.nearest_node(pos, true)
	_path = game.level.route(from, to)
	if not _path.is_empty() and _path[0] == from:
		_path.pop_front()
	_target_node = to


func _process(delta: float) -> void:
	if state == S.DORMANT:
		return
	_phase += delta * _speed_now * 2.6
	for m in _mats:
		(m as ShaderMaterial).set_shader_parameter("phase", _phase)
		(m as ShaderMaterial).set_shader_parameter("speed", clampf(_speed_now / 3.5, 0.0, 1.0))
		(m as ShaderMaterial).set_shader_parameter("lean", 0.4 if state == S.HUNT else 0.15)
		(m as ShaderMaterial).set_shader_parameter("arms_up", 0.7 if state == S.HUNT else 0.0)
		(m as ShaderMaterial).set_shader_parameter("limp", 0.5)
		_flash = move_toward(_flash, 0.0, delta * 2.0)
		(m as ShaderMaterial).set_shader_parameter("flash", _flash)
	rotation.y = lerp_angle(rotation.y, _yaw, clampf(delta * 7.0, 0.0, 1.0))
	# Its breathing follows it: louder when it is close and has not seen you.
	var d := global_position.distance_to(game.player.global_position)
	game.sfx.breath_at(global_position + Vector3(0, 1.8, 0), clampf(-4.0 - d * 1.6, -80.0, -4.0) if d < 22.0 else -80.0)


func _physics_process(delta: float) -> void:
	if state == S.DORMANT or state == S.CAUGHT:
		return
	_state_t += delta
	grace = maxf(0.0, grace - delta)
	var p := game.player
	var to_p := p.global_position - global_position
	to_p.y = 0.0
	var dist := to_p.length()

	# A room that is lit while it stands in it burns it out of there.
	if game.level.is_lit(game.level.zone_at(global_position)) and state != S.FLEE:
		_flee(true)

	_see_and_stun(delta, dist)

	match state:
		S.PATROL:
			_patrol(delta)
		S.INVESTIGATE:
			if _walk(delta, 2.2 + speed_bonus * 0.3):
				_wait -= delta
				if _wait <= 0.0:
					_enter(S.PATROL)
		S.HUNT:
			_hunt(delta, dist)
		S.STUNNED:
			_speed_now = 0.0
			if _state_t > 2.4:
				_flee(false)
		S.FLEE:
			if _walk(delta, 5.5) and _state_t > 3.0 or _state_t > 9.0:
				_enter(S.PATROL)
				_wait = 3.0
		S.LURK:
			_lurk(delta, dist)

	# Death.
	if state in [S.HUNT, S.PATROL, S.INVESTIGATE, S.LURK] and not p.dead and not p.hidden and dist < KILL_RANGE and absf(p.global_position.y - global_position.y) < 1.5:
		if _clear(global_position + Vector3(0, 1.2, 0), p.eye_pos()):
			_kill()
	_growl_t -= delta
	if _growl_t <= 0.0 and state in [S.PATROL, S.INVESTIGATE, S.LURK, S.HUNT]:
		_growl_t = randf_range(7.0, 13.0)
		game.sfx.play_at("growl", global_position + Vector3(0, 1.6, 0), 2.0, randf_range(0.9, 1.1))


func _clear(a: Vector3, b: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(a, b, Data.L_WORLD)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _see_and_stun(delta: float, dist: float) -> void:
	var p := game.player
	_los_t -= delta
	if _los_t <= 0.0:
		_los_t = 0.12
		_sees = false
		if not p.hidden and not p.dead and grace <= 0.0:
			var vis := SIGHT_TORCH if p.torch_on else SIGHT_DARK
			if p.crouching:
				vis *= 0.5
			if dist < vis and not game.level.is_lit(game.level.zone_at(p.global_position)):
				_sees = _clear(global_position + Vector3(0, 1.9, 0), p.eye_pos())
			# Standing right beside it, it notices you whatever you do.
			if dist < 2.4 and _clear(global_position + Vector3(0, 1.4, 0), p.eye_pos()):
				_sees = true
	if _sees and state in [S.PATROL, S.INVESTIGATE, S.LURK]:
		_start_hunt()
	if _sees and state == S.HUNT:
		_last_known = p.global_position
		_lost = 0.0

	# The torch: held on it, it flinches.
	var lit_now := false
	if p.torch_on and not p.hidden and p.battery > 0.0 and state in [S.HUNT, S.PATROL, S.INVESTIGATE, S.LURK]:
		var to := (global_position + Vector3(0, 1.3, 0)) - p.cam.global_position
		var d := to.length()
		if d < 14.0 and to.normalized().dot(p.torch_dir()) > cos(deg_to_rad(19.0)):
			lit_now = _clear(p.cam.global_position, global_position + Vector3(0, 1.3, 0))
	if lit_now:
		_dose += delta
		_flash = 0.35
		if _dose >= _need:
			_dose = 0.0
			_need = minf(_need + 0.25, 2.2)
			_stun()
	else:
		_dose = maxf(0.0, _dose - delta * 0.8)


func _stun() -> void:
	_enter(S.STUNNED)
	game.sfx.play_at("screech", global_position + Vector3(0, 1.8, 0), 3.0)
	game.player.scare(0.6)
	game.ui.toast("It recoils from the light!")


func _flee(burned: bool) -> void:
	_enter(S.FLEE)
	var far := game.far_dark_node(global_position, game.player.global_position)
	_path = game.level.route(game.level.nearest_node(global_position, false), far, true)
	_target_node = far
	if burned:
		game.sfx.play_at("screech", global_position + Vector3(0, 1.8, 0), 2.0, 0.8)


func _start_hunt() -> void:
	_enter(S.HUNT)
	_lost = 0.0
	_last_known = game.player.global_position
	game.sfx.play_at("screech", global_position + Vector3(0, 1.8, 0), 0.0, 0.9)
	game.player.scare(0.5)


func _patrol(delta: float) -> void:
	if _path.is_empty():
		_speed_now = 0.0
		_wait -= delta
		if _wait <= 0.0:
			_pick_patrol()
			_wait = randf_range(1.5, 3.5)
		return
	_walk(delta, 1.8 + speed_bonus * 0.25)


func _pick_patrol() -> void:
	var from := game.level.nearest_node(global_position, true)
	var darks: Array = []
	for id in game.level.nodes:
		if not game.level.is_lit(game.level.nodes[id].zone):
			darks.append(id)
	if darks.is_empty():
		return
	# Half the time it drifts towards where you are: a hunter, not a screensaver.
	var pick: String = darks[randi() % darks.size()]
	if randf() < 0.55:
		var near := game.level.nearest_node(game.player.global_position, true)
		var route: Array = game.level.route(from, near)
		if route.size() > 2:
			pick = route[maxi(route.size() - 3, 0)]
	_path = game.level.route(from, pick)
	if not _path.is_empty() and _path[0] == from:
		_path.pop_front()
	_target_node = pick


## Walks the node path; returns true when it has arrived (path empty).
func _walk(delta: float, speed: float) -> bool:
	if _path.is_empty():
		_speed_now = 0.0
		return true
	var target: Vector3 = game.level.nodes[_path[0]].pos
	var to := target - global_position
	to.y = 0.0
	if to.length() < 0.35:
		_path.pop_front()
		return _path.is_empty()
	var step := to.normalized() * speed * delta
	global_position += step if step.length() < to.length() else to
	_yaw = atan2(-to.x, -to.z) if to.length() > 0.01 else _yaw
	_speed_now = speed
	_stepfx(delta, speed)
	return false


func _stepfx(delta: float, speed: float) -> void:
	_step_t -= delta * speed
	if _step_t <= 0.0:
		_step_t = 2.4
		game.sfx.play_at("hollow_step", global_position, -2.0, randf_range(0.85, 1.1))


func _hunt(delta: float, dist: float) -> void:
	var p := game.player
	var speed := 3.5 + speed_bonus * 0.3
	if _locker_target != null:
		# It saw you hide. It goes straight to the locker, and opens it.
		var at := Vector3(_locker_target.hide_pos.x, 0.0, _locker_target.hide_pos.z)
		var go := at - global_position
		go.y = 0.0
		if go.length() < 1.3:
			_kill()
			return
		global_position += go.normalized() * speed * delta
		_yaw = atan2(-go.x, -go.z)
		_speed_now = speed
		_stepfx(delta, speed)
		return
	var lit_player := game.level.is_lit(game.level.zone_at(p.global_position))
	if lit_player:
		_enter(S.LURK)
		return
	if _sees or (_lost < 1.2 and dist < 7.0):
		# Straight at you when it can see you and nothing is in the way.
		var to := p.global_position - global_position
		to.y = 0.0
		if _clear(global_position + Vector3(0, 1.0, 0), p.global_position + Vector3(0, 1.0, 0)):
			if to.length() > 0.2:
				var step := to.normalized() * speed * delta
				var next := global_position + step
				if not game.level.is_lit(game.level.zone_at(next)):
					global_position = next
				_yaw = atan2(-to.x, -to.z)
			_speed_now = speed
			_stepfx(delta, speed)
			_path.clear()
			return
	# Lost it: go to where it was last known, then look about, then give up.
	if not _sees:
		_lost += delta
	if _path.is_empty():
		_go_to_point(_last_known)
	if not _walk(delta, speed * 0.9) and _lost < 8.0:
		return
	if _lost >= 5.0 or _path.is_empty():
		if _lost >= 5.0:
			_enter(S.PATROL)
			_wait = 2.0
			_path.clear()


func _lurk(delta: float, dist: float) -> void:
	# You are in a lit room. It waits at the edge, as close as the dark allows, and watches.
	var p := game.player
	if not game.level.is_lit(game.level.zone_at(p.global_position)):
		_enter(S.HUNT)
		return
	var near := game.level.nearest_node(p.global_position, true)
	if _path.is_empty() and game.level.nearest_node(global_position, true) != near:
		_go_to_point(p.global_position)
	_walk(delta, 2.6)
	var to := p.global_position - global_position
	_yaw = atan2(-to.x, -to.z)
	if _state_t > 25.0 and dist > 12.0:
		_enter(S.PATROL)


func _kill() -> void:
	_enter(S.CAUGHT)
	caught_player.emit()


## It opens the locker the player is in. Called by the game when a hunted player hid in plain sight.
func drag_from(u: Use) -> void:
	_locker_target = u
	_enter(S.HUNT)
	_sees = false
	_last_known = u.hide_pos
	_lost = 0.0


func clear_drag() -> void:
	_locker_target = null


func face(pos: Vector3) -> void:
	var to := pos - global_position
	_yaw = atan2(-to.x, -to.z)
	rotation.y = _yaw
