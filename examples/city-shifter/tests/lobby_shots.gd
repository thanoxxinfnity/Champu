extends SceneTree
## The menu under xvfb: home, heroes, shop, online, settings.   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/lobby_shots.gd -- /tmp/out

var out := "/tmp/ls"


func snap(name: String, frames := 20) -> void:
	for i in frames:
		await process_frame
	root.get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("shot ", name)


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	game.save.coins = 1500
	if OS.get_environment("HERO") != "":
		game.save.char = OS.get_environment("HERO")
		game.sel = Data.CAST_ORDER.find(OS.get_environment("HERO"))
		game._show_preview()
	game.lobby.set_save(game.save)
	await snap("l0_home", 40)
	game.lobby.show_screen("chars")
	await snap("l1_heroes", 20)
	game.lobby.show_screen("shop")
	await snap("l2_shop", 20)
	game.lobby.browsing = "knight"
	game.lobby.char_preview.emit("knight")
	game.lobby._refresh()
	await snap("l3_shop_knight", 25)
	game.lobby.browsing = "kunoichi"
	game.lobby.char_preview.emit("kunoichi")
	game.lobby._refresh()
	await snap("l3b_shop_kunoichi", 25)
	game.lobby.show_screen("chars")
	game.lobby.browsing = "outlaw"
	game.lobby.show_screen("skills")
	game.save.skills = {"outlaw": {"vitality": 3, "driving": 5, "sprint": 1, "power": 10}}
	game.lobby.set_save(game.save)
	await snap("l3c_skills", 20)
	game.lobby.show_screen("home")
	game.lobby._open_my_card()
	await snap("l3d_mycard", 20)
	game.lobby._card_pop.visible = false
	game.lobby.show_screen("online")
	await snap("l4_online", 10)
	game.lobby.set_room({"state": "room", "code": "KZ7Q", "status": "Waiting for players", "host": true, "max": 15, "players": [{"name": "PLAYER", "team": 0, "host": true, "you": true}, {"name": "Mika", "team": 0}, {"name": "Ren", "team": 0}, {"name": "Aoi", "team": 1}, {"name": "Sora", "team": 1}]})
	await snap("l5_room", 10)
	game.lobby.show_screen("settings")
	await snap("l6_settings", 10)
	quit()
