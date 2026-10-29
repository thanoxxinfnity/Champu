class_name House
extends Node3D
## A house you can walk into (Free Fire style): one or two storeys, a door with a frame and an open leaf, windows with frames and glass, a stair inside,
## furnished rooms (kitchen, dining table, sofa and TV, bedroom, desk, shelves, lamps, pictures), a flat roof you can stand on with a water tank and
## an air-conditioner, and loot spots on tables and beds. Built from boxes in code and merged per material, so a house is a handful of draw calls;
## it is closed and solid with no holes, and every collider belongs to ONE static body.
## Local frame: origin at the middle of the ground floor, the door in the +Z wall.

const WALL := 0.25
const STOREY := 3.2
const PALETTES := [
	{"wall": Color(0.93, 0.89, 0.8), "trim": Color(0.62, 0.36, 0.28), "roof": Color(0.5, 0.52, 0.56), "tex": "plaster", "inner": Color(0.84, 0.9, 0.86), "wood": Color(0.62, 0.45, 0.3)},
	{"wall": Color(0.8, 0.52, 0.42), "trim": Color(0.3, 0.4, 0.52), "roof": Color(0.56, 0.5, 0.44), "tex": "brick", "inner": Color(0.93, 0.88, 0.78), "wood": Color(0.5, 0.36, 0.26)},
	{"wall": Color(0.95, 0.85, 0.7), "trim": Color(0.45, 0.3, 0.22), "roof": Color(0.58, 0.58, 0.6), "tex": "plaster", "inner": Color(0.8, 0.86, 0.93), "wood": Color(0.68, 0.52, 0.34)},
	{"wall": Color(0.72, 0.46, 0.38), "trim": Color(0.36, 0.46, 0.32), "roof": Color(0.52, 0.48, 0.44), "tex": "brick", "inner": Color(0.9, 0.82, 0.7), "wood": Color(0.45, 0.33, 0.24)},
]
const FACES := [
	[Vector3(0, 0, 1), Vector3(1, 0, 0), Vector3(0, 1, 0)],
	[Vector3(0, 0, -1), Vector3(-1, 0, 0), Vector3(0, 1, 0)],
	[Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0)],
	[Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 1, 0)],
	[Vector3(0, 1, 0), Vector3(1, 0, 0), Vector3(0, 0, -1)],
	[Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(0, 0, 1)],
]

var size := Vector2(10, 8)          # outer width (x) and depth (z)
var floors := 2
var loot_spots: Array[Vector3] = []  # house-local positions inside: on tables and beds
static var _mats := {}
static var _texs := {}

var _surf := {}                      # Material -> Batch: every box, merged per material


class Batch:
	extends RefCounted
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var i := PackedInt32Array()

var _phys: StaticBody3D
var _xf := Transform3D.IDENTITY      # the frame furniture is built in (origin on the floor, +Z the front of the piece)
var _pal: Dictionary
var _wall_out: Material
var _wall_in: Material
var _trim: Material
var _wood: Material
var _roof_m: Material


## A tiling texture drawn once: "plaster" (soft noise), "brick" (courses with mortar), "wood" (planks), all light so the albedo colour tints them.
static func _tex(kind: String) -> Texture2D:
	if _texs.has(kind):
		return _texs[kind]
	var n := 128
	var img := Image.create(n, n, false, Image.FORMAT_RGB8)
	var fn := FastNoiseLite.new()
	fn.frequency = 0.09
	fn.seed = 11 + kind.length()
	for y in n:
		for x in n:
			var g := 0.9 + 0.1 * (fn.get_noise_2d(x, y) * 0.5 + 0.5)
			match kind:
				"brick":
					var row := y / 16
					var bx := (x + (8 if row % 2 == 1 else 0)) % 32
					if y % 16 < 2 or bx < 2:
						g = 0.66
					else:
						g *= 0.94 + 0.06 * float((row * 7 + (x + (8 if row % 2 == 1 else 0)) / 32 * 5) % 4) / 3.0
				"wood":
					if x % 32 < 2:
						g = 0.7
					else:
						g *= 0.92 + 0.08 * sin(float(y) * 0.5 + float(x / 32) * 3.0)
			img.set_pixel(x, y, Color(g, g, g))
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_texs[kind] = t
	return t


static func _mat(c: Color, tex := "", scale := 0.5, glow := 0.0, alpha := 1.0) -> StandardMaterial3D:
	var k := "%s/%s/%s/%s/%s" % [c.to_html(), tex, scale, glow, alpha]
	if not _mats.has(k):
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(c.r, c.g, c.b, alpha)
		if tex != "":
			m.albedo_texture = _tex(tex)
			m.uv1_scale = Vector3(scale, scale, 1.0)
			m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		m.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
		m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		m.roughness = 1.0
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = c
			m.emission_energy_multiplier = glow
		if alpha < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		_mats[k] = m
	return _mats[k]


## Build it. `style` picks the colours (walls, roof trim, floor).
func build(w: float, d: float, n_floors: int, style: int) -> House:
	size = Vector2(w, d)
	floors = n_floors
	_pal = PALETTES[style % PALETTES.size()]
	_wall_out = _mat(_pal.wall, _pal.tex, 0.5)
	_wall_in = _mat(_pal.inner, "plaster", 0.5)
	_trim = _mat(_pal.trim, "plaster", 0.5)
	_wood = _mat(_pal.wood, "wood", 0.5)
	_roof_m = _mat(_pal.roof, "plaster", 0.4)
	_phys = StaticBody3D.new()
	_phys.collision_layer = 1
	_phys.collision_mask = 0
	add_child(_phys)
	var hw := w * 0.5
	var hd := d * 0.5
	var top := STOREY * floors
	var sx0 := -hw + WALL
	var sx1 := sx0 + 1.4
	var z_front := hd - WALL - 0.6
	var z_back := -hd + WALL + 1.3
	var ceil_m := _mat(Color(0.95, 0.94, 0.9), "plaster", 0.5)
	# foundation with a plinth band, corner posts and a door canopy: what makes it a building and not a box
	_slab(Vector3(0, 0.1, 0), Vector3(w + 0.3, 0.2, d + 0.3), _wood, _roof_m)
	for sz in [-1.0, 1.0]:
		_vis(Vector3(0, 0.45, sz * (hd + 0.04)), Vector3(w + 0.12, 0.5, 0.1), _roof_m)
		_vis(Vector3(sz * (hw + 0.04), 0.45, 0), Vector3(0.1, 0.5, d + 0.12), _roof_m)
	for cx in [-1.0, 1.0]:
		for cz in [-1.0, 1.0]:
			_vis(Vector3(cx * (hw + 0.02), top * 0.5 + 0.2, cz * (hd + 0.02)), Vector3(0.34, top + 0.1, 0.34), _trim)
	# storey slabs: wooden floor on top, white ceiling underneath; the stair strip is left open except the landing at the back
	for f in range(1, floors + 1):
		var y := STOREY * f + 0.1
		var roof := f == floors
		var over := 0.2 if roof else 0.0
		var top_m: Material = _roof_m if roof else _wood
		_slab(Vector3((sx1 + hw + over) * 0.5, y, 0), Vector3(hw + over - sx1, 0.22, d - WALL * 2 + over * 2), top_m, ceil_m)
		_slab(Vector3((sx0 + sx1) * 0.5, y, (-hd + WALL + z_back) * 0.5), Vector3(sx1 - sx0, 0.22, z_back + hd - WALL), top_m, ceil_m)
		if roof:
			_slab(Vector3((-hw - over + sx0) * 0.5, y, 0), Vector3(sx0 + hw + over, 0.22, d + over * 2), top_m, ceil_m)
	for s in [-1.0, 1.0]:                                                                      # roof parapet
		_box(Vector3(0, top + 0.55, s * (hd + 0.1)), Vector3(w + 0.4, 0.7, 0.18), _trim)
		_box(Vector3(s * (hw + 0.1), top + 0.55, 0), Vector3(0.18, 0.7, d + 0.4), _trim)
	for f in floors:
		var y0 := STOREY * f + 0.21
		var rise := STOREY
		var run := z_front - z_back
		# the steps are only looks; the collider is one smooth ramp under them (a character body does not climb steps)
		var steps := 12
		for i in steps:
			var t := (float(i) + 0.5) / float(steps)
			_vis(Vector3((sx0 + sx1) * 0.5, y0 + rise * t - 0.1, z_front - run * t), Vector3(sx1 - sx0 - 0.05, 0.2, run / steps + 0.02), _wood)
		# (the ramp ends 14 cm above the landing: a capsule meeting the slab's edge at floor level would take it for a wall; it steps down onto the landing instead)
		var rise2 := rise + 0.14
		_ramp(Vector3((sx0 + sx1) * 0.5, y0 + rise2 * 0.5 - 0.12, (z_front + z_back) * 0.5), Vector3(sx1 - sx0, 0.1, sqrt(rise2 * rise2 + run * run)), atan2(rise2, run))
		# a railing along the open side of the flight
		_vis(Vector3(sx1 - 0.04, y0 + rise * 0.5 + 0.5, (z_front + z_back) * 0.5), Vector3(0.06, 0.06, run + 0.1), _trim, Vector3(atan2(rise, run), 0, 0))
	# the porch: two looks-only steps and the ramp that carries a body over the 20 cm lip of the foundation
	_vis(Vector3(0.45, 0.05, hd + 0.4), Vector3(2.0, 0.1, 0.5), _roof_m)
	_ramp(Vector3(0.45, 0.04, hd + 0.55), Vector3(2.0, 0.1, 1.04), atan2(0.2, 1.0))
	_vis(Vector3(0.45, 2.55, hd + 0.5), Vector3(2.3, 0.1, 1.1), _trim)                           # canopy over the door
	for sx in [-1.0, 1.0]:
		_vis(Vector3(0.45 + sx * 1.05, 1.3, hd + 0.95), Vector3(0.1, 2.5, 0.1), _trim)
	# walls, storey by storey: the door in the front of the ground floor, windows elsewhere
	for f in floors:
		var y0 := STOREY * f + 0.21
		var h := STOREY - 0.21
		var front_holes := [[-0.2, 1.1, 0.0, 2.3]] if f == 0 else [[hw * 0.5 - 0.6, hw * 0.5 + 0.6, 1.0, 2.2]]
		_wall(Vector3(0, y0, hd - WALL * 0.5), Vector3.RIGHT, w, h, front_holes, Vector3(0, 0, 1))
		_wall(Vector3(0, y0, -hd + WALL * 0.5), Vector3.RIGHT, w, h, [[hw * 0.3 - 0.6, hw * 0.3 + 0.6, 1.0, 2.2]], Vector3(0, 0, -1))
		_wall(Vector3(hw - WALL * 0.5, y0, 0), Vector3.FORWARD, d - WALL * 2, h, [[-0.6, 0.6, 1.0, 2.2]], Vector3(1, 0, 0))
		_wall(Vector3(-hw + WALL * 0.5, y0, 0), Vector3.FORWARD, d - WALL * 2, h, [], Vector3(-1, 0, 0))
		for sz in [-1.0, 1.0]:
			_vis(Vector3(0, STOREY * (f + 1) - 0.05, sz * (hd + 0.03)), Vector3(w + 0.1, 0.16, 0.08), _trim)
			_vis(Vector3(sz * (hw + 0.03), STOREY * (f + 1) - 0.05, 0), Vector3(0.08, 0.16, d + 0.1), _trim)
	_roof_props(top, hw, hd, sx0, sx1)
	for f in floors:
		_furnish(f, hw, hd, sx1, f % 2 == 1)
	_flush()
	return self


# ── pieces ──────────────────────────────────────────────────────────────────

## A wall of `length` along `along` (RIGHT or FORWARD), its bottom at base.y, with rectangular holes [[u0, u1, v0, v1], ...]
## (u along the wall from its middle, v up from its bottom), `out` pointing to the street. Cut into solid pieces around the holes: a
## plastered outer skin, a painted inner skin, one collider; frames, glass and the door leaf are added around the holes.
func _wall(base: Vector3, along: Vector3, length: float, h: float, holes: Array, out: Vector3) -> void:
	var cuts := [-length * 0.5, length * 0.5]
	for hl in holes:
		cuts.append(float(hl[0]))
		cuts.append(float(hl[1]))
	cuts.sort()
	for i in cuts.size() - 1:
		var u0: float = cuts[i]
		var u1: float = cuts[i + 1]
		if u1 - u0 < 0.01:
			continue
		var um := (u0 + u1) * 0.5
		var hole = null
		for hl in holes:
			if um > float(hl[0]) and um < float(hl[1]):
				hole = hl
		var spans := [[0.0, h]] if hole == null else [[0.0, float(hole[2])], [float(hole[3]), h]]
		for sp in spans:
			var v0: float = sp[0]
			var v1: float = sp[1]
			if v1 - v0 < 0.01:
				continue
			var c := base + along * um + Vector3(0, (v0 + v1) * 0.5, 0)
			_col(c, _wsz(along, u1 - u0, v1 - v0, WALL))
			_vis(c + out * (WALL * 0.5 - 0.09), _wsz(along, u1 - u0, v1 - v0, 0.18), _wall_out)
			_vis(c - out * (WALL * 0.5 - 0.035), _wsz(along, u1 - u0, v1 - v0, 0.07), _wall_in)
	for hl in holes:
		var a := float(hl[0])
		var b := float(hl[1])
		var v0 := float(hl[2])
		var v1 := float(hl[3])
		var fd := WALL + 0.08
		var fw := 0.09
		var door := v0 < 0.05
		var glass := _mat(Color(0.62, 0.8, 0.95), "", 1.0, 0.0, 0.3)
		var mid := base + along * ((a + b) * 0.5)
		_vis(mid + Vector3(0, v1 + fw * 0.5, 0), _wsz(along, b - a + fw * 2, fw, fd), _trim)                                  # lintel
		_vis(base + along * (a - fw * 0.5) + Vector3(0, (v0 + v1) * 0.5, 0), _wsz(along, fw, v1 - v0, fd), _trim)           # jambs
		_vis(base + along * (b + fw * 0.5) + Vector3(0, (v0 + v1) * 0.5, 0), _wsz(along, fw, v1 - v0, fd), _trim)
		if door:
			# the leaf, swung open against the inside of the wall (no collider: it must never trap a body)
			var leaf_sz := Vector3(0.05, 2.2, 1.0) if along == Vector3.RIGHT else Vector3(1.0, 2.2, 0.05)
			_vis(base + along * (b - 0.06) - out * (WALL * 0.5 + 0.52) + Vector3(0, 1.1, 0), leaf_sz, _mat(_pal.trim, "wood", 0.6))
		else:
			_vis(mid + Vector3(0, v0 - fw * 0.5, 0), _wsz(along, b - a + fw * 2, fw, fd), _trim)                              # sill
			_vis(mid + out * (WALL * 0.5 + 0.06) + Vector3(0, v0 - fw * 0.9, 0), _wsz(along, b - a + 0.3, 0.05, 0.14), _trim)  # ledge outside
			_vis(mid + Vector3(0, (v0 + v1) * 0.5, 0), _wsz(along, 0.05, v1 - v0, 0.05), _trim)                               # mullion
			_vis(mid + Vector3(0, (v0 + v1) * 0.5, 0), _wsz(along, b - a, v1 - v0, 0.02), glass)                               # glass, no collider


static func _wsz(along: Vector3, length: float, h: float, thick: float) -> Vector3:
	return Vector3(length, h, thick) if along == Vector3.RIGHT else Vector3(thick, h, length)


## A floor slab: wooden (or roof) top and a white ceiling underneath, one collider for the whole thickness.
func _slab(center: Vector3, sz: Vector3, top_m: Material, under_m: Material) -> void:
	_col(center, sz)
	_vis(center + Vector3(0, sz.y * 0.5 - 0.07, 0), Vector3(sz.x, 0.14, sz.z), top_m)
	_vis(center + Vector3(0, -sz.y * 0.5 + 0.04, 0), Vector3(sz.x, 0.08, sz.z), under_m)
	_vis(center, Vector3(sz.x, sz.y - 0.22, sz.z), under_m)


## A solid box (a visible one with a collider).
func _box(c: Vector3, sz: Vector3, m: Material, solid := true) -> void:
	_vis(c, sz, m)
	if solid:
		_col(c, sz)


## A visible box merged into its material's mesh. `rot` turns it (radians about x, y, z) round its own middle.
func _vis(c: Vector3, sz: Vector3, m: Material, rot := Vector3.ZERO) -> void:
	var xf := _xf * Transform3D(Basis.from_euler(rot), c)
	var s: Batch = _surf.get(m)
	if s == null:
		s = Batch.new()
		_surf[m] = s
	var hs := sz * 0.5
	for f in FACES:
		var n: Vector3 = f[0]
		var u: Vector3 = f[1]
		var v: Vector3 = f[2]
		var ctr := Vector3(n.x * hs.x, n.y * hs.y, n.z * hs.z)
		var ue := Vector3(u.x * hs.x, u.y * hs.y, u.z * hs.z)
		var ve := Vector3(v.x * hs.x, v.y * hs.y, v.z * hs.z)
		var base: int = s.v.size()
		var wn := (xf.basis * n).normalized()
		for corner in [ctr - ue - ve, ctr + ue - ve, ctr + ue + ve, ctr - ue + ve]:
			var p: Vector3 = xf * (corner as Vector3)
			s.v.append(p)
			s.n.append(wn)
			var uv := Vector2(p.x, p.z) if absf(wn.y) > 0.5 else (Vector2(p.z, -p.y) if absf(wn.x) > 0.5 else Vector2(p.x, -p.y))
			s.uv.append(uv)
		s.i.append_array(PackedInt32Array([base, base + 2, base + 1, base, base + 3, base + 2]))


## An invisible box collider (all of a house's colliders are shapes of one body).
func _col(c: Vector3, sz: Vector3, rot := Vector3.ZERO) -> void:
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = sz
	cs.shape = shape
	cs.transform = _xf * Transform3D(Basis.from_euler(rot), c)
	_phys.add_child(cs)


## A walkable ramp collider rising towards -Z by `ang`.
func _ramp(c: Vector3, sz: Vector3, ang: float) -> void:
	_col(c, sz, Vector3(ang, 0, 0))


## A cylinder (water tank, pot, lamp post) merged into the batch: appended through a thin box-free path (a prism of `sides` quads).
func _cyl(c: Vector3, r: float, h: float, m: Material, solid := true, sides := 10) -> void:
	var xf := _xf * Transform3D(Basis.IDENTITY, c)
	var s: Batch = _surf.get(m)
	if s == null:
		s = Batch.new()
		_surf[m] = s
	for k in sides:
		var a0 := float(k) / sides * TAU
		var a1 := float(k + 1) / sides * TAU
		var p0 := Vector3(cos(a0) * r, -h * 0.5, sin(a0) * r)
		var p1 := Vector3(cos(a1) * r, -h * 0.5, sin(a1) * r)
		var nrm := (xf.basis * Vector3(cos((a0 + a1) * 0.5), 0, sin((a0 + a1) * 0.5))).normalized()
		var base: int = s.v.size()
		for q in [p0, p1, p1 + Vector3(0, h, 0), p0 + Vector3(0, h, 0)]:
			var wp: Vector3 = xf * (q as Vector3)
			s.v.append(wp)
			s.n.append(nrm)
			s.uv.append(Vector2(wp.x + wp.z, -wp.y))
		s.i.append_array(PackedInt32Array([base, base + 1, base + 2, base, base + 2, base + 3]))
		# the lid
		var lb: int = s.v.size()
		for q2 in [Vector3(0, h * 0.5, 0), p0 + Vector3(0, h, 0), p1 + Vector3(0, h, 0)]:
			var wp2: Vector3 = xf * (q2 as Vector3)
			s.v.append(wp2)
			s.n.append(xf.basis * Vector3.UP)
			s.uv.append(Vector2(wp2.x, wp2.z))
		s.i.append_array(PackedInt32Array([lb, lb + 2, lb + 1]))
	if solid:
		var cs := CollisionShape3D.new()
		var shape := CylinderShape3D.new()
		shape.radius = r
		shape.height = h
		cs.shape = shape
		cs.transform = _xf * Transform3D(Basis.IDENTITY, c)
		_phys.add_child(cs)


## One mesh per material: all the boxes of the house in a few draw calls.
func _flush() -> void:
	for m in _surf:
		var s: Batch = _surf[m]
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = s.v
		arr[Mesh.ARRAY_NORMAL] = s.n
		arr[Mesh.ARRAY_TEX_UV] = s.uv
		arr[Mesh.ARRAY_INDEX] = s.i
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		mesh.surface_set_material(0, m)
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
	_surf.clear()


# ── the roof ────────────────────────────────────────────────────────────────

func _roof_props(top: float, hw: float, hd: float, sx0: float, sx1: float) -> void:
	var y := top + 0.22
	var steel := _mat(Color(0.62, 0.66, 0.7))
	var dark := _mat(Color(0.2, 0.22, 0.26))
	# a water tank on legs in the back right corner
	var tx := hw - 1.3
	var tz := -hd + 1.3
	for lx in [-0.45, 0.45]:
		for lz in [-0.45, 0.45]:
			_box(Vector3(tx + lx, y + 0.35, tz + lz), Vector3(0.1, 0.7, 0.1), dark, false)
	_box(Vector3(tx, y + 0.72, tz), Vector3(1.2, 0.08, 1.2), dark, false)
	_cyl(Vector3(tx, y + 1.3, tz), 0.55, 1.1, _mat(Color(0.35, 0.55, 0.75)))
	# an air conditioner and a vent, a radio mast
	_box(Vector3(hw - 1.1, y + 0.3, hd - 1.3), Vector3(0.9, 0.6, 0.5), steel)
	_vis(Vector3(hw - 1.1, y + 0.32, hd - 1.04), Vector3(0.6, 0.36, 0.03), dark)
	_box(Vector3(sx1 + 1.4, y + 0.25, -hd + 1.1), Vector3(0.7, 0.5, 0.7), _roof_m)
	_cyl(Vector3(sx1 + 1.4, y + 0.6, -hd + 1.1), 0.22, 0.2, steel, false)
	_box(Vector3(0.5, y + 1.4, -0.6), Vector3(0.06, 2.8, 0.06), dark, false)
	_vis(Vector3(0.5, y + 2.2, -0.6), Vector3(0.7, 0.05, 0.05), dark)


# ── furniture ───────────────────────────────────────────────────────────────

## Fill one storey. The ground floor is a kitchen, a dining table and a living room with a sofa and a TV; the upper floors a bedroom with a desk and shelves.
## `bedroom`: false = ground-floor layout. Free floor is x in [sx1 + 0.25, hw - WALL - 0.1], z in [-hd + WALL + 0.1, hd - 2.2]: the strip along the left
## wall is the stair, and the way from the door to the stair stays open.
func _furnish(f: int, hw: float, hd: float, sx1: float, bedroom: bool) -> void:
	var y := STOREY * f + 0.21
	var xr0 := sx1 + 0.3
	var xr1 := hw - WALL - 0.1
	var zb := -hd + WALL + 0.1
	var zf := hd - 2.3
	var wood := _wood
	var dark_wood := _mat(_pal.wood.darkened(0.35), "wood", 0.6)
	var fabrics: Array = [_mat(Color(0.35, 0.45, 0.62)), _mat(Color(0.62, 0.3, 0.3)), _mat(Color(0.4, 0.55, 0.42))]
	var fabric: Material = fabrics[int(hw * 7.0 + f) % 3]
	var white := _mat(Color(0.93, 0.93, 0.9))
	var steel := _mat(Color(0.7, 0.72, 0.76))
	var black := _mat(Color(0.1, 0.11, 0.13))
	var rug_m := _mat(Color(0.72, 0.42, 0.34).lerp(_pal.trim, 0.5))
	var warm := _mat(Color(1.0, 0.86, 0.55), "", 1.0, 1.6)
	# ceiling lights on every floor
	for lx in [(xr0 + xr1) * 0.5, xr1 - 1.2]:
		_xf = Transform3D(Basis.IDENTITY, Vector3(lx, y + STOREY - 0.28, (zb + zf) * 0.5))
		_vis(Vector3(0, 0.0, 0), Vector3(0.7, 0.05, 0.25), warm)
	if not bedroom:
		# kitchen along the back wall: base cabinets with a worktop, a sink, a hob and a fridge; wall cabinets on the left part only (the window is on the right)
		var win_x := hw * 0.3 - 0.75
		var klen := clampf(win_x - (xr0 + 0.2) - 0.1 - 0.9, 1.0, 2.6)
		_at(Vector3(xr0 + 0.2 + klen * 0.5, y, zb + 0.35), 0.0)
		_box(Vector3(0, 0.43, 0), Vector3(klen, 0.86, 0.7), white)
		_vis(Vector3(0, 0.89, 0.02), Vector3(klen + 0.04, 0.05, 0.76), black)
		_vis(Vector3(-klen * 0.25, 0.915, 0.04), Vector3(0.5, 0.02, 0.4), steel)
		_vis(Vector3(klen * 0.2, 0.915, 0.04), Vector3(0.5, 0.02, 0.4), black)
		for k in 4:
			_vis(Vector3(klen * (-0.375 + 0.25 * k), 0.5, 0.36), Vector3(0.02, 0.3, 0.02), steel)
		if klen > 1.4:
			_box(Vector3(-klen * 0.1, 1.85, -0.1), Vector3(klen * 0.8, 0.7, 0.35), wood)
		_box(Vector3(klen * 0.5 + 0.45, 0.95, 0.0), Vector3(0.8, 1.9, 0.7), steel)
		_vis(Vector3(klen * 0.5 + 0.45, 1.3, 0.36), Vector3(0.04, 0.5, 0.03), black)
		# the dining table with four chairs, a bowl on it
		_at(Vector3(xr0 + 1.7, y, zb + 2.7), 0.0)
		_box(Vector3(0, 0.74, 0), Vector3(1.5, 0.06, 0.9), wood)
		for lx2 in [-0.65, 0.65]:
			for lz2 in [-0.35, 0.35]:
				_vis(Vector3(lx2, 0.36, lz2), Vector3(0.07, 0.72, 0.07), dark_wood)
		_col(Vector3(0, 0.4, 0), Vector3(1.4, 0.8, 0.8))
		_vis(Vector3(0.2, 0.82, 0.05), Vector3(0.3, 0.1, 0.3), _mat(Color(0.85, 0.6, 0.3)))
		for cz in [-1.0, 1.0]:
			for cx in [-0.4, 0.4]:
				_chair(Vector3(cx, 0, cz * 0.78), PI if cz > 0 else 0.0, wood)
		loot_spots.append(Vector3(_xf.origin.x + 0.2, y + 0.95, _xf.origin.z + 0.05))
		# the living room: TV on the back wall, a sofa facing it, a coffee table and a rug
		var lx0 := xr1 - 1.2
		_at(Vector3(lx0, y, zb + 2.6), 0.0)
		_vis(Vector3(0, 0.01, 0), Vector3(2.8, 0.02, 2.4), rug_m)
		_at(Vector3(lx0, y, zb + 0.3), 0.0)
		_box(Vector3(0, 0.25, 0), Vector3(1.6, 0.5, 0.45), dark_wood)
		_vis(Vector3(0, 0.95, 0.02), Vector3(1.25, 0.72, 0.06), black)
		_vis(Vector3(0, 0.95, 0.055), Vector3(1.15, 0.62, 0.01), _mat(Color(0.35, 0.6, 0.85), "", 1.0, 0.8))
		_at(Vector3(lx0, y, zb + 4.2), PI)
		_sofa(fabric, 2.0)
		_at(Vector3(lx0, y, zb + 2.5), 0.0)
		_box(Vector3(0, 0.2, 0), Vector3(1.1, 0.4, 0.6), wood)
		_vis(Vector3(0.2, 0.46, 0.05), Vector3(0.25, 0.07, 0.35), _mat(Color(0.9, 0.85, 0.7)))
		loot_spots.append(Vector3(_xf.origin.x - 0.25, y + 0.75, _xf.origin.z))
		# a plant, a floor lamp, a cabinet beside the door
		_at(Vector3(xr0 + 0.3, y, zb + 1.6), 0.0)
		_plant()
		_at(Vector3(xr0 + 0.35, y, zf - 0.2), 0.0)
		_lamp(warm, dark_wood)
		_at(Vector3(xr1 - 0.3, y, hd - 1.2), -PI * 0.5)
		_box(Vector3(0, 0.45, 0), Vector3(1.0, 0.9, 0.4), dark_wood)
		_vis(Vector3(0, 0.92, 0.0), Vector3(1.04, 0.04, 0.44), wood)
		_pictures(y, hw, hd, [Vector3(lx0, 1.7, -hd + WALL + 0.02)])
	else:
		# a bedroom: the bed against the right wall, a wardrobe, a desk with a chair, a bookshelf and a lamp
		_at(Vector3(xr1 - 1.05, y, zb + 1.6), -PI * 0.5)
		_bed(fabric, wood, dark_wood)
		loot_spots.append(Vector3(_xf.origin.x, y + 0.85, _xf.origin.z))
		_at(Vector3(xr1 - 0.3, y, zb + 3.0), -PI * 0.5)
		_box(Vector3(0, 0.3, 0), Vector3(0.45, 0.6, 0.4), dark_wood)
		_at(Vector3(xr1 - 0.3, y + 0.6, zb + 3.0), 0.0)
		_lamp(warm, dark_wood, 0.5)
		_at(Vector3(xr0 + 1.1, y, zb + 0.3), 0.0)
		_box(Vector3(0, 1.0, 0), Vector3(1.6, 2.0, 0.55), dark_wood)
		_vis(Vector3(0, 1.0, 0.285), Vector3(0.03, 1.8, 0.02), black)
		_vis(Vector3(-0.15, 1.0, 0.3), Vector3(0.04, 0.18, 0.03), steel)
		_vis(Vector3(0.15, 1.0, 0.3), Vector3(0.04, 0.18, 0.03), steel)
		_at(Vector3(xr1 - 0.3, y, zf - 0.4), -PI * 0.5)
		_box(Vector3(0, 0.74, 0), Vector3(1.3, 0.05, 0.6), wood)
		_vis(Vector3(-0.58, 0.37, 0.0), Vector3(0.05, 0.74, 0.55), dark_wood)
		_vis(Vector3(0.58, 0.37, 0.0), Vector3(0.05, 0.74, 0.55), dark_wood)
		_col(Vector3(0, 0.37, 0), Vector3(1.3, 0.74, 0.6))
		_vis(Vector3(0.2, 0.95, -0.05), Vector3(0.5, 0.3, 0.04), black)
		_vis(Vector3(0.2, 0.95, -0.025), Vector3(0.44, 0.24, 0.01), _mat(Color(0.5, 0.75, 0.95), "", 1.0, 0.7))
		loot_spots.append(Vector3(_xf.origin.x, y + 0.95, _xf.origin.z))
		_at(Vector3(xr1 - 1.1, y, zf - 0.4), -PI * 0.5)
		_chair(Vector3(0, 0, 0), PI, wood)
		_at(Vector3(xr0 + 1.0, y, hd - WALL - 0.22), PI)
		_shelf(wood)
		_at(Vector3(xr0 + 0.4, y, zf - 0.6), 0.0)
		_plant()
	_xf = Transform3D.IDENTITY


func _at(pos: Vector3, yaw: float) -> void:
	_xf = Transform3D(Basis(Vector3.UP, yaw), pos)


func _chair(p: Vector3, yaw: float, m: Material) -> void:
	var keep := _xf
	_xf = keep * Transform3D(Basis(Vector3.UP, yaw), p)
	_vis(Vector3(0, 0.45, 0), Vector3(0.42, 0.05, 0.42), m)
	_vis(Vector3(0, 0.75, -0.19), Vector3(0.42, 0.55, 0.05), m)
	for lx in [-0.17, 0.17]:
		for lz in [-0.17, 0.17]:
			_vis(Vector3(lx, 0.22, lz), Vector3(0.05, 0.44, 0.05), m)
	_col(Vector3(0, 0.45, 0), Vector3(0.42, 0.9, 0.42))
	_xf = keep


## A sofa of the given length, facing local +Z.
func _sofa(cloth: Material, len: float) -> void:
	_box(Vector3(0, 0.22, 0), Vector3(len, 0.44, 0.9), cloth)
	_box(Vector3(0, 0.62, -0.38), Vector3(len, 0.5, 0.18), cloth)
	_box(Vector3(-len * 0.5 + 0.11, 0.42, 0.0), Vector3(0.22, 0.7, 0.9), cloth)
	_box(Vector3(len * 0.5 - 0.11, 0.42, 0.0), Vector3(0.22, 0.7, 0.9), cloth)
	var cush := _mat(Color(0.95, 0.9, 0.8))
	_vis(Vector3(-len * 0.28, 0.5, 0.0), Vector3(len * 0.38, 0.1, 0.62), cush)
	_vis(Vector3(len * 0.18, 0.5, 0.0), Vector3(len * 0.38, 0.1, 0.62), cush)


## A bed with its head against local -Z.. (the footprint is 1.4 wide x 2.0 long, the head at -Z).
func _bed(cloth: Material, wood: Material, dark: Material) -> void:
	_box(Vector3(0, 0.22, 0), Vector3(1.5, 0.44, 2.05), dark)
	_vis(Vector3(0, 0.5, 0.05), Vector3(1.4, 0.18, 1.9), cloth)
	_vis(Vector3(0, 0.6, -0.78), Vector3(0.9, 0.12, 0.38), _mat(Color(0.97, 0.97, 0.95)))
	_box(Vector3(0, 0.62, -1.0), Vector3(1.6, 1.0, 0.08), wood)


func _shelf(wood: Material) -> void:
	_box(Vector3(0, 1.0, 0), Vector3(1.3, 2.0, 0.36), wood)
	var books := [Color(0.7, 0.25, 0.25), Color(0.25, 0.4, 0.7), Color(0.85, 0.7, 0.3), Color(0.3, 0.6, 0.4)]
	for r in 4:
		for k in 5:
			_vis(Vector3(-0.5 + 0.22 * k, 0.4 + r * 0.42, 0.185), Vector3(0.17, 0.3, 0.02), _mat(books[(r + k) % 4]))


func _lamp(glow: Material, post: Material, h := 1.5) -> void:
	_cyl(Vector3(0, h * 0.5, 0), 0.025, h, post, false, 6)
	_cyl(Vector3(0, 0.02, 0), 0.16, 0.04, post, false, 8)
	_cyl(Vector3(0, h + 0.1, 0), 0.17, 0.24, glow, false, 8)


func _plant() -> void:
	_cyl(Vector3(0, 0.22, 0), 0.2, 0.44, _mat(Color(0.7, 0.4, 0.3)), true, 8)
	var leaf := _mat(Color(0.3, 0.6, 0.32))
	for k in 5:
		var a := float(k) / 5.0 * TAU
		_vis(Vector3(cos(a) * 0.12, 0.7 + 0.08 * (k % 2), sin(a) * 0.12), Vector3(0.22, 0.5, 0.05), leaf, Vector3(0.2 * cos(a), a, 0.2 * sin(a)))


## Framed pictures on the inside of the walls (looks only).
func _pictures(y: float, hw: float, hd: float, spots: Array) -> void:
	var cols := [Color(0.85, 0.55, 0.3), Color(0.35, 0.6, 0.8), Color(0.8, 0.4, 0.5)]
	var i := 0
	for p in spots:
		_xf = Transform3D.IDENTITY
		_vis(Vector3(p.x, y + p.y - 0.21, p.z), Vector3(0.85, 0.6, 0.04), _mat(Color(0.2, 0.15, 0.12)))
		_vis(Vector3(p.x, y + p.y - 0.21, p.z + 0.025), Vector3(0.72, 0.48, 0.01), _mat(cols[i % 3]))
		i += 1
