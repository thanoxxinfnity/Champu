class_name ClothSway
extends Node
## Spring-bone cloth for a dressed character: the `sway_*` bones (cloth hems, belt tails, sleeve ends) lag behind the body, swing with the
## motion and flutter in wind, so a hakama or a sash moves instead of being welded to the leg.
##
## Godot 4.3 has no built-in spring bones, so this is a small verlet solver. The key rule: the target each frame is read from the
## *animated* pose (parent pose × bone rest), never from the pose this script wrote last frame — otherwise the chain feeds back on itself
## and never settles. Cost is a few dozen bones per character; turn it off on Low (`GraphicsSettings.use_cloth_sway`).

@export var skeleton: Skeleton3D
@export var stiffness := 0.25        ## how hard cloth is pulled back to the animated pose (0 = free, 1 = rigid)
@export var damping := 0.80          ## velocity kept per frame
@export var gravity := Vector3(0, -6.0, 0)
@export var wind := Vector3.ZERO     ## world-space wind; set it from the arena or a move's shockwave
@export var gust := 0.0              ## extra turbulence on top of `wind`
@export var enabled := true

class Chain:
	var bones: PackedInt32Array = []
	var parent := -1
	var pos: Array[Vector3] = []      ## simulated tip position of each bone, world space
	var prev: Array[Vector3] = []
	var length: Array[float] = []     ## rest length of each bone
	var started := false

var _chains: Array[Chain] = []
var _t := 0.0

func _ready() -> void:
	if skeleton != null:
		build()

## Find every `sway_<piece><i>_<n>` chain in the skeleton and prepare a solver state for it.
func build() -> void:
	_chains.clear()
	var groups := {}
	for i in skeleton.get_bone_count():
		var n := skeleton.get_bone_name(i)
		if not n.begins_with("sway_"):
			continue
		var cut := n.rfind("_")
		var key := n.substr(0, cut) if cut > 0 else n
		if not groups.has(key):
			groups[key] = []
		groups[key].append(i)
	for key in groups:
		var ids: Array = groups[key]
		ids.sort_custom(func(a: int, b: int) -> bool: return skeleton.get_bone_name(a).naturalnocasecmp_to(skeleton.get_bone_name(b)) < 0)
		var c := Chain.new()
		c.parent = skeleton.get_bone_parent(ids[0])
		for id in ids:
			c.bones.append(id)
			c.length.append(maxf(0.01, skeleton.get_bone_rest(id).origin.length()))
			c.pos.append(Vector3.ZERO)
			c.prev.append(Vector3.ZERO)
		_chains.append(c)

func chain_count() -> int:
	return _chains.size()

func _physics_process(delta: float) -> void:
	if not enabled or skeleton == null or delta <= 0.0:
		return
	_t += delta
	var force := wind
	if gust > 0.0:
		force += Vector3(sin(_t * 3.1) + sin(_t * 7.7) * 0.4, sin(_t * 2.3 + 1.0) * 0.5, cos(_t * 2.7) + cos(_t * 6.1) * 0.4) * gust
	for c in _chains:
		_solve(c, delta, force)

func _solve(c: Chain, delta: float, force: Vector3) -> void:
	var skin := skeleton.global_transform
	# start from the parent's animated pose; this is unaffected by what we wrote into the sway bones
	var cur := skin * (skeleton.get_bone_global_pose(c.parent) if c.parent >= 0 else Transform3D.IDENTITY)
	for j in c.bones.size():
		var bone := c.bones[j]
		var rest := skeleton.get_bone_rest(bone)
		var animated := cur * rest                       # where the bone's tip wants to be without any sway
		var head := cur.origin
		var target := animated.origin
		if not c.started:
			c.pos[j] = target
			c.prev[j] = target
		# verlet step
		var p := c.pos[j]
		var v := (p - c.prev[j]) * damping
		c.prev[j] = p
		p += v + (gravity + force) * delta * delta
		p = p.lerp(target, clampf(stiffness, 0.0, 1.0))
		# hold the bone's length so cloth stretches no further than it should
		var dir := p - head
		if dir.length() < 1e-5:
			dir = (target - head)
		if dir.length() < 1e-5:
			dir = Vector3.DOWN * c.length[j]
		p = head + dir.normalized() * c.length[j]
		c.pos[j] = p
		# rotate the bone so its rest direction points at the simulated tip, then walk the chain on with that rotation
		var want_local := (cur.affine_inverse().basis * (p - head)).normalized()
		var rest_dir := rest.origin.normalized()
		if rest_dir.length_squared() < 1e-9:
			rest_dir = Vector3.UP
		var swing := Quaternion(rest_dir, want_local)
		skeleton.set_bone_pose_rotation(bone, swing * rest.basis.get_rotation_quaternion())
		cur = cur * Transform3D(Basis(swing) * rest.basis, rest.origin)
	c.started = true

## Snap every chain back onto the animated pose (use after a teleport or a round reset).
func reset() -> void:
	for c in _chains:
		c.started = false
		for j in c.bones.size():
			skeleton.set_bone_pose_rotation(c.bones[j], skeleton.get_bone_rest(c.bones[j]).basis.get_rotation_quaternion())
