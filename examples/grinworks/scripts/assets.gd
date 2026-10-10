class_name Assets
extends RefCounted
## Loads the Pixal3D models (res://assets/s9/*.glb) and stands them up: scaled to a
## real-world size, resting on y = 0, centred on the footprint. A model that is not
## there is replaced by a hand-built stand-in of the same size (boxes, cylinders), so
## the game always runs and the map is never missing a piece.

const DIR := "res://assets/s9/"
const PUPPET := preload("res://shaders/puppet.gdshader")

static var _scenes := {}
static var _mats := {}


static func exists(model: String) -> bool:
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
static func make(model: String, size: float, by_length := false, puppet := false, align := "", foot := 0.0) -> Node3D:
	var info: Dictionary = Data.MODELS.get(model, {})
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
	var mats: Array = []
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if puppet and mi.mesh != null:
			var m := _puppet_material(mi, info)
			mi.material_override = m
			mats.append(m)
	holder.set_meta("puppet_mats", mats)
	holder.set_meta("scaled_size", scaled)
	return holder


static func size_of(holder: Node3D) -> Vector3:
	return holder.get_meta("scaled_size", Vector3.ONE)


static func _puppet_material(mi: MeshInstance3D, info: Dictionary) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = PUPPET
	var box := mi.get_aabb()
	m.set_shader_parameter("bmin", box.position)
	m.set_shader_parameter("bsize", box.size)
	m.set_shader_parameter("shoulder", float(info.get("shoulder", 0.12)))
	m.set_shader_parameter("hip", float(info.get("hip", 0.06)))
	m.set_shader_parameter("tpose", float(info.get("tpose", 1.0)))
	var src: Material = mi.material_override if mi.material_override != null else mi.mesh.surface_get_material(0)
	if src is BaseMaterial3D:
		var tex := (src as BaseMaterial3D).albedo_texture
		if tex != null:
			m.set_shader_parameter("albedo_tex", tex)
			m.set_shader_parameter("use_tex", true)
		else:
			var c := (src as BaseMaterial3D).albedo_color
			m.set_shader_parameter("tint", Vector3(c.r, c.g, c.b))
	return m


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


static func _stand_in(model: String) -> Node3D:
	var n := Node3D.new()
	var steel := Color(0.34, 0.37, 0.4)
	var dark := Color(0.12, 0.13, 0.15)
	match model:
		"locker":
			_box(n, Vector3(0.9, 2.0, 0.5), Vector3(0, 1.0, 0), Color(0.3, 0.36, 0.38), 0.6, 0.4)
			_box(n, Vector3(0.02, 1.9, 0.02), Vector3(0, 1.0, -0.26), dark)
			for y in [1.55, 0.35]:
				_box(n, Vector3(0.3, 0.12, 0.02), Vector3(-0.22, y, -0.26), dark)
				_box(n, Vector3(0.3, 0.12, 0.02), Vector3(0.22, y, -0.26), dark)
		"crate":
			_box(n, Vector3(0.9, 0.7, 0.7), Vector3(0, 0.35, 0), Color(0.3, 0.32, 0.3), 0.7, 0.3)
			_box(n, Vector3(0.92, 0.1, 0.72), Vector3(0, 0.45, 0), Color(0.75, 0.6, 0.1))
		"barrel":
			_cyl(n, 0.3, 0.95, Vector3(0, 0.475, 0), Color(0.14, 0.26, 0.45), 0.5, 0.5)
			_cyl(n, 0.31, 0.06, Vector3(0, 0.5, 0), Color(0.1, 0.12, 0.16), 0.5, 0.5)
		"bunk_bed":
			for x in [-0.45, 0.45]:
				for z in [-1.0, 1.0]:
					_box(n, Vector3(0.06, 1.9, 0.06), Vector3(x, 0.95, z), steel, 0.5, 0.6)
			for y in [0.45, 1.3]:
				_box(n, Vector3(0.9, 0.1, 2.0), Vector3(0, y, 0), Color(0.3, 0.32, 0.36), 0.8)
				_box(n, Vector3(0.82, 0.08, 1.9), Vector3(0, y + 0.08, 0), Color(0.45, 0.42, 0.38), 0.95)
		"desk":
			_box(n, Vector3(1.5, 0.05, 0.7), Vector3(0, 0.75, 0), Color(0.4, 0.36, 0.3), 0.7)
			for x in [-0.6, 0.6]:
				_box(n, Vector3(0.3, 0.7, 0.6), Vector3(x, 0.37, 0), steel, 0.6, 0.4)
		"chair":
			_box(n, Vector3(0.5, 0.08, 0.5), Vector3(0, 0.5, 0), Color(0.35, 0.3, 0.22), 0.9)
			_box(n, Vector3(0.5, 0.5, 0.08), Vector3(0, 0.8, 0.24), Color(0.35, 0.3, 0.22), 0.9)
			_cyl(n, 0.04, 0.45, Vector3(0, 0.25, 0), dark)
			_cyl(n, 0.25, 0.04, Vector3(0, 0.02, 0), dark)
		"terminal":
			_box(n, Vector3(0.5, 0.42, 0.45), Vector3(0, 0.62, 0), Color(0.62, 0.6, 0.52), 0.7)
			_box(n, Vector3(0.38, 0.3, 0.02), Vector3(0, 0.64, -0.23), Color(0.25, 1.0, 0.5), 0.3, 0.0, 1.4)
			_box(n, Vector3(0.55, 0.04, 0.2), Vector3(0, 0.38, -0.3), Color(0.6, 0.58, 0.5), 0.7)
			_box(n, Vector3(0.5, 0.35, 0.4), Vector3(0, 0.17, 0), Color(0.55, 0.53, 0.46), 0.7)
		"generator":
			_box(n, Vector3(1.8, 1.0, 0.8), Vector3(0, 0.6, 0), Color(0.28, 0.3, 0.32), 0.5, 0.5)
			_box(n, Vector3(1.82, 0.14, 0.82), Vector3(0, 0.95, 0), Color(0.85, 0.65, 0.05))
			_cyl(n, 0.12, 0.7, Vector3(0.6, 1.4, 0), dark, 0.5, 0.6)
			_box(n, Vector3(1.9, 0.12, 0.9), Vector3(0, 0.06, 0), Color(0.18, 0.19, 0.2), 0.6, 0.5)
		"breaker_box":
			_box(n, Vector3(0.8, 1.0, 0.22), Vector3(0, 0.5, 0), Color(0.42, 0.45, 0.47), 0.5, 0.5)
			_box(n, Vector3(0.6, 0.7, 0.02), Vector3(0, 0.55, -0.12), dark)
		"lab_bench":
			_box(n, Vector3(2.0, 0.06, 0.8), Vector3(0, 0.9, 0), Color(0.82, 0.84, 0.85), 0.4)
			_box(n, Vector3(1.9, 0.86, 0.7), Vector3(0, 0.43, 0), Color(0.5, 0.52, 0.54), 0.7)
			_cyl(n, 0.07, 0.2, Vector3(-0.5, 1.03, 0), Color(0.6, 0.85, 0.95, 0.5), 0.1)
			_cyl(n, 0.05, 0.3, Vector3(0.6, 1.08, 0), Color(0.55, 0.52, 0.5), 0.4, 0.6)
		"specimen_tank":
			_cyl(n, 0.5, 2.0, Vector3(0, 1.1, 0), Color(0.3, 0.7, 0.4, 0.45), 0.1, 0.0, 0.5)
			_cyl(n, 0.56, 0.12, Vector3(0, 0.06, 0), steel, 0.5, 0.6)
			_cyl(n, 0.56, 0.12, Vector3(0, 2.14, 0), steel, 0.5, 0.6)
		"diving_suit":
			_cyl(n, 0.26, 0.8, Vector3(0, 1.05, 0), Color(0.62, 0.45, 0.12), 0.4, 0.8)
			_ball(n, 0.24, Vector3(0, 1.6, 0), Color(0.7, 0.5, 0.14), 0.3, 0.9)
			_cyl(n, 0.1, 0.65, Vector3(-0.14, 0.33, 0), Color(0.55, 0.4, 0.1), 0.4, 0.8)
			_cyl(n, 0.1, 0.65, Vector3(0.14, 0.33, 0), Color(0.55, 0.4, 0.1), 0.4, 0.8)
		"gurney":
			_box(n, Vector3(0.7, 0.08, 1.9), Vector3(0, 0.85, 0), Color(0.8, 0.78, 0.72), 0.95)
			for x in [-0.3, 0.3]:
				for z in [-0.8, 0.8]:
					_box(n, Vector3(0.04, 0.8, 0.04), Vector3(x, 0.4, z), steel, 0.5, 0.6)
		"oxygen_tank":
			_cyl(n, 0.13, 1.1, Vector3(0, 0.55, 0), Color(0.85, 0.7, 0.05), 0.5, 0.3)
			_ball(n, 0.13, Vector3(0, 1.1, 0), Color(0.85, 0.7, 0.05), 0.5, 0.3)
			_cyl(n, 0.03, 0.12, Vector3(0, 1.28, 0), steel, 0.4, 0.8)
		"toolbox":
			_box(n, Vector3(0.5, 0.25, 0.22), Vector3(0, 0.125, 0), Color(0.7, 0.1, 0.08), 0.5, 0.3)
			_box(n, Vector3(0.25, 0.04, 0.04), Vector3(0, 0.29, 0), steel, 0.4, 0.7)
		"radio":
			_box(n, Vector3(0.5, 0.22, 0.3), Vector3(0, 0.11, 0), Color(0.16, 0.19, 0.14), 0.6, 0.4)
			for x in [-0.15, 0.0, 0.15]:
				_cyl(n, 0.035, 0.04, Vector3(x, 0.12, -0.16), Color(0.7, 0.7, 0.65), 0.4, 0.7, 0.0, Vector3(90, 0, 0))
		"keycard":
			_box(n, Vector3(0.085, 0.01, 0.054), Vector3(0, 0.005, 0), Color(1.0, 0.55, 0.1), 0.4, 0.0, 0.6)
		"fuse":
			_cyl(n, 0.012, 0.09, Vector3(0, 0.045, 0), Color(0.92, 0.92, 0.9), 0.3)
			for y in [0.01, 0.08]:
				_cyl(n, 0.013, 0.02, Vector3(0, y, 0), Color(0.75, 0.6, 0.3), 0.3, 0.9)
		"power_cell":
			_cyl(n, 0.07, 0.3, Vector3(0, 0.15, 0), Color(0.2, 0.65, 1.0), 0.2, 0.0, 2.2)
			_cyl(n, 0.075, 0.04, Vector3(0, 0.3, 0), dark, 0.5, 0.6)
			_cyl(n, 0.075, 0.04, Vector3(0, 0.0, 0), dark, 0.5, 0.6)
		"battery":
			_cyl(n, 0.035, 0.12, Vector3(0, 0.06, 0), Color(0.15, 0.55, 0.2), 0.4, 0.4, 0.5)
			_cyl(n, 0.015, 0.02, Vector3(0, 0.13, 0), steel, 0.3, 0.9)
		"escape_pod":
			_ball(n, 1.1, Vector3(0, 1.1, 0), Color(0.55, 0.58, 0.62), 0.3, 0.8, 0.0, 0.85)
			_cyl(n, 0.35, 0.08, Vector3(0, 1.05, -1.0), Color(0.4, 0.75, 0.9, 0.7), 0.1, 0.0, 0.6, Vector3(90, 0, 0))
		"pipes":
			for p in [[-0.18, 0.22], [0.18, 0.22], [0.0, 0.52]]:
				_cyl(n, 0.16, 1.8, Vector3(p[0], p[1], 0), Color(0.42, 0.26, 0.18), 0.6, 0.5, 0.0, Vector3(90, 0, 0))
		"valve_wheel":
			var tm := TorusMesh.new()
			tm.inner_radius = 0.2
			tm.outer_radius = 0.28
			_part(n, tm, Vector3(0, 0.5, 0), Color(0.75, 0.1, 0.08), 0.4, 0.4, 0.0, Vector3(90, 0, 0))
			_cyl(n, 0.03, 0.5, Vector3(0, 0.25, 0), steel, 0.4, 0.7)
			_box(n, Vector3(0.5, 0.04, 0.04), Vector3(0, 0.5, 0), Color(0.75, 0.1, 0.08), 0.4, 0.4)
		"cart":
			_box(n, Vector3(0.7, 0.06, 1.1), Vector3(0, 0.4, 0), Color(0.4, 0.28, 0.2), 0.7, 0.4)
			for x in [-0.3, 0.3]:
				for z in [-0.45, 0.45]:
					_cyl(n, 0.1, 0.05, Vector3(x, 0.1, z), dark, 0.6, 0.2, 0.0, Vector3(0, 0, 90))
			_box(n, Vector3(0.6, 0.04, 0.04), Vector3(0, 1.0, 0.55), steel, 0.5, 0.6)
		"submarine":
			var cap := CapsuleMesh.new()
			cap.radius = 0.9
			cap.height = 4.2
			_part(n, cap, Vector3(0, 1.1, 0), Color(0.9, 0.7, 0.05), 0.4, 0.2, 0.0, Vector3(90, 0, 0))
			_box(n, Vector3(0.6, 0.8, 0.9), Vector3(0, 2.1, 0), Color(0.85, 0.65, 0.05), 0.4, 0.2)
		"hollow":
			var pale := Color(0.62, 0.7, 0.72)
			_cyl(n, 0.2, 0.9, Vector3(0, 1.15, 0), pale, 0.6)
			_ball(n, 0.2, Vector3(0, 1.8, -0.03), pale, 0.5, 0.0, 0.0, 1.3)
			_ball(n, 0.05, Vector3(0, 2.3, -0.2), Color(1.0, 0.75, 0.3), 0.3, 0.0, 3.0)
			_cyl(n, 0.07, 1.0, Vector3(-0.32, 0.95, 0), pale, 0.6)
			_cyl(n, 0.07, 1.0, Vector3(0.32, 0.95, 0), pale, 0.6)
			_cyl(n, 0.08, 0.9, Vector3(-0.1, 0.45, 0), pale, 0.6)
			_cyl(n, 0.08, 0.9, Vector3(0.1, 0.45, 0), pale, 0.6)
		"teddy":
			var brown := Color(0.78, 0.5, 0.25)
			_ball(n, 0.42, Vector3(0, 0.45, 0), brown, 0.95)
			_ball(n, 0.3, Vector3(0, 1.05, 0), brown, 0.95)
			_ball(n, 0.1, Vector3(-0.22, 1.32, 0), brown, 0.95)
			_ball(n, 0.1, Vector3(0.22, 1.32, 0), brown, 0.95)
			_ball(n, 0.16, Vector3(0, 1.0, -0.26), Color(0.95, 0.85, 0.65), 0.95)
			_cyl(n, 0.12, 0.5, Vector3(-0.42, 0.55, 0), brown, 0.95, 0.0, 0.0, Vector3(0, 0, 40))
			_cyl(n, 0.12, 0.5, Vector3(0.42, 0.55, 0), brown, 0.95, 0.0, 0.0, Vector3(0, 0, -40))
		"blocks":
			var cols := [Color(0.9, 0.2, 0.2), Color(0.2, 0.5, 0.9), Color(0.95, 0.8, 0.15), Color(0.2, 0.7, 0.35)]
			for i in range(4):
				_box(n, Vector3(0.5, 0.5, 0.5), Vector3(0.02 * i, 0.25 + 0.5 * i, 0.0), cols[i], 0.7)
		"robot_toy":
			_box(n, Vector3(0.4, 0.5, 0.3), Vector3(0, 0.55, 0), Color(0.75, 0.15, 0.15), 0.4, 0.5)
			_box(n, Vector3(0.3, 0.26, 0.26), Vector3(0, 0.98, 0), Color(0.7, 0.72, 0.78), 0.4, 0.6)
			_box(n, Vector3(0.12, 0.45, 0.14), Vector3(-0.12, 0.2, 0), Color(0.6, 0.6, 0.65), 0.4, 0.6)
			_box(n, Vector3(0.12, 0.45, 0.14), Vector3(0.12, 0.2, 0), Color(0.6, 0.6, 0.65), 0.4, 0.6)
			_ball(n, 0.04, Vector3(-0.07, 1.0, -0.14), Color(1.0, 0.9, 0.3), 0.3, 0.0, 2.0)
			_ball(n, 0.04, Vector3(0.07, 1.0, -0.14), Color(1.0, 0.9, 0.3), 0.3, 0.0, 2.0)
		"rocking_horse":
			_box(n, Vector3(0.3, 0.5, 0.9), Vector3(0, 0.75, 0), Color(0.9, 0.45, 0.2), 0.7)
			_box(n, Vector3(0.22, 0.4, 0.3), Vector3(0, 1.15, -0.4), Color(0.9, 0.45, 0.2), 0.7)
			_box(n, Vector3(0.1, 0.1, 1.3), Vector3(-0.2, 0.2, 0), Color(0.45, 0.28, 0.15), 0.8)
			_box(n, Vector3(0.1, 0.1, 1.3), Vector3(0.2, 0.2, 0), Color(0.45, 0.28, 0.15), 0.8)
		"jack_box":
			_box(n, Vector3(0.5, 0.5, 0.5), Vector3(0, 0.25, 0), Color(0.2, 0.45, 0.85), 0.6)
			_ball(n, 0.2, Vector3(0, 0.8, 0), Color(0.98, 0.85, 0.75), 0.7)
			_cyl(n, 0.1, 0.25, Vector3(0, 1.05, 0), Color(0.9, 0.2, 0.3), 0.7)
		"toy_train":
			_box(n, Vector3(1.4, 0.45, 0.55), Vector3(0, 0.4, 0), Color(0.85, 0.2, 0.2), 0.6)
			_cyl(n, 0.22, 0.6, Vector3(-0.4, 0.78, 0), Color(0.2, 0.5, 0.85), 0.6, 0.0, 0.0, Vector3(0, 0, 0))
			_box(n, Vector3(0.5, 0.35, 0.5), Vector3(0.45, 0.82, 0), Color(0.95, 0.8, 0.2), 0.6)
			for x in [-0.45, 0.0, 0.45]:
				_cyl(n, 0.14, 0.08, Vector3(x, 0.14, -0.3), Color(0.15, 0.15, 0.18), 0.5, 0.3, 0.0, Vector3(90, 0, 0))
				_cyl(n, 0.14, 0.08, Vector3(x, 0.14, 0.3), Color(0.15, 0.15, 0.18), 0.5, 0.3, 0.0, Vector3(90, 0, 0))
		"plush_bunny":
			var pink := Color(0.95, 0.6, 0.75)
			_ball(n, 0.3, Vector3(0, 0.3, 0), pink, 0.95)
			_ball(n, 0.2, Vector3(0, 0.72, 0), pink, 0.95)
			_cyl(n, 0.06, 0.4, Vector3(-0.09, 1.05, 0), pink, 0.95)
			_cyl(n, 0.06, 0.4, Vector3(0.09, 1.05, 0), pink, 0.95)
		"toy_drum":
			_cyl(n, 0.3, 0.4, Vector3(0, 0.2, 0), Color(0.85, 0.15, 0.2), 0.5)
			_cyl(n, 0.31, 0.04, Vector3(0, 0.4, 0), Color(0.95, 0.9, 0.8), 0.5)
		"delivery_truck":
			_box(n, Vector3(2.4, 1.0, 1.1), Vector3(0, 0.75, 0), Color(0.95, 0.75, 0.15), 0.5)
			_box(n, Vector3(0.9, 0.8, 1.1), Vector3(1.4, 0.65, 0), Color(0.85, 0.2, 0.25), 0.5)
			for x in [-0.8, 0.0, 1.4]:
				_cyl(n, 0.28, 0.2, Vector3(x, 0.28, -0.55), Color(0.1, 0.1, 0.12), 0.7, 0.0, 0.0, Vector3(90, 0, 0))
				_cyl(n, 0.28, 0.2, Vector3(x, 0.28, 0.55), Color(0.1, 0.1, 0.12), 0.7, 0.0, 0.0, Vector3(90, 0, 0))
		"doll_house":
			_box(n, Vector3(1.0, 0.7, 0.7), Vector3(0, 0.35, 0), Color(0.95, 0.55, 0.6), 0.7)
			_box(n, Vector3(1.1, 0.12, 0.8), Vector3(0, 0.76, 0), Color(0.6, 0.2, 0.25), 0.7)
			_box(n, Vector3(0.22, 0.4, 0.04), Vector3(0, 0.2, -0.36), Color(0.5, 0.3, 0.15), 0.7)
		"xylophone":
			var rc := [Color(0.9, 0.2, 0.2), Color(0.95, 0.6, 0.15), Color(0.95, 0.85, 0.2), Color(0.3, 0.75, 0.35), Color(0.25, 0.5, 0.9)]
			for i in range(5):
				_box(n, Vector3(0.1, 0.04, 0.5 - 0.06 * i), Vector3(-0.2 + 0.1 * i, 0.3, 0), rc[i], 0.6)
			_box(n, Vector3(0.6, 0.05, 0.05), Vector3(0, 0.26, -0.2), Color(0.5, 0.3, 0.15), 0.8)
		"gift_box":
			_box(n, Vector3(0.7, 0.6, 0.7), Vector3(0, 0.3, 0), Color(0.85, 0.2, 0.4), 0.6)
			_box(n, Vector3(0.74, 0.62, 0.12), Vector3(0, 0.3, 0), Color(0.95, 0.85, 0.3), 0.5)
			_box(n, Vector3(0.12, 0.62, 0.74), Vector3(0, 0.3, 0), Color(0.95, 0.85, 0.3), 0.5)
		"toy_shelf":
			_box(n, Vector3(1.6, 1.8, 0.4), Vector3(0, 0.9, 0), Color(0.45, 0.6, 0.9), 0.7)
			for y in [0.45, 0.9, 1.35]:
				_box(n, Vector3(1.5, 0.06, 0.38), Vector3(0, y, -0.02), Color(0.95, 0.9, 0.8), 0.7)
		"mascot_head":
			_ball(n, 0.9, Vector3(0, 1.1, 0), Color(0.98, 0.82, 0.2), 0.6)
			_box(n, Vector3(1.0, 0.18, 0.1), Vector3(0, 0.8, -0.8), Color(0.98, 0.98, 0.95), 0.5)
			_ball(n, 0.12, Vector3(-0.3, 1.4, -0.75), Color(0.1, 0.1, 0.1), 0.3)
			_ball(n, 0.12, Vector3(0.3, 1.4, -0.75), Color(0.1, 0.1, 0.1), 0.3)
		"mr_grin":
			var yel := Color(0.98, 0.82, 0.2)
			_cyl(n, 0.22, 0.9, Vector3(0, 1.15, 0), yel, 0.9)
			_ball(n, 0.24, Vector3(0, 1.85, -0.02), yel, 0.9, 0.0, 0.0, 1.2)
			_box(n, Vector3(0.3, 0.06, 0.06), Vector3(0, 1.8, -0.24), Color(0.98, 0.98, 0.95), 0.5)
			_cyl(n, 0.06, 1.2, Vector3(-0.34, 0.9, 0), yel, 0.9)
			_cyl(n, 0.06, 1.2, Vector3(0.34, 0.9, 0), yel, 0.9)
			_cyl(n, 0.08, 0.9, Vector3(-0.1, 0.45, 0), yel, 0.9)
			_cyl(n, 0.08, 0.9, Vector3(0.1, 0.45, 0), yel, 0.9)
		_:
			_box(n, Vector3(0.6, 0.6, 0.6), Vector3(0, 0.3, 0), Color(0.5, 0.2, 0.5))
	return n
