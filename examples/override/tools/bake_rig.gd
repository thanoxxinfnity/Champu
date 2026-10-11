extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/bake_rig.gd -- warden crawler hunter
## Skins assets/models/<name>.glb to the skeleton in scripts/rig.gd and saves assets/rigs/<name>_skin.res.
## Each vertex is weighted to the nearest limbs of its own side by distance to the bone, so elbows, knees and the
## neck bend smoothly instead of tearing. It also prints the model's box, which goes into Rig.PROFILES.

const NEAR := 4
const POWER := 3.0


func _init() -> void:
	DirAccess.make_dir_recursive_absolute("res://assets/rigs")
	for model in OS.get_cmdline_user_args():
		bake(model)
	quit()


func bake(model: String) -> void:
	var root := (load("res://assets/models/%s.glb" % model) as PackedScene).instantiate()
	var mi := root.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var arrays := mi.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var bb := mi.get_aabb()
	print("%s box: AABB(Vector3(%s, %s, %s), Vector3(%s, %s, %s))" % [model, bb.position.x, bb.position.y, bb.position.z, bb.size.x, bb.size.y, bb.size.z])
	if not Rig.PROFILES.has(model):
		print("  (no profile yet: add one to Rig.PROFILES with the box above)")
		return
	var box: AABB = Rig.box(model)
	var j := Rig.joints(model)
	var segs: Array = []
	for i in range(j.size()):
		var name: String = j[i][0]
		if name.ends_with("_end"):
			continue
		var tip := _tip_of(j, i)
		var a := Rig.to_mesh(model, j[i][2])
		var b := Rig.to_mesh(model, tip)
		var side := 0
		if name.ends_with("_l"):
			side = -1
		elif name.ends_with("_r"):
			side = 1
		segs.append({"i": i, "a": a, "b": b, "side": side, "name": name})
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	bones.resize(verts.size() * 4)
	weights.resize(verts.size() * 4)
	var cx := Rig.to_mesh(model, Vector3(0.5, 0.5, 0.5)).x
	var hip_y := Rig.to_mesh(model, Vector3(0, Rig.PROFILES[model].hip + 0.04, 0)).y
	var arm_floor := Rig.to_mesh(model, Vector3(0, Rig.PROFILES[model].hip + 0.02, 0)).y
	for vi in range(verts.size()):
		var p := verts[vi]
		var side := 0
		if p.x < cx - 0.02 * box.size.x:
			side = -1
		elif p.x > cx + 0.02 * box.size.x:
			side = 1
		var cand: Array = []
		for s in segs:
			var nm: String = s.name
			if s.side != 0 and s.side != side:
				continue
			if (nm.begins_with("thigh_") or nm.begins_with("shin_") or nm.begins_with("foot_")) and p.y > hip_y:
				continue
			if (nm.begins_with("arm_") or nm.begins_with("fore_") or nm.begins_with("hand_")) and p.y < arm_floor:
				continue
			cand.append([_dist(p, s.a, s.b), s.i])
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
	var path := "%s%s_skin.res" % [Rig.DIR, model]
	print("  saved ", path, " err ", ResourceSaver.save(out, path), " verts ", verts.size())


## A bone's tip is its first child.
func _tip_of(j: Array, i: int) -> Vector3:
	var name: String = j[i][0]
	for e in j:
		if e[1] == name and not (name == "chest" and (e[0] as String).begins_with("arm_")) and not (name == "pelvis" and (e[0] as String).begins_with("thigh_")):
			return e[2]
	return j[i][2]


func _dist(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
	return p.distance_to(a + ab * t)
