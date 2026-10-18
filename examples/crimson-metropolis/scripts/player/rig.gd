class_name Rig
extends RefCounted
## The protagonist's skeleton — the same rigged "hacker concept" character used on the
## Chomugiri site hero video (res://assets/protagonist.glb), re-skinned once via
## tools/bake_rig.gd and animated here for ground locomotion instead of a sit/TV/phone beat.
## See site-video/scripts/rig.gd for the sibling this was forked from: same mesh, same bone
## table, same measured PROFILE — only the animation set below is new.

const MESH := "res://assets/protagonist_skin.res"
const SRC := "res://assets/protagonist.glb"
const BOX := AABB(Vector3(-0.9294177889823914, -0.9964808821678162, -0.15006881952285767), Vector3(1.8554794788360596, 1.977126598358154, 0.30423762917518616))

const PROFILE := {
	"hip": 0.50, "knee": 0.27, "ankle": 0.07, "spine": 0.56, "chest": 0.65, "shoulder_y": 0.64, "neck": 0.735, "head": 0.78,
	"shoulder_x": 0.065, "elbow_x": 0.27, "wrist_x": 0.40, "leg_x": 0.045, "z": 0.32,
}


static func spec() -> Array:
	var out: Array = [["hips", ""], ["spine", "hips"], ["chest", "spine"], ["neck", "chest"], ["head", "neck"]]
	for k in ["L", "R"]:
		out.append(["thigh" + k, "hips"])
		out.append(["shin" + k, "thigh" + k])
		out.append(["foot" + k, "shin" + k])
		out.append(["upperArm" + k, "chest"])
		out.append(["foreArm" + k, "upperArm" + k])
		out.append(["hand" + k, "foreArm" + k])
	return out


## name -> position in the model's own space (metres), measured from the profile.
static func positions() -> Dictionary:
	var p: Dictionary = PROFILE
	var z: float = p.z
	var P := {}
	P["hips"] = to_mesh(Vector3(0.5, p.hip, z))
	P["spine"] = to_mesh(Vector3(0.5, p.spine, z))
	P["chest"] = to_mesh(Vector3(0.5, p.chest, z + 0.02))
	P["neck"] = to_mesh(Vector3(0.5, p.neck, z + 0.06))
	P["head"] = to_mesh(Vector3(0.5, p.head, z + 0.1))
	var sy: float = p.shoulder_y
	for s in [-1.0, 1.0]:
		var k := "L" if s < 0.0 else "R"
		P["thigh" + k] = to_mesh(Vector3(0.5 + s * p.leg_x, p.hip, z))
		P["shin" + k] = to_mesh(Vector3(0.5 + s * p.leg_x, p.knee, z))
		P["foot" + k] = to_mesh(Vector3(0.5 + s * p.leg_x, p.ankle, z))
		P["upperArm" + k] = to_mesh(Vector3(0.5 + s * p.shoulder_x, sy, z))
		P["foreArm" + k] = to_mesh(Vector3(0.5 + s * p.elbow_x, sy - 0.01, z))
		P["hand" + k] = to_mesh(Vector3(0.5 + s * p.wrist_x, sy - 0.02, z))
	return P


## Where a bone's segment ends (its first child; leaves get a short stub), for weighting.
static func tip(bone: String, P: Dictionary) -> Vector3:
	var b := BOX
	if bone == "head":
		return P["head"] + Vector3(0, 0.1 * b.size.y, 0)
	if bone.begins_with("foot"):
		return P[bone] + Vector3(0, 0, 0.08 * b.size.y)
	if bone.begins_with("hand"):
		var sd := -1.0 if bone.ends_with("L") else 1.0
		return P[bone] + Vector3(sd * 0.1 * b.size.x, 0, 0)
	for e in spec():
		if e[1] == bone:
			return P[e[0]]
	return P[bone]


## [name, parent, position] in spec() order.
static func joints() -> Array:
	var P := positions()
	var out: Array = []
	for e in spec():
		out.append([e[0], e[1], P[e[0]]])
	return out


static func to_mesh(u: Vector3) -> Vector3:
	return BOX.position + u * BOX.size


static func index_of(bone: String) -> int:
	var j := joints()
	for i in range(j.size()):
		if j[i][0] == bone:
			return i
	return -1


## The skeleton, with the bind pose worked out (the bones have no rest rotation, so it is a translation each).
static func build_skeleton() -> Skeleton3D:
	var j := joints()
	var sk := Skeleton3D.new()
	sk.name = "Skeleton"
	for e in j:
		sk.add_bone(e[0])
	for i in range(j.size()):
		var parent: String = j[i][1]
		var rest: Vector3 = j[i][2]
		if parent != "":
			var pi := index_of(parent)
			rest = (j[i][2] as Vector3) - (j[pi][2] as Vector3)
			sk.set_bone_parent(i, pi)
		sk.set_bone_rest(i, Transform3D(Basis.IDENTITY, rest))
	sk.reset_bone_poses()
	return sk


static func build_skin() -> Skin:
	var j := joints()
	var skin := Skin.new()
	for i in range(j.size()):
		skin.add_bind(i, Transform3D(Basis.IDENTITY, -(j[i][2] as Vector3)))
		skin.set_bind_name(i, j[i][0])
	return skin


# ── animation ────────────────────────────────────────────────────────────────

static func rx(a: float) -> Quaternion:
	return Quaternion(Vector3.RIGHT, a)


static func ry(a: float) -> Quaternion:
	return Quaternion(Vector3.UP, a)


static func rz(a: float) -> Quaternion:
	return Quaternion(Vector3.BACK, a)


## An arm: `down` lowers it from the T-pose (radians), `fwd` swings it forward (+) / back (-) when
## it hangs, `reach` turns it out in front of the body, `lift` raises that reaching arm. `s` is +1
## for the right arm (+x), -1 for the left.
static func arm(s: float, down: float, fwd: float, reach := 0.0, lift := 0.0) -> Quaternion:
	return rx(-fwd - lift) * ry(-s * reach * PI * 0.5) * rz(-s * down)


static func _cycle(len: float, steps: int, fn: Callable, loop := true) -> Animation:
	var an := Animation.new()
	an.length = len
	an.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	var tracks := {}
	for k in range(steps + 1):
		var t01 := float(k) / steps
		var pose: Dictionary = fn.call(t01 if k < steps or not loop else 0.0)
		for key in pose:
			var is_hips: bool = key == "hips"
			var is_scale := (key as String).begins_with("scale_")
			var bone: String = key if not is_scale else (key as String).trim_prefix("scale_")
			var id := "%s/%s" % [key, "p" if is_hips else ("s" if is_scale else "r")]
			if not tracks.has(id):
				var tr := an.add_track(Animation.TYPE_POSITION_3D if is_hips else (Animation.TYPE_SCALE_3D if is_scale else Animation.TYPE_ROTATION_3D))
				an.track_set_path(tr, NodePath("Skeleton:%s" % bone))
				tracks[id] = tr
			var v = pose[key]
			if is_hips:
				v = (joints()[0][2] as Vector3) + (v as Vector3) * BOX.size.y
			an.track_insert_key(tracks[id], len * float(k) / steps, v)
	return an


## Standing, breathing — the hold pose between locomotion states.
static func _idle() -> Animation:
	return _cycle(2.4, 10, func(t: float) -> Dictionary:
		var ph := t * TAU
		var br := sin(ph)
		var p := {}
		p["hips"] = Vector3(0, br * 0.01, 0)
		p["spine"] = rx(br * 0.02)
		p["chest"] = rx(br * 0.015)
		p["head"] = ry(sin(ph * 0.4) * 0.08)
		p["upperArmL"] = arm(-1, 1.2, 0.0)
		p["upperArmR"] = arm(1, 1.2, 0.0)
		p["foreArmL"] = rx(-0.15)
		p["foreArmR"] = rx(-0.15)
		return p)


## One stride cycle; `pace` scales stride length/arm swing (1.0 = walk, ~1.8 = run/sprint look).
static func _locomotion_pose(t: float, pace: float) -> Dictionary:
	var ph := t * TAU
	var s := sin(ph)
	var c := cos(ph)
	var p := {}
	p["hips"] = Vector3(sin(ph) * 0.015 * pace, -absf(c) * 0.02, 0.0)
	p["spine"] = rx(0.08 + pace * 0.03) * ry(-s * 0.08)
	p["chest"] = rx(0.06 + pace * 0.02) * ry(-s * 0.06)
	p["neck"] = rx(-0.05)
	p["head"] = rx(0.03)
	p["thighL"] = rx(-s * 0.55 * pace)
	p["thighR"] = rx(s * 0.55 * pace)
	p["shinL"] = rx(maxf(0.0, c) * 1.0 * pace + 0.08)
	p["shinR"] = rx(maxf(0.0, -c) * 1.0 * pace + 0.08)
	p["footL"] = rx(s * 0.3 * pace)
	p["footR"] = rx(-s * 0.3 * pace)
	p["upperArmL"] = arm(-1, 1.2, -s * 0.45 * pace)
	p["upperArmR"] = arm(1, 1.2, s * 0.45 * pace)
	p["foreArmL"] = rx(-0.25)
	p["foreArmR"] = rx(-0.25)
	return p


static func _walk() -> Animation:
	return _cycle(0.85, 16, func(t: float) -> Dictionary: return _locomotion_pose(t, 1.0))


## Faster cadence and a longer, lower stride than walk — also stands in for sprint, played at a
## higher AnimationPlayer.speed_scale rather than as a separate animation (same cycle, less data).
static func _run() -> Animation:
	return _cycle(0.55, 16, func(t: float) -> Dictionary: return _locomotion_pose(t, 1.8))


## A short hop: knees tuck on the way up, legs extend for landing. Not looped — the player script
## plays it once and returns to idle/locomotion when grounded again.
static func _jump_pose(t: float) -> Dictionary:
	var up: float = sin(t * PI) # 0 → 1 → 0 across the clip
	var p := {}
	p["hips"] = Vector3(0, up * 0.12, 0)
	p["thighL"] = rx(-0.9 * up)
	p["thighR"] = rx(-0.9 * up)
	p["shinL"] = rx(1.3 * up)
	p["shinR"] = rx(1.3 * up)
	p["upperArmL"] = arm(-1, 0.4 * (1.0 - up), -0.6 * up)
	p["upperArmR"] = arm(1, 0.4 * (1.0 - up), -0.6 * up)
	return p


static func _jump() -> Animation:
	return _cycle(0.5, 10, Callable(Rig, "_jump_pose"), false)


## Reaching to push a door open — one hand out, weight forward.
static func _push_door_pose(t: float) -> Dictionary:
	var e: float = clampf(t * 1.6, 0.0, 1.0)
	var p := {}
	p["hips"] = Vector3(0, 0, 0.04 * e)
	p["spine"] = rx(0.06 * e)
	p["upperArmR"] = arm(1, 1.2 * (1.0 - e), 0.0, e * 0.7, e * 0.55)
	p["foreArmR"] = rx(-0.1 - e * 0.15)
	return p


static func _push_door() -> Animation:
	return _cycle(0.6, 10, Callable(Rig, "_push_door_pose"), false)


## Rifle held at the shoulder, both hands on it, elbows in — the hold pose for Aim_Rifle; Shoot
## reuses this with a one-frame recoil kick the weapon script applies itself (camera + muzzle FX),
## not a separate baked clip.
static func _aim_rifle() -> Animation:
	return _cycle(0.6, 1, func(t: float) -> Dictionary:
		var p := {}
		p["spine"] = rx(0.05)
		p["chest"] = ry(-0.12)
		p["upperArmR"] = arm(1, 0.25, -0.1, 0.65, 0.78)
		p["foreArmR"] = rx(-1.65)
		p["upperArmL"] = arm(-1, 0.3, -0.05, 0.55, 0.7)
		p["foreArmL"] = rx(-1.5)
		p["head"] = rx(0.05) * ry(-0.08)
		return p)


## Lying flat — the sleep/save-point pose, held while the bed interaction advances the clock.
static func _sleep() -> Animation:
	return _cycle(2.0, 1, func(t: float) -> Dictionary:
		var p := {}
		p["hips"] = Vector3(0, -0.78, 0)
		p["spine"] = rx(-1.55)
		p["chest"] = rx(0.05)
		p["neck"] = rx(0.1)
		p["thighL"] = rx(-0.1)
		p["thighR"] = rx(-0.1)
		p["upperArmL"] = arm(-1, 1.45, 0.0)
		p["upperArmR"] = arm(1, 1.45, 0.0)
		return p)


static func library() -> AnimationLibrary:
	var lib := AnimationLibrary.new()
	lib.add_animation("idle", _idle())
	lib.add_animation("walk", _walk())
	lib.add_animation("run", _run())
	lib.add_animation("jump", _jump())
	lib.add_animation("push_door", _push_door())
	lib.add_animation("aim_rifle", _aim_rifle())
	lib.add_animation("sleep", _sleep())
	return lib


## The rigged character: a holder whose origin is the middle of its base, `size` metres tall.
static func make_character(size: float) -> Node3D:
	if not ResourceLoader.exists(MESH):
		return null
	var mesh := load(MESH) as ArrayMesh
	var holder := Node3D.new()
	holder.name = "character"
	var inner := Node3D.new()
	var k := size / BOX.size.y
	inner.scale = Vector3.ONE * k
	inner.position = Vector3(-(BOX.position.x + BOX.size.x * 0.5), -BOX.position.y, -(BOX.position.z + BOX.size.z * 0.5)) * k
	holder.add_child(inner)
	var sk := build_skeleton()
	inner.add_child(sk)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = mesh
	mi.skin = build_skin()
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var player := AnimationPlayer.new()
	player.name = "Anim"
	inner.add_child(player)
	player.add_animation_library("", library())
	holder.set_meta("anim", player)
	holder.set_meta("skeleton", sk)
	return holder
