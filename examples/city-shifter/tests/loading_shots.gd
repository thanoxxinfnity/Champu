extends SceneTree
## The loading screen under xvfb, a few frames apart while the world is built:  xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/loading_shots.gd -- /tmp/out

func _initialize() -> void:
	var out := "/tmp/ld"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game := await T.boot(self, "kafu")
	game.mode = "world"
	game.match_type = "solo"
	game.begin_match()
	var n := 0
	var seen := []
	while game.state != Main.State.PLAY and n < 900:
		await process_frame
		n += 1
		if n in [6, 40, 90]:
			root.get_texture().get_image().save_png("%s/ld_%d.png" % [out, n])
		if game.loading != null:
			seen.append(snappedf(game.loading.shown, 0.1))
	T.check(game.state == Main.State.PLAY, "the match starts behind the loading screen (%d frames)" % n)
	T.check(game.world != null and game.world is OpenWorld and game.world.district != null, "the world was built step by step")
	var uniq := {}
	for v in seen:
		uniq[v] = true
	T.check(uniq.size() >= 5, "the progress bar moved in %d steps while loading" % uniq.size())
	await create_timer(1.2).timeout
	T.check(not game.loading.visible, "the loading screen closes by itself")
	T.done(self)
