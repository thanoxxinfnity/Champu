class_name ClothSway
extends Node
## Spring-bone cloth for a dressed character: the `sway_*` bones (cloth hems, belt tails, sleeve ends) lag behind the body, swing with the
## motion and flutter in wind, so a hakama or a sash moves instead of being welded to the leg.
##
## Godot 4.3 has no built-in spring bones, so this is a small verlet solver. The key rule: the target each frame is read from the
## *animated* pose (parent pose × bone rest), never from the pose this script wrote last frame — otherwise the chain feeds back on itself
## and never settles. Cost is a hundred-odd bones per character, cheap enough to keep on every mode (`GraphicsSettings.use_cloth_sway`).

@export var skeleton: Skeleton3D
@export var stiffness := 0.25        ## how hard cloth is pulled back to the animated pose (0 = free, 1 = rigid)
@export var damping := 0.80          ## velocity kept per frame
@export var gravity := Vector3(0, -6.0, 0)
@export var wind := Vector3.ZERO     ## world-space wind; set it from the arena or a move's shockwave
@export var gust := 0.0              ## extra turbulence on top of `wind`
@export var enabled := true

## Stiffness per chain, matched against the chain name (case-insensitive); hair and collars hold their shape, hems swing.
@export var chain_stiffness := {"hair": 0.55, "hood": 0.7, "sleeve": 0.3, "legHem": 0.4, "topsHem": 0.3, "belt": 0.18, "bow": 0.2}

class Chain:
	var bones: PackedInt32Array = []
	var parent := -1
	var tip: Array[Vector3] = []      ## each bone's tip in its own rest frame (the next bone's head, or along +Y for the last)
	var pos: Array[Vector3] = []      ## simulated tip position of each bone, world space
	var prev: Array[Vector3] = []
	var stiffness := 0.25
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
		c.stiffness = stiffness
		for k in chain_stiffness:
			if String(key).to_lower().contains(String(k).to_lower()):
				c.stiffness = chain_stiffness[k]
		for j in ids.size():
			c.bones.append(ids[j])
			var t: Vector3
			if j + 1 < ids.size():
				t = skeleton.get_bone_rest(ids[j + 1]).origin
			else:
				t = Vector3(0, maxf(0.03, skeleton.get_bone_rest(ids[j]).origin.length()), 0)
			c.tip.append(t)
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
	# start from the parent's animated pose; this is unaffected by what we wrote into the sway bones
	var cur := skeleton.global_transform * (skeleton.get_bone_global_pose(c.parent) if c.parent >= 0 else Transform3D.IDENTITY)
	for j in c.bones.size():
		var bone := c.bones[j]
		var rest := skeleton.get_bone_rest(bone)
		var animated := cur * rest                       # the bone without any sway
		var head := animated.origin
		var target := animated * c.tip[j]                # where its tip wants to be
		var length := (target - head).length()
		if not c.started:
			c.pos[j] = target
			c.prev[j] = target
		# verlet step, pulled back toward the animated tip
		var p := c.pos[j]
		var v := (p - c.prev[j]) * damping
		c.prev[j] = p
		p += v + (gravity + force) * delta * delta
		p = p.lerp(target, clampf(c.stiffness, 0.0, 1.0))
		# keep the bone's length so cloth stretches no further than it should
		var dir := p - head
		if dir.length() < 1e-5:
			dir = target - head
		p = head + dir.normalized() * length
		c.pos[j] = p
		# swing the bone (in its own rest frame) so its tip points at the simulated point, then walk on down the chain
		var frame := animated.basis.orthonormalized()
		var want_local := (frame.inverse() * (p - head)).normalized()
		var swing := Quaternion(c.tip[j].normalized(), want_local) if want_local.length_squared() > 0.5 else Quaternion.IDENTITY
		var rot := rest.basis.get_rotation_quaternion() * swing
		skeleton.set_bone_pose_rotation(bone, rot)
		cur = cur * Transform3D(Basis(rot).scaled(rest.basis.get_scale()), rest.origin)
	c.started = true

## Snap every chain back onto the animated pose (use after a teleport or a round reset).
func reset() -> void:
	for c in _chains:
		c.started = false
		for j in c.bones.size():
			skeleton.set_bone_pose_rotation(c.bones[j], skeleton.get_bone_rest(c.bones[j]).basis.get_rotation_quaternion())
