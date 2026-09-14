# Proves a generated .glb really rigs, using the actual Godot engine.
#
# The Node tests in scripts/test-rig.mjs check the bytes we write. They cannot
# check what Godot does with them, and that is where skinning goes wrong: a file
# can be spec-valid and still import as a pile of meshes with no skeleton, or
# with bind matrices that tear the character apart the first time a bone moves.
#
# Usage:
#   1. Write a rigged hero.glb and a minimal project.godot into a folder.
#   2. godot --headless --path <folder> --import
#   3. godot --headless --path <folder> --script verify-rig.gd
#
# Prints RESULT: PASS, or the specific checks that failed.

extends SceneTree

func _find(node: Node, type: String) -> Node:
	if node.get_class() == type:
		return node
	for child in node.get_children():
		var found := _find(child, type)
		if found != null:
			return found
	return null

func _init() -> void:
	var packed := load("res://hero.glb") as PackedScene
	if packed == null:
		print("RESULT: FAIL - hero.glb did not load as a scene")
		quit(1)
		return

	var root := packed.instantiate()
	# A Skeleton3D only recomputes poses inside the tree.
	get_root().add_child(root)

	var sk := _find(root, "Skeleton3D") as Skeleton3D
	if sk == null:
		print("RESULT: FAIL - imported with no Skeleton3D; the mesh is scenery, not a character")
		quit(1)
		return

	var fails := 0
	print("Skeleton3D with ", sk.get_bone_count(), " bones")
	for i in sk.get_bone_count():
		print("  ", i, " ", sk.get_bone_name(i), " parent=", sk.get_bone_parent(i),
			" rest=", sk.get_bone_rest(i).origin)

	# Every mesh must be bound to the skeleton, or it will not move with it.
	var skinned := 0
	for mi in sk.get_children():
		if not (mi is MeshInstance3D):
			continue
		var skin: Skin = (mi as MeshInstance3D).skin
		if skin == null:
			print("FAIL: ", mi.name, " has no skin")
			fails += 1
			continue
		skinned += 1
		for b in skin.get_bind_count():
			var bone_name := skin.get_bind_name(b)
			var bone := sk.find_bone(bone_name) if bone_name != "" else skin.get_bind_bone(b)
			# A bind pose is the inverse of the bone's rest transform. If the two
			# disagree the limb lands somewhere else the moment anything animates.
			if not (sk.get_bone_global_rest(bone) * skin.get_bind_pose(b)).is_equal_approx(Transform3D.IDENTITY):
				print("FAIL: ", mi.name, " bind pose for ", bone_name, " does not cancel its rest pose")
				fails += 1
	print(skinned, " skinned mesh(es), bind poses checked")

	var arm := sk.find_bone("ArmL")
	var head := sk.find_bone("Head")
	var hips := sk.find_bone("Hips")
	if arm < 0 or head < 0 or hips < 0:
		print("FAIL: expected a biped rig with Hips, Head and ArmL")
		quit(1)
		return

	var arm_before := sk.get_bone_global_pose(arm).origin
	var head_before := sk.get_bone_global_pose(head).origin

	# Headless runs process no frames, so poses stay dirty unless forced.
	sk.set_bone_pose_position(hips, sk.get_bone_pose_position(hips) + Vector3(0, 1, 0))
	sk.force_update_all_bone_transforms()

	if not (sk.get_bone_global_pose(arm).origin - arm_before).is_equal_approx(Vector3(0, 1, 0)):
		print("FAIL: raising the hips did not carry the arm with it")
		fails += 1
	if not (sk.get_bone_global_pose(head).origin - head_before).is_equal_approx(Vector3(0, 1, 0)):
		print("FAIL: raising the hips did not carry the head with it")
		fails += 1

	sk.set_bone_pose_position(hips, sk.get_bone_pose_position(hips) - Vector3(0, 1, 0))
	sk.force_update_all_bone_transforms()
	var head_flat := sk.get_bone_global_pose(head).origin

	# The reverse: a shoulder must not drag the head, which is what a flat
	# skeleton (every bone parented to the root) would do.
	sk.set_bone_pose_rotation(arm, Quaternion(Vector3(0, 0, 1), PI / 2))
	sk.force_update_all_bone_transforms()
	if not sk.get_bone_global_pose(head).origin.is_equal_approx(head_flat):
		print("FAIL: rotating the shoulder moved the head")
		fails += 1

	print("RESULT: ", "PASS" if fails == 0 else str(fails) + " FAILURES")
	quit(0 if fails == 0 else 1)
