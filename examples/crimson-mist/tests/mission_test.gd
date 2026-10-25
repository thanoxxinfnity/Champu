extends SceneTree
## Chapter 1 end to end through the story API: every mission can be completed in order, items and flags behave, the boss ends the chapter.

func use(game: Game, kind: String, value := "") -> bool:
	for it in game.story.interactables:
		if is_instance_valid(it) and it.kind == kind and (value == "" or it.value == value):
			game.player.global_position = it.global_position + Vector3(0.5, 0, 0)
			await T.frames(self, 2)
			game.story.on_interact(it)
			return true
	return false


func _initialize() -> void:
	var game := await T.boot(self, "rina")
	await T.start(self, game)
	var st := game.story
	var p := game.player
	p.max_hp = 2000.0
	p.hp = 2000.0
	# 1 wake
	T.check(st.mission == 0, "mission 1 active")
	T.check(await use(game, "loot", "crowbar"), "pick up the crowbar")
	T.check(p.has_crowbar, "crowbar equipped")
	await T.frames(self, 220)
	T.check(st._ambush_enemy != null, "ambush walker arrives")
	if st._ambush_enemy != null:
		st._ambush_enemy.take_damage(500.0, p.global_position)
	await T.frames(self, 5)
	T.check(st.mission == 1, "killing it starts mission 2")
	# 2 power
	T.check(await use(game, "loot", "fuel"), "take fuel")
	T.check(await use(game, "loot", "fuse"), "take fuse")
	await use(game, "generator")
	T.check(game.world.powered, "generator powers the clinic")
	T.check(await use(game, "cabinet"), "cabinet gives a pistol")
	T.check(p.has_pistol and p.mag == 12, "pistol is loaded")
	p.global_position = game.world.spots.exit + Vector3(0, 0, -1.5)
	await T.frames(self, 6)
	T.check(st.mission == 2, "mission 3 starts once the player walks out through the opened door")
	# 3 rescue
	T.check(await use(game, "door"), "break the storeroom door")
	T.check(await use(game, "ally", "1"), "free the prisoner")
	T.check(game.companions.size() == 1, "she follows as a companion (%s)" % (game.companions[0].char_id if game.companions.size() > 0 else "none"))
	T.check(game.companions[0].char_id != "rina", "the companion is not the player's own character")
	# gather everything the workbench needs
	for it in st.interactables.duplicate():
		if is_instance_valid(it) and it.kind == "loot":
			st.on_interact(it)
	await T.frames(self, 400)
	T.check(st.mission == 3, "mission 4 (craft) starts (mission %d)" % st.mission)
	T.check(p.count("scrap") >= 3 and p.count("cloth") >= 2 and p.count("alcohol") >= 1 and p.count("fuel") >= 1, "materials in the bag: scrap %d cloth %d alcohol %d fuel %d" % [p.count("scrap"), p.count("cloth"), p.count("alcohol"), p.count("fuel")])
	for r in ["bandage", "flare", "crowbar_plus"]:
		st.craft(r)
	await T.frames(self, 5)
	T.check(p.count("bandage") >= 1 and p.count("flare") >= 1 and p.count("crowbar_plus") == 1, "bandage, flare and reinforced crowbar crafted")
	T.check(st.mission == 4, "mission 5 (bell road) starts")
	# 5 road
	T.check(await use(game, "ally", "2"), "free the church survivor")
	T.check(game.companions.size() == 2, "two companions now")
	p.global_position = game.world.spots.barricade
	await use(game, "barricade")
	T.check(game.world.barricade == null, "flare burns the barricade")
	game.clear_enemies()
	p.global_position = Vector3(0, 0, -188)
	await T.frames(self, 4)
	T.check(st.mission == 5, "mission 6 (boss) starts at the tower")
	p.global_position = Vector3(0, 0, -199)
	await T.frames(self, 6)
	T.check(st.flags.get("boss_spawned", false), "the Bellkeeper appears")
	var boss: Enemy = null
	for e in get_nodes_in_group("enemies"):
		if (e as Enemy).boss:
			boss = e
	T.check(boss != null, "boss exists")
	if boss != null:
		boss.take_damage(boss.max_hp * 0.6, p.global_position, 0.0)
		T.check(boss.phase2, "boss enters phase two below half health")
		boss.take_damage(boss.max_hp, p.global_position, 0.0)
	await T.frames(self, 10)
	T.check(st.finished, "defeating the boss finishes the chapter")
	T.done(self)
