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
	# the real Sukuna (Meguna): the author's dynamic bones arrive as sway chains, hair holds stiffer than the haori hem
	var rig := RigAnimator.new()
	root.add_child(rig)
	check(rig.load_model("res://assets/characters/meguna.glb"), "Meguna loads")
	var mc := ClothSway.new()
	mc.skeleton = rig.skeleton
	root.add_child(mc)
	mc.build()
	check(mc.chain_count() >= 30, "Meguna has %d cloth/hair chains (haori hem, sleeves, trouser hems, hair)" % mc.chain_count())
	var hem := rig.skeleton.find_bone("sway_LTopsHemA_0")
	var hair := rig.skeleton.find_bone("sway_FhairB_0")
	check(hem >= 0 and hair >= 0, "haori hem and fringe chains are named for ClothSway")
	var stiff := {}
	for c in mc._chains:
		stiff[c.bones[0]] = c.stiffness
	check(stiff.get(hair, 0.0) > stiff.get(hem, 1.0), "hair is stiffer than the haori hem")
	var hem_rest := rig.skeleton.get_bone_pose_rotation(hem)
	mc.wind = Vector3(0, 0, 12)
	for i in 40:
		rig.position.x += 0.05
		mc._physics_process(1.0 / 60.0)
	check(rig.skeleton.get_bone_pose_rotation(hem).angle_to(hem_rest) > 0.05, "the haori hem swings when he moves")
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
