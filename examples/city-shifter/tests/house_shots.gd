extends SceneTree
## A village house from outside, at its door, inside on each floor and on the roof; a body walks in and up the ramps.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/house_shots.gd -- /tmp/out
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/house"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(960, 540)
	var g := await T.boot(self, "viper")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 30)
	for b in g.mc._brains:
		b.set_physics_process(false)
	g.hud.visible = false
	var w = g.world
	var houses: Array = w.find_children("*", "House", true, false)
	print("HOUSES ", houses.size(), " indoor loot ", w.house_spots.size())
	var h: House = houses[houses.size() - 1]
	var p: PlayerController = g.player
	var cam := Camera3D.new()
	g.add_child(cam)
	cam.fov = 70.0
	cam.current = true
	var T3: Transform3D = h.global_transform
	var views := [[Vector3(9, 6, 14), Vector3(0, 2, 0)], [Vector3(0.4, 1.6, 6.5), Vector3(0.4, 1.4, 0)], [Vector3(3.5, 1.6, 2.5), Vector3(-3, 1.2, -2)],
		[Vector3(3.5, 4.8, 2.5), Vector3(-3, 4.4, -2)], [Vector3(2, 8.5, 3), Vector3(-2, 6.4, -2)]]
	var i := 0
	for v in views:
		cam.global_position = T3 * v[0]
		cam.look_at(T3 * v[1])
		await T.frames(self, 6)
		root.get_texture().get_image().save_png("%s/house_%d.png" % [out, i])
		i += 1
	# walk in through the door and up the first flight with the real controller
	p.global_position = T3 * Vector3(0.45, 0.4, 6.0)
	p.yaw = h.global_rotation.y + PI
	await T.frames(self, 10)
	var steps := 0
	while steps < 200:
		Input.action_press("move_forward") if InputMap.has_action("move_forward") else null
		p.velocity = (T3.basis * Vector3(0, 0, -1)).normalized() * 4.0 + Vector3(0, p.velocity.y, 0)
		await physics_frame
		steps += 1
	print("WALKED_IN inside=", (T3.affine_inverse() * p.global_position))
	quit()
