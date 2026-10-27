class_name WeaponModels
extends RefCounted
## The 15 gauntlet weapons as small models built from boxes and cylinders (a few dozen triangles each: they are held in the hand of a phone-sized character).
## A part is [kind, position, size, glow?]: kind "b" = box (size = x,y,z), "c" = cylinder along Z (size = radius, length, unused), "r" = ring (cylinder along Z, flat).
## "glow" parts take the weapon's colour and light up; the others are steel greys. Every model points down -Z with its grip at the origin.

## How long each weapon is in the hand, metres (the real models are all different sizes; they are fitted to this).
const HELD := {"shift_gauntlet": 0.7, "vortex_blaster": 0.9, "quantum_breaker": 1.2, "gravity_carver": 1.0, "plasma_magnet": 0.45, "sonic_impactor": 1.5, "force_gauntlet": 0.6,
	"seismic_rebounder": 1.0, "saber_grapple": 1.0, "orbital_crush": 0.95, "tactical_beamer": 1.3, "thermo_vaporizer": 0.9, "chrono_sliders": 0.6, "nexus_tether": 0.4,
	"meteor_burster": 1.1}

const STEEL := Color(0.45, 0.5, 0.6)
const DARK := Color(0.16, 0.18, 0.24)

const PARTS := {
	"shift_gauntlet": [["b", Vector3(0, 0, -0.15), Vector3(0.22, 0.2, 0.34), 0], ["r", Vector3(0, 0, -0.42), Vector3(0.17, 0.05, 0), 1], ["r", Vector3(0, 0, -0.52), Vector3(0.14, 0.05, 0), 1], ["r", Vector3(0, 0, -0.62), Vector3(0.11, 0.05, 0), 1]],
	"vortex_blaster": [["b", Vector3(0, 0, 0.0), Vector3(0.16, 0.2, 0.4), 0], ["c", Vector3(0, 0, -0.4), Vector3(0.13, 0.5, 0), 2], ["r", Vector3(0, 0, -0.62), Vector3(0.19, 0.06, 0), 1], ["r", Vector3(0, 0, -0.4), Vector3(0.19, 0.06, 0), 1]],
	"quantum_breaker": [["c", Vector3(0, 0, 0.1), Vector3(0.04, 0.9, 0), 2], ["b", Vector3(0, 0, -0.45), Vector3(0.3, 0.3, 0.42), 1], ["b", Vector3(0, 0.0, -0.45), Vector3(0.36, 0.14, 0.34), 0]],
	"gravity_carver": [["b", Vector3(0, 0, 0.05), Vector3(0.12, 0.18, 0.6), 0], ["c", Vector3(0, 0.03, -0.55), Vector3(0.04, 0.7, 0), 2], ["b", Vector3(0, 0.12, -0.15), Vector3(0.1, 0.06, 0.3), 1], ["b", Vector3(0, -0.12, 0.2), Vector3(0.1, 0.1, 0.16), 2]],
	"plasma_magnet": [["b", Vector3(0, -0.04, 0.05), Vector3(0.14, 0.24, 0.3), 0], ["r", Vector3(0, 0.02, -0.3), Vector3(0.24, 0.08, 0), 2], ["r", Vector3(0, 0.02, -0.36), Vector3(0.16, 0.06, 0), 1]],
	"sonic_impactor": [["b", Vector3(0, 0, 0.0), Vector3(0.18, 0.2, 0.3), 0], ["c", Vector3(0, 0, -0.5), Vector3(0.06, 0.7, 0), 1], ["r", Vector3(0, 0, -0.35), Vector3(0.16, 0.05, 0), 1], ["r", Vector3(0, 0, -0.55), Vector3(0.13, 0.05, 0), 1], ["r", Vector3(0, 0, -0.75), Vector3(0.1, 0.05, 0), 1]],
	"force_gauntlet": [["b", Vector3(0, 0, -0.2), Vector3(0.3, 0.26, 0.4), 0], ["b", Vector3(0, 0.15, -0.3), Vector3(0.05, 0.1, 0.16), 1], ["b", Vector3(-0.1, 0.15, -0.3), Vector3(0.05, 0.1, 0.16), 1], ["b", Vector3(0.1, 0.15, -0.3), Vector3(0.05, 0.1, 0.16), 1]],
	"seismic_rebounder": [["c", Vector3(0, 0, 0.05), Vector3(0.03, 0.8, 0), 2], ["r", Vector3(0, 0, -0.5), Vector3(0.26, 0.12, 0), 0], ["r", Vector3(0, 0, -0.5), Vector3(0.14, 0.14, 0), 1]],
	"saber_grapple": [["b", Vector3(0, 0, 0.0), Vector3(0.14, 0.18, 0.3), 0], ["c", Vector3(0, 0, -0.4), Vector3(0.03, 0.6, 0), 1], ["b", Vector3(0.06, 0.0, -0.74), Vector3(0.14, 0.04, 0.1), 2], ["b", Vector3(-0.06, 0.0, -0.74), Vector3(0.14, 0.04, 0.1), 2]],
	"orbital_crush": [["b", Vector3(0, 0, 0.05), Vector3(0.18, 0.2, 0.5), 0], ["c", Vector3(0, 0.05, -0.45), Vector3(0.1, 0.4, 0), 2], ["r", Vector3(0, 0.05, -0.65), Vector3(0.2, 0.06, 0), 1]],
	"tactical_beamer": [["b", Vector3(0, 0, 0.1), Vector3(0.1, 0.16, 0.5), 0], ["c", Vector3(0, 0, -0.55), Vector3(0.035, 0.9, 0), 1], ["b", Vector3(0, 0.12, -0.05), Vector3(0.06, 0.08, 0.28), 2]],
	"thermo_vaporizer": [["b", Vector3(0, 0, 0.0), Vector3(0.18, 0.22, 0.46), 0], ["b", Vector3(0, 0, -0.35), Vector3(0.2, 0.16, 0.22), 1], ["c", Vector3(0, 0, -0.55), Vector3(0.1, 0.2, 0), 2]],
	"chrono_sliders": [["b", Vector3(-0.1, 0, -0.1), Vector3(0.12, 0.14, 0.5), 0], ["b", Vector3(0.1, 0, -0.1), Vector3(0.12, 0.14, 0.5), 0], ["b", Vector3(-0.1, 0, -0.38), Vector3(0.08, 0.08, 0.1), 1], ["b", Vector3(0.1, 0, -0.38), Vector3(0.08, 0.08, 0.1), 1]],
	"nexus_tether": [["b", Vector3(0, 0, 0.0), Vector3(0.12, 0.18, 0.4), 0], ["c", Vector3(0, 0, -0.38), Vector3(0.025, 0.5, 0), 1], ["b", Vector3(0.08, 0.0, -0.6), Vector3(0.1, 0.03, 0.1), 1], ["b", Vector3(-0.08, 0.0, -0.6), Vector3(0.1, 0.03, 0.1), 1]],
	"meteor_burster": [["b", Vector3(0, 0, 0.0), Vector3(0.26, 0.28, 0.6), 0], ["c", Vector3(0, 0, -0.55), Vector3(0.17, 0.5, 0), 2], ["r", Vector3(0, 0, -0.8), Vector3(0.21, 0.06, 0), 1], ["b", Vector3(0, 0.2, 0.0), Vector3(0.1, 0.12, 0.3), 1]],
}


## A held model of the weapon. `scale` 1.0 is hand size.
static func held_length(id: String) -> float:
	if Data.MELEE.has(id):
		return float(Data.MELEE[id].len)
	return float(HELD.get(id, 0.8))


static func build(id: String, scale := 1.0) -> Node3D:
	var path := "res://assets/weapons/%s.glb" % id
	if ModelKit.exists(path):
		var real := ModelKit.fitted(path, held_length(id), "center")
		real.name = "Weapon_" + id
		real.scale = Vector3.ONE * scale
		real.set_meta("real", true)
		return real
	var root := Node3D.new()
	root.name = "Weapon_" + id
	if Data.MELEE.has(id):                       # (no model yet: a plain bar with a head)
		Mat.box(root, Vector3(0, 0, -0.3), Vector3(0.06, 0.06, 0.9), Mat.flat(Color(0.5, 0.35, 0.2)))
		Mat.box(root, Vector3(0, 0, -0.75), Vector3(0.3, 0.2, 0.3), Mat.flat(Data.MELEE[id].color))
		root.scale = Vector3.ONE * scale
		return root
	var color: Color = Data.WEAPONS[id].color
	for part in PARTS.get(id, PARTS["shift_gauntlet"]):
		var kind: String = part[0]
		var pos: Vector3 = part[1]
		var size: Vector3 = part[2]
		var mat_i: int = part[3]
		var m: Material = Mat.flat(STEEL) if mat_i == 0 else (Mat.flat(color, 1.4) if mat_i == 1 else Mat.flat(DARK))
		var mi := MeshInstance3D.new()
		if kind == "b":
			mi.mesh = Mat.box_mesh(size)
		else:
			var cm := CylinderMesh.new()
			cm.top_radius = size.x
			cm.bottom_radius = size.x
			cm.height = size.y
			cm.radial_segments = 10
			cm.rings = 1
			mi.mesh = cm
			mi.rotation_degrees = Vector3(90, 0, 0)
		mi.material_override = m
		mi.position = pos
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
	root.scale = Vector3.ONE * scale
	return root


## The muzzle: where beams and shots start, in the model's own space.
static func muzzle(id: String) -> Vector3:
	if ModelKit.exists("res://assets/weapons/%s.glb" % id) or Data.MELEE.has(id):
		return Vector3(0, 0, -held_length(id) * 0.5)
	var z := 0.0
	for part in PARTS.get(id, PARTS["shift_gauntlet"]):
		var pos: Vector3 = part[1]
		var size: Vector3 = part[2]
		var front: float = pos.z - (size.z * 0.5 if part[0] == "b" else (size.y * 0.5 if part[0] == "c" else 0.03))
		z = minf(z, front)
	return Vector3(0, 0, z)
