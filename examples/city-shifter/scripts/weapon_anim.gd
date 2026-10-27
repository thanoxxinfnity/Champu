class_name WeaponAnim
extends RefCounted
## How a weapon moves in the hand. Every style is a list of keys [time 0..1, grip position, weapon direction]; the frame is read between the keys
## (smooth, the direction turned on the sphere). Positions are in metres for a 1.75 m hero, x = the hero's right, y up, z = backwards (the hero faces -Z);
## they are scaled to the hero's height. The grip is where the right hand holds the weapon; the arms follow it by Avatar's two-bone solver,
## so the same keys fit every model. `two` = the left hand holds the weapon too.

const REST_POS := Vector3(0.34, 0.98, -0.3)
const REST_DIR := Vector3(0.0, -0.5, -1.0)

## style -> {dur: seconds, two: bool, keys: [[t, pos, dir], ...]}
const STYLES := {
	"shoot": {"dur": 0.5, "two": false, "keys": [
		[0.0, Vector3(0.26, 1.28, -0.5), Vector3(0.0, 0.0, -1.0)],
		[0.12, Vector3(0.26, 1.32, -0.34), Vector3(0.0, 0.2, -1.0)],
		[0.5, Vector3(0.26, 1.28, -0.5), Vector3(0.0, 0.02, -1.0)],
		[1.0, REST_POS, REST_DIR]]},
	"cannon": {"dur": 0.8, "two": true, "keys": [
		[0.0, Vector3(0.2, 1.2, -0.5), Vector3(0.0, 0.0, -1.0)],
		[0.1, Vector3(0.2, 1.26, -0.2), Vector3(0.0, 0.3, -1.0)],
		[0.45, Vector3(0.2, 1.2, -0.45), Vector3(0.0, 0.04, -1.0)],
		[1.0, REST_POS, REST_DIR]]},
	"overhead": {"dur": 0.7, "two": true, "keys": [
		[0.0, REST_POS, REST_DIR],
		[0.3, Vector3(0.42, 1.5, 0.12), Vector3(0.35, 0.75, 0.55)],
		[0.42, Vector3(0.38, 1.6, 0.2), Vector3(0.3, 0.8, 0.6)],
		[0.56, Vector3(0.12, 1.0, -0.62), Vector3(-0.1, -0.7, -0.7)],
		[0.74, Vector3(0.12, 0.98, -0.6), Vector3(-0.1, -0.65, -0.75)],
		[1.0, REST_POS, REST_DIR]]},
	"slash": {"dur": 0.45, "two": false, "keys": [
		[0.0, REST_POS, REST_DIR],
		[0.22, Vector3(0.5, 1.15, -0.1), Vector3(0.6, 0.35, 0.4)],
		[0.45, Vector3(0.12, 1.2, -0.62), Vector3(-0.15, 0.0, -1.0)],
		[0.62, Vector3(-0.36, 1.08, -0.5), Vector3(-0.9, -0.3, -0.35)],
		[1.0, REST_POS, REST_DIR]]},
	"thrust": {"dur": 0.6, "two": true, "keys": [
		[0.0, REST_POS, REST_DIR],
		[0.25, Vector3(0.3, 1.18, 0.1), Vector3(0.0, 0.03, -1.0)],
		[0.42, Vector3(0.26, 1.22, -0.8), Vector3(0.0, 0.0, -1.0)],
		[0.62, Vector3(0.26, 1.2, -0.72), Vector3(0.0, 0.0, -1.0)],
		[1.0, REST_POS, REST_DIR]]},
}


## The way a weapon is used.
static func style_of(id: String) -> String:
	match id:
		"hammer", "hammer_big", "axe", "quantum_breaker":
			return "overhead"
		"katana":
			return "slash"
		"spear":
			return "thrust"
		"genesis_cannon", "meteor_burster":
			return "cannon"
	return "shoot"


static func two_handed(id: String) -> bool:
	return bool(STYLES[style_of(id)].two)


static func duration(id: String) -> float:
	var d: float = STYLES[style_of(id)].dur
	if Data.MELEE.has(id):
		return clampf(float(Data.MELEE[id].cd) * 0.85, 0.35, 1.0)
	return d


## Grip position and weapon direction at time `t` seconds after the shot (a long time = at rest). The hero's height scales the metres.
static func frame(id: String, t: float, height: float) -> Dictionary:
	var st: Dictionary = STYLES[style_of(id)]
	var k := clampf(t / duration(id), 0.0, 1.0)
	var keys: Array = st.keys
	var pos: Vector3 = REST_POS
	var dir: Vector3 = REST_DIR
	if t < duration(id):
		var a: Array = keys[0]
		var b: Array = keys[keys.size() - 1]
		for i in keys.size() - 1:
			if k >= float(keys[i][0]) and k <= float(keys[i + 1][0]):
				a = keys[i]
				b = keys[i + 1]
				break
		var span := maxf(float(b[0]) - float(a[0]), 0.0001)
		var u := smoothstep(0.0, 1.0, clampf((k - float(a[0])) / span, 0.0, 1.0))
		pos = (a[1] as Vector3).lerp(b[1], u)
		dir = _turn(a[2], b[2], u)
	return {"pos": pos * (height / 1.75), "dir": dir.normalized()}


static func _turn(a: Vector3, b: Vector3, u: float) -> Vector3:
	var qa := Quaternion(Vector3(0, 0, -1), a.normalized())
	var qb := Quaternion(Vector3(0, 0, -1), b.normalized())
	return qa.slerp(qb, u) * Vector3(0, 0, -1)


## How far the grip sits behind the model's centre (the model is centred on itself), so the hand is on the handle or the pistol grip.
static func grip_back(id: String) -> float:
	var len := WeaponModels.held_length(id)
	match id:
		"hammer", "hammer_big", "axe", "quantum_breaker":
			return len * 0.36                     # at the end of the handle, the head far out
		"katana":
			return len * 0.33
		"spear":
			return len * 0.08
	return len * 0.14


## Weapon transform for the grip `pos` and direction `dir` (holder space), at hero-size `scale_k`; `pop` = the equip animation 0..1.
static func weapon_transform(id: String, pos: Vector3, dir: Vector3, roll_deg := 0.0) -> Transform3D:
	var up := Vector3.UP if absf(dir.y) < 0.97 else Vector3.RIGHT
	var b := Basis.looking_at(dir, up)
	if roll_deg != 0.0:
		b = b * Basis(Vector3(0, 0, -1), deg_to_rad(roll_deg))
	return Transform3D(b, pos - b * Vector3(0, 0, grip_back(id)))
