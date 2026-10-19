class_name ClothSway
extends Node
## Moves the sway_* bones of a dressed character (cloth hems, belt tails) with a light verlet spring, so cloth lags behind the body, swings
## and flutters in wind. Each chain is the bones named `sway_<piece><n>_1`, `_2`, ... below one parent bone.
##
## Cost: a few dozen bones, one small loop per physics frame; turn it off on Low (GraphicsSettings.use_cloth_sway).

@export var skeleton: Skeleton3D
@export var stiffness := 0.18        ## 0 = loose cloth, 1 = rigid
@export var damping := 0.86
@export var gravity := Vector3(0, -9.8, 0)
@export var wind := Vector3.ZERO     ## world-space wind velocity; change it any time
@export var gust := 0.0              ## extra random flutter strength
@export var enabled := true

class Chain:
	var bones: Array[int] = []
	var rest_len: Array[float] = []
	var pos: Array[Vector3] = []
	var prev: Array[Vector3] = []
	var parent: int = -1

var _chains: Array[Chain] = []
var _t := 0.0

func _ready() -> void:
	if skeleton != null:
		build()

func build() -> void:
	_chains.clear()
	var groups := {}
	for i in skeleton.get_bone_count():
		var n := skeleton.get_bone_name(i)
		if not n.begins_with("sway_"):
			continue
		var key := n.substr(0, n.rfind("_"))     # sway_gi0_1 -> sway_gi0
		if not groups.has(key):
			groups[key] = []
		groups[key].append(i)
	for key in groups:
		var ids: Array = groups[key]
		ids.sort_custom(func(a: int, b: int) -> bool: return skeleton.get_bone_name(a) < skeleton.get_bone_name(b))
		var c := Chain.new()
		c.parent = skeleton.get_bone_parent(ids[0])
		for id in ids:
			c.bones.append(id)
			var w := _world_pos(id)
			c.pos.append(w)
			c.prev.append(w)
		for j in ids.size():
			var head := _world_pos(ids[j])
			var tail := head + _bone_dir(ids[j]) * 0.05
			c.rest_len.append(maxf(0.02, head.distance_to(tail)))
		_chains.append(c)

func chain_count() -> int:
	return _chains.size()

func _world_pos(bone: int) -> Vector3:
	return skeleton.global_transform * skeleton.get_bone_global_pose(bone).origin

func _bone_dir(bone: int) -> Vector3:
	return (skeleton.global_transform.basis * skeleton.get_bone_global_pose(bone).basis * Vector3.UP).normalized()

func _physics_process(delta: float) -> void:
	if not enabled or skeleton == null:
		return
	_t += delta
	var f := wind + Vector3(sin(_t * 3.1), sin(_t * 2.3 + 1.0), cos(_t * 2.7)) * gust
	for c in _chains:
		_step(c, delta, f)

func _step(c: Chain, delta: float, force: Vector3) -> void:
	var anchor := _world_pos(c.parent) if c.parent >= 0 else Vector3.ZERO
	for j in c.bones.size():
		var rest := _world_pos(c.bones[j])            # where the animation wants the bone
		var p := c.pos[j]
		var v := (p - c.prev[j]) * damping
		c.prev[j] = p
		p += v + (gravity + force) * delta * delta
		# spring back towards the animated pose
		p = p.lerp(rest, stiffness)
		# keep the segment length to the previous point of the chain
		var from := anchor if j == 0 else c.pos[j - 1]
		var d := p - from
		var want := c.rest_len[j]
		if d.length() > 0.0001:
			p = from + d.normalized() * want
		c.pos[j] = p
		anchor = p
		_apply(c.bones[j], p, from)

## Rotate the bone so it points from `from` to `p`, in the parent's space, keeping the animated position.
func _apply(bone: int, p: Vector3, from: Vector3) -> void:
	var dir_world := (p - from)
	if dir_world.length() < 0.0001:
		return
	var local_dir := (skeleton.global_transform.basis.inverse() * dir_world).normalized()
	var parent := skeleton.get_bone_parent(bone)
	var parent_basis := skeleton.get_bone_global_pose(parent).basis if parent >= 0 else Basis.IDENTITY
	var rest_dir := (skeleton.get_bone_global_rest(bone).basis * Vector3.UP).normalized()
	var target := (parent_basis.inverse() * local_dir).normalized()
	var base_dir := (parent_basis.inverse() * rest_dir).normalized()
	var q := Quaternion(base_dir, target)
	skeleton.set_bone_pose_rotation(bone, q * skeleton.get_bone_rest(bone).basis.get_rotation_quaternion())
