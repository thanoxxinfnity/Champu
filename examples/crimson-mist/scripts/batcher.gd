class_name Batcher
extends RefCounted
## Static batching for GL Compatibility (which draws every MeshInstance3D separately): all static meshes under a zone are merged into one mesh per
## (material, 48 m cell), baked into the zone's local space. Plain flat-colour toon materials share ONE vertex-colour material, so a whole cell of
## frames, sills, doors and signs is a single draw call. Colliders are untouched. Anything under a node with meta "keep" (doors, gates, things that
## move or vanish later) is left alone, as are MultiMeshes and skinned meshes.

const CELL := 96.0


static func keep(n: Node) -> void:
	n.set_meta("keep", true)


static func _kept(n: Node, root: Node) -> bool:
	var p: Node = n
	while p != null and p != root:
		if p.has_meta("keep"):
			return true
		p = p.get_parent()
	return false


static func _group(groups: Dictionary, key: String, mat: Material, shadow: int, has_uv: bool) -> Dictionary:
	if not groups.has(key):
		groups[key] = {"mat": mat, "shadow": shadow, "uv": has_uv, "v": PackedVector3Array(), "n": PackedVector3Array(), "t": PackedVector2Array(), "c": PackedColorArray(), "i": PackedInt32Array()}
	return groups[key]


## Returns {"before": meshes merged, "after": batches created}.
static func merge(root: Node3D, view_end := 130.0) -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return {"before": 0, "after": 0}      # no mesh surfaces to read on the dummy renderer
	var groups := {}
	var sources: Array[MeshInstance3D] = []
	var inv := root.global_transform.affine_inverse()
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null or mi.skin != null or not mi.is_visible_in_tree():
			continue
		if _kept(mi, root) or mi.get_parent() is Skeleton3D:
			continue
		var xf := inv * mi.global_transform
		var cell := Vector2i(floori(xf.origin.x / CELL), floori(xf.origin.z / CELL))
		var nb := xf.basis.inverse().transposed()
		var flip := xf.basis.determinant() < 0.0
		var ok := false
		for s in mi.mesh.get_surface_count():
			var m: Material = mi.get_surface_override_material(s)
			if m == null:
				m = mi.material_override
			if m == null:
				m = mi.mesh.surface_get_material(s)
			if m == null:
				continue
			var arr := mi.mesh.surface_get_arrays(s)
			if arr.is_empty() or arr[Mesh.ARRAY_VERTEX] == null:
				continue
			var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var norms: PackedVector3Array = arr[Mesh.ARRAY_NORMAL] if arr[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
			var uvs: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV] if arr[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
			var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var plain := Toon.is_plain(m)
			var key: String
			var gm: Material = m
			if plain:
				gm = Toon.vcolor()
				key = "vc/%s/%s/%s" % [cell.x, cell.y, int(mi.cast_shadow)]
			else:
				key = "%s/%s/%s/%s" % [m.get_instance_id(), cell.x, cell.y, int(mi.cast_shadow)]
			var has_uv := uvs.size() == verts.size() and not plain
			var g := _group(groups, key, gm, mi.cast_shadow, has_uv)
			var base: int = g.v.size()
			var col := Color.WHITE
			if plain:
				var a: Variant = (m as ShaderMaterial).get_shader_parameter("albedo")
				col = (a as Color).srgb_to_linear() if a != null else Color.WHITE
			for k in verts.size():
				g.v.append(xf * verts[k])
				g.n.append((nb * norms[k]).normalized() if norms.size() == verts.size() else Vector3.UP)
				if has_uv:
					g.t.append(uvs[k])
				g.c.append(col)
			if idx.is_empty():
				idx = PackedInt32Array()
				for k in verts.size():
					idx.append(k)
			for k in range(0, idx.size(), 3):
				if flip:
					g.i.append_array([base + idx[k], base + idx[k + 2], base + idx[k + 1]])
				else:
					g.i.append_array([base + idx[k], base + idx[k + 1], base + idx[k + 2]])
			ok = true
		if ok:
			sources.append(mi)
	for mi in sources:
		mi.get_parent().remove_child(mi)
		mi.queue_free()
	var count := 0
	for key in groups:
		var g: Dictionary = groups[key]
		if g.i.is_empty():
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = g.v
		arrays[Mesh.ARRAY_NORMAL] = g.n
		arrays[Mesh.ARRAY_COLOR] = g.c
		if g.uv:
			arrays[Mesh.ARRAY_TEX_UV] = g.t
		arrays[Mesh.ARRAY_INDEX] = g.i
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, g.mat)
		var out := MeshInstance3D.new()
		out.mesh = mesh
		out.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		out.visibility_range_end = view_end
		out.name = "batch"
		root.add_child(out)
		count += 1
	return {"before": sources.size(), "after": count}
