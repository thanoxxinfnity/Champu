extends SceneTree
## Frames of the opening cut-scene under xvfb (real renderer): one every few seconds of its run.
##   xvfb-run -a godot --rendering-driver opengl3 --fixed-fps 30 --path . -s tests/intro_shots.gd -- /tmp/out

func _initialize() -> void:
	var out := OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/cm/out/intro"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	game.start_game(false, true)
	var frames := 0
	var marks := [60, 150, 240, 330, 420, 520, 600, 690, 760]
	while game.state != Game.State.PLAYING and frames < 4000:
		await process_frame
		frames += 1
		if marks.has(frames):
			root.get_texture().get_image().save_png("%s/intro_%04d.png" % [out, frames])
			print("shot ", frames)
	print("intro frames ", frames)
	quit()
