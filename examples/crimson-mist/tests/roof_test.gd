extends SceneTree
## The veranda roof on Market Street can be climbed with the real controls: walk up the ramp, stand on the roof, take the loot up there; a spitter waits on it.

func _initialize() -> void:
	var game := await T.boot(self)
	await T.start(self, game)
	game.world.power_on()
	game.story.finished = true
	var p := game.player
	p.max_hp = 2000.0
	p.hp = 2000.0
	var w := game.world
	T.check(w.spots.has("roof_top") and w.spots.has("roof_ramp") and w.spots.has("loot13"), "the roof, its ramp and its loot are on the map")
	var top: Vector3 = w.spots.roof_top
	p.global_position = Vector3(w.spots.roof_ramp.x, 0.1, w.spots.roof_ramp.z - 1.0)
	p.yaw = 0.0
	await T.frames(self, 30)
	game.hud.held["sprint"] = false
	var reached := false
	for i in 900:
		var to := Vector2(top.x - p.global_position.x, top.z - p.global_position.z)
		game.hud.move = to.normalized() if to.length() > 0.5 else Vector2.ZERO
		await process_frame
		if p.global_position.y > top.y - 0.3 and absf(p.global_position.x - top.x) < 3.0 and absf(p.global_position.z - top.z) < 5.0:
			reached = true
			break
	game.hud.move = Vector2.ZERO
	T.check(reached, "the player walks up the ramp onto the roof (y %.2f of %.2f)" % [p.global_position.y, top.y])
	# the roof loot is there to take
	game.story._ensure_loot()
	var found := false
	for it in game.story.interactables:
		if is_instance_valid(it) and it.key == "loot13":
			found = true
	T.check(found, "there is loot on the roof")
	# and a spitter up there
	game.story._spawn_zone("market")
	var roofers := 0
	for e in get_nodes_in_group("enemies"):
		if (e as Enemy).global_position.y > 2.5 and (e as Enemy).trait_id == "spitter":
			roofers += 1
	T.check(roofers == 1, "a spitter stands on the roof (%d)" % roofers)
	T.done(self)
