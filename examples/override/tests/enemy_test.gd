extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/enemy_test.gd
## The creatures. A hunter is blind and goes to a sound through the navigation mesh; a crawler that sees you chases and hurts you; the EMP
## stunner freezes any of them for five seconds; the Warden cannot be hurt; hiding works; the Warden's footsteps shake the screen.

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
	game.enemies.clear()
	await steps(2)


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	await steps(6)
	game._begin()
	await steps(20)
	game.player.global_position = Vector3(25, 0, 4)
	await steps(6)
	await clear()
	game.player.has_emp = true
	game.player.emp_charges = 6

	print("-- a hunter is blind and follows sound")
	var hunter := spawn("hunter", Vector3(13, 0, 4))
	await steps(20)
	check(hunter.state == Enemy.S.PATROL, "it starts on patrol")
	game.player.global_position = Vector3(16, 0, 4)       # three metres in front of it, in the open, silent
	await steps(180)
	check(hunter.state != Enemy.S.CHASE, "a silent player three metres from a blind hunter is not noticed (state %d)" % hunter.state)
	game.noise(Vector3(24, 0, 4), 12.0, "bang")
	await steps(5)
	check(hunter.state == Enemy.S.INVESTIGATE or hunter.state == Enemy.S.CHASE, "a bang in the next room brings it to investigate (state %d)" % hunter.state)
	await steps(60 * 12)
	var d := hunter.global_position.distance_to(Vector3(24, 0, 4))
	check(d < 3.0, "and it walked to the sound along the navigation mesh (%.1f m away)" % d)
	await clear()

	print("-- a crawler sees, chases and hurts")
	game.player.global_position = Vector3(25, 0, 4)
	game.player.health = 3
	game.player.dead = false
	var crawler := spawn("crawler", Vector3(21.5, 0, 4))
	crawler.rotation.y = -PI * 0.5 * -1.0     # facing +x, towards the player
	crawler.rotation.y = atan2(-1.0, 0.0) * 0.0 + PI * 1.5
	await steps(90)
	check(crawler.state == Enemy.S.CHASE, "it notices a player in the open at four metres (state %d)" % crawler.state)
	await steps(60 * 8)
	check(game.player.health < 3 or game.player.dead, "and it hurts (health %d)" % game.player.health)

	print("-- the stunner holds anything for five seconds")
	game.player.health = 3
	game.player.dead = false
	game.player.global_position = Vector3(25, 0, 4)
	game.player.yaw = deg_to_rad(90.0)       # looking down the hall towards -x ... the camera is at the player
	await steps(2)
	crawler.global_position = Vector3(21, 0, 4)
	crawler.state = Enemy.S.CHASE
	game.player.yaw = deg_to_rad(90.0)
	game.player.pitch = 0.0
	await steps(2)
	var fired := game.player.fire_emp()
	await steps(2)
	check(fired and crawler.state == Enemy.S.STUNNED, "one shot stuns it (state %d)" % crawler.state)
	var p0 := crawler.global_position
	await steps(60 * 3)
	check(crawler.global_position.distance_to(p0) < 0.2, "it does not move while stunned")
	await steps(60 * 3)
	check(crawler.state != Enemy.S.STUNNED, "and is itself again after five seconds")
	check(game.player.emp_charges == 5, "a shot costs a charge (%d left)" % game.player.emp_charges)
	await clear()

	print("-- the Warden")
	game.player.global_position = Vector3(25, 0, 4)
	game.player.health = 3
	game.player.dead = false
	var warden := spawn("warden", Vector3(14, 0, 4), [Vector3(14, 0, 4), Vector3(24, 0, 4)])
	check(warden._cfg.damage == 2, "it hits for two")
	check(not warden.has_method("take_damage") and not warden.has_method("die"), "there is no way to hurt it")
	await steps(30)
	var before := game.player.shake_amount()
	warden.global_position = Vector3(20, 0, 4)
	warden._step_t = 0.0
	warden._step(0.01, 2.0)
	check(game.player.shake_amount() > before, "its footsteps shake the screen near the player (%.2f)" % game.player.shake_amount())
	warden.stun(5.0)
	await steps(5)
	check(warden.state == Enemy.S.STUNNED, "the stunner holds even the Warden")
	await clear()

	print("-- hiding")
	game.player.health = 3
	game.player.dead = false
	game.player.global_position = Vector3(20, 0, 4)
	var seeker := spawn("crawler", Vector3(15, 0, 4))
	seeker.state = Enemy.S.CHASE
	seeker._last_known = game.player.global_position
	var locker: Use = null
	for u in game.world.uses:
		if u.id == "hide":
			locker = u
	check(locker != null, "there is a locker in the hall")
	game.player.enter_hide(locker)
	check(game.player.hidden and game.player.collision_layer == 0, "inside it the player is hidden and off the physics layer")
	seeker.state = Enemy.S.PATROL
	await steps(60 * 3)
	check(seeker.state != Enemy.S.CHASE, "a creature that did not see you go in does not chase a hidden player (state %d)" % seeker.state)
	game.player.exit_hide()
	await clear()

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
