extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/lowshot.gd -- <out.png> [quality 0|1|2]
## What a weak phone is shown: the game at a chosen quality level (default 0, low), one screenshot of the hall.
func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var game := (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	game.enemies_off = true
	root.add_child(game)
	for i in range(40):
		await process_frame
	game.ui.close_modal()
	Quality.apply(game, int(args[1]) if args.size() > 1 else 0)
	game.player.global_position = Vector3(12.5, 0, 4)
	game.player.yaw = deg_to_rad(-90)
	game.player.rotation.y = game.player.yaw
	for i in range(40):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png(args[0])
	print("saved ", args[0], " ", root.get_viewport().get_texture().get_size())
	quit()
