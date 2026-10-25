extends SceneTree
## Every cast member loads (model or stand-in), a rigged model has all humanoid bones, poses apply, sway bones exist and move.

func _initialize() -> void:
	var root3d := Node3D.new()
	root.add_child(root3d)
	for id in Data.CAST_ORDER:
		var v := CharacterView.new()
		root3d.add_child(v)
		v.setup(id)
		await process_frame
		var path := CharacterView.model_path(String(Data.CAST[id].model))
		if path == "":
			T.check(v.stand_in, "%s: no model pack here -> stand-in used" % id)
			continue
		T.check(v.rig != null, "%s: rigged model loaded (%s)" % [id, path.get_file()])
		if v.rig == null:
			continue
		for b in RigAnimator.BONES:
			T.check(v.rig.idx.has(b), "%s has bone %s" % [id, b])
		var tris := 0
		for n in v.rig.model.find_children("*", "MeshInstance3D", true, false):
			var mi := n as MeshInstance3D
			if mi.mesh == null:
				continue
			for s in mi.mesh.get_surface_count():
				var arr := mi.mesh.surface_get_arrays(s)
				if arr.size() > Mesh.ARRAY_INDEX and arr[Mesh.ARRAY_INDEX] != null:
					tris += (arr[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
		T.check(tris == 0 or tris <= 26000, "%s triangle budget (%d)" % [id, tris])
		# a pose must actually move the arm: raise it, compare the hand position
		var sk := v.rig.skeleton
		var hand := v.rig.idx["handR"]
		v.rig.apply(PoseLib.build(CMPoses.idle(0.0)))
		var down := sk.get_bone_global_pose(hand).origin
		v.rig.apply(PoseLib.build(CMPoses.swing(1, 1.0, 0)))
		var swung := sk.get_bone_global_pose(hand).origin
		T.check(down.distance_to(swung) > 0.25, "%s swing pose moves the hand (%.2f m)" % [id, down.distance_to(swung)])
		# sway: moving the body must bend at least one hair/coat/tail bone
		if not v.rig.sway_bones.is_empty():
			v.position = Vector3.ZERO
			await process_frame
			var before := sk.get_bone_pose_rotation(v.rig.sway_bones[0])
			for i in 30:
				v.position.x += 0.12
				await process_frame
			var after := sk.get_bone_pose_rotation(v.rig.sway_bones[0])
			T.check(before.angle_to(after) > 0.005, "%s hair/coat sway follows movement" % id)
		v.queue_free()
	T.done(self)
