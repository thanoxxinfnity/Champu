extends SceneTree
## The 15 gauntlet weapons: every one has complete data and a model, can be fired against a cloud of blocks without an error, does something to them
## (breaks, moves or slows at least one), respects its cooldown; unlocking follows level and coins; the bridge slabs are pooled and age out.

func _initialize() -> void:
	T.check(Data.WEAPONS.size() == 15 and Data.WEAPON_ORDER.size() == 15, "there are 15 weapons")
	for id in Data.WEAPON_ORDER:
		var w: Dictionary = Data.WEAPONS[id]
		var ok := true
		for k in ["name", "kind", "range", "force", "cd", "price", "level", "color", "note"]:
			ok = ok and w.has(k)
		T.check(ok, "%s: complete data" % id)
		var m := WeaponModels.build(id)
		var meshes := m.find_children("*", "MeshInstance3D", true, false)
		T.check(m.has_meta("real") and not meshes.is_empty() and WeaponModels.muzzle(id).z < 0.0, "%s: real model with %d meshes" % [id, meshes.size()])
		m.free()
	# unlocking
	var save := {"coins": 0, "best": 0.0, "weapons": []}
	T.check(Data.weapon_unlocked("shift_gauntlet", save), "the first gauntlet is free")
	T.check(Data.weapon_buyable("vortex_blaster", save) == "needs $500", "a $500 weapon needs coins")
	save.coins = 600
	T.check(Data.weapon_buyable("vortex_blaster", save) == "", "…and can be bought with them")
	save.coins = 99999
	T.check(Data.weapon_buyable("sonic_impactor", save) == "needs level 6", "a level-6 weapon needs level 6 even with the coins")
	save.best = 3000.0
	T.check(Data.level_for(3000.0) == 6 and Data.weapon_buyable("sonic_impactor", save) == "", "…which 3000 m of best distance gives")
	# fire every weapon at a cloud of blocks
	var game := await T.boot(self, "engineer")
	game.bot_mode = true
	game.start_play()
	await T.frames(self, 10)
	var p := game.player
	p.global_position = Vector3(0, Data.DECK_Y + 0.3, -6)
	p.yaw = 0.0
	p.pitch = 0.0
	await T.frames(self, 5)
	for id in Data.WEAPON_ORDER:
		game.spawner.release_all()
		p.global_position = Vector3(0, Data.DECK_Y + 0.3, -6)
		p.velocity = Vector3.ZERO
		p.speed_mult = 1.0
		var blocks: Array = []
		for i in 6:
			var d := game.spawner.spawn_block(Vector3(-1.6 + float(i) * 0.7, Data.DECK_Y + 1.4, -9.0 - float(i % 3) * 1.2), 0.8, Vector3.ZERO, i)
			d.freeze = true
			blocks.append(d)
		await T.frames(self, 2)
		var before_pos: Array = []
		for d in blocks:
			before_pos.append(d.global_position)
		p.tool.equip(id)
		p.tool.cd_left = 0.0
		var fired := p.tool.fire()
		T.check(fired, "%s: fires" % id)
		T.check(p.tool.cd_left > 0.1, "%s: cooldown starts (%.2f s)" % [id, p.tool.cd_left])
		T.check(not p.tool.fire(), "%s: cannot fire again during the cooldown" % id)
		await T.frames(self, 30)
		var changed := 0
		for i in blocks.size():
			var d: OptimizedSkySpawner.Debris = blocks[i]
			if not d.active or d.slowed > 0.0 or d.global_position.distance_to(before_pos[i]) > 0.05 or not d.freeze:
				changed += 1
		var kind := String(Data.WEAPONS[id].kind)
		var needs_blocks := not ["grapple"].has(kind)
		T.check(changed > 0 or not needs_blocks, "%s (%s): it did something to the blocks (%d of 6)" % [id, kind, changed])
		p.tool.cd_left = 0.0
	# bridge slabs
	game.spawner.release_all()
	p.tool.release_all()
	p.global_position = Vector3(0, Data.DECK_Y + 0.05, -11)
	p.velocity = Vector3.ZERO
	await T.frames(self, 4)
	var first := p.tool.next_slab_pos()
	T.check(p.tool.place_bridge(), "a bridge slab is placed")
	var second := p.tool.next_slab_pos()
	T.check(absf(second.z - first.z) > 0.9 and absf(second.y - first.y) < 0.01, "the next slab steps on from the last (z %.1f → %.1f)" % [first.z, second.z])
	for i in 50:
		p.tool.place_bridge()
	T.check(p.tool.live.size() <= Data.BRIDGE_CAP, "slabs are capped at %d (%d live)" % [Data.BRIDGE_CAP, p.tool.live.size()])
	var tn := p.tool.get_child_count()
	for i in 20:
		p.tool.place_bridge()
	T.check(p.tool.get_child_count() == tn, "slabs are recycled, never created while playing")
	for s in p.tool.live:
		s.set_meta("ttl", 0.05)
	await T.frames(self, 8)
	T.check(p.tool.live.is_empty(), "slabs age out and go back to the pool")
	T.check(p.tool.cycle_block() == "bounce" and p.tool.cycle_block() == "glass", "SELECT BLOCK cycles the block types")
	T.done(self)
