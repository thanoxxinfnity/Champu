extends SceneTree
## godot --headless --path . -s tests/dismember_test.gd   (prints ALL OK)

var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func _init() -> void:
	print("dismember test")
	var scene := Node3D.new()
	get_root().add_child(scene)
	current_scene = scene
	var skel := Skeleton3D.new()
	for n in ["hips", "spine", "forearmL", "forearmR", "shinL", "shinR"]:
		skel.add_bone(n)
	scene.add_child(skel)
	var box := BoxMesh.new()
	for piece in Dismember.PIECES:
		var m := MeshInstance3D.new()
		m.name = "cut_%s__part" % piece
		m.mesh = box
		scene.add_child(m)
	var d := Dismember.new()
	d.skeleton = skel
	scene.add_child(d)
	await process_frame
	check(not d.is_cut("lower"), "nothing is cut at the start")
	var b := d.cut_piece("lower", Vector3(0, 0, 4))
	check(b != null and d.is_cut("lower"), "waist cut returns a flying rigid body")
	check(not scene.get_node("cut_lower__part").visible, "the piece disappears from the standing character")
	check(scene.get_node("cut_upper__part").visible, "the other pieces stay")
	check(d.cut_piece("lower") == null, "the same piece cannot be cut twice")
	for p in ["foreL", "foreR", "shinL", "shinR"]:
		d.cut_piece(p)
	check(d.cut_pieces.size() == 5, "limbs can be cut too (5 pieces off)")
	check(d.cut_piece("tail") == null, "unknown piece is ignored")
	d.join_all()
	check(d.cut_pieces.is_empty(), "join_all clears the cut list")
	var all_back := true
	for piece in Dismember.PIECES:
		all_back = all_back and scene.get_node("cut_%s__part" % piece).visible
	check(all_back, "join_all shows every piece again")
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
