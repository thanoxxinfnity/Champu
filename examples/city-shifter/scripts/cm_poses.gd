class_name CMPoses
extends RefCounted
## Survival poses (calm stance, walk, run, melee swing, pistol aim, hurt, death) as PoseLib parameter dictionaries.

static func idle(t: float) -> Dictionary:
	var b := sin(t * 1.7)
	return {"lean": 3.0 + b, "crouch": 0.012 * b, "head": 1.0 + 1.5 * sin(t * 0.8), "twist": 0.0,
		"uL": Vector3(0.14, -0.97, 0.12 + 0.02 * b), "fL": Vector3(0.10, -0.80, 0.55),
		"uR": Vector3(0.14, -0.97, 0.10 - 0.02 * b), "fR": Vector3(0.10, -0.80, 0.55),
		"tL": Vector3(0.05, -1.0, 0.04), "sL": Vector3(0.05, -1.0, -0.03), "ftL": Vector3(0.0, -0.3, 1.0),
		"tR": Vector3(0.05, -1.0, 0.0), "sR": Vector3(0.05, -1.0, -0.02), "ftR": Vector3(0.0, -0.3, 1.0)}


static func walk(phase: float, speed: float) -> Dictionary:
	var s := sin(phase)
	var c := cos(phase)
	var k := clampf(speed, 0.0, 1.4)
	var p := idle(phase * 0.2)
	p["tL"] = Vector3(0.06, -1.0, 0.7 * s * k)
	p["sL"] = Vector3(0.05, -1.0, -0.15 - 0.55 * maxf(0.0, -s) * k)
	p["tR"] = Vector3(0.06, -1.0, -0.7 * s * k)
	p["sR"] = Vector3(0.05, -1.0, -0.15 - 0.55 * maxf(0.0, s) * k)
	p["ftL"] = Vector3(0.0, -0.25 + 0.3 * maxf(0.0, -s), 1.0)
	p["ftR"] = Vector3(0.0, -0.25 + 0.3 * maxf(0.0, s), 1.0)
	p["uL"] = Vector3(0.16, -0.95, -0.55 * s * k)
	p["uR"] = Vector3(0.16, -0.95, 0.55 * s * k)
	p["fL"] = Vector3(0.1, -0.7, 0.3 + 0.5 * maxf(0.0, s) * k)
	p["fR"] = Vector3(0.1, -0.7, 0.3 + 0.5 * maxf(0.0, -s) * k)
	p["crouch"] = 0.02 + 0.025 * absf(c) * k
	p["lean"] = 5.0 + 7.0 * k
	p["twist"] = 5.0 * s * k
	return p


static func run(phase: float) -> Dictionary:
	var p := walk(phase, 1.4)
	p["lean"] = 17.0
	p["fL"] = Vector3(0.1, 0.1, 1.0)
	p["fR"] = Vector3(0.1, 0.1, 1.0)
	p["crouch"] = 0.05 + 0.03 * absf(cos(phase))
	return p


static func swing(phase: int, k: float, combo: int) -> Dictionary:
	# 0 wind-up, 1 strike, 2 recover; combo alternates the diagonal
	var side := 1.0 if combo % 2 == 0 else -1.0
	var wu := {"twist": 30.0 * side, "lean": -4.0, "crouch": 0.06, "uR": Vector3(0.65, 0.55, 0.25), "fR": Vector3(0.3, 0.9, -0.1),
		"uL": Vector3(0.3, -0.7, 0.5), "fL": Vector3(0.1, 0.1, 1.0), "tL": Vector3(0.12, -0.95, 0.35), "tR": Vector3(0.05, -0.95, -0.35)}
	var st := {"twist": -42.0 * side, "lean": 16.0, "crouch": 0.09, "uR": Vector3(-0.2, -0.1, 1.0), "fR": Vector3(-0.6, -0.5, 0.85),
		"uL": Vector3(0.45, -0.6, 0.6), "fL": Vector3(0.0, -0.1, 1.0), "tL": Vector3(0.1, -0.9, 0.5), "tR": Vector3(0.05, -0.95, -0.4), "hz": 0.18}
	match phase:
		0: return PoseLib.mix(idle(0.0), wu, k)
		1: return PoseLib.mix(wu, st, minf(1.0, k * 2.4))
		_: return PoseLib.mix(st, idle(0.0), k)


static func aim() -> Dictionary:
	return {"lean": 4.0, "twist": -14.0, "crouch": 0.03, "head": 0.0,
		"uR": Vector3(0.02, -0.12, 1.0), "fR": Vector3(0.0, -0.05, 1.0), "hR": Vector3(0.0, -0.05, 1.0),
		"uL": Vector3(0.25, -0.45, 0.85), "fL": Vector3(-0.35, -0.1, 0.95),
		"tL": Vector3(0.12, -0.97, 0.15), "tR": Vector3(0.0, -0.98, -0.1)}


static func throw_flare(k: float) -> Dictionary:
	return PoseLib.mix({"lean": -8.0, "twist": 24.0, "uR": Vector3(0.55, 0.6, -0.4), "fR": Vector3(0.4, 0.7, -0.2)},
		{"lean": 14.0, "twist": -30.0, "uR": Vector3(-0.1, 0.1, 1.0), "fR": Vector3(-0.1, 0.1, 1.0), "hz": 0.1}, clampf(k, 0.0, 1.0))


static func hurt(k: float) -> Dictionary:
	return PoseLib.mix({"lean": -18.0, "twist": 14.0, "crouch": 0.07, "head": -14.0, "uL": Vector3(0.7, -0.4, -0.3), "fL": Vector3(0.6, 0.1, -0.2),
		"uR": Vector3(0.7, -0.4, -0.3), "fR": Vector3(0.6, 0.1, -0.2)}, idle(0.0), clampf(k, 0.0, 1.0))


static func roll(k: float) -> Dictionary:
	return {"lean": 55.0, "crouch": 0.38, "tL": Vector3(0.3, -0.35, 0.9), "sL": Vector3(0.1, -0.1, -1.0), "tR": Vector3(-0.1, -0.35, 0.9), "sR": Vector3(0.0, -0.1, -1.0),
		"uL": Vector3(0.5, -0.4, 0.8), "fL": Vector3(0.2, -0.3, 0.9), "uR": Vector3(0.5, -0.4, 0.8), "fR": Vector3(0.2, -0.3, 0.9), "head": 20.0}


static func death(k: float) -> Dictionary:
	return PoseLib.ko(k)


static func sit_scared(t: float) -> Dictionary:
	return {"lean": 36.0, "crouch": 0.32, "head": 14.0, "uL": Vector3(0.1, -0.5, 0.8), "fL": Vector3(-0.4, 0.5, 0.7), "uR": Vector3(0.1, -0.5, 0.8), "fR": Vector3(-0.4, 0.5, 0.7),
		"tL": Vector3(0.1, -0.2, 1.0), "sL": Vector3(0.1, -1.0, 0.1), "tR": Vector3(-0.1, -0.2, 1.0), "sR": Vector3(-0.1, -1.0, 0.1)}


# ── emotes (the lobby hero, the victory screen) ──────────────────────────────

const EMOTES := ["wave", "victory", "flex", "peace", "bow"]


## `name` at time `t` (seconds since it started); any other name is the idle breathing.
static func emote(name: String, t: float) -> Dictionary:
	var p := idle(t)
	match name:
		"wave":
			p["uL"] = Vector3(0.72, 0.5, 0.2)
			p["fL"] = Vector3(0.18 + 0.55 * sin(t * 9.0), 0.92, 0.25)
			p["lean"] = 2.0
			p["head"] = 6.0 * sin(t * 2.0)
			p["twist"] = -6.0
		"victory":
			var j := absf(sin(t * 5.0))
			p["uL"] = Vector3(0.45, 0.85, 0.1)
			p["fL"] = Vector3(0.3, 0.95, 0.1)
			p["uR"] = Vector3(0.45, 0.85, 0.1)
			p["fR"] = Vector3(0.3, 0.95, 0.1)
			p["crouch"] = -0.05 * j
			p["lean"] = -4.0
			p["head"] = -8.0
		"flex":
			p["uL"] = Vector3(0.95, 0.05, 0.1)
			p["fL"] = Vector3(0.2, 0.97, 0.15)
			p["uR"] = Vector3(0.95, 0.05, 0.1)
			p["fR"] = Vector3(0.2, 0.97, 0.15)
			p["crouch"] = 0.03
			p["lean"] = -2.0
		"peace":
			p["uL"] = Vector3(0.2, 0.15, 0.95)
			p["fL"] = Vector3(0.05, 0.9, 0.55)
			p["twist"] = 10.0
			p["head"] = 8.0
			p["lean"] = -3.0
		"bow":
			var k := clampf(sin(t * 1.5), 0.0, 1.0)
			p["lean"] = 6.0 + 24.0 * k
			p["head"] = 10.0 * k
			p["uL"] = Vector3(0.1, -0.97, 0.2)
			p["uR"] = Vector3(0.1, -0.97, 0.2)
	return p
