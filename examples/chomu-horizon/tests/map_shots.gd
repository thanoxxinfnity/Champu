extends SceneTree
## Renders views of a map for a visual check (needs a GPU / xvfb):
##   xvfb-run godot --path . --rendering-driver opengl3 -s tests/map_shots.gd -- <out_dir> <map> [time]

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var out: String = args[0]
	var id: String = args[1]
	var tod: String = args[2] if args.size() > 2 else ""
	var w := WorldBuilder.new(id)
	if tod != "":
		w.time_of_day = tod
	else:
		w.time_of_day = str(JSON.parse_string(FileAccess.get_file_as_string("res://maps/%s/meta.json" % id)).time)
	w.quality = 0
	w.build()
	get_root().add_child(w)
	var cam := Camera3D.new()
	cam.fov = 70
	cam.far = 4000
	get_root().add_child(cam)
	cam.make_current()
	var sp := w.spawn_transform()
	var fwd := sp.basis.z
	var views := []
	# Chase view at spawn.
	views.append([sp.origin - fwd * 7.0 + Vector3.UP * 2.6, sp.origin + fwd * 12.0 + Vector3.UP * 1.0])
	# Along the road further on, low.
	var i := (int(w.meta.spawn_index) + 300) % w.main_count
	var p := w.samples[i]
	var t := w.tangents[i]
	views.append([p - t * 8.0 + Vector3.UP * 2.8 + t.cross(Vector3.UP) * 1.5, p + t * 20.0 + Vector3.UP])
	# High overview.
	views.append([p + Vector3(0, 140, 0) - t * 220.0, p + t * 200.0])
	# Portal plaza.
	var pz: Dictionary = w.meta.plaza
	var pc := Vector3(pz.center[0], pz.center[1], pz.center[2])
	var nrm := Vector3(pz.normal[0], 0, pz.normal[1])
	views.append([pc + nrm * 34.0 + Vector3.UP * 7.0, pc + Vector3.UP * 4.0])
	# Drift zone / twisty section.
	var dz := w.drift_zone.x
	views.append([w.samples[dz] + Vector3.UP * 30.0 - w.tangents[dz] * 40.0, w.samples[(dz + 60) % w.main_count]])
	var k := 0
	for v in views:
		cam.global_transform = Transform3D(Basis.IDENTITY, v[0]).looking_at(v[1], Vector3.UP)
		w.traffic.player = cam
		for f in 12:
			await process_frame
		get_root().get_texture().get_image().save_png("%s/%s_%d.png" % [out, id, k])
		k += 1
	print("rendered %d views, %d FPS last" % [k, Engine.get_frames_per_second()])
	quit()
