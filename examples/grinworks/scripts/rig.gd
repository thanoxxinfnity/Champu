class_name Rig
extends RefCounted
## A real skeleton for Mr. Grin. The generated model is one rigid mesh in a T-pose; tools/bake_rig.gd
## skins it to the bones below (every vertex gets up to four bones, weighted by how near it is to each
## limb) and saves the result, and this builds the Skeleton3D, the Skin and the animations at run time.
##
## Joints are given in the mesh's own box, 0..1 on each axis: x across (arms), y up, z forward. The
## bones carry no rest rotation, so every animation key is a plain rotation about a world axis.

const MESH := "res://assets/s9/mr_grin_skin.res"
const SRC := "res://assets/s9/mr_grin.glb"
const BOX := AABB(Vector3(-0.500212, -0.344991, -0.08835), Vector3(0.99954, 0.685342, 0.179051))

const PROFILE := {
	"hip": 0.50, "knee": 0.27, "ankle": 0.07, "spine": 0.56, "chest": 0.65, "shoulder_y": 0.64, "neck": 0.735, "head": 0.78,
	"shoulder_x": 0.065, "elbow_x": 0.27, "wrist_x": 0.40, "leg_x": 0.045, "z": 0.32, "toe_z": 0.85,
}


## Rigger's bone contract (rigger/GAME_BRIEF.md): 49 bones, parents before children. Game code finds bones by these names.
const FINGERS := ["thumb", "index", "middle", "ring", "pinky"]
const FINGER_Z := [0.45, 0.22, 0.0, -0.22, -0.4]   # across the hand, in hand lengths
const FINGER_SEG := [0.45, 0.3, 0.25]               # share of a finger's length per bone


static func spec() -> Array:
	var out: Array = [["hips", ""], ["spine", "hips"], ["chest", "spine"], ["neck", "chest"], ["head", "neck"]]
	for k in ["L", "R"]:
		out.append(["thigh" + k, "hips"])
		out.append(["shin" + k, "thigh" + k])
		out.append(["foot" + k, "shin" + k])
		out.append(["toe" + k, "foot" + k])
		out.append(["upperArm" + k, "chest"])
		out.append(["foreArm" + k, "upperArm" + k])
		out.append(["hand" + k, "foreArm" + k])
		for f in FINGERS:
			for i in range(1, 4):
				out.append(["%s%d%s" % [f, i, k], ("hand" + k) if i == 1 else "%s%d%s" % [f, i - 1, k]])
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
		P["toe" + k] = to_mesh(Vector3(0.5 + s * p.leg_x, 0.03, p.toe_z))
		P["upperArm" + k] = to_mesh(Vector3(0.5 + s * p.shoulder_x, sy, z))
		P["foreArm" + k] = to_mesh(Vector3(0.5 + s * p.elbow_x, sy - 0.01, z))
		var wr := to_mesh(Vector3(0.5 + s * p.wrist_x, sy - 0.02, z))
		P["hand" + k] = wr
		var hl: float = (0.5 - float(p.wrist_x)) * BOX.size.x / 0.85   # wrist to the tip of the longest finger
		for fi in range(5):
			var flen := hl * (0.6 if fi == 0 else 0.8)
			var fz: float = wr.z + float(FINGER_Z[fi]) * hl * 0.5
			var j0 := Vector3(wr.x + s * hl * 0.25, wr.y, fz)
			var j1: Vector3 = j0 + Vector3(s * float(FINGER_SEG[0]) * flen, 0, 0)
			var j2: Vector3 = j1 + Vector3(s * float(FINGER_SEG[1]) * flen, 0, 0)
			P["%s1%s" % [FINGERS[fi], k]] = j0
			P["%s2%s" % [FINGERS[fi], k]] = j1
			P["%s3%s" % [FINGERS[fi], k]] = j2
	return P


## Where a bone's segment ends (its first child; leaves get a short stub), for weighting and the Rigger export.
static func tip(bone: String, P: Dictionary) -> Vector3:
	var b := BOX
	var sd := -1.0 if bone.ends_with("L") else 1.0
	if bone == "head":
		return P["head"] + Vector3(0, 0.1 * b.size.y, 0)
	if bone.begins_with("toe"):
		return P[bone] + Vector3(0, 0, 0.05 * b.size.y)
	if bone.begins_with("hand"):
		return P[bone] + Vector3(sd * (P["index1" + bone.right(1)] - P[bone]).length() * 0.9, 0, 0)
	if bone.ends_with("3L") or bone.ends_with("3R"):
		var f1: String = bone.left(bone.length() - 2) + "1" + bone.right(1)
		return P[bone] + Vector3(sd * (P[bone] - P[f1]).length() / 3.0, 0, 0)
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


## An arm: `down` lowers it from the T-pose (radians), `fwd` swings it forward (+) / back (-) when it hangs,
## `reach` turns it out in front of the body, `lift` raises that reaching arm. `s` is +1 for the right arm (+x), -1 for the left.
static func arm(s: float, down: float, fwd: float, reach := 0.0, lift := 0.0) -> Quaternion:
	return rx(-fwd - lift) * ry(-s * reach * PI * 0.5) * rz(-s * down)


## The short names the clips below are written in -> Rigger's bone names.
const SHORT := {
	"pelvis": "hips", "thigh_l": "thighL", "thigh_r": "thighR", "shin_l": "shinL", "shin_r": "shinR", "foot_l": "footL", "foot_r": "footR",
	"toe_l": "toeL", "toe_r": "toeR", "arm_l": "upperArmL", "arm_r": "upperArmR", "fore_l": "foreArmL", "fore_r": "foreArmR", "hand_l": "handL", "hand_r": "handR",
}


static func bone_name(key: String) -> String:
	return SHORT.get(key, key)


## Curl one hand: `c` radians at the middle knuckle (negative opens the hand back). Every finger joint gets its own key,
## so the fingers move in the clip like any other bone. Left fingers curl about +z, right ones about -z.
static func _fingers(p: Dictionary, c_l: float, c_r: float, t: float) -> void:
	for side in [-1.0, 1.0]:
		var c := c_l if side < 0.0 else c_r
		var k := "L" if side < 0.0 else "R"
		var sg := 1.0 if side < 0.0 else -1.0
		for fi in range(5):
			var f: String = FINGERS[fi]
			var amt := c * (0.55 if fi == 0 else 0.9 + 0.08 * fi)
			amt += 0.06 * sin(t * TAU * 2.0 + float(fi) * 1.3 + side)   # no two fingers sit still together
			var jf := [0.8, 1.0, 0.7]
			for ji in range(3):
				var q := rz(sg * amt * jf[ji])
				if fi == 0 and ji == 0:
					q = ry(-side * amt * 0.5) * q
				p["%s%d%s" % [f, ji + 1, k]] = q


## Every pose is a Dictionary: bone -> Quaternion, plus "hips" (a position offset), "scale_<bone>" (Vector3)
## and "fing_l" / "fing_r" (finger curl, expanded to the 15 finger bones of that hand).
static func _cycle(len: float, steps: int, fn: Callable) -> Animation:
	var an := Animation.new()
	an.length = len
	an.loop_mode = Animation.LOOP_LINEAR
	var tracks := {}
	for k in range(steps + 1):
		var t01 := float(k) / steps
		var pose: Dictionary = fn.call(t01 if k < steps else 0.0)
		if pose.has("fing_l") or pose.has("fing_r"):
			_fingers(pose, float(pose.get("fing_l", 0.0)), float(pose.get("fing_r", 0.0)), t01 if k < steps else 0.0)
			pose.erase("fing_l")
			pose.erase("fing_r")
		for key in pose:
			var is_hips: bool = key == "hips"
			var is_scale := (key as String).begins_with("scale_")
			var bone: String = "hips" if is_hips else bone_name((key as String).trim_prefix("scale_") if is_scale else key)
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


static func _base(t: float) -> Dictionary:
	return {}


## Walk-style cycle. `a` swing amplitude, `lean` forward torso, `arms` arm swing, `down` how far the arms hang.
static func _gait(len: float, a: float, knee: float, lean: float, arms: float, down: float, bob: float, sway: float, head_roll := 0.0, reach := 0.0, lift := 0.0) -> Animation:
	return _cycle(len, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var s := sin(ph)
		var c := cos(ph)
		var p := {}
		p["hips"] = Vector3(sin(ph) * sway * 0.5, -absf(c) * bob, 0.0)
		p["pelvis"] = ry(s * 0.12 * (a / 0.5)) * rz(s * sway * 0.6)
		p["spine"] = rx(lean * 0.5) * ry(-s * 0.10 * (a / 0.5))
		p["chest"] = rx(lean * 0.5) * ry(-s * 0.08)
		p["neck"] = rx(-lean * 0.3) * rz(head_roll)
		p["head"] = rx(lean * 0.15 + 0.05 * sin(ph * 2.0)) * ry(sin(ph * 0.5) * 0.25)
		# Legs: the leg swinging forward bends its knee.
		p["thigh_l"] = rx(-s * a)
		p["thigh_r"] = rx(s * a)
		p["shin_l"] = rx(maxf(0.0, c) * knee + 0.05)
		p["shin_r"] = rx(maxf(0.0, -c) * knee + 0.05)
		p["foot_l"] = rx(s * a * 0.4 - maxf(0.0, c) * knee * 0.3)
		p["foot_r"] = rx(-s * a * 0.4 - maxf(0.0, -c) * knee * 0.3)
		p["arm_l"] = arm(-1, down, s * arms, reach, lift)
		p["arm_r"] = arm(1, down, -s * arms, reach, lift)
		p["fore_l"] = rx(-0.25 - maxf(0.0, -s) * 0.3 * arms)
		p["fore_r"] = rx(-0.25 - maxf(0.0, s) * 0.3 * arms)
		p["toe_l"] = rx(-0.55 * maxf(0.0, -s) * (a / 0.5))
		p["toe_r"] = rx(-0.55 * maxf(0.0, s) * (a / 0.5))
		var fist := clampf(0.25 + (1.0 if a > 0.6 or arms == 0.0 else 0.0) * 0.5 + 0.3 * reach, 0.0, 1.1)
		p["fing_l"] = fist + 0.15 * s
		p["fing_r"] = fist - 0.15 * s
		return p)


static func _idle() -> Animation:
	return _cycle(4.0, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var p := {}
		var br := sin(ph)
		p["hips"] = Vector3(0, br * 0.004, 0)
		p["spine"] = rx(0.08 + br * 0.03)
		p["chest"] = rx(0.1 + br * 0.04)
		p["neck"] = rx(0.12) * rz(0.15 * sin(ph))
		p["head"] = rx(0.1) * ry(sin(ph) * 0.35 + 0.15 * sin(ph * 3.0)) * rz(0.12 * sin(ph * 2.0))
		p["arm_l"] = arm(-1, 1.25, 0.05 * br)
		p["arm_r"] = arm(1, 1.25, -0.05 * br)
		p["fore_l"] = rx(-0.3)
		p["fore_r"] = rx(-0.3)
		p["thigh_l"] = rx(0.02)
		p["thigh_r"] = rx(-0.02)
		p["fing_l"] = 0.45 + 0.1 * br
		p["fing_r"] = 0.4 - 0.1 * br
		return p)


## Flinching from the light: arms up over the face, the head thrashing, the body thrown back.
static func _recoil() -> Animation:
	return _cycle(0.5, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var p := {}
		p["hips"] = Vector3(0, 0, -0.03)
		p["spine"] = rx(-0.3)
		p["chest"] = rx(-0.25) * ry(sin(ph * 2.0) * 0.1)
		p["neck"] = rx(-0.25)
		p["head"] = rx(-0.3) * ry(sin(ph * 2.0) * 0.55) * rz(sin(ph * 2.0 + 1.0) * 0.2)
		p["arm_l"] = arm(-1, 0.9, 0.0, 0.85, 0.55)
		p["arm_r"] = arm(1, 0.9, 0.0, 0.85, 0.55)
		p["fore_l"] = rx(-1.6)
		p["fore_r"] = rx(-1.6)
		p["thigh_l"] = rx(0.25)
		p["thigh_r"] = rx(-0.1)
		p["shin_l"] = rx(0.3)
		p["shin_r"] = rx(0.15)
		p["fing_l"] = -0.25 + 0.2 * sin(ph * 2.0)
		p["fing_r"] = -0.25 - 0.2 * sin(ph * 2.0)
		return p)


## It has you: arms flung wide, head thrown back, the whole body shuddering.
static func _scream() -> Animation:
	return _cycle(0.6, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var sh := sin(ph * 4.0) * 0.04
		var p := {}
		p["hips"] = Vector3(sin(ph * 4.0) * 0.004, 0.0, 0.0)
		p["spine"] = rx(-0.35 + sh)
		p["chest"] = rx(-0.3 + sh)
		p["neck"] = rx(-0.35)
		p["head"] = rx(-0.55 + sin(ph * 3.0) * 0.1) * ry(sin(ph * 2.0) * 0.15)
		p["arm_l"] = arm(-1, -0.35 + sh, 0.0)
		p["arm_r"] = arm(1, -0.35 - sh, 0.0)
		p["fore_l"] = rx(-0.2) * rz(0.3)
		p["fore_r"] = rx(-0.2) * rz(-0.3)
		p["thigh_l"] = rx(-0.15)
		p["thigh_r"] = rx(0.15)
		p["scale_fore_l"] = Vector3(1.25, 1, 1)
		p["scale_fore_r"] = Vector3(1.25, 1, 1)
		p["fing_l"] = -0.3 + sh * 6.0
		p["fing_r"] = -0.3 - sh * 6.0
		return p)


## Its arms stretch out in front, longer than they should be, to take hold.
static func _lunge() -> Animation:
	return _cycle(0.5, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var s := sin(ph)
		var p := {}
		p["hips"] = Vector3(0, -absf(cos(ph)) * 0.02, 0)
		p["spine"] = rx(0.5)
		p["chest"] = rx(0.35)
		p["neck"] = rx(-0.4)
		p["head"] = rx(0.1) * rz(sin(ph * 2.0) * 0.12)
		p["arm_l"] = arm(-1, 0.3, 0.0, 1.0, 0.95 + 0.08 * s)
		p["arm_r"] = arm(1, 0.3, 0.0, 1.0, 0.95 - 0.08 * s)
		p["fore_l"] = rx(0.0)
		p["fore_r"] = rx(0.0)
		p["scale_arm_l"] = Vector3(1.4, 1, 1)
		p["scale_arm_r"] = Vector3(1.4, 1, 1)
		p["scale_fore_l"] = Vector3(1.5, 1, 1)
		p["scale_fore_r"] = Vector3(1.5, 1, 1)
		p["thigh_l"] = rx(-s * 0.85)
		p["thigh_r"] = rx(s * 0.85)
		p["shin_l"] = rx(maxf(0.0, cos(ph)) * 1.2 + 0.1)
		p["shin_r"] = rx(maxf(0.0, -cos(ph)) * 1.2 + 0.1)
		p["fing_l"] = 0.6 + 0.5 * s
		p["fing_r"] = 0.6 - 0.5 * s
		return p)


## Waiting around a corner: the head leans out, slowly.
static func _peek() -> Animation:
	return _cycle(3.0, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var p := {}
		p["spine"] = rx(0.15) * rz(-0.2)
		p["chest"] = rx(0.15) * rz(-0.15)
		p["neck"] = rz(0.5)
		p["head"] = rx(0.15) * ry(0.4 * sin(ph)) * rz(0.35 + 0.1 * sin(ph * 3.0))
		p["arm_l"] = arm(-1, 1.3, 0.1, 0.0)
		p["arm_r"] = arm(1, 1.3, -0.1, 0.0)
		p["fore_l"] = rx(-0.5)
		p["fore_r"] = rx(-0.5)
		p["fing_l"] = 0.7 + 0.2 * sin(ph * 3.0)
		p["fing_r"] = 0.5
		return p)


static func library() -> AnimationLibrary:
	var lib := AnimationLibrary.new()
	lib.add_animation("idle", _idle())
	lib.add_animation("walk", _gait(1.0, 0.5, 0.9, 0.12, 0.35, 1.25, 0.02, 0.02))
	lib.add_animation("stalk", _gait(1.7, 0.32, 0.7, 0.3, 0.12, 1.3, 0.03, 0.03, 0.22))
	lib.add_animation("run", _gait(0.55, 0.9, 1.5, 0.5, 0.0, 0.5, 0.05, 0.02, 0.0, 0.9, 0.62))
	lib.add_animation("flee", _gait(0.5, 0.85, 1.4, 0.35, 0.8, 0.7, 0.05, 0.02))
	lib.add_animation("recoil", _recoil())
	lib.add_animation("scream", _scream())
	lib.add_animation("lunge", _lunge())
	lib.add_animation("peek", _peek())
	return lib


## Mr. Grin, rigged: a holder whose origin is the middle of his base, `size` metres tall, facing -Z.
## Returns null when the skinned mesh has not been baked (the caller falls back to the shader puppet).
static func make_grin(size: float, statue := false) -> Node3D:
	if not ResourceLoader.exists(MESH):
		return null
	var mesh := load(MESH) as ArrayMesh
	var holder := Node3D.new()
	holder.name = "mr_grin"
	var pivot := Node3D.new()
	var inner := Node3D.new()
	var k := size / BOX.size.y
	inner.scale = Vector3.ONE * k
	inner.position = Vector3(-(BOX.position.x + BOX.size.x * 0.5), -BOX.position.y, -(BOX.position.z + BOX.size.z * 0.5)) * k
	pivot.rotation_degrees.y = 180.0
	pivot.add_child(inner)
	holder.add_child(pivot)
	var sk := build_skeleton()
	inner.add_child(sk)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = mesh
	mi.skin = build_skin()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 4.0
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var src := Assets.original_material("mr_grin")
	# Dirtied and drained: eleven years in the dark, and not a toy anyone would pick up now.
	var skin_mat: Material = src.duplicate() if src != null else Assets.mat(Color(0.95, 0.85, 0.2), 0.7)
	if skin_mat is BaseMaterial3D and statue:
		# A plaster copy, left in the hall: grey, chalky, and cracked about the mouth.
		(skin_mat as BaseMaterial3D).albedo_color = Color(0.42, 0.42, 0.44)
		(skin_mat as BaseMaterial3D).roughness = 1.0
	elif skin_mat is BaseMaterial3D:
		(skin_mat as BaseMaterial3D).albedo_color = Color(0.66, 0.6, 0.46)
		(skin_mat as BaseMaterial3D).roughness = 0.95
	mi.material_override = skin_mat
	_face(sk, statue)
	var player := AnimationPlayer.new()
	player.name = "Anim"
	inner.add_child(player)
	player.add_animation_library("", library())
	holder.set_meta("anim", player)
	holder.set_meta("skeleton", sk)
	holder.set_meta("scaled_size", Vector3(BOX.size.x, BOX.size.y, BOX.size.z) * k)
	return holder


## What makes the mascot a monster: a mouth far too wide, full of teeth, and eyes that light up.
## Everything hangs on the head bone, so it turns, nods and thrashes with the head.
static func _face(sk: Skeleton3D, statue := false) -> void:
	var att := BoneAttachment3D.new()
	att.name = "Face"
	att.bone_name = "head"
	sk.add_child(att)
	var mouth := Vector3(0.0, 0.047, 0.088)     # from the head joint, in mesh units
	var dark := Assets.mat(Color(0.02, 0.0, 0.0), 0.9)
	var ivory := Assets.mat(Color(0.93, 0.9, 0.78), 0.45)
	var cavity := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 16
	sm.rings = 8
	cavity.mesh = sm
	cavity.scale = Vector3(0.112, 0.036, 0.026)
	cavity.position = mouth + Vector3(0, -0.002, -0.004)
	cavity.material_override = dark
	cavity.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	att.add_child(cavity)
	# Two rows of needle teeth along a smile that runs up past the cheeks.
	var n := 15
	for row in range(2):
		for i in range(n):
			var f := float(i) / (n - 1) * 2.0 - 1.0          # -1 .. 1 across the mouth
			var tooth := MeshInstance3D.new()
			var cone := CylinderMesh.new()
			cone.top_radius = 0.0
			cone.bottom_radius = 0.0042 + 0.0016 * (1.0 - absf(f))
			cone.height = 0.016 + 0.008 * (1.0 - absf(f))
			cone.radial_segments = 6
			cone.rings = 1
			tooth.mesh = cone
			var x := f * 0.052
			var curve := f * f * 0.012                      # corners lifted: the grin
			var y := mouth.y + curve + (0.0095 if row == 0 else -0.0095)
			tooth.position = Vector3(x, y, mouth.z + 0.003 - f * f * 0.010)
			tooth.rotation_degrees = Vector3(180.0 if row == 0 else 0.0, 0.0, -f * 22.0 * (1.0 if row == 0 else -1.0))
			tooth.material_override = ivory
			tooth.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			att.add_child(tooth)
	# Eyes: black sockets with a hot point in each.
	for side in [-1.0, 1.0]:
		var socket := MeshInstance3D.new()
		var ball := SphereMesh.new()
		ball.radius = 0.5
		ball.height = 1.0
		ball.radial_segments = 12
		ball.rings = 6
		socket.mesh = ball
		socket.scale = Vector3(0.026, 0.022, 0.012)
		socket.position = Vector3(side * 0.024, 0.081, 0.083)
		socket.material_override = dark
		socket.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		att.add_child(socket)
		var glint := MeshInstance3D.new()
		var g := SphereMesh.new()
		g.radius = 0.0055
		g.height = 0.011
		g.radial_segments = 8
		g.rings = 4
		glint.mesh = g
		glint.position = Vector3(side * 0.024, 0.080, 0.0905)
		glint.material_override = Assets.mat(Color(1.0, 0.25, 0.1), 0.3, 0.0, 6.0) if not statue else Assets.mat(Color(0.3, 0.3, 0.3), 0.9)
		glint.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		att.add_child(glint)
