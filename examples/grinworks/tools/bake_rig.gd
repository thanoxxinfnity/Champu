extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/bake_rig.gd
## Skins assets/s9/mr_grin.glb to the skeleton in scripts/rig.gd and saves assets/s9/mr_grin_skin.res.
## Each vertex is weighted to the nearest limbs of its own side by distance to the bone, so the
## elbows, knees and the neck bend smoothly instead of tearing.

const NEAR := 4
const POWER := 3.0


func _init() -> void:
	var root := (load(Rig.SRC) as PackedScene).instantiate()
	var mi := root.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var arrays := mi.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var box := mi.get_aabb()
	print("box ", box)
	var segs: Array = []   # [bone index, from, to, side]
	for i in range(Rig.JOINTS.size()):
		var name: String = Rig.JOINTS[i][0]
		if name.ends_with("_end"):
			continue
		var end_name := _end_of(i)
		var a := Rig.to_mesh(Rig.JOINTS[i][2])
		var b := Rig.to_mesh(Rig.JOINTS[Rig.index_of(end_name)][2])
		segs.append({"i": i, "a": a, "b": b, "side": 0 if not (name.ends_with("_l") or name.ends_with("_r")) else (-1 if name.ends_with("_l") else 1), "name": name})
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	bones.resize(verts.size() * 4)
	weights.resize(verts.size() * 4)
	var cx := Rig.to_mesh(Vector3(0.5, 0.5, 0.5)).x
	var arm_x := 0.075 * box.size.x
	for vi in range(verts.size()):
		var p := verts[vi]
		var side := 0
		# The side a vertex belongs to: left of the body is "l" (x below the middle), and a vertex in the middle belongs to neither.
		if p.x < cx - 0.02 * box.size.x:
			side = -1
		elif p.x > cx + 0.02 * box.size.x:
			side = 1
		var cand: Array = []
		for s in segs:
			var nm: String = s.name
			var limb: bool = s.side != 0
			if limb and s.side != side:
				continue
			# Arms start out beside the chest, legs below the pelvis: do not let a leg grab the torso or an arm grab the head.
			if nm.begins_with("arm_") or nm.begins_with("fore_") or nm.begins_with("hand_"):
				if absf(p.x - cx) < arm_x * 0.5 and p.y < Rig.to_mesh(Vector3(0, 0.80, 0)).y:
					pass
			if nm.begins_with("thigh_") or nm.begins_with("shin_") or nm.begins_with("foot_"):
				if p.y > Rig.to_mesh(Vector3(0, 0.56, 0)).y:
					continue
			if (nm.begins_with("arm_") or nm.begins_with("fore_") or nm.begins_with("hand_")) and p.y < Rig.to_mesh(Vector3(0, 0.52, 0)).y:
				continue
			var d := _dist(p, s.a, s.b)
			cand.append([d, s.i])
		cand.sort_custom(func(x, y): return x[0] < y[0])
		var total := 0.0
		var ws := [0.0, 0.0, 0.0, 0.0]
		var ids := [0, 0, 0, 0]
		for k in range(mini(NEAR, cand.size())):
			var w := 1.0 / pow(maxf(cand[k][0], 0.002) / box.size.y, POWER)
			ws[k] = w
			ids[k] = cand[k][1]
			total += w
		for k in range(4):
			bones[vi * 4 + k] = ids[k]
			weights[vi * 4 + k] = ws[k] / total if total > 0.0 else (1.0 if k == 0 else 0.0)
	arrays[Mesh.ARRAY_BONES] = bones
	arrays[Mesh.ARRAY_WEIGHTS] = weights
	var out := ArrayMesh.new()
	out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var err := ResourceSaver.save(out, Rig.MESH)
	print("saved ", Rig.MESH, " err ", err, " verts ", verts.size())
	quit()


func _end_of(i: int) -> String:
	# The bone's tip is its first child; a chain's last bone has an explicit *_end joint.
	var name: String = Rig.JOINTS[i][0]
	for j in Rig.JOINTS:
		if j[1] == name and not (name == "chest" and (j[0] as String).begins_with("arm_")) and not (name == "pelvis" and (j[0] as String).begins_with("thigh_")) and not (name == "chest" and (j[0] as String) == "neck" and false):
			return j[0]
	return name


func _dist(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
	return p.distance_to(a + ab * t)
