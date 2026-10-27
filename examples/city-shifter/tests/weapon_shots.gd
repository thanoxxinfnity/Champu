extends SceneTree
## The hero with each weapon at several moments of its shot or swing (the camera behind, the same way a player sees it).
##   xvfb-run -a godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/weapon_shots.gd -- /tmp/out [hero]

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/ws"
	var hero := args[1] if args.size() > 1 else "samurai"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(960, 540)
	var g := await T.boot(self, hero)
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 40)
	var p: PlayerController = g.player
	for b in g.mc._brains:
		b.set_physics_process(false)
	p.shield = 0.0
	p.yaw = 0.0
	g.hud.visible = false
	var cam := Camera3D.new()
	g.add_child(cam)
	cam.fov = 45.0
	cam.current = true
	var plan := {"hammer": [0.0, 0.2, 0.38, 0.5], "katana": [0.0, 0.22, 0.45, 0.62], "spear": [0.0, 0.25, 0.42, 0.62],
		"nova_blaster": [0.0, 0.06, 0.12, 1.0], "genesis_cannon": [0.0, 0.08, 0.2, 1.0]}
	for id in plan:
		if not p.tool.inventory.has(id):
			p.tool.inventory.append(id)
		p.tool.equip(id)
		await T.frames(self, 30)
		var dur := WeaponAnim.duration(id)
		var i := 0
		for k in plan[id]:
			p.tool.anim_t = float(k) * dur if float(k) < 1.0 else 5.0
			p.tool.set_process(false)
			p.shield = 0.0
			cam.global_position = p.global_position + Vector3(2.3, 1.7, -3.0)
			cam.look_at(p.global_position + Vector3(0.1, 1.15, 0.0))
			for _n in 3:
				p.tool._process(0.0)
				await process_frame
			var img := root.get_texture().get_image()
			img.save_png("%s/%s_%d.png" % [out, id, i])
			p.tool.set_process(true)
			i += 1
	T.done(self)
