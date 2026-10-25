extends SceneTree
## Boots the whole game: lobby with every cast member, then Chapter 1 mission 1, a few hundred frames of play, no script errors.
##   godot --headless --path . -s tests/smoke.gd        (prints ALL OK)

var fails := 0


func check(cond: bool, what: String) -> void:
	if not cond:
		fails += 1
		print("FAIL  ", what)
	else:
		print("ok    ", what)


func _initialize() -> void:
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	await process_frame
	check(game.state == Game.State.LOBBY, "boots into the lobby")
	check(game.hud.lobby.get("count", 0) == 4, "lobby lists four survivors")
	for i in 4:
		check(game._lobby_view != null and game._lobby_view.char_id == Data.CAST_ORDER[game.selected], "lobby shows %s" % Data.CAST_ORDER[game.selected])
		game.lobby_step(1)
		await process_frame
	game.selected = 0
	game.start_game(false)
	for i in 20:
		await process_frame
	check(game.state == Game.State.PLAYING, "chapter 1 starts")
	check(game.player != null and game.world != null and game.story != null, "player, world and story exist")
	check(game.story.mission == 0, "mission 1 is active")
	check(game.world.loaded_zones().has("clinic"), "clinic zone loaded")
	var start := game.player.global_position
	game.hud.move = Vector2(0, -1)
	game.player.yaw = 0.0
	for i in 90:
		await process_frame
	check(game.player.global_position.distance_to(start) > 1.0, "player walks")
	game.hud.move = Vector2.ZERO
	game.player.try_attack()
	for i in 40:
		await process_frame
	check(game.state == Game.State.PLAYING, "still playing after an attack")
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(1 if fails > 0 else 0)
