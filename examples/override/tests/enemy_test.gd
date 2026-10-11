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
	var d := 99.0
	for i in range(60 * 12):
		d = minf(d, hunter.global_position.distance_to(Vector3(24, 0, 4)))
		await physics_frame
	check(d < 3.0, "and it walked to the sound along the navigation mesh (got within %.1f m)" % d)
	await clear()

	print("-- the blind kill by sound, and only by sound")
	game.player.global_position = Vector3(16, 0, 4)
	game.player.health = 3
	game.player.dead = false
	var blind := spawn("hunter", Vector3(13.5, 0, 4))
	await steps(10)
	blind.hear(Vector3(16, 0, 4), 9.0, "step")         # a step it hears
	await steps(60 * 2)
	check(blind.state == Enemy.S.CHASE or blind.state == Enemy.S.SEARCH, "a footstep it hears sets it hunting (state %d)" % blind.state)
	var quiet_hp := game.player.health
	await steps(60 * 8)      # ... and the player now stands perfectly still, a metre from it
	check(game.player.health == quiet_hp, "a player who stands still while it is on top of them is not hurt (health %d)" % game.player.health)
	check(blind.state != Enemy.S.CHASE, "it gives up the hunt when it hears nothing more (state %d)" % blind.state)
	game.player.global_position = Vector3(16, 0, 4)
	blind.global_position = Vector3(13.5, 0, 4)
	blind._set_state(Enemy.S.PATROL)
	blind._hit_cd = 0.0
	for i in range(60 * 6):
		if i % 20 == 0:
			game.noise(game.player.global_position, Player.NOISE_RUN, "step")      # running on the spot
		await physics_frame
	check(game.player.health < quiet_hp, "a player who keeps making noise is killed by it (health %d)" % game.player.health)
	check(blind._glow.size() > 0 and (blind._glow[0] as StandardMaterial3D).albedo_color.r > 0.9, "and its band shows red while it hunts")
	await clear()
	game.player.health = 3
	game.player.dead = false
	game.player.global_position = Vector3(16, 0, 4)
	var crouch_h := spawn("hunter", Vector3(13, 0, 4))
	await steps(10)
	game.noise(game.player.global_position, Player.NOISE_CROUCH, "step")
	await steps(30)
	check(crouch_h.state == Enemy.S.PATROL, "a crouched step three metres away is below its hearing (state %d)" % crouch_h.state)
	game.noise(game.player.global_position, Player.NOISE_WALK, "step")
	await steps(5)
	check(crouch_h.state == Enemy.S.CHASE, "an ordinary step the same distance is heard (state %d)" % crouch_h.state)
	await clear()

	print("-- a thrown scrap is a decoy")
	game.player.global_position = Vector3(25, 0, 4)
	game.player.health = 3
	game.player.dead = false
	var dh := spawn("hunter", Vector3(13, 0, 4), [Vector3(13, 0, 4), Vector3(13, 0, 6)])
	await steps(10)
	game.noise(Vector3(16, 0, 4), Player.NOISE_CLANG, "clang")
	await steps(5)
	check(dh.state == Enemy.S.INVESTIGATE, "it goes to see about the clang (state %d)" % dh.state)
	var dd := 99.0
	for i in range(60 * 7):
		dd = minf(dd, dh.global_position.distance_to(Vector3(16, 0, 4)))
		await physics_frame
	check(dd < 3.0, "it walked to where the scrap landed, not to the player (got within %.1f m)" % dd)
	check(game.player.health == 3, "the player, silent in the next room, is untouched")
	var saw_search := false
	for i in range(60 * 45):
		if dh.state == Enemy.S.SEARCH:
			saw_search = true
		if saw_search and dh.state == Enemy.S.PATROL:
			break
		await physics_frame
	check(saw_search, "then it stood and searched round the spot")
	check(dh.state == Enemy.S.PATROL, "and went back to its round (state %d)" % dh.state)
	game.s.inv = ["scrap", "fuse"]
	game.player.global_position = Vector3(25, 0, 4)
	game.player.yaw = deg_to_rad(90.0)
	game.player.pitch = 0.0
	await steps(2)
	var spot := game.player.throw_scrap()
	check(spot != Vector3.ZERO and not game.s.inv.has("scrap") and game.s.inv.has("fuse"), "throwing uses up one scrap and lands somewhere (%s)" % str(spot))
	check(game.player.throw_scrap() == Vector3.ZERO, "with none left there is nothing to throw")
	await clear()

	print("-- crawlers hunt as a pack and pounce after a tell")
	game.player.global_position = Vector3(25, 0, 4)
	game.player.health = 3
	game.player.dead = false
	var ca := spawn("crawler", Vector3(21.5, 0, 4))
	ca.rotation.y = PI * 1.5
	var cb := spawn("crawler", Vector3(14, 0, 4))
	cb.rotation.y = PI * 0.5
	var tell := false
	var cb_called := false
	for i in range(60 * 10):
		if ca._windup > 0.0 or ca._pounce_t > 0.0:
			tell = true
		if cb.state == Enemy.S.INVESTIGATE or cb.state == Enemy.S.CHASE:
			cb_called = true
		if game.player.health < 3 and tell and cb_called:
			break
		await physics_frame
	check(cb_called, "the crawler that did not see you is called by the one that did")
	check(tell, "the leap is preceded by a wind-up the player can see")
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

	print("-- smarter: walls muffle sound, decoys stop working, lockers are remembered, the lock-on roar, devil twitches")
	game.player.global_position = Vector3(26, 0, 3)
	game.player.health = 3
	game.player.dead = false
	var ear := spawn("hunter", Vector3(24, 0, 4))
	await steps(10)
	game.noise(Vector3(24, 0, 10), 5.0, "bang")      # in the closet behind the wall, six metres away
	await steps(5)
	check(ear.state == Enemy.S.PATROL, "a bang behind a wall that would carry through the open is not heard (state %d)" % ear.state)
	game.noise(Vector3(18, 0, 4), 5.0, "bang")       # the same distance, clear line
	await steps(5)
	check(ear.state != Enemy.S.PATROL, "the same bang with a clear line is (state %d)" % ear.state)
	await clear()
	var fooled := spawn("hunter", Vector3(24, 0, 4))
	await steps(10)
	game.last_throw_from = Vector3(25, 0, 3)
	game.noise(Vector3(20, 0, 4), 12.0, "clang")
	game.noise(Vector3(21, 0, 4), 12.0, "clang")
	check(fooled._decoys >= 2, "a hunter that has been led to two clangs counts them (%d)" % fooled._decoys)
	fooled._last_known = Vector3(21, 0, 4)
	fooled._begin_search()
	check(fooled._search_pts[0] == Vector3(25, 0, 3), "and then searches where the throws came from, not only where they landed")
	game.s.deaths = 5
	check(is_equal_approx(fooled._adapt(), 1.15), "they get up to 15 percent keener after deaths (%.2f)" % fooled._adapt())
	game.s.deaths = 0
	fooled.state = Enemy.S.PATROL
	fooled._twitch_t = 0.01
	await steps(5)
	check(fooled._flicker > 0.0, "an idle creature glitches now and then (its eyes stutter)")
	await clear()
	var roarer := spawn("crawler", Vector3(21.5, 0, 4))
	await steps(5)
	roarer._enter_chase(game.player)
	check(roarer._roar_t > 0.0 and roarer._roar_t < 1.0, "a creature that locks on screams first (%.2f s)" % roarer._roar_t)
	var mate := spawn("crawler", Vector3(19, 0, 4))
	mate.state = Enemy.S.CHASE
	await steps(2)
	check(roarer._pack_mates() == 1, "crawlers know when a pack mate is also hunting (%d)" % roarer._pack_mates())
	await clear()

	print("-- it remembers which locker you hid in, and bangs on it")
	game.player.health = 3
	game.player.dead = false
	game.player.global_position = Vector3(15, 0, 11)      # the server closet has the locker
	await steps(10)
	var lk: Use = null
	for u in game.world.uses:
		if u.id == "hide":
			lk = u
	check(lk != null, "the closet has a locker")
	game.player.enter_hide(lk)
	check(game.hid_spots.size() >= 1, "going into it is remembered")
	var seeker2 := spawn("warden", Vector3(19, 0, 9), [Vector3(19, 0, 9)])
	await steps(10)
	seeker2._last_known = Vector3(lk.hide_pos.x, 0, lk.hide_pos.z - 3.0)
	seeker2._begin_search()
	check(seeker2._search_pts.size() >= 2 and (seeker2._search_pts[0] as Vector3).distance_to(Vector3(lk.hide_pos.x, 0, lk.hide_pos.z)) < 3.0, "its search starts at that locker")
	var banged := false
	for i in range(60 * 40):
		if seeker2._check_u != null:
			banged = true
		if game.player.health < 3 or not game.player.hidden:
			break
		await physics_frame
	check(banged, "it stood in front of the locker and hammered on the door first")
	check(game.player.health < 3 or not game.player.hidden, "and then opened it (health %d)" % game.player.health)
	game.player.exit_hide()
	game.hid_spots.clear()
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
