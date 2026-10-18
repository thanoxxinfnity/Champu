class_name Wanted
extends Node
## The law. Crimes raise the star level; police cars are sent after the player (more stars, more cars); get far enough away for
## long enough and the stars drop; get caught on foot and you are busted. Police shoot at a player they can see.

const MAX_CARS := {0: 0, 1: 1, 2: 2, 3: 3, 4: 3, 5: 4}
const EVADE_DISTANCE := 85.0
const EVADE_TIME := 12.0
const BUST_RADIUS := 7.0
const BUST_TIME := 2.5
const SHOOT_RANGE := 32.0

var state: GameState
var world: World
var traffic: Traffic
var hud: Hud
var director: Director
var police: Array[Vehicle] = []
var busted_count := 0
var _evade := 0.0
var _bust := 0.0
var _shoot_cd := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	add_to_group("wanted_watch")
	_rng.seed = 5


## The one door every crime goes through. Only the player's crimes count.
func report_crime(kind: StringName, _pos: Vector3, offender: Node) -> void:
	if not _is_player(offender):
		return
	match kind:
		&"kill_ped":
			state.raise_stars(2)
		&"hit_ped":
			state.raise_stars(1)
		&"hijack":
			state.raise_stars(1)
		&"shoot_police":
			state.raise_stars(maxi(3, state.stars))
		&"kill_police":
			state.raise_stars(maxi(4, state.stars))
	_evade = 0.0


func _is_player(n: Node) -> bool:
	return n != null and (n.is_in_group("player") or (n is Vehicle and (n as Vehicle).is_player_driven))


func _player_pos() -> Vector3:
	return world.player.global_position if world.player.active else _driven_pos()


func _driven_pos() -> Vector3:
	for v in get_tree().get_nodes_in_group("vehicles"):
		if (v as Vehicle).is_player_driven:
			return (v as Vehicle).global_position
	return world.player.global_position


func _process(delta: float) -> void:
	if state == null:
		return
	police = police.filter(func(v): return is_instance_valid(v))
	var want: int = MAX_CARS[state.stars]
	if police.size() < want:
		_spawn_cop()
	elif state.stars == 0 and police.size() > 0:
		for v in police:
			(v.get_node("LaneDriver") as LaneDriver).mode = LaneDriver.Mode.TRAFFIC
			(v.get_node("LaneDriver") as LaneDriver).cruise = 11.0
			v.remove_from_group("police")
		police.clear()
	if state.stars == 0:
		_evade = 0.0
		_bust = 0.0
		return
	var pp := _player_pos()
	var nearest := INF
	for v in police:
		nearest = minf(nearest, v.global_position.distance_to(pp))
	if nearest > EVADE_DISTANCE:
		_evade += delta
		if _evade >= EVADE_TIME:
			_evade = 0.0
			state.set_stars(state.stars - 1)
			if state.stars == 0 and hud != null:
				hud.toast("Wanted level lost", 2.5)
	else:
		_evade = maxf(0.0, _evade - delta * 2.0)
	_gunfire(delta, pp)
	_busted_check(delta, pp)


func _spawn_cop() -> void:
	var player_pos := _player_pos()
	var best := Vector2i.ZERO
	var best_d := INF
	for _i in range(12):
		var n := Vector2i(_rng.randi_range(0, 3), _rng.randi_range(0, 3))
		var d := LaneDriver.node_pos(n).distance_to(player_pos)
		if d > 70.0 and d < best_d and _spot_free(LaneDriver.node_pos(n)):
			best_d = d
			best = n
	if best_d == INF:
		return
	var v := Vehicle.make("police")
	world.add_child(v)
	var drv := LaneDriver.new()
	drv.name = "LaneDriver"
	drv.mode = LaneDriver.Mode.POLICE
	drv.lights = traffic.lights
	v.add_child(drv)
	var dirs := [Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 0), Vector2i(-1, 0)]
	var dir: Vector2i = dirs[_rng.randi() % 4]
	if not (best + dir).x in range(4) or not (best + dir).y in range(4):
		dir = Vector2i(0, 1) if best.y < 2 else Vector2i(0, -1)
	drv.place(best, dir)
	drv.target = _target_node()
	v.add_to_group("police")
	_siren(v)
	police.append(v)


## No car within 45 m of the spawn lane (the cop is placed up to 38 m before the intersection).
func _spot_free(c: Vector3) -> bool:
	for v in get_tree().get_nodes_in_group("vehicles"):
		if (v as Node3D).global_position.distance_to(c) < 45.0:
			return false
	return true


func _target_node() -> Node3D:
	return world.player


func _siren(v: Vehicle) -> void:
	var red := OmniLight3D.new()
	red.light_color = Color(1, 0.1, 0.1)
	red.omni_range = 9.0
	red.light_energy = 2.0
	red.position = Vector3(-0.5, 1.5, 0)
	v.add_child(red)
	var blue := OmniLight3D.new()
	blue.light_color = Color(0.2, 0.3, 1)
	blue.omni_range = 9.0
	blue.light_energy = 2.0
	blue.position = Vector3(0.5, 1.5, 0)
	v.add_child(blue)
	v.set_meta("siren", [red, blue])


func _physics_process(_delta: float) -> void:
	var on := int(Time.get_ticks_msec() / 220) % 2 == 0
	for v in police:
		if is_instance_valid(v) and v.has_meta("siren"):
			var s: Array = v.get_meta("siren")
			(s[0] as OmniLight3D).visible = on
			(s[1] as OmniLight3D).visible = not on
	# Police chase whoever the player is: on foot, or in whatever car they are driving.
	for v in police:
		var d := v.get_node_or_null("LaneDriver") as LaneDriver
		if d != null:
			d.target = world.player if world.player.active else _driven_node()


func _driven_node() -> Node3D:
	for v in get_tree().get_nodes_in_group("vehicles"):
		if (v as Vehicle).is_player_driven:
			return v as Node3D
	return world.player


func _gunfire(delta: float, pp: Vector3) -> void:
	if state.stars < 2:
		return
	_shoot_cd -= delta
	if _shoot_cd > 0.0:
		return
	for v in police:
		if v.global_position.distance_to(pp) < SHOOT_RANGE:
			_shoot_cd = 1.4
			if _rng.randf() < 0.55:
				world.player.hurt(int(4 + state.stars * 2))
			return


func _busted_check(delta: float, pp: Vector3) -> void:
	if not world.player.active or world.player.dead:
		_bust = 0.0
		return
	var close := false
	for v in police:
		if v.global_position.distance_to(pp) < BUST_RADIUS and v.linear_velocity.length() < 6.0:
			close = true
	if close and world.player.horizontal_speed() < 3.0:
		_bust += delta
		if _bust >= BUST_TIME:
			bust()
	else:
		_bust = maxf(0.0, _bust - delta)


func bust() -> void:
	_bust = 0.0
	busted_count += 1
	var fine := mini(int(state.cash * 0.1), 2000)
	state.add_cash(-fine)
	state.set_stars(0)
	world.player.global_position = World.spawn_point()
	world.player.velocity = Vector3.ZERO
	if hud != null:
		hud.toast("BUSTED — fined $%d" % fine, 3.5)
