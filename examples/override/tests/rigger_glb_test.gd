extends SceneTree
## godot --headless --path . -s tests/rigger_glb_test.gd
## The Rigger-layout files in assets/rigger load back as Rigger exports do: 49 bones by name, a skinned mesh, one clip "Take".

var fails := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		fails += 1
		print("FAIL ", what)


func _initialize() -> void:
	for model in ["warden", "crawler", "hunter"]:
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		var err := doc.append_from_file("res://assets/rigger/%s.glb" % model, st)
		check(err == OK, "%s: glb reads" % model)
		if err != OK:
			continue
		var node := doc.generate_scene(st)
		root.add_child(node)
		var sk := _find(node, "Skeleton3D") as Skeleton3D
		check(sk != null and sk.get_bone_count() == 49, "%s: 49 bones" % model)
		if sk:
			for n in ["hips", "head", "handL", "index1L", "pinky3R", "toeR", "upperArmR", "thighL"]:
				check(sk.find_bone(n) != -1, "%s: bone %s" % [model, n])
		var mi := _find(node, "MeshInstance3D") as MeshInstance3D
		check(mi != null and mi.skin != null, "%s: skinned mesh" % model)
		var ap := _find(node, "AnimationPlayer") as AnimationPlayer
		check(ap != null and ap.has_animation("Take"), "%s: clip Take" % model)
		if ap and sk:
			var an := ap.get_animation("Take")
			check(an.get_track_count() >= 40, "%s: Take has %d tracks" % [model, an.get_track_count()])
			an.loop_mode = Animation.LOOP_LINEAR
			var idx := sk.find_bone("index1L")
			var rest := sk.get_bone_pose_rotation(idx)
			ap.play("Take")
			ap.seek(0.3, true)
			check(not rest.is_equal_approx(sk.get_bone_pose_rotation(idx)), "%s: index1L moves in Take" % model)
		node.queue_free()
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(fails)


func _find(node: Node, cls: String) -> Node:
	if node.is_class(cls):
		return node
	for c in node.get_children():
		var f := _find(c, cls)
		if f:
			return f
	return null
