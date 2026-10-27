extends SceneTree
## Downtown screenshots under xvfb:  xvfb-run -a godot --rendering-driver opengl3 --fixed-fps 30 --path . -s tests/city_shots.gd -- /tmp/cs

var out := "/tmp/cs"


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
	await T.frames(self, 20)
	var p := game.player
	var w: OpenWorld = game.world
	print("district buildings ", w.district.building_count, " tallest ", w.district.tallest, " slots ", w.district.car_slots.size(), " mounts ", w.mounts.size())
	game.mc.running = false
	var c := OpenWorld.DISTRICT_AT
	p.global_position = Vector3(c.x - 59.0, 0.5, c.y + 62.0)
	p.yaw = PI * 0.0
	await snap("c0_street", 30)
	p.global_position = Vector3(c.x, 0.5, c.y + 32.0)
	p.yaw = 0.0
	await snap("c2_plaza", 30)
	p.global_position = Vector3(c.x + 118.0, 0.5, c.y + 20.0)
	p.yaw = PI * 0.5
	await snap("c3_approach", 30)
	p.global_position = Vector3(c.x + 150.0, 40.0, c.y + 90.0)
	p.yaw = PI * 0.5 + 0.5
	p.pitch = -0.25
	await snap("c4_sky", 10)
	p.global_position = Vector3(c.x + 0.0, 62.0, c.y + 40.0)
	p.yaw = 0.0
	p.pitch = -0.5
	await snap("c5_top", 10)
	# destruction: a tower loses its top, then falls
	var b: Dictionary = w.district.buildings[0]
	var bd := 1.0e9
	for cand in w.district.buildings:
		var cr: Rect2 = cand.rect
		var dd := cr.get_center().distance_to(Vector2(c.x, c.y + 62.0)) - float(cand.height) * 0.1
		if dd < bd and float(cand.height) > 28.0:
			bd = dd
			b = cand
	var br: Rect2 = b.rect
	p.global_position = Vector3(br.get_center().x, 22.0, br.end.y + 46.0)
	p.yaw = 0.0
	p.pitch = -0.1
	p.set_physics_process(false)
	await snap("c6_before", 20)
	w.damage_at(Vector3(br.get_center().x, 3.0, br.get_center().y), 5.0, float(b.max) * 0.4)
	await snap("c7_top_off", 6)
	w.damage_at(Vector3(br.get_center().x, 3.0, br.get_center().y), 5.0, float(b.max))
	await snap("c8_fall", 4)
	await snap("c9_rubble", 50)
	quit()
