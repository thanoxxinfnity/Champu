extends SceneTree
## RigAnimator + PoseLib on the real Gojo and Sukuna: bones found, directions obeyed, fists attached, flight pose leans forward.

var fails := 0

func ok(cond: bool, what: String) -> void:
	print(("  ok   " if cond else "  FAIL ") + what)
	if not cond:
		fails += 1

func _init() -> void:
	for id in ["gojo_whole", "sukuna_FINAL"]:
		var a := RigAnimator.new()
		root.add_child(a)
		ok(a.load_model("res://assets/characters/%s.glb" % id), "%s loads with the 21 body bones" % id)
		ok(a.idx.size() == RigAnimator.BONES.size(), "%s: every logical bone found (%d)" % [id, a.idx.size()])
		a.set_fists(true)
		a.apply(PoseLib.build(PoseLib.stance(0.0)))
		a.skeleton.force_update_all_bone_transforms()
		var up: Vector3 = a.skeleton.get_bone_global_pose(a.idx["upperarmL"]).basis.y.normalized()
		var want: Vector3 = (PoseLib.stance(0.0)["uL"] as Vector3).normalized()
		ok(up.distance_to(want) < 0.02, "%s: left upper arm obeys its direction target" % id)
		var ur: Vector3 = a.skeleton.get_bone_global_pose(a.idx["upperarmR"]).basis.y.normalized()
		ok(ur.x < 0.0 and ur.z > 0.0, "%s: right arm is mirrored" % id)
		ok(a.skeleton.get_children().any(func(c): return c is BoneAttachment3D), "%s: fist meshes ride on the forearms" % id)
		ok(a.skeleton.get_bone_pose_scale(a.idx["handL"]).x < 0.01, "%s: hand collapsed into the fist" % id)
		a.apply(PoseLib.build(PoseLib.fly_fast(0.0)))
		a.skeleton.force_update_all_bone_transforms()
		var spine: Vector3 = a.skeleton.get_bone_global_pose(a.idx["chest"]).basis.y.normalized()
		ok(spine.z > 0.7, "%s: flying pose leans the chest forward (%.2f)" % [id, spine.z])
		a.apply(PoseLib.build(PoseLib.ko(1.0)))
		a.skeleton.force_update_all_bone_transforms()
		var hips: float = a.skeleton.get_bone_global_pose(a.idx["hips"]).origin.y
		ok(hips < a.rest_origin("hips").y - 0.4, "%s: KO drops the hips to the floor" % id)
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(1 if fails else 0)
