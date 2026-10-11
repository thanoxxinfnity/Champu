extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/bench.gd
## A relative speed check without a phone: the average time to render a frame on the software renderer, in four views
## (a corridor, the assembly floor, the reactor, a creature close up). Smaller is better; compare before and after a change.
var game: Game


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	game.enemies_off = true
	root.add_child(game)
	for i in range(40):
		await process_frame
	game.ui.close_modal()
	if OS.get_environment("OV_Q") != "":
		Quality.apply(game, int(OS.get_environment("OV_Q")))
		for i in range(5):
			await process_frame
	var opts := OS.get_environment("OV_B").split(",", false)
	if "glow" in opts:
		game.env.glow_enabled = false
	if "msaa" in opts:
		root.msaa_3d = Viewport.MSAA_DISABLED
	if "post" in opts:
		game.ui._post.visible = false
	if "pad" in opts:
		game.ui._pad.visible = false
	if "shaft" in opts:
		for n in game.find_children("*", "MeshInstance3D", true, false):
			var m := (n as MeshInstance3D).material_override
			if m is ShaderMaterial and (m as ShaderMaterial).shader.resource_path.ends_with("shaft.gdshader"):
				(n as MeshInstance3D).visible = false
	if "lights" in opts:
		for n in game.find_children("*", "OmniLight3D", true, false):
			(n as OmniLight3D).visible = false
	if "scale" in opts:
		root.scaling_3d_scale = 0.5
	if "fog" in opts:
		game.env.fog_enabled = false
	print("opts ", opts)
	var views := [["hall", Vector3(12.5, 0, 4), -90.0], ["cryo", Vector3(5, 0, 4.5), 0.0], ["floor", Vector3(205, 0, 8), -90.0], ["reactor", Vector3(325, 0, 5), -90.0]]
	var total := 0.0
	for v in views:
		game.player.global_position = v[1]
		game.player.yaw = deg_to_rad(v[2])
		game.player.rotation.y = game.player.yaw
		game.player.pitch = 0.0
		for i in range(20):
			await process_frame
		var t0 := Time.get_ticks_usec()
		for i in range(30):
			await process_frame
		var ms := float(Time.get_ticks_usec() - t0) / 30000.0
		total += ms
		print("bench %-8s %.1f ms/frame  %d draw calls" % [v[0], ms, RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)])
	print("bench mean %.1f ms/frame" % (total / views.size()))
	quit()
