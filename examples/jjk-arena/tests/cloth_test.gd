extends SceneTree
## godot --headless --path . -s tests/cloth_test.gd   (prints ALL OK)

var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func _init() -> void:
	print("cloth sway test")
	var root := Node3D.new()
	get_root().add_child(root)
	var skel := Skeleton3D.new()
	root.add_child(skel)
	var hips := skel.add_bone("hips")
	skel.set_bone_rest(hips, Transform3D(Basis.IDENTITY, Vector3(0, 1, 0)))
	var prev := hips
	for i in range(1, 4):
		var b := skel.add_bone("sway_gi0_%d" % i)
		skel.set_bone_parent(b, prev)
		skel.set_bone_rest(b, Transform3D(Basis.IDENTITY, Vector3(0, -0.1, 0)))
		prev = b
	skel.reset_bone_poses()
	var cs := ClothSway.new()
	cs.skeleton = skel
	root.add_child(cs)
	await process_frame
	check(cs.chain_count() == 1, "one sway chain found (sway_gi0)")
	cs.wind = Vector3(8, 0, 0)
	for i in 60:
		cs._physics_process(1.0 / 60.0)
	var tip := skel.get_bone_count() - 1
	var rot := skel.get_bone_pose_rotation(tip)
	check(not rot.is_equal_approx(Quaternion.IDENTITY), "wind bends the chain (tip rotated)")
	cs.wind = Vector3.ZERO
	for i in 240:
		cs._physics_process(1.0 / 60.0)
	check(skel.get_bone_pose_rotation(tip).angle_to(Quaternion.IDENTITY) < 0.8, "cloth settles back when the wind stops")
	cs.enabled = false
	var before := skel.get_bone_pose_rotation(tip)
	cs.wind = Vector3(20, 0, 0)
	for i in 30:
		cs._physics_process(1.0 / 60.0)
	check(skel.get_bone_pose_rotation(tip).is_equal_approx(before), "disabled sway does nothing (Low mode)")
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
