class_name Rig
extends RefCounted
## Real skeletons for the robots. A generated model is one rigid mesh in a T-pose; tools/bake_rig.gd skins it
## to the bones this builds (each vertex weighted to the nearest limbs of its own side) and saves a skinned mesh,
## and this builds the Skeleton3D, the Skin and the animations at run time. Bones carry no rest rotation, so every
## animation key is a plain rotation about a world axis.

const DIR := "res://assets/rigs/"

## Each model's own box (its mesh bounds, measured once by tools/bake_rig.gd) and where its joints are, as fractions of that box.
const PROFILES := {
	"warden": {
		"box": AABB(Vector3(-0.389654, -0.500403, -0.185255), Vector3(0.779447, 0.99949, 0.309831)),
		"hip": 0.50, "knee": 0.27, "ankle": 0.07, "spine": 0.57, "chest": 0.68, "shoulder_y": 0.77, "neck": 0.88, "head": 0.90,
		"shoulder_x": 0.17, "elbow_x": 0.32, "wrist_x": 0.43, "leg_x": 0.11, "z": 0.45, "toe_z": 0.9,
	},
	"crawler": {
		"box": AABB(Vector3(-0.498703, -0.487799, -0.144655), Vector3(0.999071, 0.945256, 0.27318)),
		"hip": 0.40, "knee": 0.22, "ankle": 0.06, "spine": 0.48, "chest": 0.62, "shoulder_y": 0.745, "neck": 0.82, "head": 0.84,
		"shoulder_x": 0.07, "elbow_x": 0.26, "wrist_x": 0.40, "leg_x": 0.045, "z": 0.30, "toe_z": 0.62,
	},
	"hunter": {
		"box": AABB(Vector3(-0.499889, -0.388358, -0.05034), Vector3(1.000144, 0.76989, 0.122992)),
		"hip": 0.52, "knee": 0.28, "ankle": 0.07, "spine": 0.58, "chest": 0.68, "shoulder_y": 0.755, "neck": 0.82, "head": 0.84,
		"shoulder_x": 0.04, "elbow_x": 0.26, "wrist_x": 0.40, "leg_x": 0.045, "z": 0.38, "toe_z": 0.9,
	},
}


static func has(model: String) -> bool:
	return PROFILES.has(model) and ResourceLoader.exists("%s%s_skin.res" % [DIR, model])


static func box(model: String) -> AABB:
	return PROFILES[model].box


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
static func positions(model: String) -> Dictionary:
	var p: Dictionary = PROFILES[model]
	var z: float = p.z
	var P := {}
	P["hips"] = to_mesh(model, Vector3(0.5, p.hip, z))
	P["spine"] = to_mesh(model, Vector3(0.5, p.spine, z))
	P["chest"] = to_mesh(model, Vector3(0.5, p.chest, z + 0.02))
	P["neck"] = to_mesh(model, Vector3(0.5, p.neck, z + 0.06))
	P["head"] = to_mesh(model, Vector3(0.5, p.head, z + 0.1))
	var sy: float = p.shoulder_y
	for s in [-1.0, 1.0]:
		var k := "L" if s < 0.0 else "R"
		P["thigh" + k] = to_mesh(model, Vector3(0.5 + s * p.leg_x, p.hip, z))
		P["shin" + k] = to_mesh(model, Vector3(0.5 + s * p.leg_x, p.knee, z))
		P["foot" + k] = to_mesh(model, Vector3(0.5 + s * p.leg_x, p.ankle, z))
		P["toe" + k] = to_mesh(model, Vector3(0.5 + s * p.leg_x, 0.03, p.toe_z))
		P["upperArm" + k] = to_mesh(model, Vector3(0.5 + s * p.shoulder_x, sy, z))
		P["foreArm" + k] = to_mesh(model, Vector3(0.5 + s * p.elbow_x, sy - 0.01, z))
		var wr := to_mesh(model, Vector3(0.5 + s * p.wrist_x, sy - 0.02, z))
		P["hand" + k] = wr
		var hl: float = (0.5 - float(p.wrist_x)) * box(model).size.x / 0.85   # wrist to the tip of the longest finger
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
static func tip(model: String, bone: String, P: Dictionary) -> Vector3:
	var b := box(model)
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
static func joints(model: String) -> Array:
	var P := positions(model)
	var out: Array = []
	for e in spec():
		out.append([e[0], e[1], P[e[0]]])
	return out


static func to_mesh(model: String, u: Vector3) -> Vector3:
	var b := box(model)
	return b.position + u * b.size


static func index_of(model: String, bone: String) -> int:
	var j := joints(model)
	for i in range(j.size()):
		if j[i][0] == bone:
			return i
	return -1


## The skeleton, with the bind pose worked out (the bones have no rest rotation, so it is a translation each).
static func build_skeleton(model: String) -> Skeleton3D:
	var j := joints(model)
	var sk := Skeleton3D.new()
	sk.name = "Skeleton"
	for e in j:
		sk.add_bone(e[0])
	for i in range(j.size()):
		var parent: String = j[i][1]
		var global: Vector3 = j[i][2]
		var rest := global
		if parent != "":
			var pi := index_of(model, parent)
			rest = global - (j[pi][2] as Vector3)
			sk.set_bone_parent(i, pi)
		sk.set_bone_rest(i, Transform3D(Basis.IDENTITY, rest))
	sk.reset_bone_poses()
	return sk


static func build_skin(model: String) -> Skin:
	var j := joints(model)
	var skin := Skin.new()
	for i in range(j.size()):
		skin.add_bind(i, Transform3D(Basis.IDENTITY, -(j[i][2] as Vector3)))
		skin.set_bind_name(i, j[i][0])
	return skin


static var _model := "warden"


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
				v = (joints(_model)[0][2] as Vector3) + (v as Vector3) * box(_model).size.y
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


static func library(model: String) -> AnimationLibrary:
	_model = model
	var lib := AnimationLibrary.new()
	lib.add_animation("idle", _idle())
	lib.add_animation("walk", _gait(1.0, 0.5, 0.9, 0.12, 0.35, 1.25, 0.02, 0.02))
	lib.add_animation("stalk", _gait(1.7, 0.32, 0.7, 0.3, 0.12, 1.3, 0.03, 0.03, 0.22))
	lib.add_animation("stomp", _gait(1.3, 0.36, 0.55, 0.1, 0.22, 1.15, 0.045, 0.035))
	lib.add_animation("run", _gait(0.55, 0.9, 1.5, 0.5, 0.0, 0.5, 0.05, 0.02, 0.0, 0.9, 0.62))
	lib.add_animation("flee", _gait(0.5, 0.85, 1.4, 0.35, 0.8, 0.7, 0.05, 0.02))
	lib.add_animation("recoil", _recoil())
	lib.add_animation("scream", _scream())
	lib.add_animation("lunge", _lunge())
	lib.add_animation("peek", _peek())
	lib.add_animation("sweep", _sweep())
	lib.add_animation("crawl", _crawl())
	return lib


## Blind and listening: a slow walk, arms held out in front feeling for what it cannot see, the head turning side to side.
static func _sweep() -> Animation:
	return _cycle(2.4, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var s := sin(ph)
		var c := cos(ph)
		var p := {}
		p["hips"] = Vector3(0, -absf(c) * 0.015, 0)
		p["spine"] = rx(0.12)
		p["chest"] = rx(0.1)
		p["neck"] = rx(-0.05)
		p["head"] = ry(sin(ph * 0.5) * 0.7) * rx(0.1)
		p["arm_l"] = arm(-1, 0.5, 0.0, 0.8 + 0.1 * s, 0.35)
		p["arm_r"] = arm(1, 0.5, 0.0, 0.8 - 0.1 * s, 0.35)
		p["fore_l"] = rx(-0.2)
		p["fore_r"] = rx(-0.2)
		p["thigh_l"] = rx(-s * 0.32)
		p["thigh_r"] = rx(s * 0.32)
		p["shin_l"] = rx(maxf(0.0, c) * 0.6 + 0.05)
		p["shin_r"] = rx(maxf(0.0, -c) * 0.6 + 0.05)
		p["fing_l"] = -0.1 + 0.25 * s
		p["fing_r"] = -0.1 - 0.25 * s
		p["toe_l"] = rx(-0.4 * maxf(0.0, s))
		p["toe_r"] = rx(-0.4 * maxf(0.0, -s))
		return p)


## Dragging itself along the floor on its arms.
static func _crawl() -> Animation:
	return _cycle(1.2, 16, func(t: float) -> Dictionary:
		var ph := t * TAU
		var s := sin(ph)
		var p := {}
		p["hips"] = Vector3(0, -0.2 + 0.015 * absf(s), 0.0)
		p["pelvis"] = rx(1.15)
		p["spine"] = rx(-0.15)
		p["chest"] = rx(-0.2)
		p["neck"] = rx(-0.5)
		p["head"] = rx(-0.4) * rz(0.25 * s)
		p["arm_l"] = arm(-1, 0.2, 0.0, 1.0, -1.0 + 0.5 * s)
		p["arm_r"] = arm(1, 0.2, 0.0, 1.0, -1.0 - 0.5 * s)
		p["fore_l"] = rx(0.3)
		p["fore_r"] = rx(0.3)
		p["thigh_l"] = rx(-0.3 * s)
		p["thigh_r"] = rx(0.3 * s)
		p["shin_l"] = rx(0.3)
		p["shin_r"] = rx(0.3)
		p["fing_l"] = 0.15 + 0.3 * maxf(0.0, s)
		p["fing_r"] = 0.15 + 0.3 * maxf(0.0, -s)
		return p)


## A creature, rigged: a holder whose origin is the middle of its base, `size` metres tall, facing -Z.
## Returns null when the skinned mesh has not been baked (the caller falls back to a stand-in).
static func make(model: String, size: float, tint := Color(1, 1, 1)) -> Node3D:
	if not has(model):
		return null
	var mesh := load("%s%s_skin.res" % [DIR, model]) as ArrayMesh
	var b := box(model)
	var holder := Node3D.new()
	holder.name = model
	var pivot := Node3D.new()
	var inner := Node3D.new()
	var k := size / b.size.y
	inner.scale = Vector3.ONE * k
	inner.position = Vector3(-(b.position.x + b.size.x * 0.5), -b.position.y, -(b.position.z + b.size.z * 0.5)) * k
	pivot.rotation_degrees.y = float(Assets.FACING.get(model, {}).get("face", 0.0))
	pivot.add_child(inner)
	holder.add_child(pivot)
	var sk := build_skeleton(model)
	inner.add_child(sk)
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = mesh
	mi.skin = build_skin(model)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 4.0
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var src := Assets.original_material(model)
	var m: Material = src.duplicate() if src != null else Assets.mat(Color(0.4, 0.42, 0.45), 0.6, 0.5)
	if m is BaseMaterial3D:
		(m as BaseMaterial3D).albedo_color = tint
	mi.material_override = m
	var player := AnimationPlayer.new()
	player.name = "Anim"
	inner.add_child(player)
	player.add_animation_library("", library(model))
	holder.set_meta("anim", player)
	holder.set_meta("skeleton", sk)
	holder.set_meta("body_mat", m)
	holder.set_meta("scaled_size", b.size * k)
	holder.set_meta("glow_mats", _dress(model, sk, k))
	return holder


## What marks each kind apart on the head bone: the Warden's red eyes, the hunters' blank sensor band, the crawlers' one cracked lens.
static func _dress(model: String, sk: Skeleton3D, _k: float) -> Array:
	var b := box(model)
	var att := BoneAttachment3D.new()
	att.name = "Face"
	att.bone_name = "head"
	sk.add_child(att)
	var u := b.size.y * 0.05
	var mats: Array = []
	var glow := _glow_mat(Color(1.0, 0.08, 0.04), 6.0)
	mats.append(glow)
	if model == "warden":
		for s in [-1.0, 1.0]:
			var e := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = u * 0.22
			sm.height = u * 0.44
			sm.radial_segments = 8
			sm.rings = 4
			e.mesh = sm
			e.material_override = glow
			e.position = Vector3(s * u * 0.45, u * 0.35, b.size.z * 0.4)
			att.add_child(e)
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.1, 0.05)
		l.light_energy = 0.8
		l.omni_range = 6.0
		l.position = Vector3(0, u * 0.35, b.size.z * 0.55)
		att.add_child(l)
	elif model == "crawler":
		var e := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = u * 0.2
		sm.height = u * 0.4
		sm.radial_segments = 8
		sm.rings = 4
		e.mesh = sm
		var lens := _glow_mat(Color(1.0, 0.45, 0.1), 4.0)
		mats.append(lens)
		e.material_override = lens
		e.position = Vector3(u * 0.3, u * 0.3, b.size.z * 0.35)
		att.add_child(e)
	elif model == "hunter":
		var band := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(u * 1.6, u * 0.18, u * 0.3)
		band.mesh = bm
		var bandm := _glow_mat(Color(0.2, 0.5, 1.0), 2.5)
		mats.append(bandm)
		band.material_override = bandm
		band.position = Vector3(0, u * 0.3, b.size.z * 0.4)
		att.add_child(band)
	return mats


## A glow of its own (the shared material cache would recolour every creature at once): the state of a creature shows in it.
static func _glow_mat(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	m.roughness = 0.3
	return m
