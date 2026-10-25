extends SceneTree
## Enemy state machine: dormant -> investigates a sound -> chases -> winds up -> strikes; dies; the weeper freezes under the player's gaze; the bloater bursts.

func _initialize() -> void:
	var game := await T.boot(self)
	await T.start(self, game)
	game.world.power_on()
	var p := game.player
	p.global_position = Vector3(0, 0, -30)
	p.max_hp = 1000.0
	p.hp = 1000.0
	game.story.finished = true   # stop mission logic from spawning more
	# walker, far away: dormant, then wakes to a noise and walks toward it
	var z := game.spawn_enemy("mist_walker", Vector3(0, 0, -70), "market")
	await T.frames(self, 5)
	T.check(z.state == Enemy.S.DORMANT, "walker starts dormant")
	game.noise(Vector3(0, 0, -56), 60.0)
	T.check(z.state == Enemy.S.INVESTIGATE, "a noise sends it to investigate")
	await T.frames(self, 240)
	T.check(z.global_position.z > -69.0, "it walked toward the noise (z %.1f)" % z.global_position.z)
	# close up: it sees the player, chases, winds up and hits
	z.global_position = Vector3(0, 0, -34)
	p.global_position = Vector3(0, 0, -30)
	var hp0 := p.hp
	z.wake()
	T.check(z.state == Enemy.S.CHASE, "waking starts the chase")
	var saw_windup := false
	for i in 400:
		await process_frame
		if z.state == Enemy.S.WINDUP:
			saw_windup = true
		if p.hp < hp0:
			break
	T.check(saw_windup, "attack has a wind-up tell")
	T.check(p.hp < hp0, "the strike lands (%.0f damage)" % (hp0 - p.hp))
	# the player kills it
	z.take_damage(500.0, p.global_position, 2.0)
	T.check(z.is_dead(), "damage kills it")
	T.check(not get_nodes_in_group_safe(z), "dead enemies leave the enemies group")
	# crawler path through the street reaches the player
	var c := game.spawn_enemy("crawler", Vector3(0, 0, -60), "market")
	c.wake()
	p.global_position = Vector3(0, 0, -30)
	await T.frames(self, 420)
	T.check(c.global_position.distance_to(p.global_position) < 4.0 or p.hp < hp0 - 5.0, "crawler reaches the player along the street")
	c.take_damage(500.0, p.global_position)
	# weeper freezes while looked at
	p.global_position = Vector3(0, 0, -30)
	p.yaw = 0.0
	p.pitch = 0.0
	var wp := game.spawn_enemy("weeper", Vector3(0, 0, -42), "church")
	wp.wake()
	await T.frames(self, 4)
	var z0 := wp.global_position.z
	await T.frames(self, 30)
	T.check(absf(wp.global_position.z - z0) < 0.3, "weeper is frozen while the player looks at it")
	p.yaw = PI
	await T.frames(self, 60)
	T.check(wp.global_position.z - z0 > 0.5, "weeper rushes when the player looks away")
	wp.take_damage(500.0, p.global_position)
	# bloater bursts and slows
	var b := game.spawn_enemy("bloater", Vector3(0, 0, -32), "market")
	p.global_position = Vector3(0, 0, -30)
	b.take_damage(500.0, p.global_position)
	T.check(b.is_dead(), "bloater dies")
	T.check(p._slow_t > 0.0, "its spores slow the player")
	T.done(self)


func get_nodes_in_group_safe(e: Enemy) -> bool:
	return e.is_in_group("enemies")
