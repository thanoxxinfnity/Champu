extends SceneTree
## Progress is saved at every mission start and Continue restores mission, bag, weapons, companion and world state.

func _initialize() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Data.SAVE_PATH))
	var game := await T.boot(self, "mococo")
	await T.start(self, game)
	T.check(Data.load_save().get("mission", -1) == 0, "starting writes a save at mission 1")
	game.player.has_crowbar = true
	game.player.inventory = {"scrap": 3, "cloth": 2, "flare": 1}
	game.story.start(3)
	await T.frames(self, 3)
	var s := Data.load_save()
	T.check(s.get("mission", -1) == 3 and s.get("char", "") == "mococo", "mission 4 checkpoint saved for Mococo")
	T.check(int(s.get("inv", {}).get("scrap", 0)) == 3, "bag saved")
	await game.back_to_lobby()
	await T.frames(self, 5)
	T.check(game.state == Game.State.LOBBY, "back in the lobby")
	T.check(game.hud.lobby.get("can_continue", false), "lobby offers Continue")
	await game.start_game(true)
	await T.frames(self, 10)
	T.check(game.story.mission == 3, "continue resumes mission 4")
	T.check(game.player.count("scrap") == 3 and game.player.has_crowbar, "bag and crowbar restored")
	T.check(game.world.powered, "power is back on")
	T.check(game.companions.size() == 1, "first companion is back")
	# death rolls back to the checkpoint
	game.player.take_damage(9999.0, game.player.global_position + Vector3(1, 0, 0))
	T.check(game.player.dead, "player can die")
	game.state = Game.State.PLAYING
	game.story.restart_mission()
	await T.frames(self, 3)
	T.check(not game.player.dead and game.player.hp == game.player.max_hp, "retry revives at full health")
	T.check(game.player.count("scrap") == 3, "retry restores the checkpoint bag")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Data.SAVE_PATH))
	T.done(self)
