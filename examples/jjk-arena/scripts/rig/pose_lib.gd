class_name PoseLib
extends RefCounted
## High-level fighting poses -> RigAnimator pose dictionaries. Vectors are in model space (+X left, +Y up, +Z forward) written for the
## LEFT side; the right side is mirrored automatically. A "pose" here is a flat parameter dictionary; `build` expands it into bones.

const DEFAULT := {
	"lean": 6.0, "twist": 0.0, "roll": 0.0, "crouch": 0.0, "hx": 0.0, "hz": 0.0, "head": 0.0,
	"uL": Vector3(0.30, -0.80, 0.50), "fL": Vector3(0.10, 0.60, 0.80),
	"uR": Vector3(0.30, -0.80, 0.55), "fR": Vector3(0.10, 0.60, 0.80),
	"tL": Vector3(0.12, -1.0, 0.30), "sL": Vector3(0.10, -1.0, -0.10), "ftL": Vector3(0.0, -0.25, 1.0),
	"hL": Vector3.ZERO, "hR": Vector3.ZERO,     # hand direction; zero = follow the forearm
	"tR": Vector3(0.12, -1.0, -0.20), "sR": Vector3(0.10, -1.0, -0.05), "ftR": Vector3(0.0, -0.25, 1.0),
}

static func mix(a: Dictionary, b: Dictionary, w: float) -> Dictionary:
	var out := {}
	var keys := {}
	for k in a:
		keys[k] = true
	for k in b:
		keys[k] = true
	for k in keys:
		if not DEFAULT.has(k):
			continue
		var va = a.get(k, DEFAULT[k])
		var vb = b.get(k, DEFAULT[k])
		out[k] = va.lerp(vb, w) if va is Vector3 else lerpf(va, vb, w)
	return out

static func _mir(v: Vector3) -> Vector3:
	return Vector3(-v.x, v.y, v.z)

static func build(p: Dictionary) -> Dictionary:
	var q := DEFAULT.duplicate()
	for k in p:
		if DEFAULT.has(k):
			q[k] = p[k]
	var lean: float = q["lean"]
	var tw: float = q["twist"]
	var roll: float = q["roll"]
	var up := func(l: float, r: float) -> Vector3:
		return Vector3(sin(deg_to_rad(r)), cos(deg_to_rad(l)) * cos(deg_to_rad(r)), sin(deg_to_rad(l)))
	var pose := {}
	pose["hips"] = [up.call(lean * 0.15, roll * 0.2), tw * 0.15]
	pose["spine"] = [up.call(lean * 0.45, roll * 0.5), tw * 0.45]
	pose["chest"] = [up.call(lean * 0.8, roll * 0.8), tw * 0.8]
	pose["neck"] = [up.call(lean * 0.6 + q["head"] * 0.4, roll * 0.6), tw * 0.9]
	pose["head"] = [up.call(lean * 0.1 + q["head"], roll * 0.4), tw]
	pose["upperarmL"] = q["uL"]
	pose["forearmL"] = q["fL"]
	pose["upperarmR"] = _mir(q["uR"])
	pose["forearmR"] = _mir(q["fR"])
	pose["handL"] = q["hL"] if (q["hL"] as Vector3).length() > 0.3 else q["fL"]
	pose["handR"] = _mir(q["hR"] if (q["hR"] as Vector3).length() > 0.3 else q["fR"])
	pose["thighL"] = q["tL"]
	pose["shinL"] = q["sL"]
	pose["footL"] = q["ftL"]
	pose["thighR"] = _mir(q["tR"])
	pose["shinR"] = _mir(q["sR"])
	pose["footR"] = _mir(q["ftR"])
	pose["hips_pos"] = Vector3(q["hx"], -q["crouch"], q["hz"])
	return pose

# ---- named poses -----------------------------------------------------------------------------------------------------------------------
static func stance(t: float) -> Dictionary:
	var b := sin(t * 3.2)
	return {"crouch": 0.07 + 0.015 * b, "lean": 7.0 + 1.0 * b, "twist": -8.0,
		"tL": Vector3(0.30, -0.80, 0.50), "sL": Vector3(0.20, -0.85, -0.45),
		"tR": Vector3(-0.05, -0.85, -0.40), "sR": Vector3(0.0, -1.0, -0.25),
		"uL": Vector3(0.32, -0.85, 0.40), "fL": Vector3(0.0, 0.50, 0.85),
		"uR": Vector3(0.25, -0.90, 0.30), "fR": Vector3(-0.15, 0.40, 0.90)}

static func walk(t: float, speed: float) -> Dictionary:
	var s := sin(t * 9.0)
	var c := cos(t * 9.0)
	var p := stance(t)
	p["tL"] = Vector3(0.14, -1.0, 0.75 * s)
	p["sL"] = Vector3(0.1, -1.0, -0.45 * maxf(0.0, -s) - 0.1)
	p["tR"] = Vector3(0.14, -1.0, -0.75 * s)
	p["sR"] = Vector3(0.1, -1.0, -0.45 * maxf(0.0, s) - 0.1)
	p["crouch"] = 0.05 + 0.02 * absf(c)
	p["lean"] = 10.0 + 6.0 * speed
	return p

## Signature poses: Gojo's finger point for Red, open palm for Blue, arms wide then thrust for Purple; Sukuna's swipe for Dismantle,
## palm strike for Cleave, the bow draw of Fuga, the World-Cutting Slash's two-handed sign then a full-body sweep, and both domain hand signs.
const SIG_WINDUP := {
	"gojo_special": {"twist": 18.0, "lean": 2.0, "uR": Vector3(0.55, -0.1, 0.55), "fR": Vector3(-0.1, 0.9, 0.3), "uL": Vector3(0.3, -0.9, 0.2), "fL": Vector3(0.2, -0.3, 0.9)},
	"gojo_skill2": {"twist": -12.0, "uL": Vector3(0.6, -0.3, 0.4), "fL": Vector3(0.2, 0.5, 0.8), "uR": Vector3(0.3, -0.9, 0.0), "fR": Vector3(0.1, -0.6, 0.6)},
	"gojo_ultimate": {"lean": -8.0, "uL": Vector3(1.0, 0.1, 0.1), "fL": Vector3(0.6, 0.6, 0.4), "uR": Vector3(1.0, 0.1, 0.1), "fR": Vector3(0.6, 0.6, 0.4), "crouch": 0.06},
	"gojo_purple200": {"lean": -12.0, "uL": Vector3(1.0, 0.3, 0.0), "fL": Vector3(0.5, 0.8, 0.1), "uR": Vector3(1.0, 0.3, 0.0), "fR": Vector3(0.5, 0.8, 0.1), "crouch": 0.1, "head": -10.0},
	"gojo_domain": {"lean": 0.0, "head": 4.0, "uR": Vector3(0.45, -0.35, 0.6), "fR": Vector3(-0.55, 0.8, 0.2), "uL": Vector3(0.25, -0.95, 0.1), "fL": Vector3(0.1, -1.0, 0.2), "crouch": 0.02},
	"sukuna_special": {"twist": 26.0, "lean": 4.0, "uR": Vector3(-0.3, 0.6, 0.5), "fR": Vector3(-0.8, 0.4, 0.2), "crouch": 0.08},
	"sukuna_skill2": {"twist": 22.0, "uR": Vector3(0.4, -0.6, -0.6), "fR": Vector3(0.0, 0.2, 1.0), "crouch": 0.14, "lean": 10.0},
	"sukuna_ultimate": {"twist": 30.0, "uL": Vector3(0.0, 0.1, 1.0), "fL": Vector3(0.0, 0.1, 1.0), "uR": Vector3(0.7, 0.1, -0.2), "fR": Vector3(-0.9, 0.2, 0.3), "crouch": 0.08},
	"sukuna_world_slash": {"lean": 4.0, "head": 8.0, "uL": Vector3(0.2, -0.4, 0.9), "fL": Vector3(-0.8, 0.5, 0.3), "uR": Vector3(0.2, -0.4, 0.9), "fR": Vector3(-0.8, 0.5, 0.3), "crouch": 0.05},
	"sukuna_domain": {"lean": 6.0, "head": 10.0, "uL": Vector3(0.25, -0.5, 0.85), "fL": Vector3(-0.85, 0.35, 0.4), "uR": Vector3(0.25, -0.5, 0.85), "fR": Vector3(-0.85, 0.35, 0.4), "crouch": 0.04},
}
const SIG_STRIKE := {
	"gojo_special": {"twist": -24.0, "lean": 10.0, "uR": Vector3(-0.1, 0.15, 1.0), "fR": Vector3(-0.05, 0.2, 1.0), "hz": 0.15},
	"gojo_skill2": {"twist": 20.0, "lean": 8.0, "uL": Vector3(-0.1, 0.1, 1.0), "fL": Vector3(-0.1, 0.25, 1.0), "hz": 0.1},
	"gojo_ultimate": {"lean": 14.0, "twist": -20.0, "uR": Vector3(-0.05, 0.1, 1.0), "fR": Vector3(0.0, 0.1, 1.0), "uL": Vector3(0.7, -0.2, -0.6), "fL": Vector3(0.6, -0.3, -0.7), "hz": 0.25, "crouch": 0.12},
	"gojo_purple200": {"lean": 16.0, "twist": -26.0, "uR": Vector3(-0.05, 0.2, 1.0), "fR": Vector3(0.0, 0.2, 1.0), "uL": Vector3(0.8, -0.1, -0.5), "fL": Vector3(0.7, -0.2, -0.6), "hz": 0.3, "crouch": 0.16},
	"gojo_domain": {"lean": 0.0, "head": 4.0, "uR": Vector3(0.45, -0.35, 0.6), "fR": Vector3(-0.55, 0.8, 0.2), "uL": Vector3(0.25, -0.95, 0.1), "fL": Vector3(0.1, -1.0, 0.2)},
	"sukuna_special": {"twist": -30.0, "lean": 14.0, "uR": Vector3(0.9, -0.3, 0.4), "fR": Vector3(0.9, -0.4, 0.3), "hz": 0.15, "crouch": 0.1},
	"sukuna_skill2": {"twist": -26.0, "lean": 16.0, "uR": Vector3(-0.1, -0.05, 1.0), "fR": Vector3(-0.05, 0.0, 1.0), "hz": 0.3, "crouch": 0.16,
		"tL": Vector3(0.15, -0.8, 0.6), "sL": Vector3(0.1, -1.0, 0.0)},
	"sukuna_ultimate": {"twist": -10.0, "lean": 8.0, "uL": Vector3(0.0, 0.1, 1.0), "fL": Vector3(0.0, 0.1, 1.0), "uR": Vector3(0.1, 0.05, 1.0), "fR": Vector3(0.0, 0.05, 1.0), "hz": 0.1},
	"sukuna_world_slash": {"twist": -40.0, "lean": 22.0, "roll": -10.0, "uR": Vector3(0.95, -0.6, 0.3), "fR": Vector3(0.9, -0.7, 0.2), "uL": Vector3(0.6, -0.4, -0.5), "fL": Vector3(0.4, -0.2, -0.8), "hz": 0.35, "crouch": 0.18},
	"sukuna_domain": {"lean": 6.0, "head": 10.0, "uL": Vector3(0.25, -0.5, 0.85), "fL": Vector3(-0.85, 0.35, 0.4), "uR": Vector3(0.25, -0.5, 0.85), "fR": Vector3(-0.85, 0.35, 0.4)},
}

static func windup(kind: String) -> Dictionary:
	if SIG_WINDUP.has(kind):
		return SIG_WINDUP[kind]
	if kind.contains("_") and not kind.begins_with("light"):
		kind = kind.split("_", true, 1)[1]
		if kind == "skill2" or kind == "purple200" or kind == "world_slash":
			kind = "special" if kind == "skill2" else "ultimate"
	match kind:
		"light1": return {"twist": 14.0, "uR": Vector3(0.4, -0.5, 0.0), "fR": Vector3(0.1, 0.6, 0.6), "crouch": 0.09}
		"light2": return {"twist": -16.0, "uL": Vector3(0.7, -0.3, -0.1), "fL": Vector3(0.5, 0.4, 0.6), "crouch": 0.09}
		"light3": return {"twist": 22.0, "lean": 4.0, "uR": Vector3(0.5, -0.6, -0.4), "fR": Vector3(0.1, 0.5, 0.3), "crouch": 0.12}
		"heavy": return {"twist": 10.0, "lean": -5.0, "crouch": 0.12, "tR": Vector3(0.0, -0.8, -0.6), "sR": Vector3(0.0, -0.4, -0.9)}
		"special": return {"lean": -6.0, "twist": 0.0, "uL": Vector3(0.6, -0.2, 0.3), "fL": Vector3(0.4, 0.3, 0.6),
			"uR": Vector3(0.6, -0.2, 0.3), "fR": Vector3(0.4, 0.3, 0.6)}
		_: return {"lean": -14.0, "crouch": 0.04, "uL": Vector3(0.5, 1.0, 0.0), "fL": Vector3(0.2, 1.0, 0.0),
			"uR": Vector3(0.5, 1.0, 0.0), "fR": Vector3(0.2, 1.0, 0.0)}

static func strike(kind: String) -> Dictionary:
	if SIG_STRIKE.has(kind):
		return SIG_STRIKE[kind]
	if kind.contains("_") and not kind.begins_with("light"):
		kind = kind.split("_", true, 1)[1]
		if kind == "skill2" or kind == "purple200" or kind == "world_slash":
			kind = "special" if kind == "skill2" else "ultimate"
	match kind:
		"light1": return {"twist": -28.0, "lean": 12.0, "uR": Vector3(-0.15, 0.05, 1.0), "fR": Vector3(-0.1, 0.05, 1.0), "hz": 0.18, "crouch": 0.08}
		"light2": return {"twist": 30.0, "lean": 12.0, "uL": Vector3(-0.2, 0.0, 1.0), "fL": Vector3(-0.3, 0.0, 1.0), "hz": 0.18, "crouch": 0.08}
		"light3": return {"twist": -34.0, "lean": 16.0, "uR": Vector3(-0.1, 0.12, 1.0), "fR": Vector3(-0.05, 0.12, 1.0), "hz": 0.34, "crouch": 0.1,
			"tL": Vector3(0.1, -0.8, 0.7), "sL": Vector3(0.1, -1.0, 0.1)}
		"heavy": return {"twist": 30.0, "lean": -12.0, "roll": 14.0, "crouch": 0.04, "tR": Vector3(-0.2, 0.0, 1.0), "sR": Vector3(-0.1, 0.1, 1.0),
			"ftR": Vector3(0.0, 0.1, 1.0), "uL": Vector3(0.9, 0.1, -0.2), "fL": Vector3(1.0, 0.0, 0.0), "uR": Vector3(0.6, -0.5, 0.2)}
		"special": return {"lean": 10.0, "uL": Vector3(0.0, 0.1, 1.0), "fL": Vector3(0.0, 0.1, 1.0), "uR": Vector3(0.0, 0.1, 1.0), "fR": Vector3(0.0, 0.1, 1.0),
			"hz": 0.1, "crouch": 0.1}
		_: return {"lean": 14.0, "crouch": 0.13, "uL": Vector3(0.2, -0.2, 1.0), "fL": Vector3(0.1, -0.5, 1.0),
			"uR": Vector3(0.2, -0.2, 1.0), "fR": Vector3(0.1, -0.5, 1.0), "tL": Vector3(0.3, -0.7, 0.6), "tR": Vector3(0.0, -0.8, -0.5)}

static func attack(kind: String, phase: int, k: float) -> Dictionary:
	# phase 0 wind-up, 1 strike, 2 recover (k = 0..1 inside the phase)
	var wu := windup(kind)
	var st := strike(kind)
	match phase:
		0: return mix(stance(0.0), wu, k)
		1: return mix(wu, st, minf(1.0, k * 2.5))
		_: return mix(st, stance(0.0), k)

static func hit(k: float) -> Dictionary:
	return mix({"lean": -22.0, "twist": 14.0, "crouch": 0.1, "head": -16.0, "uL": Vector3(0.9, -0.2, -0.3), "fL": Vector3(0.8, 0.2, -0.3),
		"uR": Vector3(0.9, -0.2, -0.3), "fR": Vector3(0.8, 0.2, -0.3)}, stance(0.0), clampf(k, 0.0, 1.0))

static func block() -> Dictionary:
	return {"lean": 8.0, "crouch": 0.1, "uL": Vector3(0.1, -0.2, 0.9), "fL": Vector3(-0.8, 0.8, 0.5),
		"uR": Vector3(0.1, -0.2, 0.9), "fR": Vector3(-0.8, 0.8, 0.5), "head": 6.0}

static func dodge() -> Dictionary:
	return {"lean": -20.0, "crouch": 0.18, "tL": Vector3(0.2, -0.7, 0.6), "sL": Vector3(0.0, -0.6, -0.8), "tR": Vector3(0.0, -0.9, -0.2), "sR": Vector3(0.0, -0.7, -0.7)}

static func ko(k: float) -> Dictionary:
	# fall backwards onto the floor
	var f := clampf(k, 0.0, 1.0)
	return mix(hit(0.0), {"lean": -84.0, "crouch": 0.55, "head": -6.0, "uL": Vector3(0.6, 0.0, 0.7), "fL": Vector3(0.7, 0.0, 0.6),
		"uR": Vector3(0.6, 0.0, 0.7), "fR": Vector3(0.7, 0.0, 0.6),
		"tL": Vector3(0.1, 0.0, -1.0), "sL": Vector3(0.1, 0.0, -1.0), "ftL": Vector3(0.0, 1.0, -0.3),
		"tR": Vector3(-0.1, 0.0, -1.0), "sR": Vector3(-0.1, 0.0, -1.0), "ftR": Vector3(0.0, 1.0, -0.3)}, f)

static func fly_hover(t: float) -> Dictionary:
	var b := sin(t * 1.6)
	return {"lean": 4.0, "crouch": -0.05 * b, "head": 0.0,
		"uL": Vector3(0.75, -0.65, 0.12), "fL": Vector3(0.8, -0.55, 0.2), "uR": Vector3(0.75, -0.65, 0.12), "fR": Vector3(0.8, -0.55, 0.2),
		"tL": Vector3(0.08, -1.0, -0.12), "sL": Vector3(0.05, -1.0, -0.4), "ftL": Vector3(0.0, -1.0, 0.45),
		"tR": Vector3(0.0, -1.0, -0.05), "sR": Vector3(0.0, -1.0, -0.35), "ftR": Vector3(0.0, -1.0, 0.4)}

static func fly_fast(t: float) -> Dictionary:
	var s := sin(t * 2.4)
	return {"lean": 72.0 + 2.0 * s, "crouch": 0.0, "head": -50.0, "roll": 3.0 * s,
		"uL": Vector3(0.18, -0.25, -1.0), "fL": Vector3(0.1, -0.15, -1.0), "uR": Vector3(0.18, -0.25, -1.0), "fR": Vector3(0.1, -0.15, -1.0),
		"tL": Vector3(0.06, -0.3, -1.0), "sL": Vector3(0.05, -0.2, -1.0), "ftL": Vector3(0.0, -0.6, -0.8),
		"tR": Vector3(0.0, -0.3, -1.0), "sR": Vector3(0.0, -0.2, -1.0), "ftR": Vector3(0.0, -0.6, -0.8)}

static func fly_takeoff(k: float) -> Dictionary:
	return mix({"crouch": 0.22, "lean": 14.0, "tL": Vector3(0.3, -0.7, 0.7), "sL": Vector3(0.1, -0.6, -0.8), "tR": Vector3(0.0, -0.7, 0.7), "sR": Vector3(0.0, -0.6, -0.8)},
		fly_hover(0.0), clampf(k, 0.0, 1.0))

## Caught in Infinite Void: the brain is flooded with information — limp arms, head tipped back, a constant tremble.
static func stunned(t: float) -> Dictionary:
	var j := sin(t * 47.0) * 0.03
	return {"lean": -10.0 + sin(t * 31.0) * 1.5, "head": -24.0, "roll": 4.0 + sin(t * 23.0) * 2.0, "crouch": 0.03,
		"uL": Vector3(0.3, -0.95, 0.05 + j), "fL": Vector3(0.2, -1.0, 0.1), "uR": Vector3(0.3, -0.95, 0.05 - j), "fR": Vector3(0.2, -1.0, 0.1),
		"tL": Vector3(0.1, -1.0, 0.02), "sL": Vector3(0.05, -1.0, 0.0), "tR": Vector3(0.1, -1.0, -0.02), "sR": Vector3(0.05, -1.0, 0.0)}

## Gojo's Infinite Void sign: right hand up by the face, index and middle finger raised and crossed, the rest folded.
static func gojo_sign() -> Dictionary:
	var p: Dictionary = SIG_WINDUP["gojo_domain"].duplicate()
	p["uR"] = Vector3(0.08, -0.5, 0.86)
	p["fR"] = Vector3(-0.62, 0.78, 0.1)
	p["head"] = 6.0
	p["hR"] = Vector3(-0.15, 1.0, 0.25)
	p["curl"] = {"R": {"index": [-6, 4, 4], "middle": [10, 6, 4], "ring": [75, 95, 70], "pinky": [80, 95, 70], "thumb": [25, 35, 25]}}
	return p

## Sukuna's Malevolent Shrine seal: both hands pressed together in front of the chest, fingers straight up.
static func sukuna_seal() -> Dictionary:
	var p: Dictionary = SIG_WINDUP["sukuna_domain"].duplicate()
	p["uL"] = Vector3(0.05, -0.5, 0.86)
	p["fL"] = Vector3(-1.0, 0.22, 0.08)
	p["uR"] = Vector3(0.05, -0.5, 0.86)
	p["fR"] = Vector3(-1.0, 0.22, 0.08)
	p["hL"] = Vector3(-0.2, 1.0, 0.15)
	p["hR"] = Vector3(-0.2, 1.0, 0.15)
	p["curl"] = {"R": {"thumb": [10, 10, 5]}, "L": {"thumb": [10, 10, 5]}}
	return p
