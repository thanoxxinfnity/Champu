class_name ModelKit
extends RefCounted
## Loads the real models (Sketchfab CC-BY, prepared by tools/prep_sf.py: one joined mesh, upright, longest side along -Z, origin at the bottom centre — or at the
## centre for hand-held things) and fits them to the size the game needs. Everything the world shows comes through here, so a missing file is one clear check
## (`exists`) and the tests can assert that nothing is a stand-in.

static var _packs := {}


static func exists(path: String) -> bool:
	return ResourceLoader.exists(path)


static func scene(path: String) -> PackedScene:
	if not _packs.has(path):
		_packs[path] = load(path) if ResourceLoader.exists(path) else null
	return _packs[path]


static func instance(path: String) -> Node3D:
	var p := scene(path)
	return p.instantiate() as Node3D if p != null else null


## The bounds of a model's meshes in the model's own space.
static func bounds(n: Node3D) -> AABB:
	var out := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var cur: Node = m
		while cur != null and cur != n.get_parent():
			if cur is Node3D:
				xf = (cur as Node3D).transform * xf
			cur = cur.get_parent()
		var bb := xf * m.mesh.get_aabb()
		out = bb if first else out.merge(bb)
		first = false
	return out


## A model scaled so its longest side is `length` metres; `origin` says where the node's own origin sits: "bottom" (feet), "center".
static func fitted(path: String, length: float, origin := "bottom") -> Node3D:
	var n := instance(path)
	if n == null:
		return null
	var bb := bounds(n)
	var k := length / maxf(maxf(bb.size.x, bb.size.y), maxf(bb.size.z, 0.0001))
	var holder := Node3D.new()
	holder.add_child(n)
	n.scale = Vector3.ONE * k
	var c := bb.position + bb.size * 0.5
	n.position = Vector3(-c.x, -c.y if origin == "center" else -bb.position.y, -c.z) * k
	holder.set_meta("size", bb.size * k)
	return holder


## A train car: X squeezed to `width`, Z to `length`, Y by the average of the two so it keeps its shape, and the roof (the top of the mesh) put at `roof_y`.
static func car(path: String, width: float, length: float, roof_y: float) -> Node3D:
	var n := instance(path)
	if n == null:
		return null
	var bb := bounds(n)
	var sx := width / maxf(bb.size.x, 0.0001)
	var sz := length / maxf(bb.size.z, 0.0001)
	var sy := (sx + sz) * 0.5
	var holder := Node3D.new()
	holder.add_child(n)
	n.scale = Vector3(sx, sy, sz)
	var c := bb.position + bb.size * 0.5
	n.position = Vector3(-c.x * sx, roof_y - (bb.position.y + bb.size.y) * sy, -c.z * sz)
	return holder


## The first mesh of a model with the transform that fits it (for MultiMesh patterns such as lamp posts).
static func first_mesh(path: String) -> Mesh:
	var n := instance(path)
	if n == null:
		return null
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := (mi as MeshInstance3D).mesh
		n.free()
		return m
	n.free()
	return null
