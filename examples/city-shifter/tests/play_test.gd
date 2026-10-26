extends SceneTree
## A bot plays the run with the real controls: walks down the roof, crosses the first coupling gap by placing bridge slabs, jets over a second one,
## is knocked off and put back, fires at the rain for coins. The distance keeps counting, nothing errors, the debris cap holds.

func _initialize() -> void:
	var game := await T.boot(self, "outlaw")
	game.bot_mode = true
	game.start_play()
	await T.frames(self, 20)
	var p := game.player
	var w := game.world
	T.check(game.state == Main.State.PLAY, "the run starts")
	T.check(p.global_position.distance_to(w.spawn_points[0].global_position) < 1.0, "the player spawned on the first spawn marker")
	T.check(w.spawn_points.size() == 8, "there are 8 spawn markers on the roof")
	var d0 := w.progress
	await T.frames(self, 60)
	T.check(w.progress > d0 + 15.0, "the world slides past (%.0f m in a second)" % (w.progress - d0))
	T.check(p.is_on_floor(), "the player stands on the roof")
	# walk toward the first gap (the car ends at z = -12)
	p.move_input = Vector2(0, 1)
	var f := 0
	while p.global_position.z > -10.5 and f < 600:
		await process_frame
		f += 1
	T.check(p.global_position.z < -10.0, "the player walks down the roof (z %.1f)" % p.global_position.z)
	# a gap: stop at the edge and bridge it with three slabs
	p.move_input = Vector2.ZERO
	await T.frames(self, 20)
	for i in 4:
		p.tool.place_bridge()
		await T.frames(self, 3)
	p.move_input = Vector2(0, 1)
	f = 0
	while p.global_position.z > -17.0 and f < 900:
		await process_frame
		f += 1
	T.check(p.global_position.z < -16.0 and p.global_position.y > Data.DECK_Y - 1.0, "the bridge carried the player over the coupling gap (z %.1f, y %.1f)" % [p.global_position.z, p.global_position.y])
	# jetpack: take off, climb, fall again
	p.move_input = Vector2.ZERO
	await T.frames(self, 30)
	var y0 := p.global_position.y
	p.press_jump()
	p.jet_held = true
	await T.frames(self, 50)
	T.check(p.global_position.y > y0 + 1.5, "holding JUMP/JET climbs (%.1f m up, fuel %.0f)" % [p.global_position.y - y0, p.fuel])
	T.check(p.fuel < p.max_fuel - 5.0, "the jetpack burns fuel")
	p.jet_held = false
	await T.frames(self, 120)
	T.check(p.is_on_floor(), "and the player lands again")
	# fall off the side: back on the last safe roof
	p.global_position = Vector3(9.0, Data.DECK_Y, -30.0)
	p.velocity = Vector3.ZERO
	await T.frames(self, 120)
	T.check(p.global_position.y > Data.DECK_Y - 1.0 and absf(p.global_position.x) < 3.0, "a fall puts the player back on the roof (x %.1f y %.1f)" % [p.global_position.x, p.global_position.y])
	# rain for a while, shoot, count coins
	var coins0 := game.run_coins
	game.spawner.rate = 6.0
	p.tool.equip("quantum_breaker")
	for i in 900:
		await process_frame
		if i % 60 == 0:
			game.spawner.spawn_block(p.global_position + Vector3(0.5, 3.0, -2.5), 1.0, Vector3(0, -3, 0), i)
		if i % 20 == 0:
			p.tool.cd_left = 0.0
			p.tool.fire()
	T.check(game.spawner.active_count() <= Data.DEBRIS_CAP, "the debris cap holds in the rain (%d active)" % game.spawner.active_count())
	T.check(game.run_coins > coins0, "breaking blocks pays coins ($%d)" % (game.run_coins - coins0))
	T.check(p.hp > 0.0 and p.global_position.y > Data.FALL_Y, "the player is alive and on the train")
	game.end_run()
	await T.frames(self, 5)
	T.check(game.state == Main.State.LOBBY and game.world == null, "ending the run frees the train and returns to the lobby")
	T.check(float(game.save.best) > 100.0, "the best distance was saved (%d m)" % int(game.save.best))
	T.done(self)
