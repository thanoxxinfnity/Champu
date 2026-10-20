extends SceneTree
## xvfb-run -a godot --rendering-driver opengl3 --resolution 1280x720 --path . -s tests/collapse_shot.gd
## A tower collapses into rubble and burns down to ash; screenshots at several moments in /tmp/cm/collapse_N.png.

func _init() -> void:
	var built := ArenaBuilder.build(false)
	var world: Node3D = built["root"]
	root.add_child(world)
	var dm := DestructionManager.new()
	world.add_child(dm)
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.current = true
	cam.fov = 60.0
	await process_frame
	var b: Node3D = world.get_tree().get_nodes_in_group("buildings")[0]
	var p := b.global_position
	var out := (Vector3(p.x, 0, p.z)).normalized()
	cam.global_position = p - out * 42.0 + Vector3(0, 9, 0)
	cam.look_at(p + Vector3(0, 10, 0))
	BuildingCollapse.run(b, dm, world, 1.0, RandomNumberGenerator.new())
	var marks := [0.8, 2.0, 3.6, 7.0, 20.0, 34.0]
	var t := 0.0
	var i := 0
	while i < marks.size():
		await process_frame
		t += get_root().get_process_delta_time() if get_root().get_process_delta_time() > 0.0 else 0.016
		if t >= marks[i]:
			root.get_viewport().get_texture().get_image().save_png("/tmp/cm/collapse_%d.png" % i)
			i += 1
	quit()
