extends SceneTree
## Open-world screenshots under xvfb: the town, the car park, a drive, the jungle, a horse ride.
##   xvfb-run -a godot --rendering-driver opengl3 --fixed-fps 30 --path . -s tests/world_shots.gd -- /tmp/out

var out := "/tmp/ws"


func snap(name: String, frames := 20) -> void:
	for i in frames:
		await physics_frame
		await process_frame
	root.get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("shot ", name, "  draw calls ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "  tris ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	game.mode = "world"
	root.add_child(game)
	await process_frame
	game.start_play()
	await snap("w0_spawn", 40)
	var p := game.player
	var w: OpenWorld = game.world
	print("mounts: ", w.mounts.size(), " road points ", w.path.size())
	# walk to the car park and look at it
	p.global_position = Vector3(-40, 0.5, 30)
	p.yaw = PI * 0.5 + 0.3
	await snap("w1_carpark", 30)
	# board the nearest vehicle and drive
	p.global_position = Vector3(-60, 0.5, 35.5)
	await snap("w2_near", 10)
	var m: Mount = w.nearest_mount(p.global_position)
	print("nearest: ", m.title if m != null else "none")
	if m != null:
		game._ride()
		game.hud.set_playing(true)
		await snap("w3_seated", 15)
		game.hud.move = Vector2(0, 1)
		await snap("w4_drive", 90)
		game.hud.move = Vector2(0.6, 1)
		await snap("w5_turn", 60)
		game.hud.move = Vector2.ZERO
		await snap("w6_brake", 40)
	game._ride()
	# the jungle: stand in it
	p.global_position = Vector3(100, 0.5, -90)
	p.yaw = 0.7
	await snap("w7_jungle", 30)
	p.global_position = Vector3(-120, 0.5, -90)
	p.yaw = 2.2
	await snap("w8_jungle2", 30)
	# a horse
	var horse: Mount
	for mm in w.mounts:
		if mm is Horse:
			horse = mm
			break
	if horse != null:
		p.global_position = horse.global_position + Vector3(2.5, 0.3, 0)
		await snap("w9_horse", 20)
		game._ride()
		game.hud.move = Vector2(0, 0.5)
		await snap("wa_trot", 60)
		game.hud.move = Vector2(0, 1)
		await snap("wb_gallop", 80)
	quit()
