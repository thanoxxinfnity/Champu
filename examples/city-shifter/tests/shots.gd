extends SceneTree
## Screenshots under xvfb: lobby, armory, the roof at start, a jetpack jump, a shot, a bridge, the engine end.
##   xvfb-run -a godot --rendering-driver opengl3 --fixed-fps 30 --path . -s tests/shots.gd -- /tmp/out [char]

var out := "/tmp/cm/out/cs"


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
	if args.size() > 1:
		game.sel = maxi(0, Data.CAST_ORDER.find(args[1]))
		game._show_preview()
		game._refresh_lobby()
	await snap("00_lobby", 30)
	game._open_armory(true)
	await snap("01_armory", 10)
	game._open_armory(false)
	game.start_play()
	await snap("02_roof", 40)
	var p := game.player
	p.move_input = Vector2(0, 1)
	await snap("03_walk", 40)
	p.move_input = Vector2.ZERO
	p.press_jump()
	p.jet_held = true
	await snap("04_jet", 18)
	p.jet_held = false
	await snap("05_air", 14)
	game.spawner.spawn_block(p.global_position + Vector3(0, 3, -6), 1.2, Vector3(0, -2, 0), 1)
	game.spawner.spawn_block(p.global_position + Vector3(1.5, 2, -7), 1.0, Vector3(0, -2, 0), 3)
	await snap("06_blocks", 12)
	p.tool.fire()
	await snap("07_fire", 6)
	p.tool.place_bridge()
	p.tool.place_bridge()
	await snap("08_bridge", 10)
	game.hud.toast("Bridge the gaps")
	game.hud.banner("ROUND 1")
	await snap("09_hud", 10)
	for id in ["quantum_breaker", "gravity_carver", "meteor_burster"]:
		p.tool.equip(id)
		p.tool.cd_left = 0.0
		p.tool.fire()
		await snap("10_" + id, 6)
	quit()
