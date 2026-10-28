class_name RigAnimator
extends Node3D
## Drives a Skeleton3D from direction targets instead of per-bone euler angles, so one pose table fits every character whatever
## its bone roll: a pose says "the left upper arm points forward-down", the animator turns that into local rotations, parents first.
## Model space: +X = the character's left, +Y up, +Z forward (the way the imported model faces).
## A pose is {bone: Vector3 direction | [direction, twist_degrees], "hips_pos": Vector3 offset}. Bones missing from a pose follow their parent.
## Hair, coat and tail bones ("sway_*", "Tail*") are not posed; `set_sway` gives each a small direction offset on top of its parent.

const BONES := {
	"hips": ["Hips"], "spine": ["Spine"], "chest": ["Chest"], "neck": ["Neck"], "head": ["Head"],
	"shoulderL": ["Shoulder.L", "Shoulder_L"], "upperarmL": ["UpperArm.L", "UpperArm_L"], "forearmL": ["LowerArm.L", "LowerArm_L"], "handL": ["Hand.L", "Hand_L"],
	"shoulderR": ["Shoulder.R", "Shoulder_R"], "upperarmR": ["UpperArm.R", "UpperArm_R"], "forearmR": ["LowerArm.R", "LowerArm_R"], "handR": ["Hand.R", "Hand_R"],
	"thighL": ["UpperLeg.L", "UpperLeg_L"], "shinL": ["LowerLeg.L", "LowerLeg_L"], "footL": ["Foot.L", "Foot_L"], "toeL": ["Toes.L", "Toes_L"],
	"thighR": ["UpperLeg.R", "UpperLeg_R"], "shinR": ["LowerLeg.R", "LowerLeg_R"], "footR": ["Foot.R", "Foot_R"], "toeR": ["Toes.R", "Toes_R"],
}

var skeleton: Skeleton3D
var model: Node3D
var idx := {}                 ## logical name -> bone index
var sway_bones: Array[int] = []
var _rest_g: Array[Transform3D] = []
var _rest_dir: Array[Vector3] = []
var _order: Array[int] = []
var _sway := {}               ## bone index -> Vector3 model-space direction offset


func load_model(scene: PackedScene) -> bool:
	model = scene.instantiate()
	add_child(model)
	var found := model.find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		return false
	skeleton = found[0]
	for n in BONES:
		for alias in BONES[n]:
			var i := skeleton.find_bone(alias)
			if i >= 0:
				idx[n] = i
				break
	for i in skeleton.get_bone_count():
		var nm := skeleton.get_bone_name(i)
		if nm.begins_with("sway_") or nm.begins_with("Tail"):
			sway_bones.append(i)
	_cache_rest()
	return idx.has("hips") and idx.has("upperarmL") and idx.has("thighL")


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


func set_sway(offsets: Dictionary) -> void:
	_sway = offsets


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
			if _sway.has(i):
				var cur := nb.y.normalized()
				var want := (cur + (_sway[i] as Vector3)).normalized()
				nb = Basis(Quaternion(cur, want)) * nb
		new_b[i] = nb
		skeleton.set_bone_pose_rotation(i, (parent_b.inverse() * nb).get_rotation_quaternion())
	if pose.has("hips_pos") and idx.has("hips"):
		var h: int = idx["hips"]
		skeleton.set_bone_pose_position(h, skeleton.get_bone_rest(h).origin + pose["hips_pos"] * leg_scale())


var _leg_scale := -1.0


## Pose offsets are metres on a hero whose leg is 0.8 m long; a skeleton in other units (or a shorter hero) scales them by its own leg.
func leg_scale() -> float:
	if _leg_scale < 0.0:
		_leg_scale = 1.0
		if idx.has("thighL") and idx.has("shinL") and idx.has("footL"):
			var a := _rest_g[idx["thighL"]].origin
			var b := _rest_g[idx["shinL"]].origin
			var c := _rest_g[idx["footL"]].origin
			var leg := a.distance_to(b) + b.distance_to(c)
			if leg > 0.0001:
				_leg_scale = leg / 0.8
	return _leg_scale
