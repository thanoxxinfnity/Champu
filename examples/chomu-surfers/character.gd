extends Node3D
## Drives a skinned character's bones from its parent's velocity.
## Attach to the imported .glb node; the parent should be a CharacterBody3D.

@export var swing: float = 0.9        ## Radians a limb swings at full speed.
@export var steps_per_metre: float = 0.55

var _skeleton: Skeleton3D
var _body: CharacterBody3D
var _phase: float = 0.0
## Bone indices, resolved once. -1 means this rig does not have that bone.
var _bones := {}


func _ready() -> void:
	_skeleton = _find_skeleton(self)
	if _skeleton == null:
		# Not a rigged model. Nothing to drive, and nothing to complain about.
		set_physics_process(false)
		return

	_body = get_parent() as CharacterBody3D
	for name in ["ArmL", "ArmR", "LegL", "LegR", "Chest", "Head"]:
		_bones[name] = _skeleton.find_bone(name)


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null


func _rotate_bone(bone_name: String, axis: Vector3, angle: float) -> void:
	var index: int = _bones.get(bone_name, -1)
	if index < 0:
		return
	# Rest is the bind pose; posing relative to it keeps the limb attached.
	_skeleton.set_bone_pose_rotation(index, Quaternion(axis, angle))


func _physics_process(delta: float) -> void:
	var speed := 0.0
	if _body != null:
		speed = Vector2(_body.velocity.x, _body.velocity.z).length()

	if speed > 0.05:
		_phase += delta * speed * steps_per_metre * TAU
	else:
		# Settle back to the rest pose instead of freezing mid-stride.
		_phase = move_toward(_phase, round(_phase / TAU) * TAU, delta * 6.0)

	var reach := swing * clampf(speed / 5.0, 0.0, 1.0)
	var stride := sin(_phase) * reach

	# Arms and legs swing opposite each other; left and right are out of phase.
	_rotate_bone("LegL", Vector3.RIGHT, stride)
	_rotate_bone("LegR", Vector3.RIGHT, -stride)
	_rotate_bone("ArmL", Vector3.RIGHT, -stride)
	_rotate_bone("ArmR", Vector3.RIGHT, stride)
	# A small counter-rotation in the chest stops it reading as a puppet.
	_rotate_bone("Chest", Vector3.UP, stride * 0.12)
