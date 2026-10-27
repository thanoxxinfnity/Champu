class_name CityDistrict
extends Node3D
## Downtown: a 3 x 3 grid of city blocks with streets between them (the middle block is a plaza with cherry trees and a torii), pastel anime towers with lit windows,
## shop fronts, neon signs, rooftop machinery, parked vehicles. The whole thing is a handful of meshes (one for every building, one for the streets, one for the
## neon) and one box collider per building, so it costs a few draw calls. Everything is built from a seed, the same on every phone.

const BLOCK := 34.0
const STREET := 14.0
const N := 3
const PALETTE := [Color(0.98, 0.78, 0.84), Color(0.7, 0.87, 1.0), Color(1.0, 0.93, 0.7), Color(0.78, 0.95, 0.85), Color(0.85, 0.8, 1.0), Color(1.0, 0.82, 0.66),
	Color(0.76, 0.82, 0.92), Color(0.95, 0.72, 0.72)]
const NEON := [Color(1.0, 0.3, 0.6), Color(0.3, 0.9, 1.0), Color(1.0, 0.85, 0.25), Color(0.6, 1.0, 0.5), Color(0.75, 0.5, 1.0)]

var center := Vector2.ZERO
var rect := Rect2()
var blocked: Array = []                  # footprints of the buildings (Rect2 in x, z)
var car_slots: Array = []                # [Vector3 position, yaw] free places for parked vehicles
var plaza := Vector2.ZERO
var building_count := 0
var tallest := 0.0
var _rng := RandomNumberGenerator.new()
var _v := PackedVector3Array()
var _n := PackedVector3Array()
var _c := PackedColorArray()
var _i := PackedInt32Array()
var _nv := PackedVector3Array()
var _nn := PackedVector3Array()
var _nc := PackedColorArray()
var _ni := PackedInt32Array()


static func extent() -> float:
	return float(N) * BLOCK + float(N + 1) * STREET


func build(c: Vector2, seed_v := 31) -> void:
	center = c
	_rng.seed = seed_v
	var ext := extent()
	rect = Rect2(c - Vector2(ext, ext) * 0.5, Vector2(ext, ext))
	var x0 := rect.position.x
	var z0 := rect.position.y
	for bx in N:
		for bz in N:
			var o := Vector2(x0 + STREET + float(bx) * (BLOCK + STREET), z0 + STREET + float(bz) * (BLOCK + STREET))
			if bx == 1 and bz == 1:
				_plaza(o)
			else:
				_block(o, bx, bz)
	_streets()
	_add_mesh(_v, _n, _c, _i, "res://shaders/city.gdshader")
	_add_neon()
	_slots()


func _quad(v: PackedVector3Array, n: PackedVector3Array, col: PackedColorArray, idx: PackedInt32Array, a: Vector3, b: Vector3, c: Vector3, d: Vector3, nor: Vector3, color: Color) -> void:
	var k := v.size()
	v.append_array([a, b, c, d])
	for q in 4:
		n.append(nor)
		col.append(color)
	idx.append_array([k, k + 2, k + 1, k, k + 3, k + 2])         # (Godot's front faces are clockwise)


## A box standing on `base` (centre of its bottom face): four walls and a roof.
func _box(base: Vector3, size: Vector3, color: Color) -> void:
	var hx := size.x * 0.5
	var hz := size.z * 0.5
	var y1 := base.y + size.y
	var p000 := Vector3(base.x - hx, base.y, base.z - hz)
	var p100 := Vector3(base.x + hx, base.y, base.z - hz)
	var p101 := Vector3(base.x + hx, base.y, base.z + hz)
	var p001 := Vector3(base.x - hx, base.y, base.z + hz)
	var q000 := Vector3(p000.x, y1, p000.z)
	var q100 := Vector3(p100.x, y1, p100.z)
	var q101 := Vector3(p101.x, y1, p101.z)
	var q001 := Vector3(p001.x, y1, p001.z)
	_quad(_v, _n, _c, _i, p001, p101, q101, q001, Vector3(0, 0, 1), color)      # +z
	_quad(_v, _n, _c, _i, p100, p000, q000, q100, Vector3(0, 0, -1), color)     # -z
	_quad(_v, _n, _c, _i, p101, p100, q100, q101, Vector3(1, 0, 0), color)      # +x
	_quad(_v, _n, _c, _i, p000, p001, q001, q000, Vector3(-1, 0, 0), color)     # -x
	_quad(_v, _n, _c, _i, q001, q101, q100, q000, Vector3(0, 1, 0), color)      # roof


func _collider(base: Vector3, size: Vector3) -> void:
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	body.position = base + Vector3(0, size.y * 0.5, 0)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	body.add_child(cs)
	add_child(body)


func _block(o: Vector2, bx: int, bz: int) -> void:
	# the pavement pad
	_box(Vector3(o.x + BLOCK * 0.5, 0.0, o.y + BLOCK * 0.5), Vector3(BLOCK, 0.05, BLOCK), Color(0.86, 0.84, 0.86, 1.0))
	var mid := Vector2(float(N - 1) * 0.5, float(N - 1) * 0.5)
	var dist := Vector2(float(bx), float(bz)).distance_to(mid)
	var split := _rng.randi_range(0, 2)                        # 0 = one big tower, 1 = two, 2 = four
	var lots: Array = []
	var pad := 2.2
	match split:
		0:
			lots.append(Rect2(o + Vector2(pad, pad), Vector2(BLOCK - pad * 2.0, BLOCK - pad * 2.0)))
		1:
			var vertical := _rng.randf() < 0.5
			for k in 2:
				if vertical:
					lots.append(Rect2(o + Vector2(pad + float(k) * BLOCK * 0.5, pad), Vector2(BLOCK * 0.5 - pad * 1.5, BLOCK - pad * 2.0)))
				else:
					lots.append(Rect2(o + Vector2(pad, pad + float(k) * BLOCK * 0.5), Vector2(BLOCK - pad * 2.0, BLOCK * 0.5 - pad * 1.5)))
		_:
			for kx in 2:
				for kz in 2:
					lots.append(Rect2(o + Vector2(pad + float(kx) * BLOCK * 0.5, pad + float(kz) * BLOCK * 0.5), Vector2(BLOCK * 0.5 - pad * 1.5, BLOCK * 0.5 - pad * 1.5)))
	for l in lots:
		var lot: Rect2 = l
		var h := _rng.randf_range(16.0, 36.0) + (1.0 - dist / 1.5) * _rng.randf_range(8.0, 44.0)
		_building(lot, h)


func _building(lot: Rect2, h: float) -> void:
	var col: Color = PALETTE[_rng.randi() % PALETTE.size()]
	var seed_a := _rng.randf() * 0.95
	var color := Color(col.r, col.g, col.b, seed_a)
	var cx := lot.get_center().x
	var cz := lot.get_center().y
	var sz := Vector3(lot.size.x, h, lot.size.y)
	var tiered := h > 30.0 and _rng.randf() < 0.75
	if tiered:
		var h1 := h * _rng.randf_range(0.5, 0.7)
		_box(Vector3(cx, 0.05, cz), Vector3(sz.x, h1, sz.z), color)
		_collider(Vector3(cx, 0.05, cz), Vector3(sz.x, h1, sz.z))
		var s2 := _rng.randf_range(0.55, 0.78)
		var ox := _rng.randf_range(-0.12, 0.12) * sz.x
		var oz := _rng.randf_range(-0.12, 0.12) * sz.z
		var up := Vector3(sz.x * s2, h - h1, sz.z * s2)
		var col2: Color = PALETTE[_rng.randi() % PALETTE.size()]
		_box(Vector3(cx + ox, 0.05 + h1, cz + oz), up, Color(col2.r, col2.g, col2.b, _rng.randf() * 0.95))
		_collider(Vector3(cx + ox, 0.05 + h1, cz + oz), up)
		_roof_props(Vector3(cx + ox, 0.05 + h, cz + oz), Vector2(up.x, up.z))
	else:
		_box(Vector3(cx, 0.05, cz), sz, color)
		_collider(Vector3(cx, 0.05, cz), sz)
		_roof_props(Vector3(cx, 0.05 + h, cz), Vector2(sz.x, sz.z))
	blocked.append(Rect2(lot.position - Vector2(1, 1), lot.size + Vector2(2, 2)))
	tallest = maxf(tallest, h)
	building_count += 1
	# a neon sign on a street-facing wall, some of the time
	if _rng.randf() < 0.6:
		var side := _rng.randi() % 4
		var y := _rng.randf_range(5.0, 10.0)
		var nc: Color = NEON[_rng.randi() % NEON.size()]
		var sw := minf(lot.size.x, lot.size.y) * 0.5
		match side:
			0:
				_neon_quad(Vector3(cx, y, lot.end.y + 0.08), Vector3(sw, 0, 0), Vector3(0, 1.6, 0), Vector3(0, 0, 1), nc)
			1:
				_neon_quad(Vector3(cx, y, lot.position.y - 0.08), Vector3(-sw, 0, 0), Vector3(0, 1.6, 0), Vector3(0, 0, -1), nc)
			2:
				_neon_quad(Vector3(lot.end.x + 0.08, y, cz), Vector3(0, 0, -sw), Vector3(0, 1.6, 0), Vector3(1, 0, 0), nc)
			_:
				_neon_quad(Vector3(lot.position.x - 0.08, y, cz), Vector3(0, 0, sw), Vector3(0, 1.6, 0), Vector3(-1, 0, 0), nc)


func _roof_props(top: Vector3, foot: Vector2) -> void:
	var ac := Color(0.62, 0.64, 0.72, 0.5)
	for k in _rng.randi_range(1, 3):
		var p := Vector3(top.x + _rng.randf_range(-0.3, 0.3) * foot.x, top.y, top.z + _rng.randf_range(-0.3, 0.3) * foot.y)
		_box(p, Vector3(_rng.randf_range(1.6, 3.0), _rng.randf_range(1.0, 1.8), _rng.randf_range(1.6, 3.0)), ac)
	if _rng.randf() < 0.4:
		_box(Vector3(top.x, top.y, top.z), Vector3(0.25, _rng.randf_range(4.0, 8.0), 0.25), Color(0.5, 0.5, 0.6, 0.5))


func _neon_quad(c: Vector3, along: Vector3, up: Vector3, nor: Vector3, col: Color) -> void:
	_quad(_nv, _nn, _nc, _ni, c - along - up * 0.5, c + along - up * 0.5, c + along + up * 0.5, c - along + up * 0.5, nor, col)


func _plaza(o: Vector2) -> void:
	_box(Vector3(o.x + BLOCK * 0.5, 0.0, o.y + BLOCK * 0.5), Vector3(BLOCK, 0.05, BLOCK), Color(0.95, 0.86, 0.9, 1.0))
	# a pink ring and a cross of paving in the middle
	_box(Vector3(o.x + BLOCK * 0.5, 0.05, o.y + BLOCK * 0.5), Vector3(12, 0.04, 12), Color(1.0, 0.7, 0.8, 1.0))
	plaza = o + Vector2(BLOCK, BLOCK) * 0.5


func _streets() -> void:
	var sv := PackedVector3Array()
	var sn := PackedVector3Array()
	var sc := PackedColorArray()
	var si := PackedInt32Array()
	var sl := PackedVector2Array()
	var ext := extent()
	for k in N + 1:
		var off := STREET * 0.5 + float(k) * (BLOCK + STREET)
		# along z (a street at x = const)
		_street_quad(sv, sn, sc, si, sl, Vector3(rect.position.x + off, 0.035, rect.position.y), Vector3(rect.position.x + off, 0.035, rect.end.y), Vector3(1, 0, 0), STREET)
		# along x (z = const)
		_street_quad(sv, sn, sc, si, sl, Vector3(rect.position.x, 0.03, rect.position.y + off), Vector3(rect.end.x, 0.03, rect.position.y + off), Vector3(0, 0, 1), STREET)
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = sv
	arr[Mesh.ARRAY_NORMAL] = sn
	arr[Mesh.ARRAY_TEX_UV] = sl
	arr[Mesh.ARRAY_INDEX] = si
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/road.gdshader") as Shader
	mi.material_override = sm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func _street_quad(v: PackedVector3Array, n: PackedVector3Array, _c2: PackedColorArray, idx: PackedInt32Array, uv: PackedVector2Array, a: Vector3, b: Vector3, across: Vector3, width: float) -> void:
	var half := across * width * 0.5
	var k := v.size()
	var len := a.distance_to(b)
	v.append_array([a - half, a + half, b + half, b - half])
	for q in 4:
		n.append(Vector3.UP)
	uv.append_array([Vector2(0, 0), Vector2(1, 0), Vector2(1, len / 8.0), Vector2(0, len / 8.0)])
	# wind so that the face looks up
	if (b - a).cross(across).y > 0.0:
		idx.append_array([k, k + 1, k + 2, k, k + 2, k + 3])
	else:
		idx.append_array([k, k + 2, k + 1, k, k + 3, k + 2])


func _add_mesh(v: PackedVector3Array, n: PackedVector3Array, c: PackedColorArray, idx: PackedInt32Array, shader_path: String) -> void:
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_COLOR] = c
	arr[Mesh.ARRAY_INDEX] = idx
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = Vector3.ZERO
	var sm := ShaderMaterial.new()
	sm.shader = load(shader_path) as Shader
	mi.material_override = sm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 40.0
	add_child(mi)


func _add_neon() -> void:
	if _nv.is_empty():
		return
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = _nv
	arr[Mesh.ARRAY_NORMAL] = _nn
	arr[Mesh.ARRAY_COLOR] = _nc
	arr[Mesh.ARRAY_INDEX] = _ni
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## Parked vehicles: kerbside, in the middle of every block's length of every street (never in a crossing).
func _slots() -> void:
	var x0 := rect.position.x
	var z0 := rect.position.y
	for k in N + 1:
		var off := STREET * 0.5 + float(k) * (BLOCK + STREET)
		for m in N:
			var t := STREET + float(m) * (BLOCK + STREET) + BLOCK * 0.5
			car_slots.append([Vector3(x0 + off + 2.8, 0.0, z0 + t), PI])            # a street along z, on its right-hand side
			car_slots.append([Vector3(x0 + t, 0.0, z0 + off + 2.8), PI * 0.5])      # a street along x
