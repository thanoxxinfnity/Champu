extends SceneTree
## A look round the open world without the HUD: eye-height views at many places and a few high ones, to find what is broken (floating things, holes, black patches).
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/world_survey.gd -- /tmp/out
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/survey"
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
	p.visible = false
	var cam := Camera3D.new()
	g.add_child(cam)
	cam.fov = 70.0
	cam.far = 400.0
	cam.current = true
	var spots := [Vector3(0, 0, 0), Vector3(60, 0, 20), Vector3(-120, 0, 80), Vector3(150, 0, -150), Vector3(-200, 0, -100), Vector3(250, 0, 200), Vector3(-60, 0, -200), Vector3(300, 0, -40)]
	var i := 0
	for s in spots:
		p.global_position = s + Vector3(0, 1.0, 0)
		for yaw in [0.0, PI * 0.5, PI, PI * 1.5]:
			cam.global_position = s + Vector3(0, 1.7, 0)
			cam.rotation = Vector3(-0.05, yaw, 0)
			await T.frames(self, 8)
			root.get_texture().get_image().save_png("%s/eye_%02d.png" % [out, i])
			i += 1
		cam.global_position = s + Vector3(0, 22, 18)
		cam.look_at(s)
		await T.frames(self, 8)
		root.get_texture().get_image().save_png("%s/high_%02d.png" % [out, i])
		i += 1
	quit()
