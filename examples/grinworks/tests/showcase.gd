extends SceneTree
## S9_LIVE=1 xvfb-run -a godot --path . --rendering-driver opengl3 --write-movie out.avi --fixed-fps 30 -s tests/showcase.gd
## The two things the full playthrough rarely shows: Mr. Grin flinching from the torch, and Mr. Grin catching you.

var game: Game


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	root.add_child(game)
	await physics_frame
	await physics_frame
	await run()
	quit(0)


func step(n: int) -> void:
	for i in range(n):
		await physics_frame


func face_it() -> void:
	var p := game.player
	var to := game.hollow.global_position + Vector3(0, 1.3, 0) - p.cam.global_position
	p.yaw = atan2(-to.x, -to.z)
	p.pitch = asin(to.normalized().y)


func run() -> void:
	game._begin()
	await step(5)
	game.ui.close_modal()
	game._awake_t = -9999.0
	var p := game.player
	p.global_position = game.level.nodes["hw"].pos + Vector3(0, 0.1, 0)
	p.battery = 100.0
	game.hollow.wake("hne")
	game.hollow.grace = 0.0
	game.hollow.hunt_player()
	print("-- the torch on Mr. Grin")
	p.torch_on = true
	for i in range(60 * 14):
		face_it()
		p.torch_on = true
		await step(1)
		if i % 120 == 0:
			print("  t=%ds state %d dist %.1f" % [i / 60, game.hollow.state, game.hollow.global_position.distance_to(p.global_position)])
	print("-- Mr. Grin catches you")
	game.hollow.sleep()
	game.hollow.wake("hne")
	game.hollow.grace = 0.0
	game.hollow.hunt_player()
	p.torch_on = false
	var t := 0
	while not p.dead and t < 60 * 40:
		face_it()
		p.torch_on = false
		await step(1)
		t += 1
	print("  caught after %ds: %s" % [t / 60, str(p.dead)])
	await step(60 * 5)
