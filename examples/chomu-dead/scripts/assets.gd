class_name Assets
extends RefCounted
## Loads the TRELLIS models (res://assets/dead/*.glb, made by tools/prep_dead.py)
## and stands them up: scaled to a real-world height, feet on y = 0, centred on
## the footprint, front turned to -Z. A model that is missing falls back to a
## plain primitive stand-in, so the game always runs and a failed generation
## shows up as a grey box rather than a crash.

const DIR := "res://assets/dead/"
const PUPPET := preload("res://shaders/puppet.gdshader")

static var _scenes := {}
static var _mats := {}


static func exists(model: String) -> bool:
	return ResourceLoader.exists("%s%s.glb" % [DIR, model])


static func _scene(model: String) -> PackedScene:
	if not _scenes.has(model):
		_scenes[model] = load("%s%s.glb" % [DIR, model]) if exists(model) else null
	return _scenes[model]


## The bounds of everything under `root`, in `root`'s own space.
static func bounds(root: Node3D) -> AABB:
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


## A stood-up copy of `model`: `height` metres tall (or, for `by_length`, that
## long in its largest horizontal direction). Returns a holder whose origin is
## the middle of the model's feet. `puppet` swaps the materials for the walk
## shader, and the result keeps `puppet_mats` in its meta for the animator.
static func make(model: String, size: float, by_length := false, puppet := false, tint := Color.WHITE) -> Node3D:
	var info: Dictionary = Data.MODELS.get(model, {})
	var holder := Node3D.new()
	holder.name = model
	var pack := _scene(model)
	if pack == null:
		holder.add_child(_stand_in(model, size, by_length))
		holder.set_meta("stand_in", true)
		return holder

	var root := pack.instantiate() as Node3D
	var box := bounds(root)
	var scale_by := size / maxf(box.size.y, 0.001)
	if by_length:
		scale_by = size / maxf(maxf(box.size.x, box.size.z), 0.001)
	var inner := Node3D.new()
	inner.add_child(root)
	inner.scale = Vector3.ONE * scale_by
	var centre := box.position + box.size * 0.5
	inner.position = Vector3(-centre.x, -box.position.y, -centre.z) * scale_by
	var pivot := Node3D.new()
	pivot.add_child(inner)
	pivot.rotation_degrees.y = float(info.get("face", 0.0))
	holder.add_child(pivot)

	var mats: Array = []
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		if puppet and mi.mesh != null:
			var m := _puppet_material(mi, tint, info)
			mi.material_override = m
			mats.append(m)
		else:
			_tint(mi, tint)
	holder.set_meta("puppet_mats", mats)
	holder.set_meta("scaled_size", box.size * scale_by)
	return holder


## The footprint (metres) of a made model, for collision boxes.
static func size_of(holder: Node3D) -> Vector3:
	if holder.has_meta("scaled_size"):
		return holder.get_meta("scaled_size")
	return Vector3.ONE


static func _tint(mi: MeshInstance3D, tint: Color) -> void:
	if tint == Color.WHITE:
		return
	for s in range(mi.mesh.get_surface_count()):
		var src := mi.mesh.surface_get_material(s)
		if src is BaseMaterial3D:
			var m := (src as BaseMaterial3D).duplicate() as BaseMaterial3D
			m.albedo_color = m.albedo_color * tint
			mi.set_surface_override_material(s, m)


## One walk-shader material per character, so every ghoul can be mid-stride
## at a different moment and flash on its own when shot.
static func _puppet_material(mi: MeshInstance3D, tint: Color, info: Dictionary) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = PUPPET
	var box := mi.get_aabb()
	m.set_shader_parameter("bmin", box.position)
	m.set_shader_parameter("bsize", box.size)
	m.set_shader_parameter("tint", Vector3(tint.r, tint.g, tint.b))
	m.set_shader_parameter("shoulder", float(info.get("shoulder", 0.12)))
	m.set_shader_parameter("hip", float(info.get("hip", 0.06)))
	m.set_shader_parameter("tpose", float(info.get("tpose", 1.0)))
	var src := mi.mesh.surface_get_material(0)
	if src is BaseMaterial3D:
		var tex := (src as BaseMaterial3D).albedo_texture
		if tex != null:
			m.set_shader_parameter("albedo_tex", tex)
			m.set_shader_parameter("use_tex", true)
	return m


static func _mat(color: Color, rough := 0.85, metal := 0.0) -> StandardMaterial3D:
	var key := "%s/%s/%s" % [color.to_html(), rough, metal]
	if not _mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.roughness = rough
		m.metallic = metal
		_mats[key] = m
	return _mats[key]


static func _box(size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = _mat(color)
	return mi


## A plain stand-in for a model that is not there. People are a stack of boxes,
## guns a slab with a grip, everything else a box the size of the real thing.
static func _stand_in(model: String, size: float, by_length: bool) -> Node3D:
	var n := Node3D.new()
	if model.begins_with("zombie") or model.begins_with("boss") or model == "player":
		var skin := Color(0.55, 0.62, 0.5) if model != "player" else Color(0.75, 0.6, 0.5)
		var cloth := Color(0.25, 0.3, 0.22) if model != "player" else Color(0.25, 0.3, 0.2)
		var h := size
		n.add_child(_box(Vector3(0.28 * h / 1.8, 0.8 * h / 1.8, 0.2 * h / 1.8), Vector3(0, 0.55 * h, 0), cloth))
		n.add_child(_box(Vector3(0.22 * h / 1.8, 0.24 * h / 1.8, 0.22 * h / 1.8), Vector3(0, 0.88 * h, 0), skin))
		n.add_child(_box(Vector3(0.12 * h / 1.8, 0.5 * h / 1.8, 0.14 * h / 1.8), Vector3(-0.09 * h / 1.8, 0.2 * h, 0), cloth))
		n.add_child(_box(Vector3(0.12 * h / 1.8, 0.5 * h / 1.8, 0.14 * h / 1.8), Vector3(0.09 * h / 1.8, 0.2 * h, 0), cloth))
		n.add_child(_box(Vector3(0.1 * h / 1.8, 0.1 * h / 1.8, 0.5 * h / 1.8), Vector3(-0.19 * h / 1.8, 0.6 * h, -0.2 * h / 1.8), skin))
		n.add_child(_box(Vector3(0.1 * h / 1.8, 0.1 * h / 1.8, 0.5 * h / 1.8), Vector3(0.19 * h / 1.8, 0.6 * h, -0.2 * h / 1.8), skin))
	elif model.begins_with("gun"):
		var l := size
		n.add_child(_box(Vector3(0.05, 0.06, l), Vector3(0, 0.06, 0), Color(0.12, 0.12, 0.13)))
		n.add_child(_box(Vector3(0.04, 0.12, 0.05), Vector3(0, 0.0, l * 0.2), Color(0.1, 0.1, 0.1)))
	else:
		var d := {"medkit": Vector3(0.35, 0.2, 0.25), "ammo_box": Vector3(0.35, 0.22, 0.2), "barrel": Vector3(0.6, 0.9, 0.6),
			"crate": Vector3(0.9, 0.9, 0.9), "car_wreck": Vector3(1.9, 1.4, 4.4), "police_car": Vector3(1.9, 1.5, 4.6),
			"ambulance": Vector3(2.2, 2.4, 5.5), "van": Vector3(2.0, 2.2, 5.0), "house": Vector3(8, 6, 7),
			"clinic": Vector3(14, 8, 10), "church": Vector3(10, 16, 18), "gas_station": Vector3(12, 5, 9)}
		var dims: Vector3 = d.get(model, Vector3(1, 1, 1))
		var f := size / (maxf(dims.x, dims.z) if by_length else dims.y)
		var color := Color(0.35, 0.33, 0.3)
		if model.begins_with("car") or model == "police_car" or model == "van" or model == "ambulance":
			color = Color(0.3, 0.2, 0.18)
		n.add_child(_box(dims * f, Vector3(0, dims.y * f * 0.5, 0), color))
	return n
