class_name BotBrain
extends Node
## The mind of a bot: a PlayerController with no camera and no touch, steered from here. It loots when it is short of guns, roams otherwise, and when it sees an enemy
## it picks the weapon that suits the distance (melee up close, the strongest charged gauntlet that reaches), turns toward the enemy with a little aim error, strafes
## around it and fires. Stuck against something for a second: it jumps and jets over. Cheap: it thinks five times a second, the movement runs every frame.

var player: PlayerController
var mc: MatchController
var skill := 0.6                       # 0..1: aim error and reaction
var state := "roam"
var target: PlayerController
var goal := Vector3.ZERO
var _think_t := 0.0
var _strafe := 1.0
var _strafe_t := 0.0
var _stuck_t := 0.0
var _last_pos := Vector3.ZERO
var _jump_t := 0.0
var _want_yaw := 0.0
var _want_pitch := 0.0
var _aim_err := Vector2.ZERO
var _rng := RandomNumberGenerator.new()


func setup(p: PlayerController, m: MatchController, sk: float) -> void:
	player = p
	mc = m
	skill = sk
	_rng.randomize()
	_think_t = _rng.randf() * 0.3
	_want_yaw = _rng.randf() * TAU
	goal = p.global_position


func _physics_process(delta: float) -> void:
	if player == null or not player.alive or mc == null or not mc.running:
		if player != null:
			player.move_input = Vector2.ZERO
			player.jet_held = false
		return
	_think_t -= delta
	if _think_t <= 0.0:
		_think_t = _rng.randf_range(0.15, 0.25)
		_think()
	_move(delta)


func _gun_count() -> int:
	var n := 0
	for id in player.tool.inventory:
		if not Data.MELEE.has(id):
			n += 1
	return n


func _think() -> void:
	# an enemy in sight?
	var best: PlayerController = null
	var bd := 1.0e9
	for t in Combat.enemies(player):
		var d := player.global_position.distance_to(t.global_position)
		if d < 48.0 and d < bd and _sees(t):
			bd = d
			best = t
	target = best
	if target != null:
		state = "fight"
		_pick_weapon(bd)
		return
	# nothing to fight: loot, else roam
	if _gun_count() < 3 and mc.loot != null:
		var uid := mc.loot.nearest(player.global_position, 70.0)
		if uid >= 0:
			state = "loot"
			goal = mc.loot.items[uid].pos
			return
	if state != "roam" or player.global_position.distance_to(goal) < 4.0 or _stuck_t > 1.5:
		state = "roam"
		goal = mc.random_point_near(player.global_position, 90.0)
		_stuck_t = 0.0


func _sees(t: PlayerController) -> bool:
	var from := player.global_position + Vector3(0, 1.4, 0)
	var to := Combat.center(t)
	var q := PhysicsRayQueryParameters3D.create(from, to, 1)
	return player.get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _pick_weapon(dist: float) -> void:
	var tool := player.tool
	var best := ""
	var best_score := -1.0
	for id in tool.inventory:
		var info: Dictionary = Data.info_of(id)
		var melee := Data.MELEE.has(id)
		var reach := float(info.reach) + 0.8 if melee else lerpf(7.0, 42.0, float(info.range)) * 0.85
		if dist > reach:
			continue
		if not melee and (tool.is_locked(id) or tool.charge_of(id) < 0.12):
			continue
		var score := float(Data.DAMAGE[id].dmg) / maxf(tool.cooldown_for(id), 0.2)
		if melee and dist < 3.2:
			score *= 1.6
		if not melee and dist < 3.0:
			score *= 0.6
		if score > best_score:
			best_score = score
			best = id
	if best != "" and best != tool.weapon:
		tool.equip(best)


func _move(delta: float) -> void:
	var to_goal := goal - player.global_position
	to_goal.y = 0.0
	var mv := Vector2.ZERO
	var fire := false
	_strafe_t -= delta
	if _strafe_t <= 0.0:
		_strafe_t = _rng.randf_range(0.8, 2.0)
		_strafe = -_strafe if _rng.randf() < 0.6 else _strafe
	if state == "fight" and target != null and is_instance_valid(target) and target.alive:
		var tc := Combat.center(target)
		var from := player.eye()
		var flat := tc - from
		var dist := Vector2(flat.x, flat.z).length()
		_want_yaw = atan2(-flat.x, -flat.z)
		_want_pitch = atan2(flat.y, maxf(dist, 0.5))
		var info := Data.info_of(player.tool.weapon)
		var melee := Data.MELEE.has(player.tool.weapon)
		var want_dist := float(info.reach) * 0.7 if melee else 14.0
		mv.y = 1.0 if dist > want_dist + 2.0 else (-0.6 if dist < want_dist - 3.0 and not melee else 0.2)
		mv.x = _strafe * (0.8 if not melee else 0.3)
		# aim error shrinks with skill; the bot fires when it is looking roughly at the enemy
		_aim_err = _aim_err.lerp(Vector2(_rng.randfn(0.0, 1.0), _rng.randfn(0.0, 1.0)) * deg_to_rad(lerpf(9.0, 2.5, skill)), 0.25)
		var dyaw := absf(angle_difference(player.yaw, _want_yaw))
		if dyaw < deg_to_rad(10.0 + (1.0 - skill) * 8.0) and (melee and dist < float(info.reach) + 0.8 or not melee):
			fire = true
	else:
		if to_goal.length() > 1.5:
			_want_yaw = atan2(-to_goal.x, -to_goal.z)
			mv.y = 1.0
		_want_pitch = 0.0
		_aim_err = Vector2.ZERO
	# turn (the bots turn a bit slower than a thumb)
	var turn := lerpf(4.0, 9.0, skill) * delta
	player.yaw += clampf(angle_difference(player.yaw, _want_yaw + _aim_err.x), -turn, turn)
	player.pitch = lerpf(player.pitch, clampf(_want_pitch + _aim_err.y, -0.7, 0.4), minf(1.0, delta * 8.0))
	# stuck? jump and jet over whatever is in the way
	var moved := player.global_position.distance_to(_last_pos)
	_last_pos = player.global_position
	if (mv.length() > 0.3) and moved < 0.4 * delta * player.speed_mult * 3.0:
		_stuck_t += delta
	else:
		_stuck_t = maxf(0.0, _stuck_t - delta)
	_jump_t = maxf(0.0, _jump_t - delta)
	if _stuck_t > 0.7 and _jump_t <= 0.0:
		player.press_jump()
		_jump_t = 1.2
		_strafe = -_strafe
	player.jet_held = _jump_t > 0.6
	player.move_input = mv
	if fire and player.tool.cd_left <= 0.0:
		player.tool.fire()
