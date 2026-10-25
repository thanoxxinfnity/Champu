class_name Assets
extends RefCounted
## Props and stand-ins. Every model has a stand-in built from toon primitives, so the game and its tests run without any GLB and a failed
## generation shows up as a plain shape instead of a crash. Real models live in assets/world (prepared by tools/prep_glb.py).

const DIR := "res://assets/world/"

static var _scenes := {}


## "ph/barrel" -> assets/ph/barrel.glb (Poly Haven, CC0); anything else lives in assets/world.
static func path_of(model: String) -> String:
	return "res://assets/%s.glb" % model if model.begins_with("ph/") else "%s%s.glb" % [DIR, model]


static func exists(model: String) -> bool:
	return ResourceLoader.exists(path_of(model))


static func bounds(root: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var p: Node = mi
		while p != null and p != root:
			xf = (p as Node3D).transform * xf
			p = p.get_parent()
		var b := xf * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


## A stood-up copy of `model`: `size` metres tall (or that long on its widest horizontal side when `by_length`), feet on y = 0,
## centred on its footprint, with a toon material + outline. Returns a holder; `stand_in` is set in its meta when the model is missing.
static func prop(model: String, size: float, by_length := false, outline := 0.02, grime := 0.25) -> Node3D:
	var holder := Node3D.new()
	holder.name = model.get_file()
	if not _scenes.has(model):
		_scenes[model] = load(path_of(model)) if exists(model) else null
	var pack: PackedScene = _scenes[model]
	if pack == null:
		holder.add_child(_stand_in(model, size, by_length))
		holder.set_meta("stand_in", true)
		holder.set_meta("scaled_size", _stand_in_dims(model, size, by_length))
		return holder
	var root := pack.instantiate() as Node3D
	var box := bounds(root)
	var k := size / maxf(maxf(box.size.x, box.size.z) if by_length else box.size.y, 0.001)
	var inner := Node3D.new()
	inner.add_child(root)
	inner.scale = Vector3.ONE * k
	var c := box.position + box.size * 0.5
	inner.position = Vector3(-c.x, -box.position.y, -c.z) * k
	holder.add_child(inner)
	Toon.apply(root, outline, Color.WHITE, grime)
	holder.set_meta("scaled_size", box.size * k)
	return holder


static func size_of(holder: Node3D) -> Vector3:
	return holder.get_meta("scaled_size", Vector3.ONE)


static func _box(size: Vector3, pos: Vector3, color: Color, outline := 0.015) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = Toon.flat(color, outline, 0.2)
	return mi


static func _cyl(r: float, h: float, pos: Vector3, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = 12
	mi.mesh = cm
	mi.position = pos
	mi.material_override = Toon.flat(color, 0.015, 0.2)
	return mi


const DIMS := {
	"generator": Vector3(0.9, 0.8, 0.6), "fuel_can": Vector3(0.3, 0.45, 0.2), "fuse_box": Vector3(0.5, 0.7, 0.2), "medkit": Vector3(0.35, 0.22, 0.25),
	"crowbar": Vector3(0.05, 0.05, 0.7), "flare": Vector3(0.05, 0.05, 0.3), "radio": Vector3(0.5, 0.3, 0.3), "car_wreck": Vector3(1.9, 1.4, 4.4),
	"streetlamp": Vector3(0.25, 4.5, 0.25), "house_small": Vector3(8.0, 6.0, 7.0), "market_stall": Vector3(2.6, 2.6, 2.0), "crate": Vector3(0.9, 0.9, 0.9),
	"clinic_bed": Vector3(1.0, 0.6, 2.0), "lighthouse": Vector3(6.0, 28.0, 6.0), "church_bell": Vector3(3.0, 3.5, 2.0), "boat": Vector3(2.4, 1.6, 6.0),
	"workbench": Vector3(1.8, 1.0, 0.8), "barricade": Vector3(5.0, 2.4, 1.2),
}


static func _stand_in_dims(model: String, size: float, by_length: bool) -> Vector3:
	var dims: Vector3 = DIMS.get(model, Vector3(1, 1, 1))
	var f := size / (maxf(dims.x, dims.z) if by_length else dims.y)
	return dims * f


static func _stand_in(model: String, size: float, by_length: bool) -> Node3D:
	var n := Node3D.new()
	var d := _stand_in_dims(model, size, by_length)
	var color := Color(0.42, 0.38, 0.4)
	match model:
		"car_wreck":
			color = Color(0.45, 0.2, 0.22)
			n.add_child(_box(Vector3(d.x, d.y * 0.5, d.z), Vector3(0, d.y * 0.3, 0), color))
			n.add_child(_box(Vector3(d.x * 0.85, d.y * 0.4, d.z * 0.5), Vector3(0, d.y * 0.7, 0), color.darkened(0.2)))
		"generator":
			n.add_child(_box(d, Vector3(0, d.y * 0.5, 0), Color(0.85, 0.7, 0.2)))
		"fuel_can":
			n.add_child(_box(d, Vector3(0, d.y * 0.5, 0), Color(0.8, 0.15, 0.15)))
		"streetlamp":
			n.add_child(_cyl(0.07, d.y, Vector3(0, d.y * 0.5, 0), Color(0.2, 0.2, 0.24)))
			n.add_child(_box(Vector3(0.4, 0.22, 0.4), Vector3(0, d.y, 0), Color(1.0, 0.9, 0.6), 0.0))
		"lighthouse":
			n.add_child(_cyl(d.x * 0.5, d.y, Vector3(0, d.y * 0.5, 0), Color(0.92, 0.9, 0.9)))
		"church_bell":
			n.add_child(_cyl(d.x * 0.35, d.y * 0.7, Vector3(0, d.y * 0.45, 0), Color(0.72, 0.52, 0.25)))
		_:
			n.add_child(_box(d, Vector3(0, d.y * 0.5, 0), color))
	return n


## A toon-shaded girl made of primitives — used only when the real model is missing.
static func stand_in_person(h: float, tint: Color) -> Node3D:
	var n := Node3D.new()
	var skin := Color(0.98, 0.82, 0.74)
	n.add_child(_cyl(0.11 * h / 1.6, 0.8 * h / 1.6, Vector3(-0.09, 0.4 * h / 1.6, 0), tint.darkened(0.2)))
	n.add_child(_cyl(0.11 * h / 1.6, 0.8 * h / 1.6, Vector3(0.09, 0.4 * h / 1.6, 0), tint.darkened(0.2)))
	n.add_child(_box(Vector3(0.34, 0.5, 0.2) * h / 1.6, Vector3(0, 1.05 * h / 1.6, 0), tint))
	n.add_child(_box(Vector3(0.1, 0.5, 0.1) * h / 1.6, Vector3(-0.23, 1.05 * h / 1.6, 0), skin))
	n.add_child(_box(Vector3(0.1, 0.5, 0.1) * h / 1.6, Vector3(0.23, 1.05 * h / 1.6, 0), skin))
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.12 * h / 1.6
	sm.height = 0.26 * h / 1.6
	head.mesh = sm
	head.position.y = 1.42 * h / 1.6
	head.material_override = Toon.flat(skin, 0.012)
	n.add_child(head)
	n.add_child(_box(Vector3(0.28, 0.3, 0.26) * h / 1.6, Vector3(0, 1.42 * h / 1.6, 0.03), tint.lightened(0.3)))
	return n
