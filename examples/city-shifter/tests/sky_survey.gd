extends SceneTree
## What the skydive sees: views from the drop height down to the ground over the spawn, to find floating or huge things.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/sky_survey.gd -- /tmp/out
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/sky"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(960, 540)
	var g := await T.boot(self, "outlaw")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 30)
	for b in g.mc._brains:
		b.set_physics_process(false)
	g.hud.visible = false
	var p: PlayerController = g.player
	p.set_physics_process(false)
	var s := Vector3(p.global_position.x, 0, p.global_position.z)
	var cam := Camera3D.new()
	g.add_child(cam)
	cam.fov = 70.0
	cam.far = 900.0
	cam.current = true
	var i := 0
	for h in [230.0, 150.0, 90.0, 50.0, 25.0, 8.0]:
		p.global_position = s + Vector3(0, h, 0)
		for yaw in [0.0, PI * 0.5, PI, PI * 1.5]:
			cam.global_position = s + Vector3(0, h + 3.0, 0) + Vector3(sin(yaw), 0, cos(yaw)) * 6.0
			cam.rotation = Vector3(-0.35, yaw, 0)
			await T.frames(self, 8)
			root.get_texture().get_image().save_png("%s/sky_%02d.png" % [out, i])
			i += 1
	print("SKY_SURVEY ", i)
	quit()
