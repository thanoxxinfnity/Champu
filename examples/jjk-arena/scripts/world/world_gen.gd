class_name WorldGen
extends RefCounted
## The open-world layout, all pure functions of (x, z) so any chunk can be rebuilt at any time and always matches its neighbours.
## 5.6 km square: a flat downtown in the middle, mid-rise districts around it, suburbs, forest, a lake, and mountains closing the map.

const HALF := 2800.0              ## map is [-HALF, HALF] on both axes
const CELL := 96.0                ## city block pitch (block + road)
const ROAD := 16.0
const LAKE_C := Vector2(-1300.0, 1100.0)
const LAKE_R := 330.0

static var _hill := FastNoiseLite.new()
static var _ridge := FastNoiseLite.new()
static var _ready_noise := false

static func _init_noise() -> void:
	if _ready_noise:
		return
	_ready_noise = true
	_hill.seed = 11
	_hill.frequency = 0.0016
	_ridge.seed = 29
	_ridge.frequency = 0.0021
	_ridge.fractal_octaves = 4

static func radius(x: float, z: float) -> float:
	return Vector2(x, z).length()

static func height(x: float, z: float) -> float:
	_init_noise()
	var r := radius(x, z)
	var h := 0.0
	h += smoothstep(1300.0, 2300.0, r) * (_hill.get_noise_2d(x, z) * 0.5 + 0.5) * 38.0
	var m := smoothstep(2000.0, 2750.0, r)
	h += m * (60.0 + 420.0 * pow(absf(_ridge.get_noise_2d(x, z)), 0.8) * 2.0)
	var d := Vector2(x, z).distance_to(LAKE_C)
	return lerpf(h, -9.0, 1.0 - smoothstep(LAKE_R * 0.5, LAKE_R * 1.25, d))

static func in_city(x: float, z: float) -> bool:
	return radius(x, z) < 1750.0 and Vector2(x, z).distance_to(LAKE_C) > LAKE_R * 1.3

static func district(x: float, z: float) -> String:
	var r := radius(x, z)
	if r < 650.0:
		return "downtown"
	if r < 1250.0:
		return "midrise"
	if r < 1750.0:
		return "suburb"
	if r < 2300.0:
		return "forest"
	return "mountain"

## Deterministic 0..1 hash of two ints and a salt.
static func hash2(a: int, b: int, salt := 0) -> float:
	var h := a * 374761393 + b * 668265263 + salt * 2147483647
	h = (h ^ (h >> 13)) * 1274126177
	h = h ^ (h >> 16)
	return float(h & 0xFFFFFF) / float(0x1000000)

## Buildings of one block: Array of {pos: Vector3 (base centre), size: Vector3 (w, h, d), kind: int}.
static func block_buildings(bx: int, bz: int) -> Array:
	var out := []
	var cx := (bx + 0.5) * CELL
	var cz := (bz + 0.5) * CELL
	if not in_city(cx, cz) or absf(cx) > HALF - 200.0 or absf(cz) > HALF - 200.0:
		return out
	var dist := district(cx, cz)
	var inner := CELL - ROAD - 6.0
	var n := 1
	var hmin := 10.0
	var hmax := 24.0
	match dist:
		"downtown":
			n = 2 + int(hash2(bx, bz, 1) * 2.0)
			hmin = 45.0
			hmax = 190.0
		"midrise":
			n = 2 + int(hash2(bx, bz, 1) * 3.0)
			hmin = 18.0
			hmax = 60.0
		_:
			n = 2 + int(hash2(bx, bz, 1) * 3.0)
			hmin = 6.0
			hmax = 12.0
	if hash2(bx, bz, 9) < 0.12:
		return out                           # a park / empty lot
	var grid := 2 if n > 1 else 1
	for i in n:
		var gx := i % 2
		var gz := i / 2
		var w := inner / (2.0 if n > 1 else 1.0) - 4.0
		var px := cx - inner * 0.25 * (1.0 if n > 1 else 0.0) + gx * inner * 0.5 * (1.0 if n > 1 else 0.0)
		var pz := cz - inner * 0.25 * (1.0 if n > 2 else 0.0) + gz * inner * 0.5 * (1.0 if n > 2 else 0.0)
		var hh := lerpf(hmin, hmax, pow(hash2(bx * 7 + i, bz * 13 + i, 3), 1.6))
		out.append({"pos": Vector3(px, height(px, pz), pz), "size": Vector3(w * lerpf(0.7, 1.0, hash2(bx, bz, 20 + i)), hh, w * lerpf(0.7, 1.0, hash2(bx, bz, 40 + i))),
			"kind": int(hash2(bx, bz, 60 + i) * 4.0)})
	return out

## Tree positions inside one chunk rectangle (forest and suburb edges), deterministic.
static func chunk_trees(cx: int, cz: int, size: float, count: int) -> Array:
	var out := []
	for i in count:
		var x := (cx + hash2(cx, cz, 100 + i)) * size
		var z := (cz + hash2(cx, cz, 300 + i)) * size
		var d := district(x, z)
		var chance := 0.0
		match d:
			"suburb": chance = 0.25
			"forest": chance = 0.95
			"mountain": chance = 0.35
			"midrise": chance = 0.04
		if hash2(cx * 31 + i, cz * 17 + i, 5) > chance:
			continue
		var h := height(x, z)
		if h < -2.0 or h > 240.0 or Vector2(x, z).distance_to(LAKE_C) < LAKE_R * 1.1:
			continue
		out.append(Vector3(x, h, z))
	return out
