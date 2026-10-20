class_name ModelCatalog
extends RefCounted
## Real (Sketchfab) building and tree models, flattened into mesh parts so a whole chunk can draw each part with one MultiMesh.
## Each entry is normalised: base on y = 0, centred on x/z, longest horizontal side = 1. `size` is the normalised bounding box.

const CITY := "res://assets/environment/city/"
const TOWERS := ["singapore_tower", "highrise_office", "montgomery_tower", "rand_tower", "asian_tower"]   # residential_tower dropped: 400 mesh parts = 400 draw calls
const MIDRISE := ["soviet_apartment", "chicago_real", "chicago", "washington_st", "asian_tower", "residential9"]
const TREES := ["oak_a", "oak_b", "tree_real"]

static var _cache := {}

static func entry(name: String) -> Dictionary:
	if _cache.has(name):
		return _cache[name]
	var res = load(CITY + name + ".glb")
	if res == null:
		_cache[name] = {}
		return {}
	var root: Node3D = res.instantiate()
	var parts := []
	_collect(root, Transform3D.IDENTITY, parts, true)
	var box := AABB()
	var first := true
	for p in parts:
		var b: AABB = p[1] * (p[0] as Mesh).get_aabb()
		box = b if first else box.merge(b)
		first = false
	var w := maxf(box.size.x, box.size.z)
	var n := Transform3D(Basis.from_scale(Vector3.ONE / w), Vector3.ZERO) * Transform3D(Basis.IDENTITY, Vector3(-box.get_center().x, -box.position.y, -box.get_center().z))
	for p in parts:
		p[1] = n * p[1]
	root.free()
	var e := {"parts": parts, "size": box.size / w, "scene": res, "norm": n}
	_cache[name] = e
	return e

static func _collect(node: Node, xf: Transform3D, out: Array, is_root: bool) -> void:
	var here := xf
	if not is_root and node is Node3D:
		here = xf * (node as Node3D).transform
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		out.append([(node as MeshInstance3D).mesh, here])
	for c in node.get_children():
		_collect(c, here, out, false)

## A full node copy of a model at normalised scale (used when one building has to come down on its own).
static func instance(name: String) -> Node3D:
	var e := entry(name)
	if e.is_empty():
		return null
	var holder := Node3D.new()
	var inst: Node3D = (e["scene"] as PackedScene).instantiate()
	var n: Transform3D = e["norm"]
	inst.transform = n
	holder.add_child(inst)
	return holder
