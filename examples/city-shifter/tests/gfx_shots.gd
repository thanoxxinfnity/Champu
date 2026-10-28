extends SceneTree
## The same view at each graphics level (Settings → GRAPHICS), to compare.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/gfx_shots.gd -- /tmp/out [hero]
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/gfx"
	var hero := args[1] if args.size() > 1 else "rina"
	DirAccess.make_dir_recursive_absolute(out)
	DisplayServer.window_set_size(Vector2i(1280, 720))
	root.size = Vector2i(1280, 720)
	var g := await T.boot(self, hero)
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 40)
	for b in g.mc._brains:
		b.set_physics_process(false)
	g.hud.visible = false
	var p: PlayerController = g.player
	p.shield = 0.0
	for lv in 3:
		Gfx.apply(root, g.world, lv)
		for k in 20:
			p.shield = 0.0
			await process_frame
		root.get_texture().get_image().save_png("%s/gfx_%d.png" % [out, lv])
	print("GFX_SHOTS 3")
	quit()
