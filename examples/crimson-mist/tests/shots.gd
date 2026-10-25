extends SceneTree
## Screenshot tour under xvfb: lobby, then each place of Chapter 1 with enemies and companions standing in view.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/shots.gd -- /tmp/out [character]

var out := "/tmp/cm/out/shots"


func snap(name: String) -> void:
	for i in 14:
		await process_frame
	root.get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("shot ", name)


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	if args.size() > 1:
		game.selected = maxi(0, Data.CAST_ORDER.find(args[1]))
	root.add_child(game)
	await process_frame
	await snap("00_lobby")
	game.lobby_step(1)
	await snap("01_lobby_next")
	await game.start_game(false)
	await process_frame
	game.hud.chapter_card("1 · Red Dawn", "Search the ward for something to defend yourself with.")
	await snap("02_ward")
	var p := game.player
	p.global_position = Vector3(0, 0, -6)
	p.yaw = 0.0
	await snap("03_corridor")
	game.story.flags["power"] = true
	game.world.power_on()
	p.global_position = Vector3(0, 0, -19)
	p.yaw = 0.2
	await snap("04_generator_room")
	p.global_position = Vector3(0, 0, -30)
	p.yaw = 0.0
	game.spawn_enemy("mist_walker", Vector3(-1.5, 0, -42), "market").state = Enemy.S.PATROL
	game.spawn_enemy("crawler", Vector3(3, 0, -38), "market").state = Enemy.S.PATROL
	await snap("05_market_street_start")
	game.add_companion(1)
	p.global_position = Vector3(2, 0, -52)
	p.yaw = 0.35
	game.spawn_enemy("bloater", Vector3(-3, 0, -64), "market").state = Enemy.S.PATROL
	await snap("06_market_street_mid")
	p.global_position = Vector3(14, 0, -62)
	p.yaw = -0.5
	await snap("07_radio_shop")
	game.add_companion(2)
	p.global_position = Vector3(0, 0, -96)
	p.yaw = 0.5
	game.spawn_enemy("weeper", Vector3(-4, 0, -108), "church").state = Enemy.S.PATROL
	await snap("08_church_plaza")
	p.global_position = Vector3(0, 0, -121)
	p.yaw = 0.0
	await snap("09_barricade")
	game.world.burn_barricade()
	p.global_position = Vector3(0, 0, -150)
	p.yaw = 0.0
	game.spawn_enemy("mist_walker", Vector3(1, 0, -160), "road").wake()
	await snap("10_bell_road")
	p.global_position = Vector3(0, 0, -200)
	p.yaw = 0.0
	game.story.flags["boss_spawned"] = true
	var boss := game.spawn_enemy("bellkeeper", game.world.spots.boss_spawn, "arena")
	boss.state = Enemy.S.DORMANT
	game.hud.boss_show("The Bellkeeper")
	await snap("11_boss_arena")
	quit()
