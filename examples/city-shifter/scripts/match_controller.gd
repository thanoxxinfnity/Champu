class_name MatchController
extends Node
## One match in the open world: up to 15 players (the rest of the 15 are bots offline), solo (everybody for themselves) or in teams of 4, six minutes, the most
## kills wins. It owns the score, the kill feed, the loot field, the bots, the respawns and who picks up what. Online, the host runs the same object and the
## clients mirror it from events (see Main): a phone is the judge of its own player (it reports its own death), the host counts.

signal feed_added(text: String, color: Color)
signal finished(results: Dictionary)
signal changed                                   # scoreboard or timer changed (the HUD redraws)

const NAMES := ["Sakura", "Haruto", "Mika", "Ren", "Yuki", "Kaito", "Hana", "Sora", "Aoi", "Daichi", "Rin", "Kenji", "Mio", "Takumi", "Nao", "Ryu", "Emi", "Shin"]
const RESPAWN_S := 4.0
const TEAM_COLORS := [Color(1.0, 0.45, 0.55), Color(0.4, 0.8, 1.0), Color(0.55, 1.0, 0.5), Color(1.0, 0.85, 0.35), Color(0.8, 0.55, 1.0), Color(1.0, 0.6, 0.3),
	Color(0.5, 1.0, 0.9), Color(0.95, 0.95, 0.95), Color(0.9, 0.4, 0.9), Color(0.6, 0.75, 1.0), Color(1.0, 0.7, 0.8), Color(0.7, 1.0, 0.6), Color(1.0, 0.5, 0.2),
	Color(0.4, 0.9, 0.7), Color(0.85, 0.85, 0.4)]

var game: Node
var world: OpenWorld
var spawner: OptimizedSkySpawner
var loot: LootField
var mode := "solo"                               # "solo" | "team"
var running := false
var time_left := Data.MATCH_SECONDS
var actors: Array[PlayerController] = []         # everybody in the match (the local player first)
var me: PlayerController
var online := false
var is_authority := true                         # offline or the host: counts the score
var team_score := {}                             # team -> kills
var feed: Array = []                             # [text, ttl, Color]
var _respawn := {}                               # PlayerController -> seconds left
var _no_pick := {}                               # PlayerController -> until (msec): a weapon it just dropped
var _brains: Array[BotBrain] = []
var _rng := RandomNumberGenerator.new()
var _spawns: Array[Vector3] = []
var _tick := 0.0
var _clock_t := 0.0


func setup(g: Node, w: OpenWorld, sp: OptimizedSkySpawner, m: String) -> void:
	game = g
	world = w
	spawner = sp
	mode = m
	_rng.randomize()
	if sp != null:
		sp.open = true
	_make_spawns()
	loot = LootField.new()
	loot.name = "Loot"
	w.add_child(loot)
	loot.build(OpenWorld.HALF, w.pois(), w.blocked, OpenWorld.RIVER_AT - OpenWorld.RIVER_DIR * 130.0, OpenWorld.RIVER_AT + OpenWorld.RIVER_DIR * 130.0)


func _make_spawns() -> void:
	# 24 start points on the roads and in the open, the same on every phone
	var r := RandomNumberGenerator.new()
	r.seed = 77
	var path := world.path
	for i in 24:
		if i < 14 and path.size() > 0:
			var p := path[(i * path.size()) / 14]
			_spawns.append(Vector3(p.x + r.randf_range(-3.0, 3.0), 0.4, p.y + r.randf_range(-3.0, 3.0)))
		else:
			_spawns.append(Vector3(r.randf_range(-250, 250), 0.4, r.randf_range(-250, 250)))


## Everybody who plays: `humans` = [[peer id, char id, name], ...] (me first); bots fill up to the cap when `fill`.
func begin(me_p: PlayerController, humans_extra: Array, fill: bool) -> void:
	me = me_p
	actors.clear()
	_register(me_p)
	for h in humans_extra:
		_register(h)
	if fill:
		var n_bots := Data.MAX_PLAYERS - actors.size()
		var chars := Data.CAST_ORDER.duplicate()
		for i in n_bots:
			var b := PlayerController.new()
			b.is_bot = true
			b.lethal = true
			b.display_name = "%s" % NAMES[i % NAMES.size()]
			world.add_child(b)
			b.setup(game, world, spawner, String(chars[_rng.randi() % chars.size()]), 100 + i, true)
			b.display_name = String(NAMES[i % NAMES.size()])
			if b.nametag != null:
				b.nametag.text = b.display_name
			var brain := BotBrain.new()
			b.add_child(brain)
			brain.setup(b, self, _rng.randf_range(0.35, 0.8))
			_brains.append(brain)
			_register(b)
	_assign_teams()
	for a in actors:
		_place_new(a)
		a.tool.reset_loadout()
	time_left = Data.MATCH_SECONDS
	running = true
	changed.emit()


func _register(p: PlayerController) -> void:
	p.lethal = true
	if actors.has(p):
		return
	actors.append(p)
	p.died.connect(func(killer: PlayerController) -> void: on_died(p, killer))
	p.tool.dropped.connect(func(id: String) -> void: drop_weapon(id, p.global_position + Vector3(randf_range(-1.5, 1.5), 0, randf_range(-1.5, 1.5))))


func _assign_teams() -> void:
	var order := actors.duplicate()
	order.sort_custom(func(a: PlayerController, b: PlayerController) -> bool: return a.peer_id < b.peer_id)
	for i in order.size():
		var a: PlayerController = order[i]
		a.team = (i / Data.TEAM_SIZE) if mode == "team" else i
		team_score[a.team] = 0
		_recolour(a)


func _recolour(a: PlayerController) -> void:
	if a.nametag != null:
		a.nametag.modulate = TEAM_COLORS[a.team % TEAM_COLORS.size()]
		a.nametag.outline_modulate = Color(0.05, 0.03, 0.12)


func team_color(t: int) -> Color:
	return TEAM_COLORS[t % TEAM_COLORS.size()]


# ── spawning ─────────────────────────────────────────────────────────────────

## A start point away from the enemies; in a team match the team starts together.
func spawn_for(a: PlayerController) -> Vector3:
	if mode == "team":
		var mates: Array[PlayerController] = []
		for o in actors:
			if o.team == a.team and o != a and o.alive:
				mates.append(o)
		if not mates.is_empty() and _rng.randf() < 0.8:
			var m := mates[_rng.randi() % mates.size()]
			return m.global_position + Vector3(_rng.randf_range(-4, 4), 0.5, _rng.randf_range(-4, 4))
	var best := _spawns[0]
	var best_d := -1.0
	for i in 8:
		var c: Vector3 = _spawns[_rng.randi() % _spawns.size()]
		var d := 1.0e9
		for o in actors:
			if o != a and o.alive and o.team != a.team:
				d = minf(d, o.global_position.distance_to(c))
		if d > best_d:
			best_d = d
			best = c
	return best


func _place_new(a: PlayerController) -> void:
	var p := spawn_for(a)
	a.revive(p)


func random_point_near(p: Vector3, r: float) -> Vector3:
	var ang := _rng.randf() * TAU
	var d := _rng.randf_range(r * 0.3, r)
	var q := Vector3(clampf(p.x + cos(ang) * d, -OpenWorld.HALF + 20.0, OpenWorld.HALF - 20.0), 0.0, clampf(p.z + sin(ang) * d, -OpenWorld.HALF + 20.0, OpenWorld.HALF - 20.0))
	return q


# ── a kill ───────────────────────────────────────────────────────────────────

## My player or a bot of mine died. Offline / host: count it now. A client: tell the host (it will broadcast `kill`).
func on_died(victim: PlayerController, killer: PlayerController) -> void:
	if not running:
		return
	for id in victim.tool.drop_all():
		drop_weapon(id, victim.global_position + Vector3(_rng.randf_range(-1.2, 1.2), 0, _rng.randf_range(-1.2, 1.2)))
	if is_authority:
		score_kill(killer.peer_id if killer != null else -1, victim.peer_id)
		if online:
			game.net.send_event("kill", {"k": killer.peer_id if killer != null else -1, "v": victim.peer_id})
	else:
		game.net.send_report("died", {"k": killer.peer_id if killer != null else -1})
	_respawn[victim] = RESPAWN_S


func actor_by_id(id: int) -> PlayerController:
	for a in actors:
		if a.peer_id == id:
			return a
	return null


func score_kill(killer_id: int, victim_id: int) -> void:
	var k := actor_by_id(killer_id)
	var v := actor_by_id(victim_id)
	if v == null:
		return
	if k != null and k != v:
		k.kills += 1
		team_score[k.team] = int(team_score.get(k.team, 0)) + 1
		_say("%s  ✕  %s" % [k.display_name, v.display_name], team_color(k.team))
		if k == me:
			game.audio.play("coin", -4.0, 1.4)
	else:
		_say("%s fell" % v.display_name, Color(0.8, 0.8, 0.9))
	changed.emit()


func _say(text: String, c: Color) -> void:
	feed.append([text, 6.0, c])
	while feed.size() > 5:
		feed.pop_front()
	feed_added.emit(text, c)


func drop_weapon(id: String, at: Vector3) -> void:
	if loot == null:
		return
	var uid := -1
	if online:
		if is_authority:
			uid = loot.next_uid
			game.net.send_event("drop", {"id": id, "x": at.x, "z": at.z, "u": uid})
		else:
			game.net.send_report("drop", {"id": id, "x": at.x, "z": at.z})
			return
	loot.drop(id, at, uid)


# ── per frame ────────────────────────────────────────────────────────────────

func _physics_process(delta: float) -> void:
	if not running:
		return
	time_left = maxf(0.0, time_left - delta)                 # (a client counts along and is corrected every few seconds)
	if online and is_authority:
		_clock_t -= delta
		if _clock_t <= 0.0:
			_clock_t = 4.0
			game.net.send_event("clock", {"t": time_left})
	for f in feed:
		f[1] = float(f[1]) - delta
	while not feed.is_empty() and float(feed[0][1]) <= 0.0:
		feed.pop_front()
	# respawns
	for a in _respawn.keys():
		_respawn[a] = float(_respawn[a]) - delta
		if float(_respawn[a]) <= 0.0:
			_respawn.erase(a)
			if is_instance_valid(a):
				a.tool.reset_loadout()
				a.revive(spawn_for(a))
				if a == me:
					game.toast("Back in the fight!", 1.4)
	# pickups (me and my bots; every other phone's players pick up on their own phone)
	_tick -= delta
	if _tick <= 0.0:
		_tick = 0.1
		for a in actors:
			if not a.alive or not (a.is_local or a.is_bot):
				continue
			if int(_no_pick.get(a, 0)) > Time.get_ticks_msec():
				continue
			var uid := loot.nearest(a.global_position, 1.9)
			if uid >= 0:
				_pickup(a, uid)
		# the sky drops blocks around the people who are alive
		if spawner != null:
			var foci: Array[Vector3] = []
			for a in actors:
				if a.alive and (a.is_local or a.is_bot or online):
					foci.append(a.global_position)
			spawner.foci = foci
	if is_authority and time_left <= 0.0:
		finish()


func _pickup(a: PlayerController, uid: int) -> void:
	var id: String = loot.items[uid].id
	if online and not is_authority:
		# the host decides who was first
		game.net.send_report("take", {"u": uid})
		_apply_take(a, uid)
		return
	_apply_take(a, uid)
	if online:
		game.net.send_event("take", {"u": uid, "by": a.peer_id})


func _apply_take(a: PlayerController, uid: int) -> void:
	var id := loot.take(uid, a.peer_id)
	if id == "":
		return
	var before := a.tool.inventory.size()
	a.tool.give(id)
	if a == me:
		var nm: String = String(Data.info_of(id).name)
		game.toast("Picked up %s" % nm, 1.4)
		game.audio.play("ping", -6.0, 1.3)
		game.fx.flash(a.global_position + Vector3(0, 1.0, 0), Data.info_of(id).color, 1.2)
	if a.tool.inventory.size() == before and a.tool.inventory.has(id) and a == me:
		pass


func finish() -> void:
	if not running:
		return
	running = false
	var board := scoreboard()
	var results := {"board": board, "mode": mode, "team_score": team_score.duplicate(), "me": {}}
	var best_team := -1
	var best := -1
	for t in team_score:
		if int(team_score[t]) > best:
			best = int(team_score[t])
			best_team = int(t)
	results["winner_team"] = best_team
	if me != null:
		results["me"] = {"kills": me.kills, "deaths": me.deaths, "won": me.team == best_team and best > 0, "team": me.team}
	finished.emit(results)


## [{name, team, kills, deaths, you, color}], best first (in team mode by team score then kills).
func scoreboard() -> Array:
	var out: Array = []
	for a in actors:
		out.append({"name": a.display_name, "team": a.team, "kills": a.kills, "deaths": a.deaths, "you": a == me, "color": team_color(a.team), "alive": a.alive, "id": a.peer_id})
	out.sort_custom(func(x: Dictionary, y: Dictionary) -> bool:
		if mode == "team" and int(team_score.get(x.team, 0)) != int(team_score.get(y.team, 0)):
			return int(team_score.get(x.team, 0)) > int(team_score.get(y.team, 0))
		return int(x.kills) > int(y.kills))
	return out


func stop() -> void:
	running = false
	for a in actors:
		if is_instance_valid(a) and a.is_bot:
			a.queue_free()
	actors.clear()
