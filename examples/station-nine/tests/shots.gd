extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tests/shots.gd -- <dir> [light]
## Screenshots from the places that matter, so the look of the station can be judged by eye.

var game: Game
var out := "/tmp/s9shots"


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	var lit_all := args.size() > 1 and args[1] == "light"
	DirAccess.make_dir_recursive_absolute(out)
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	Game.autostart = true
	root.add_child(game)
	for i in range(30):
		await process_frame
	game.ui.close_modal()
	game.player.torch_on = true
	game.player.battery = 100.0
	game.hollow.sleep()
	game._awake_t = -9999.0
	if lit_all:
		for z in game.level.lit:
			game.level.set_lit(z, true, true)
	var views := [
		["01_airlock", Vector3(-14.5, 0, 6.0), -90.0, -3.0],
		["02_hub_north", Vector3(0, 0, 4.0), 0.0, 0.0],
		["03_hub_corner", Vector3(-8, 0, 8), -45.0, 0.0],
		["04_dorm", Vector3(-19.0, 0, 1.0), 90.0, -6.0],
		["05_dorm_bunks", Vector3(-25.5, 0, 0.0), 0.0, -4.0],
		["06_engine", Vector3(0, 0, 18.5), 180.0, -8.0],
		["07_valves", Vector3(0, 0, 23.5), 180.0, -10.0],
		["08_lab", Vector3(18.5, 0, 0), -90.0, -6.0],
		["09_lab_board", Vector3(24.5, 0, -3.5), 0.0, 0.0],
		["10_control", Vector3(0, 0, -17.5), 0.0, -4.0],
		["11_control_radio", Vector3(0, 0, -23.5), 0.0, -6.0],
		["12_pod", Vector3(11.5, 0, -6.0), -90.0, -6.0],
		["13_corridor", Vector3(0, 0, -11.0), 0.0, 0.0],
	]
	for v in views:
		game.player.global_position = v[1]
		game.player.yaw = deg_to_rad(v[2])
		game.player.pitch = deg_to_rad(v[3])
		game.player.velocity = Vector3.ZERO
		for i in range(8):
			await process_frame
		var img := root.get_viewport().get_texture().get_image()
		img.save_png("%s/%s.png" % [out, v[0]])
		print("saved ", v[0])
	# The creature, up close.
	game.hollow.wake("hn")
	game.hollow.grace = 999.0
	game.hollow.global_position = Vector3(0, 0, -3.5)
	game.hollow.state = Hollow.S.LURK
	game.player.global_position = Vector3(0, 0, 3.0)
	game.player.yaw = 0.0
	game.player.pitch = 0.0
	for i in range(12):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png("%s/14_hollow.png" % out)
	print("saved 14_hollow")
	quit()
