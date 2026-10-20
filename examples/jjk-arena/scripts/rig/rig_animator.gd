class_name RigAnimator
extends Node3D
## Drives a Skeleton3D from direction targets instead of per-bone euler angles, so one pose table fits every character whatever
## its bone roll: a pose says "the left upper arm points forward-down", the animator turns that into local rotations, parents first.
## Model space: +X = the character's left, +Y up, +Z forward (the way the imported model faces).
## A pose is {bone: Vector3 direction | [direction, twist_degrees], "hips_pos": Vector3 offset}. Bones missing from a pose follow their parent.

const ALIASES := {"head": ["head", "head_2"]}
const BONES := ["hips", "spine", "chest", "neck", "head", "shoulderL", "upperarmL", "forearmL", "handL", "shoulderR", "upperarmR", "forearmR", "handR",
	"thighL", "shinL", "footL", "toeL", "thighR", "shinR", "footR", "toeR"]

var skeleton: Skeleton3D
var model: Node3D
var idx := {}                 ## logical name -> bone index
var _rest_g: Array[Transform3D] = []
var _rest_dir: Array[Vector3] = []
var _order: Array[int] = []
var _fists := {}              ## "L"/"R" -> BoneAttachment3D
var fists_on := false

func load_model(path: String) -> bool:
	var scene = load(path)
	if scene == null:
		return false
	model = scene.instantiate()
	add_child(model)
	model.rotation.y = PI          # the glb faces +Z; Fighter faces -Z
	model.position.y = -ArenaBuilder._aabb(model).position.y   # the glb is centred on the body; stand its feet on y = 0
	var found := model.find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		return false
	skeleton = found[0]
	for n in BONES:
		for alias in ALIASES.get(n, [n]):
			var i := skeleton.find_bone(alias)
			if i >= 0:
				idx[n] = i
				break
	_cache_rest()
	return idx.has("hips") and idx.has("upperarmL")

func _cache_rest() -> void:
	var n := skeleton.get_bone_count()
	_rest_g.resize(n)
	_rest_dir.resize(n)
	var depth := {}
	for i in n:
		_rest_g[i] = skeleton.get_bone_global_rest(i)
		_rest_dir[i] = _rest_g[i].basis.y.normalized()
		var d := 0
		var p := skeleton.get_bone_parent(i)
		while p >= 0:
			d += 1
			p = skeleton.get_bone_parent(p)
		depth[i] = d
	_order.clear()
	for i in n:
		_order.append(i)
	_order.sort_custom(func(a: int, b: int) -> bool: return depth[a] < depth[b])

func rest_origin(bone: String) -> Vector3:
	return _rest_g[idx[bone]].origin

func apply(pose: Dictionary) -> void:
	var by_index := {}
	for k in pose:
		if idx.has(k):
			by_index[idx[k]] = pose[k]
	var new_b: Array[Basis] = []
	new_b.resize(_rest_g.size())
	for i in _order:
		var p := skeleton.get_bone_parent(i)
		var parent_b: Basis = new_b[p] if p >= 0 else Basis.IDENTITY
		var rest_local: Basis = (_rest_g[p].basis.inverse() if p >= 0 else Basis.IDENTITY) * _rest_g[i].basis
		var nb: Basis
		if by_index.has(i):
			var spec = by_index[i]
			var dir: Vector3 = spec if spec is Vector3 else spec[0]
			dir = dir.normalized()
			nb = Basis(Quaternion(_rest_dir[i], dir)) * _rest_g[i].basis
			if not (spec is Vector3) and absf(spec[1]) > 0.01:
				nb = Basis(Quaternion(dir, deg_to_rad(spec[1]))) * nb
		else:
			nb = parent_b * rest_local
		new_b[i] = nb
		skeleton.set_bone_pose_rotation(i, (parent_b.inverse() * nb).get_rotation_quaternion())
	if pose.has("hips_pos") and idx.has("hips"):
		var h: int = idx["hips"]
		skeleton.set_bone_pose_position(h, skeleton.get_bone_rest(h).origin + pose["hips_pos"])
	if fists_on:
		for s in ["L", "R"]:
			skeleton.set_bone_pose_scale(idx["hand" + s], Vector3.ONE * 0.001)

## Closed-fist meshes (models/fist_L.glb, fist_R.glb) riding on the forearm bones; the hand and finger bones collapse into the wrist.
func set_fists(on: bool) -> void:
	fists_on = on
	for s in ["L", "R"]:
		if on and not _fists.has(s):
			var res = load("res://assets/characters/fist_%s.glb" % s)
			if res == null:
				continue
			var fa: int = idx["forearm" + s]
			var head: Vector3 = _rest_g[idx["hand" + s]].origin
			var fdir: Vector3 = (head - _rest_g[fa].origin).normalized()
			var up := (Vector3.UP - fdir * Vector3.UP.dot(fdir)).normalized()
			var basis := Basis(fdir, up, fdir.cross(up)).scaled(Vector3.ONE * 0.8)
			var world := Transform3D(basis, head - fdir * 0.015)
			var att := BoneAttachment3D.new()
			att.bone_name = skeleton.get_bone_name(fa)
			skeleton.add_child(att)
			var mesh: Node3D = res.instantiate()
			att.add_child(mesh)
			mesh.transform = _rest_g[fa].affine_inverse() * world
			_fists[s] = att
		if _fists.has(s):
			_fists[s].visible = on
	if not on:
		for s in ["L", "R"]:
			skeleton.set_bone_pose_scale(idx["hand" + s], Vector3.ONE)
