extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/shots.gd -- <dir> [chapter]
## Screenshots from the places that matter, to judge the look by eye.

var game: Game

const VIEWS := [
	["01_cryo", Vector3(5, 0, 5.5), 0.0, -2.0],
	["02_cryo_pods", Vector3(5, 0, 5.5), 180.0, -2.0],
	["03_hall", Vector3(12, 0, 4), -90.0, 0.0],
	["04_hall_end", Vector3(25, 0, 4), 90.0, 0.0],
	["05_server", Vector3(16, 0, 8.5), 0.0, -3.0],
	["06_store", Vector3(16, 0, 0), 180.0, -4.0],
	["07_lobby", Vector3(101, 0, 6), -90.0, -3.0],
	["08_lobby_mid", Vector3(107, 0, 6), -90.0, -6.0],
	["09_pump", Vector3(133, 0, 3.0), 180.0, -2.0],
	["10_factory", Vector3(202, 0, 8), -90.0, 0.0],
	["11_factory_belts", Vector3(210, 0, 2.0), -90.0, -8.0],
	["12_lockers", Vector3(205, 0, 21), 180.0, 0.0],
	["13_workshop", Vector3(231, 0, 7), -90.0, -4.0],
	["14_reactor", Vector3(324, 0, 5), -90.0, 4.0],
	["15_reactor_core", Vector3(326, 0, 5), -90.0, 8.0],
	["17_safe_1", Vector3(1.0, 0, 0.8), -140.0, -8.0],
	["18_safe_2", Vector3(106.0, 0, 2.0), 150.0, -8.0],
	["19_safe_3", Vector3(198.5, 0, 14.0), -30.0, -8.0],
	["20_safe_4", Vector3(305.0, 0, 3.0), 140.0, -10.0],
	["16_waste", Vector3(331, 0, 14), 0.0, -4.0],
]


func _init() -> void:
	var out := "/tmp/ovshots"
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	root.add_child(game)
	for i in range(40):
		await process_frame
	game.ui.close_modal()
	game.player.torch_on = true
	for v in VIEWS:
		game.player.global_position = v[1]
		game.player.yaw = deg_to_rad(v[2])
		game.player.pitch = deg_to_rad(v[3])
		game.player.velocity = Vector3.ZERO
		# Freeze creatures so a shot is not ruined by one in the way.
		for i in range(14):
			await process_frame
		for e in game.enemies:
			e.process_mode = Node.PROCESS_MODE_DISABLED
		root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[0]])
		print("saved ", v[0], " room ", game.world.current, " loaded ", game.world.loaded.size())
	quit()
