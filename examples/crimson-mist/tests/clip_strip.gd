extends SceneTree
## Contact strip of the MDM clips on a real character: pose names x moments, one PNG per character.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/clip_strip.gd -- /tmp/out rachel

const STRIPS := [["walk", [0.12, 0.37, 0.62, 0.87]], ["run", [0.1, 0.35, 0.6, 0.85]], ["swing1", [0.0, 0.35, 0.6, 1.0]], ["swing3", [0.0, 0.35, 0.6, 1.0]],
	["hurt", [0.0, 0.3, 0.6, 1.0]], ["death", [0.0, 0.4, 0.75, 1.0]], ["roll", [0.0, 0.3, 0.6, 1.0]], ["throw", [0.0, 0.35, 0.6, 1.0]]]

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/cm/out"
	var id := args[1] if args.size() > 1 else "rachel"
	root.size = Vector2i(1280, 720)
	var world := Node3D.new()
	root.add_child(world)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.3, 0.34, 0.37)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.66)
	env.ambient_light_energy = 0.6
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, -30, 0)
	world.add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 26
	world.add_child(cam)
	cam.look_at_from_position(Vector3(0, 1.0, 7.6), Vector3(0, 0.85, 0))
	cam.make_current()
	var views: Array[CharacterView] = []
	for si in STRIPS.size():
		for mi in 4:
			var v := CharacterView.new()
			world.add_child(v)
			v.setup(id)
			v.set_process(false)
			v.position = Vector3((mi - 1.5) * 1.05, 0, 0)
			v.rotation.y = PI + 0.5
			views.append(v)
	for si in STRIPS.size():
		var clip := AnimClip.load_clip(STRIPS[si][0])
		for mi in 4:
			var v := views[si * 4 + mi]
			if v.rig == null or clip == null:
				continue
			var p := clip.at(float(STRIPS[si][1][mi]))
			print("STRIP ", STRIPS[si][0], " ", STRIPS[si][1][mi], " n=", p.size(), " tL=", p.get("tL"), " lean=", p.get("lean"))
			if p.has("crouch"):
				p["crouch"] = float(p["crouch"]) * v.height
			v.rig.apply(PoseLib.build(p))
			v.rig.skeleton.force_update_all_bone_transforms()
		for k in views.size():
			views[k].visible = (k / 4) == si
		for i in 6:
			for mi in 4:
				var v2 := views[si * 4 + mi]
				if v2.rig != null and clip != null:
					var p2 := clip.at(float(STRIPS[si][1][mi]))
					p2["crouch"] = float(p2["crouch"]) * v2.height
					v2.rig.apply(PoseLib.build(p2))
			await process_frame
		root.get_texture().get_image().save_png("%s/clip_%s_%s.png" % [out, id, STRIPS[si][0]])
	quit()
