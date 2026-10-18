extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/bake_rig.gd
## Skins assets/protagonist.glb to the skeleton in scripts/player/rig.gd and saves
## assets/protagonist_skin.res. Not run for the first pass — protagonist_skin.res was copied
## straight from site-video/assets/character_skin.res, since Rig.BOX/PROFILE here are the exact
## same measurements of the exact same source mesh. Re-run this only if protagonist.glb changes.
## Each vertex is weighted to the nearest limbs of its own side by distance to the bone, so the
## elbows, knees and the neck bend smoothly instead of tearing.

const NEAR := 4
const POWER := 3.0


func _init() -> void:
	# godot --path . -s tools/bake_rig.gd -- [character id]   (default: protagonist; ids are in Data.CHARACTERS)
	var args := OS.get_cmdline_user_args()
	var id: String = args[0] if args.size() > 0 else "protagonist"
	Rig.use(Rig.spec_for(id))
	var root := (load(Rig.S.src) as PackedScene).instantiate()
	var mi := root.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var arrays := mi.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var box := mi.get_aabb()
	print("box ", box)
	var segs: Array = []   # [bone index, from, to, side]
	var P := Rig.positions()
	var j := Rig.joints()
	for i in range(j.size()):
		var name: String = j[i][0]
		var side := 0
		if name.ends_with("L"):
			side = -1
		elif name.ends_with("R"):
			side = 1
		segs.append({"i": i, "a": P[name], "b": Rig.tip(name, P), "side": side, "name": name})
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	bones.resize(verts.size() * 4)
	weights.resize(verts.size() * 4)
	var cx := Rig.to_mesh(Vector3(0.5, 0.5, 0.5)).x
	var hip_cut: float = Rig.S.profile.hip + 0.02      # legs claim nothing above this; arms claim nothing below it
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
			var limb: bool = s.side != 0
			if limb and s.side != side:
				continue
			var leg: bool = nm.begins_with("thigh") or nm.begins_with("shin") or nm.begins_with("foot") or nm.begins_with("toe")
			if leg and p.y > Rig.to_mesh(Vector3(0, hip_cut, 0)).y:
				continue
			if limb and not leg and p.y < Rig.to_mesh(Vector3(0, hip_cut, 0)).y:
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
	var src_mat := mi.get_surface_override_material(0)
	if src_mat == null:
		src_mat = mi.mesh.surface_get_material(0)
	if src_mat != null:
		out.surface_set_material(0, src_mat)
	var err := ResourceSaver.save(out, Rig.S.mesh)
	print("saved ", Rig.S.mesh, " err ", err, " verts ", verts.size())
	quit()


func _dist(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
	return p.distance_to(a + ab * t)
