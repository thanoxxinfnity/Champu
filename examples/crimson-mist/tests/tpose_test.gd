extends SceneTree
## No body ever stands in the T-pose: for every cast member, enemy kind and townsperson, in every pose, at least one upper arm must be bent away from
## its rest (T) direction, and the pose must not be empty. Also checks the walk cycle really moves: the feet differ between two moments of a walk.

const POSES := [CharacterView.Pose.IDLE, CharacterView.Pose.WALK, CharacterView.Pose.RUN, CharacterView.Pose.SWING, CharacterView.Pose.HURT, CharacterView.Pose.DEAD]


func _arm_bend(v: CharacterView) -> float:
	var sk := v.rig.skeleton
	sk.force_update_all_bone_transforms()
	var best := 0.0
	for side in ["upperarmL", "upperarmR"]:
		var i: int = v.rig.idx[side]
		var rest: Vector3 = v.rig._rest_dir[i]
		var now := sk.get_bone_global_pose(i).basis.y.normalized()
		best = maxf(best, rad_to_deg(rest.angle_to(now)))
	return best


func _look(v: CharacterView, label: String, poses: Array) -> void:
	## Real frames (the walk clock runs on the engine's delta).
	if v.rig == null:
		return
	for p in poses:
		v.start_pose(p)
		v.move_speed = 1.0 if p == CharacterView.Pose.WALK else (1.4 if p == CharacterView.Pose.RUN else 0.0)
		v.ground_speed = 1.6 if p == CharacterView.Pose.WALK else (4.5 if p == CharacterView.Pose.RUN else 0.0)
		v.swing_phase = 1
		v.swing_k = 0.5
		for i in 25:
			await process_frame
		var bend := _arm_bend(v)
		T.check(bend > 9.0, "%s pose %d: arms are not in the T-pose (%.0f deg from rest)" % [label, p, bend])
	# the walk cycle moves the feet
	v.start_pose(CharacterView.Pose.WALK)
	v.move_speed = 1.0
	v.ground_speed = 1.6
	for i in 15:
		await process_frame
	var foot: int = v.rig.idx["footL"]
	v.rig.skeleton.force_update_all_bone_transforms()
	var a := v.rig.skeleton.get_bone_global_pose(foot).origin
	for i in 12:
		await process_frame
	v.rig.skeleton.force_update_all_bone_transforms()
	var b := v.rig.skeleton.get_bone_global_pose(foot).origin
	T.check(a.distance_to(b) > 0.03, "%s walk moves the feet (%.2f m)" % [label, a.distance_to(b)])


func _initialize() -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	for id in Data.CAST_ORDER:
		var v := CharacterView.new()
		holder.add_child(v)
		v.setup(id)
		await _look(v, "cast " + id, POSES)
	var kinds: Array = Bestiary.ids()
	kinds.append("bellkeeper")
	for k in kinds:
		var d := Bestiary.def(k)
		var info: Array = Enemy.RIGS[k] if Enemy.RIGS.has(k) else [String(d.body), String(d.get("style", "zombie")), float(d.height)]
		var v2 := CharacterView.new()
		holder.add_child(v2)
		if v2.setup_model("res://assets/world/%s.glb" % info[0], 1.8, Color.WHITE, String(info[1])):
			await _look(v2, "enemy " + k, POSES if String(info[1]) != "crawler" else [CharacterView.Pose.WALK])
	for n in ["nurse", "shopkeeper", "priest", "student", "fisher", "granny"]:
		var v3 := CharacterView.new()
		holder.add_child(v3)
		if v3.setup_model("res://assets/world/npc_%s.glb" % n, 1.6, Color.WHITE, "npc"):
			await _look(v3, "npc " + n, [CharacterView.Pose.IDLE, CharacterView.Pose.TALK, CharacterView.Pose.WAVE, CharacterView.Pose.SCARED])
	T.done(self)
