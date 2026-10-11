class_name Assets
extends RefCounted
## Loads the Pixal3D models (res://assets/s9/*.glb) and stands them up: scaled to a
## real-world size, resting on y = 0, centred on the footprint. A model that is not
## there is replaced by a hand-built stand-in of the same size (boxes, cylinders), so
## the game always runs and the map is never missing a piece.

const DIR := "res://assets/models/"

## Models the generator handed back facing the other way (degrees to turn them so their front is -Z).
const FACING := {"warden": {"face": 180.0}, "crawler": {"face": 180.0}, "hunter": {"face": 180.0}, "skeleton": {"face": 180.0}}

## Built from primitives instead: what the generator returned for these was not what was asked for.
const PROCEDURAL := ["conveyor", "server_rack", "mega_bomb"]

static var _scenes := {}
static var _mats := {}


static func exists(model: String) -> bool:
	if model in PROCEDURAL:
		return false
	return ResourceLoader.exists("%s%s.glb" % [DIR, model])


static func _scene(model: String) -> PackedScene:
	if not _scenes.has(model):
		_scenes[model] = load("%s%s.glb" % [DIR, model]) if exists(model) else null
	return _scenes[model]


## The material the generated model came with (its colour texture), for a mesh that was rebuilt from it.
static func original_material(model: String) -> Material:
	var pack := _scene(model)
	if pack == null:
		return null
	var root := pack.instantiate()
	var mis := root.find_children("*", "MeshInstance3D", true, false)
	var found: Material = null
	if not mis.is_empty():
		var mi := mis[0] as MeshInstance3D
		found = mi.material_override if mi.material_override != null else (mi.mesh.surface_get_material(0) if mi.mesh != null and mi.mesh.get_surface_count() > 0 else null)
	root.free()
	return found


static func bounds(root: Node3D) -> AABB:
	# Hand-built stand-ins carry their own bounds (also correct under the headless dummy renderer).
	if root.has_meta("aabb"):
		return root.get_meta("aabb")
	var box := AABB()
	var first := true
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var xf := Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var b := xf * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


## A stood-up model `size` metres tall (or that long in its widest horizontal direction when
## `by_length`). The holder's origin is the middle of the model's base.
static func make(model: String, size: float, by_length := false, _puppet := false, align := "", foot := 0.0) -> Node3D:
	var info: Dictionary = FACING.get(model, {})
	var holder := Node3D.new()
	holder.name = model
	holder.set_meta("model", model)
	var pack := _scene(model)
	var root: Node3D
	if pack == null:
		root = _stand_in(model)
		holder.set_meta("stand_in", true)
	else:
		root = pack.instantiate() as Node3D
	var box := bounds(root)
	var scale_by := size / maxf(box.size.y, 0.001)
	if by_length:
		scale_by = size / maxf(maxf(box.size.x, box.size.z), 0.001)
	# `foot` caps the widest horizontal side, so a generated cabinet that came out wider than tall still fits its alcove.
	if foot > 0.0:
		scale_by = minf(scale_by, foot / maxf(maxf(box.size.x, box.size.z), 0.001))
	var inner := Node3D.new()
	inner.add_child(root)
	inner.scale = Vector3.ONE * scale_by
	var centre := box.position + box.size * 0.5
	inner.position = Vector3(-centre.x, -box.position.y, -centre.z) * scale_by
	var pivot := Node3D.new()
	pivot.add_child(inner)
	var yaw := float(info.get("face", 0.0))
	var scaled := box.size * scale_by
	# `align` turns a model so its long horizontal side runs along "x" or "z", whichever way it was generated.
	if align == "z" and box.size.x > box.size.z * 1.15:
		yaw += 90.0
		scaled = Vector3(scaled.z, scaled.y, scaled.x)
	elif align == "x" and box.size.z > box.size.x * 1.15:
		yaw += 90.0
		scaled = Vector3(scaled.z, scaled.y, scaled.x)
	pivot.rotation_degrees.y = yaw
	holder.add_child(pivot)
	for n in root.find_children("*", "MeshInstance3D", true, false):
		(n as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	holder.set_meta("scaled_size", scaled)
	return holder


static func size_of(holder: Node3D) -> Vector3:
	return holder.get_meta("scaled_size", Vector3.ONE)


# ── stand-ins ────────────────────────────────────────────────────────────────

static func mat(color: Color, rough := 0.8, metal := 0.0, glow := 0.0) -> StandardMaterial3D:
	var key := "%s/%s/%s/%s" % [color.to_html(), rough, metal, glow]
	if not _mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.roughness = rough
		m.metallic = metal
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = color
			m.emission_energy_multiplier = glow
		if color.a < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_mats[key] = m
	return _mats[key]


static func _extent(mesh: Mesh) -> Vector3:
	if mesh is BoxMesh:
		return (mesh as BoxMesh).size
	if mesh is CylinderMesh:
		var c := mesh as CylinderMesh
		return Vector3(c.top_radius * 2.0, c.height, c.top_radius * 2.0)
	if mesh is SphereMesh:
		var sp := mesh as SphereMesh
		return Vector3(sp.radius * 2.0, sp.height, sp.radius * 2.0)
	if mesh is CapsuleMesh:
		var cp := mesh as CapsuleMesh
		return Vector3(cp.radius * 2.0, cp.height, cp.radius * 2.0)
	if mesh is TorusMesh:
		var t := mesh as TorusMesh
		return Vector3(t.outer_radius * 2.0, t.outer_radius - t.inner_radius, t.outer_radius * 2.0)
	return Vector3.ONE


static func _part(root: Node3D, mesh: Mesh, pos: Vector3, color: Color, rough := 0.8, metal := 0.0, glow := 0.0, rot := Vector3.ZERO) -> void:
	var ext := _extent(mesh)
	var box := Transform3D(Basis.from_euler(rot * PI / 180.0), pos) * AABB(-ext * 0.5, ext)
	if root.has_meta("aabb"):
		root.set_meta("aabb", (root.get_meta("aabb") as AABB).merge(box))
	else:
		root.set_meta("aabb", box)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation_degrees = rot
	mi.material_override = mat(color, rough, metal, glow)
	root.add_child(mi)


static func _box(root: Node3D, size: Vector3, pos: Vector3, color: Color, rough := 0.8, metal := 0.0, glow := 0.0) -> void:
	var bm := BoxMesh.new()
	bm.size = size
	_part(root, bm, pos, color, rough, metal, glow)


static func _cyl(root: Node3D, r: float, h: float, pos: Vector3, color: Color, rough := 0.7, metal := 0.0, glow := 0.0, rot := Vector3.ZERO) -> void:
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = 14
	cm.rings = 1
	_part(root, cm, pos, color, rough, metal, glow, rot)


static func _ball(root: Node3D, r: float, pos: Vector3, color: Color, rough := 0.7, metal := 0.0, glow := 0.0, squash := 1.0) -> void:
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = r * 2.0 * squash
	sm.radial_segments = 14
	sm.rings = 8
	_part(root, sm, pos, color, rough, metal, glow)


## A stand-in built from many little primitives is one mesh with a surface per material: a belt was seven draw calls, now it is three.
static func _merge(root: Node3D) -> Node3D:
	var groups := {}
	var count := 0
	for c in root.get_children():
		var mi := c as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		count += 1
		if not groups.has(mi.material_override):
			groups[mi.material_override] = []
		groups[mi.material_override].append(mi)
	if count < 2 or groups.size() >= count:
		return root
	var merged := ArrayMesh.new()
	for mat in groups:
		var verts := PackedVector3Array()
		var normals := PackedVector3Array()
		var uvs := PackedVector2Array()
		var indices := PackedInt32Array()
		for mi in groups[mat]:
			var arr: Array = (mi.mesh as PrimitiveMesh).get_mesh_arrays()
			var base := verts.size()
			var xf: Transform3D = (mi as MeshInstance3D).transform
			for v in (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array):
				verts.append(xf * v)
			for nv in (arr[Mesh.ARRAY_NORMAL] as PackedVector3Array):
				normals.append((xf.basis * nv).normalized())
			uvs.append_array(arr[Mesh.ARRAY_TEX_UV])
			for ix in (arr[Mesh.ARRAY_INDEX] as PackedInt32Array):
				indices.append(base + ix)
		var out := []
		out.resize(Mesh.ARRAY_MAX)
		out[Mesh.ARRAY_VERTEX] = verts
		out[Mesh.ARRAY_NORMAL] = normals
		out[Mesh.ARRAY_TEX_UV] = uvs
		out[Mesh.ARRAY_INDEX] = indices
		merged.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, out)
		merged.surface_set_material(merged.get_surface_count() - 1, mat)
	for c in root.get_children():
		if c is MeshInstance3D:
			root.remove_child(c)
			c.free()
	var one := MeshInstance3D.new()
	one.name = "Merged"
	one.mesh = merged
	root.add_child(one)
	return root


static func _stand_in(model: String) -> Node3D:
	var n := Node3D.new()
	var steel := Color(0.34, 0.37, 0.4)
	var dark := Color(0.12, 0.13, 0.15)
	match model:
		"warden", "crawler", "hunter", "skeleton":
			var c := Color(0.45, 0.47, 0.5) if model != "skeleton" else Color(0.85, 0.83, 0.75)
			_cyl(n, 0.25, 0.9, Vector3(0, 1.15, 0), c, 0.6, 0.5)
			_ball(n, 0.22, Vector3(0, 1.8, 0), c, 0.5, 0.5)
			_cyl(n, 0.07, 1.0, Vector3(-0.35, 0.95, 0), c, 0.6, 0.5)
			_cyl(n, 0.07, 1.0, Vector3(0.35, 0.95, 0), c, 0.6, 0.5)
			_cyl(n, 0.09, 0.9, Vector3(-0.1, 0.45, 0), c, 0.6, 0.5)
			_cyl(n, 0.09, 0.9, Vector3(0.1, 0.45, 0), c, 0.6, 0.5)
			if model == "warden":
				_ball(n, 0.05, Vector3(-0.08, 1.83, -0.2), Color(1.0, 0.1, 0.05), 0.3, 0.0, 4.0)
				_ball(n, 0.05, Vector3(0.08, 1.83, -0.2), Color(1.0, 0.1, 0.05), 0.3, 0.0, 4.0)
		"fuse":
			_cyl(n, 0.012, 0.09, Vector3(0, 0.045, 0), Color(0.92, 0.92, 0.9), 0.3)
		"keycard":
			_box(n, Vector3(0.085, 0.01, 0.054), Vector3(0, 0.005, 0), Color(1.0, 0.55, 0.1), 0.4, 0.0, 0.6)
		"battery":
			_cyl(n, 0.035, 0.12, Vector3(0, 0.06, 0), Color(0.15, 0.55, 0.2), 0.4, 0.4, 0.5)
		"locker":
			_box(n, Vector3(0.9, 2.0, 0.5), Vector3(0, 1.0, 0), Color(0.3, 0.36, 0.38), 0.6, 0.4)
		"crate":
			_box(n, Vector3(0.9, 0.7, 0.7), Vector3(0, 0.35, 0), Color(0.3, 0.32, 0.3), 0.7, 0.3)
		"barrel":
			_cyl(n, 0.3, 0.95, Vector3(0, 0.475, 0), Color(0.14, 0.26, 0.45), 0.5, 0.5)
		"desk", "lab_table", "lab_bench":
			_box(n, Vector3(1.6, 0.05, 0.7), Vector3(0, 0.85, 0), Color(0.5, 0.5, 0.5), 0.5)
			for x in [-0.7, 0.7]:
				_box(n, Vector3(0.1, 0.8, 0.6), Vector3(x, 0.4, 0), steel, 0.6, 0.4)
		"conveyor":
			# A belt on a frame: two rails, rollers, and a dark rubber surface.
			_box(n, Vector3(2.4, 0.08, 0.9), Vector3(0, 0.78, 0), Color(0.06, 0.06, 0.07), 0.95)
			for z in [-0.46, 0.46]:
				_box(n, Vector3(2.5, 0.16, 0.06), Vector3(0, 0.78, z), Color(0.75, 0.55, 0.1), 0.5, 0.5)
			for x in [-1.1, -0.35, 0.35, 1.1]:
				_box(n, Vector3(0.08, 0.7, 0.8), Vector3(x, 0.35, 0), steel, 0.6, 0.5)
		"server_rack":
			_box(n, Vector3(0.8, 2.1, 0.8), Vector3(0, 1.05, 0), Color(0.07, 0.08, 0.09), 0.5, 0.5)
			for i in range(12):
				var on := (i * 7) % 5 != 0
				_box(n, Vector3(0.06, 0.03, 0.02), Vector3(-0.2 + 0.1 * (i % 4), 0.5 + 0.12 * i, -0.41), Color(0.2, 1.0, 0.4) if on else Color(1.0, 0.2, 0.1), 0.3, 0.0, 2.5)
		"mega_bomb":
			for x in [-0.22, 0.0, 0.22]:
				_cyl(n, 0.09, 0.5, Vector3(x, 0.25, 0), Color(0.4, 1.0, 0.45), 0.2, 0.0, 1.4)
			_box(n, Vector3(0.62, 0.3, 0.3), Vector3(0, 0.62, 0), Color(0.12, 0.12, 0.13), 0.5, 0.6)
			_box(n, Vector3(0.3, 0.1, 0.02), Vector3(0, 0.64, -0.16), Color(1.0, 0.2, 0.1), 0.3, 0.0, 3.0)
		"ceiling_pipe":
			_cyl(n, 0.12, 2.0, Vector3(0, 0.12, 0), Color(0.42, 0.26, 0.18), 0.6, 0.5, 0.0, Vector3(90, 0, 0))
		_:
			_box(n, Vector3(0.6, 0.6, 0.6), Vector3(0, 0.3, 0), Color(0.45, 0.45, 0.5), 0.6, 0.3)
	return _merge(n)
