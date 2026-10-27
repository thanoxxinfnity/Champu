class_name CityDistrict
extends Node3D
## Downtown: a 3 x 3 grid of city blocks with streets between them (the middle block is a plaza with cherry trees and a torii), pastel anime towers with lit windows,
## shop fronts, neon signs, rooftop machinery, parked vehicles. The whole thing is a handful of meshes (one for every building, one for the streets, one for the
## neon) and one box collider per building, so it costs a few draw calls. Everything is built from a seed, the same on every phone.
## Every tower is destructible: it has health, it cracks and sheds its roof at two thirds, loses its upper half at one third and collapses into rubble at zero (hammers,
## axes and explosions call `damage_at`; `destroyed` tells Main to play the dust and the shards).

const BLOCK := 34.0
const STREET := 14.0
const N := 3
const PALETTE := [Color(0.98, 0.78, 0.84), Color(0.7, 0.87, 1.0), Color(1.0, 0.93, 0.7), Color(0.78, 0.95, 0.85), Color(0.85, 0.8, 1.0), Color(1.0, 0.82, 0.66),
	Color(0.76, 0.82, 0.92), Color(0.95, 0.72, 0.72)]
signal destroyed(at: Vector3, size: Vector3, color: Color, final: bool)
signal cleared(index: int)                # the footprint number `index` of `blocked` is free ground again

const TOWER_HP := 520.0
const NEON := [Color(1.0, 0.3, 0.6), Color(0.3, 0.9, 1.0), Color(1.0, 0.85, 0.25), Color(0.6, 1.0, 0.5), Color(0.75, 0.5, 1.0)]

var center := Vector2.ZERO
var rect := Rect2()
var blocked: Array = []                  # footprints of the buildings (Rect2 in x, z)
var car_slots: Array = []                # [Vector3 position, yaw] free places for parked vehicles
var plaza := Vector2.ZERO
var building_count := 0
var buildings: Array = []                # {rect, hp, max, tiers: [lower, upper], color, neon, alive, stage}
var tallest := 0.0
var _rng := RandomNumberGenerator.new()
var _pad := Arrs.new()
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
	_add_mesh(_pad, "res://shaders/city.gdshader")
	_slots()


class Arrs:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var i := PackedInt32Array()


func _arrays() -> Arrs:
	return Arrs.new()


func _quad(t: Arrs, a: Vector3, b: Vector3, c: Vector3, d: Vector3, nor: Vector3, color: Color) -> void:
	var k := t.v.size()
	t.v.append_array([a, b, c, d])
	for q in 4:
		t.n.append(nor)
		t.c.append(color)
	t.i.append_array([k, k + 2, k + 1, k, k + 3, k + 2])         # (Godot's front faces are clockwise)


## A box standing on `base` (centre of its bottom face): four walls and a roof.
func _box(t: Arrs, base: Vector3, size: Vector3, color: Color) -> void:
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
	_quad(t, p001, p101, q101, q001, Vector3(0, 0, 1), color)      # +z
	_quad(t, p100, p000, q000, q100, Vector3(0, 0, -1), color)     # -z
	_quad(t, p101, p100, q100, q101, Vector3(1, 0, 0), color)      # +x
	_quad(t, p000, p001, q001, q000, Vector3(-1, 0, 0), color)     # -x
	_quad(t, q001, q101, q100, q000, Vector3(0, 1, 0), color)      # roof


func _mesh_of(t: Arrs, shader_path := "res://shaders/city.gdshader", unshaded_vc := false) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = t.v
	arr[Mesh.ARRAY_NORMAL] = t.n
	arr[Mesh.ARRAY_COLOR] = t.c
	arr[Mesh.ARRAY_INDEX] = t.i
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	if unshaded_vc:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.vertex_color_use_as_albedo = true
		mi.material_override = m
	else:
		if _mat == null:
			_mat = ShaderMaterial.new()
			_mat.shader = load(shader_path) as Shader
		mi.material_override = _mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


var _mat: ShaderMaterial


func _add_mesh(t: Arrs, shader_path: String) -> void:
	var mi := _mesh_of(t, shader_path)
	mi.extra_cull_margin = 40.0
	add_child(mi)


## One solid box of a tower: its own mesh (so it can be removed alone) and its own collider.
func _tier(base: Vector3, size: Vector3, color: Color, props := false) -> Dictionary:
	var t := _arrays()
	_box(t, base, size, color)
	if props:
		_roof_props(t, Vector3(base.x, base.y + size.y, base.z), Vector2(size.x, size.z))
	var mi := _mesh_of(t)
	add_child(mi)
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
	return {"mi": mi, "body": body, "base": base, "size": size, "color": color, "alive": true}


func _block(o: Vector2, bx: int, bz: int) -> void:
	# the pavement pad
	_box(_pad, Vector3(o.x + BLOCK * 0.5, 0.0, o.y + BLOCK * 0.5), Vector3(BLOCK, 0.05, BLOCK), Color(0.86, 0.84, 0.86, 1.0))
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
	var tiers: Array = []
	var tiered := h > 30.0 and _rng.randf() < 0.75
	if tiered:
		var h1 := h * _rng.randf_range(0.5, 0.7)
		tiers.append(_tier(Vector3(cx, 0.05, cz), Vector3(sz.x, h1, sz.z), color))
		var s2 := _rng.randf_range(0.55, 0.78)
		var ox := _rng.randf_range(-0.12, 0.12) * sz.x
		var oz := _rng.randf_range(-0.12, 0.12) * sz.z
		var col2: Color = PALETTE[_rng.randi() % PALETTE.size()]
		tiers.append(_tier(Vector3(cx + ox, 0.05 + h1, cz + oz), Vector3(sz.x * s2, h - h1, sz.z * s2), Color(col2.r, col2.g, col2.b, _rng.randf() * 0.95), true))
	else:
		var h1b := h * 0.6                                      # one look, two parts: the top can come off first
		tiers.append(_tier(Vector3(cx, 0.05, cz), Vector3(sz.x, h1b, sz.z), color))
		tiers.append(_tier(Vector3(cx, 0.05 + h1b, cz), Vector3(sz.x, h - h1b, sz.z), color, true))
	blocked.append(Rect2(lot.position - Vector2(1, 1), lot.size + Vector2(2, 2)))
	tallest = maxf(tallest, h)
	building_count += 1
	var b := {"rect": lot, "hp": TOWER_HP + h * 6.0, "max": TOWER_HP + h * 6.0, "tiers": tiers, "color": color, "alive": true, "stage": 0, "blocked_index": blocked.size() - 1, "neon": null, "height": h}
	# a neon sign on a street-facing wall, some of the time (it belongs to the lower part and goes with it)
	if _rng.randf() < 0.6:
		var nt := _arrays()
		var side := _rng.randi() % 4
		var y := _rng.randf_range(5.0, 10.0)
		var nc: Color = NEON[_rng.randi() % NEON.size()]
		var sw := minf(lot.size.x, lot.size.y) * 0.5
		match side:
			0:
				_neon_quad(nt, Vector3(cx, y, lot.end.y + 0.08), Vector3(sw, 0, 0), Vector3(0, 1.6, 0), Vector3(0, 0, 1), nc)
			1:
				_neon_quad(nt, Vector3(cx, y, lot.position.y - 0.08), Vector3(-sw, 0, 0), Vector3(0, 1.6, 0), Vector3(0, 0, -1), nc)
			2:
				_neon_quad(nt, Vector3(lot.end.x + 0.08, y, cz), Vector3(0, 0, -sw), Vector3(0, 1.6, 0), Vector3(1, 0, 0), nc)
			_:
				_neon_quad(nt, Vector3(lot.position.x - 0.08, y, cz), Vector3(0, 0, sw), Vector3(0, 1.6, 0), Vector3(-1, 0, 0), nc)
		var nmi := _mesh_of(nt, "", true)
		add_child(nmi)
		b.neon = nmi
	buildings.append(b)


func _roof_props(t: Arrs, top: Vector3, foot: Vector2) -> void:
	var ac := Color(0.62, 0.64, 0.72, 0.5)
	for k in _rng.randi_range(1, 3):
		var p := Vector3(top.x + _rng.randf_range(-0.3, 0.3) * foot.x, top.y, top.z + _rng.randf_range(-0.3, 0.3) * foot.y)
		_box(t, p, Vector3(_rng.randf_range(1.6, 3.0), _rng.randf_range(1.0, 1.8), _rng.randf_range(1.6, 3.0)), ac)
	if _rng.randf() < 0.4:
		_box(t, Vector3(top.x, top.y, top.z), Vector3(0.25, _rng.randf_range(4.0, 8.0), 0.25), Color(0.5, 0.5, 0.6, 0.5))


func _neon_quad(t: Arrs, c: Vector3, along: Vector3, up: Vector3, nor: Vector3, col: Color) -> void:
	_quad(t, c - along - up * 0.5, c + along - up * 0.5, c + along + up * 0.5, c - along + up * 0.5, nor, col)


# ── destruction ──────────────────────────────────────────────────────────────

## Hurt every tower whose footprint is within `radius` of `at` (flat) and not above the hit. Returns how many were touched.
func damage_at(at: Vector3, radius: float, amount: float) -> int:
	var n := 0
	for bi in buildings.size():
		var b: Dictionary = buildings[bi]
		if not bool(b.alive):
			continue
		var r: Rect2 = b.rect
		var cx := clampf(at.x, r.position.x, r.end.x)
		var cz := clampf(at.z, r.position.y, r.end.y)
		if Vector2(at.x, at.z).distance_to(Vector2(cx, cz)) > radius or at.y > float(b.height) + 4.0:
			continue
		n += 1
		_hurt(bi, amount)
	return n


func _hurt(bi: int, amount: float) -> void:
	var b: Dictionary = buildings[bi]
	b.hp = float(b.hp) - amount
	var frac := float(b.hp) / float(b.max)
	var stage := 0 if frac > 0.66 else (1 if frac > 0.33 else (2 if frac > 0.0 else 3))
	var tiers: Array = b.tiers
	if stage >= 1 and int(b.stage) < 1:
		_drop_tier(b, tiers[1], false)             # the top half comes off
	if stage >= 3 and int(b.stage) < 3:
		_drop_tier(b, tiers[0], true)              # and then the rest
		b.alive = false
		(blocked as Array)[int(b.blocked_index)] = Rect2(-9999, -9999, 1, 1)
		cleared.emit(int(b.blocked_index))
		if b.neon != null:
			(b.neon as Node3D).queue_free()
		_rubble(b)
	b.stage = maxi(int(b.stage), stage)


func _drop_tier(b: Dictionary, t: Dictionary, final: bool) -> void:
	if not bool(t.alive):
		return
	t.alive = false
	(t.mi as Node3D).queue_free()
	(t.body as Node3D).queue_free()
	var sz: Vector3 = t.size
	var base: Vector3 = t.base
	destroyed.emit(base + Vector3(0, sz.y * 0.5, 0), sz, Color(b.color.r, b.color.g, b.color.b), final)


## What is left of a fallen tower: a low heap of broken slabs the colour of its walls.
func _rubble(b: Dictionary) -> void:
	var t := _arrays()
	var r: Rect2 = b.rect
	var col: Color = b.color
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.position.x * 7.0 + r.position.y * 13.0)
	for i in 14:
		var p := Vector3(r.position.x + rng.randf() * r.size.x, 0.05, r.position.y + rng.randf() * r.size.y)
		var s := Vector3(rng.randf_range(1.2, 3.4), rng.randf_range(0.3, 1.1), rng.randf_range(1.2, 3.4))
		_box(t, p, s, Color(col.r * 0.8, col.g * 0.8, col.b * 0.8, rng.randf() * 0.9))
	var mi := _mesh_of(t)
	add_child(mi)


func _plaza(o: Vector2) -> void:
	_box(_pad, Vector3(o.x + BLOCK * 0.5, 0.0, o.y + BLOCK * 0.5), Vector3(BLOCK, 0.05, BLOCK), Color(0.95, 0.86, 0.9, 1.0))
	# a pink ring and a cross of paving in the middle
	_box(_pad, Vector3(o.x + BLOCK * 0.5, 0.05, o.y + BLOCK * 0.5), Vector3(12, 0.04, 12), Color(1.0, 0.7, 0.8, 1.0))
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
