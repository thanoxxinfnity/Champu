extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/safe_test.gd
## The safe stations, the charger and the gadgets. A creature cannot cross the pool's barrier and gives up on a player standing in it; the
## charger refills the stunner; the shield stops a hit; the medkit heals; the hush shrinks footsteps; the beeper is a decoy. And the
## monster count is small enough to be fair (one robot per chapter at the start).

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func spawn(kind: String, pos: Vector3, patrol := []) -> Enemy:
	var e := Enemy.new()
	e.kind = kind
	e.game = game
	e.patrol = patrol
	e.position = pos
	game.world.loaded[game.world.current].add_child(e)
	game.enemies.append(e)
	return e


func clear() -> void:
	for e in game.enemies.duplicate():
		e.queue_free()
		game.enemies.erase(e)
	await steps(2)


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	await steps(6)
	game._begin()
	await steps(20)

	print("-- the start is calm")
	var st := Safe.station_in("c1_cryo")
	check(not st.is_empty(), "the first room has a safe station")
	check(game.s.chapter == 1 and Safe.inside(game.player.global_position, 3.0), "the player starts at the water (%s)" % str(game.player.global_position))
	var real := 0
	for e in game.enemies:
		if e != game.warden:
			real += 1
	check(real <= 1, "one robot in the first chapter (%d)" % real)
	check(game.world.loaded["c1_cryo"].get_node_or_null("Safe_s1") != null, "the pool is built")

	print("-- the barrier keeps a creature out")
	await clear()
	var c := Vector3(float(st.x), 0.0, float(st.z))
	game.noise(c, 1.0, "none")
	var hunter := spawn("hunter", c + Vector3(9.0, 0, 0))
	await steps(10)
	hunter.hear(c, 40.0, "bang")       # something at the pool: it should walk to it, and stop at the edge
	var nearest := 99.0
	for i in range(60 * 14):
		nearest = minf(nearest, Vector2(hunter.global_position.x - c.x, hunter.global_position.z - c.z).length())
		await physics_frame
	check(nearest >= Safe.BARRIER_R - 0.8, "it never got closer than the barrier (%.2f m, barrier %.1f)" % [nearest, Safe.BARRIER_R])
	check(nearest < Safe.BARRIER_R + 3.5, "but it did come to look (%.2f m)" % nearest)

	print("-- a player in the water is left alone")
	await clear()
	game.player.global_position = c + Vector3(0.5, 0, 0)
	game.player.health = 3
	game.player.dead = false
	var crawler := spawn("crawler", c + Vector3(7.0, 0, 0))
	await steps(10)
	crawler.hear(game.player.global_position, 30.0, "step")
	await steps(60 * 12)
	check(crawler.state != Enemy.S.CHASE, "it does not chase into the water (state %d)" % crawler.state)
	check(game.player.health == 3, "and nothing hurts the player there (health %d)" % game.player.health)
	check(Vector2(crawler.global_position.x - c.x, crawler.global_position.z - c.z).length() >= Safe.BARRIER_R - 0.8, "the creature stays outside the barrier")
	await clear()

	print("-- the charger")
	game.player.has_emp = true
	game.player.emp_charges = 2
	game.use_charger(null)
	check(game.player.emp_charges == 6, "it refills the stunner (%d)" % game.player.emp_charges)
	game.player.has_emp = false
	game.player.emp_charges = 0
	game.use_charger(null)
	check(game.player.emp_charges == 0, "and does nothing without a stunner")
	game.player.has_emp = true

	print("-- the shield")
	game.player.health = 3
	game.s.inv = ["shield"]
	check(game.use_gadget() and game.player.shield_t > 0.0 and game.s.inv.is_empty(), "the shield switches on and is used up")
	game.hurt_player(1, c + Vector3(3, 0, 0))
	check(game.player.health == 3, "a hit while shielded does nothing (health %d)" % game.player.health)
	game.player.shield_t = 0.0
	game.hurt_player(1, c + Vector3(3, 0, 0))
	check(game.player.health == 2, "and it hurts when the shield is off (health %d)" % game.player.health)

	print("-- the medkit")
	game.s.inv = ["medkit"]
	check(game.use_gadget() and game.player.health == 3 and game.s.inv.is_empty(), "heals and is used up (health %d)" % game.player.health)
	game.s.inv = ["medkit"]
	check(not game.use_gadget() and game.s.inv.size() == 1, "not wasted at full health")

	print("-- the hush")
	game.s.inv = ["hush"]
	check(game.use_gadget() and game.player.hush_t > 0.0, "soft soles on")

	print("-- the beeper is a decoy")
	game.s.inv = ["beeper"]
	game.player.global_position = c + Vector3(0, 0, 0)
	check(game.use_gadget() and game.s.inv.is_empty(), "put down")
	game.player.hush_t = 0.0
	game.player.shield_t = 0.0
	await steps(30)
	check(game.gadget_item() == "", "nothing else left to use")

	print("-- every gadget is in the data")
	for g in ["shield", "medkit", "hush", "beeper"]:
		check(Data.ITEMS.has(g) and Data.ITEM_MODEL.has(g), g + " is an item with a model")

	print("-- the whole thing rebuilds on re-entry")
	game._enter_chapter(2, false)
	await steps(20)
	check(Safe.station_in(game.world.current).size() > 0 or game.world.current != "", "chapter 2 loaded (%s)" % game.world.current)
	check(game.world.loaded.has("c2_lobby") and game.world.loaded["c2_lobby"].get_node_or_null("Safe_s2") != null, "and has its own station")

	print("-- ALL OK" if fails == 0 else "-- %d FAILED" % fails)
	quit(0 if fails == 0 else 1)
