class_name World
extends Node3D
## Harrow Cove, Chapter 1: harbour clinic -> Market Street (radio shop) -> church plaza -> the bell road -> the tower arena. Built from boxes with the
## toon shader, real props where a model exists. Everything solid is registered with the NavGrid; zones fade out past 120 m (streaming).

const WALL_H := 3.4
const STREAM_DIST := 125.0
const EXIT_GAP := Rect2(-1.3, -26.3, 2.6, 0.6)
const STORE_GAP := Rect2(15.3, -66.25, 1.4, 0.5)

var game: Game
var nav := NavGrid.new()
var zones := {}                  # name -> {"node": Node3D, "rect": Rect2}
var spots := {}                  # name -> Vector3 (story anchors)
var lamps: Array[OmniLight3D] = []
var clinic_lights: Array[OmniLight3D] = []
var barricade: StaticBody3D
var barricade_bits: Array[Node] = []     # tyres and barrels piled at the barricade, cleared when it burns
var storeroom_door: StaticBody3D
var exit_door: StaticBody3D
var arena_gate: StaticBody3D
var env: Environment
var sun: DirectionalLight3D
var rain: GPUParticles3D
var fire_lights: Array[OmniLight3D] = []
var weather_tier := 1
var _bolt_in := 18.0
var _bolt := 0.0
var _amb_base := 0.62
var mist_sheets: Array[MeshInstance3D] = []
var powered := false
var _t := 0.0
var _zone_node: Node3D
var _rng := RandomNumberGenerator.new()
var _lamp_budget := 6
var low_gfx := false

# palette
const C_WALL := Color(0.62, 0.64, 0.62)
const C_FLOOR := Color(0.46, 0.48, 0.47)
const C_ROAD := Color(0.2, 0.21, 0.23)
const C_WALK := Color(0.4, 0.4, 0.4)
const C_GROUND := Color(0.2, 0.24, 0.21)


## The whole world in small steps, so the loading screen can redraw between them (a phone would otherwise freeze for seconds).
func build_steps() -> Array[Callable]:
	var steps: Array[Callable] = [
		func() -> void:
			_rng.seed = 11
			nav.setup(Rect2(-100, -260, 200, 300), 0.5)
			_environment(),
		_ground, _clinic, _market_street, _church, _bell_road, _arena, _harbour, _mist, _weather,
	]
	for zname in ["ground", "clinic", "market", "church", "road", "arena", "harbour"]:
		steps.append(func() -> void: _finish_zone(zname))
	return steps


func build() -> void:
	for step in build_steps():
		step.call()


func _finish_zone(zname: String) -> void:
	if not zones.has(zname):
		return
	var r := Batcher.merge(zones[zname].node, 105.0)
	zones[zname].node.visible = true
	if r.before > 0:
		print("world: zone %s: %d static meshes merged into %d batches" % [zname, r.before, r.after])


# ── environment ──────────────────────────────────────────────────────────────

func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.34, 0.39, 0.42)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.66)
	env.ambient_light_energy = _amb_base
	env.fog_enabled = true
	env.fog_light_color = Color(0.36, 0.41, 0.44)
	env.fog_density = 0.026
	env.fog_sky_affect = 1.0
	env.glow_enabled = false
	env.glow_intensity = 0.3
	env.glow_strength = 0.8
	env.glow_hdr_threshold = 1.3
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, 28, 0)
	sun.light_energy = 0.62
	sun.light_color = Color(0.78, 0.85, 0.98)
	sun.shadow_enabled = not OS.has_feature("mobile")
	sun.directional_shadow_max_distance = 38.0
	add_child(sun)


func _ground() -> void:
	var n := _new_zone("ground", Rect2(-100, -260, 200, 300))
	_flat(n, Vector3(0, -0.05, -110), Vector3(200, 0.1, 300), Surf.mat("forest_floor", 6.0, Color(0.42, 0.48, 0.5), 0.0, 0.0, 0.9))
	var floor_body := StaticBody3D.new()
	floor_body.collision_layer = Data.L_WORLD
	floor_body.collision_mask = 0
	var fcs := CollisionShape3D.new()
	var fbs := BoxShape3D.new()
	fbs.size = Vector3(200, 2.0, 300)
	fcs.shape = fbs
	floor_body.add_child(fcs)
	floor_body.position = Vector3(0, -1.0, -110)
	n.add_child(floor_body)
	# street + sidewalks + curbs; a dirt strip between the sidewalk and the house fronts
	var asphalt := Surf.mat("asphalt", 4.0, Color(0.5, 0.52, 0.58), 0.0, 0.0, 1.0)
	_flat(n, Vector3(0, 0.0, -88), Vector3(14, 0.06, 126), asphalt)
	_flat(n, Vector3(0, 0.0, -158), Vector3(10, 0.06, 70), Surf.mat("asphalt_b", 4.0, Color(0.46, 0.48, 0.52), 0.0, 0.0, 1.0))
	var walk := Surf.mat("pavement", 2.0, Color(0.66, 0.7, 0.74), 0.0, 0.4, 0.9)
	var curb := Surf.mat("concrete", 2.0, Color(0.62, 0.64, 0.68), 0.0, 0.5, 0.5)
	for sx in [-1.0, 1.0]:
		_flat(n, Vector3(sx * 8.2, 0.02, -88), Vector3(2.4, 0.08, 126), walk)
		_flat(n, Vector3(sx * 7.05, 0.07, -88), Vector3(0.2, 0.16, 126), curb)
		_flat(n, Vector3(sx * 10.2, 0.01, -88), Vector3(1.6, 0.04, 126), Surf.mat("mud", 3.0, Color(0.46, 0.5, 0.5), 0.0, 0.0, 0.8))
	_forest(n, -95, 95, -10, 18, 60, 24, 3)
	_forest(n, -95, 95, -250, -20, 360, 30, 5)
	var paint := Toon.flat(Color(0.72, 0.7, 0.62), 0.0, 0.3)
	for i in range(0, 20):
		_flat(n, Vector3(0, 0.05, -28 - i * 6.0), Vector3(0.22, 0.02, 2.6), paint)
	# crosswalks and manholes
	for z in [-30.0, -62.0, -94.0, -118.0]:
		for k in range(-5, 6):
			_flat(n, Vector3(k * 1.15, 0.05, z), Vector3(0.6, 0.02, 3.0), paint)
	var iron := Toon.flat(Color(0.18, 0.19, 0.22), 0.0, 0.2)
	for z in [-45.0, -77.0, -105.0]:
		var mh := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.5
		cm.bottom_radius = 0.5
		cm.height = 0.03
		cm.radial_segments = 14
		mh.mesh = cm
		mh.material_override = iron
		mh.position = Vector3(2.2 if z != -77.0 else -2.4, 0.05, z)
		n.add_child(mh)


func _new_zone(zname: String, rect: Rect2) -> Node3D:
	var n := Node3D.new()
	n.name = zname
	add_child(n)
	zones[zname] = {"node": n, "rect": rect}
	_zone_node = n
	return n


# ── primitives ───────────────────────────────────────────────────────────────

func _flat(parent: Node3D, center: Vector3, size: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = center
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


## A solid box: mesh + collider (+ nav block).
func _box(parent: Node3D, center: Vector3, size: Vector3, mat: Material, block_nav := true, collide := true) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = center
	body.collision_layer = Data.L_WORLD
	body.collision_mask = 0
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	body.add_child(mi)
	if collide:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		body.add_child(cs)
	parent.add_child(body)
	if block_nav and size.y > 0.6 and collide:
		nav.block_rect(Rect2(center.x - size.x * 0.5, center.z - size.z * 0.5, size.x, size.z), 0.35)
	return body


## Axis-aligned wall from a to b (x,z) with door gaps given as [from, to] coordinates along the wall.
func _wall(parent: Node3D, a: Vector2, b: Vector2, h: float, th: float, mat: Material, gaps: Array = [], dado: Material = null) -> void:
	var horizontal := is_equal_approx(a.y, b.y)
	var c0 := minf(a.x, b.x) if horizontal else minf(a.y, b.y)
	var c1 := maxf(a.x, b.x) if horizontal else maxf(a.y, b.y)
	var sorted := gaps.duplicate()
	sorted.sort_custom(func(p: Array, q: Array) -> bool: return p[0] < q[0])
	var segs: Array = []
	var cur := c0
	for g in sorted:
		if g[0] > cur:
			segs.append([cur, g[0]])
		cur = maxf(cur, g[1])
	if cur < c1:
		segs.append([cur, c1])
	for s in segs:
		var seg_len: float = s[1] - s[0]
		if seg_len < 0.05:
			continue
		var mid: float = (s[0] + s[1]) * 0.5
		if horizontal:
			_box(parent, Vector3(mid, h * 0.5, a.y), Vector3(seg_len, h, th), mat)
		else:
			_box(parent, Vector3(a.x, h * 0.5, mid), Vector3(th, h, seg_len), mat)
		if dado != null:       # two-tone wall: a tiled/panelled lower band with a rail on top, both sides
			var rail := Toon.flat(Color(0.2, 0.24, 0.26), 0.0, 0.3)
			for side in [-1.0, 1.0]:
				var off: float = side * (th * 0.5 + 0.02)
				if horizontal:
					_flat(parent, Vector3(mid, 0.65, a.y + off), Vector3(seg_len, 1.3, 0.04), dado)
					_flat(parent, Vector3(mid, 1.34, a.y + off * 1.3), Vector3(seg_len, 0.09, 0.08), rail)
					_flat(parent, Vector3(mid, 0.08, a.y + off * 1.4), Vector3(seg_len, 0.16, 0.07), rail)
				else:
					_flat(parent, Vector3(a.x + off, 0.65, mid), Vector3(0.04, 1.3, seg_len), dado)
					_flat(parent, Vector3(a.x + off * 1.3, 1.34, mid), Vector3(0.08, 0.09, seg_len), rail)
					_flat(parent, Vector3(a.x + off * 1.4, 0.08, mid), Vector3(0.07, 0.16, seg_len), rail)


func _room(parent: Node3D, r: Rect2, h: float, mat: Material, gaps := {}, dado: Material = null) -> void:
	_wall(parent, Vector2(r.position.x, r.position.y), Vector2(r.end.x, r.position.y), h, 0.4, mat, gaps.get("n", []), dado)
	_wall(parent, Vector2(r.position.x, r.end.y), Vector2(r.end.x, r.end.y), h, 0.4, mat, gaps.get("s", []), dado)
	_wall(parent, Vector2(r.position.x, r.position.y), Vector2(r.position.x, r.end.y), h, 0.4, mat, gaps.get("w", []), dado)
	_wall(parent, Vector2(r.end.x, r.position.y), Vector2(r.end.x, r.end.y), h, 0.4, mat, gaps.get("e", []), dado)


## A visual-only ceiling slab with lamp panels (no collider: the camera must never be pushed by it).
func _ceiling(parent: Node3D, r: Rect2, h: float, mat: Material, panels := true) -> void:
	_flat(parent, Vector3(r.get_center().x, h + 0.1, r.get_center().y), Vector3(r.size.x + 0.4, 0.2, r.size.y + 0.4), mat)
	if not panels:
		return
	var glow := Toon.flat(Color(0.85, 0.95, 0.9), 0.0, 0.0, Color(0.7, 0.85, 0.8), 0.7)
	var nx := maxi(1, int(r.size.x / 5.0))
	var nz := maxi(1, int(r.size.y / 5.0))
	for ix in nx:
		for iz in nz:
			_flat(parent, Vector3(r.position.x + (ix + 0.5) * r.size.x / nx, h - 0.03, r.position.y + (iz + 0.5) * r.size.y / nz), Vector3(1.6, 0.06, 0.45), glow)


func _prop(parent: Node3D, model: String, pos: Vector3, size: float, rot_deg := 0.0, by_length := false, solid := true, outline := 0.02) -> Node3D:
	var p := Assets.prop(model, size, by_length, outline, 0.3)
	p.position = pos
	p.rotation_degrees.y = rot_deg
	parent.add_child(p)
	if solid:
		var sz := Assets.size_of(p)
		var ang := deg_to_rad(rot_deg)
		var w: float = absf(sz.x * cos(ang)) + absf(sz.z * sin(ang))
		var d: float = absf(sz.x * sin(ang)) + absf(sz.z * cos(ang))
		var body := StaticBody3D.new()
		body.collision_layer = Data.L_WORLD
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(w * 0.9, maxf(sz.y, 0.8), d * 0.9)
		cs.shape = bs
		cs.position = Vector3(0, bs.size.y * 0.5, 0)
		body.add_child(cs)
		p.add_child(body)
		body.rotation_degrees.y = -rot_deg
		if sz.y > 0.6:
			nav.block_rect(Rect2(pos.x - w * 0.5, pos.z - d * 0.5, w, d), 0.2)
	return p


func _lamp(parent: Node3D, pos: Vector3, on := true) -> void:
	var p := Assets.prop("streetlamp", 4.6, false, 0.025, 0.2)
	p.position = pos
	parent.add_child(p)
	if on:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.78, 0.5)
		l.light_energy = 2.4
		l.omni_range = 13.0
		l.shadow_enabled = false
		l.position = pos + Vector3(0, 4.1, 0)
		parent.add_child(l)
		lamps.append(l)
	var body := StaticBody3D.new()
	body.collision_layer = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.3, 4.0, 0.3)
	cs.shape = bs
	cs.position = Vector3(0, 2.0, 0)
	body.add_child(cs)
	p.add_child(body)
	nav.block_rect(Rect2(pos.x - 0.15, pos.z - 0.15, 0.3, 0.3), 0.15)


## One combined pine (trunk + three stacked cones) used by every forest MultiMesh.
func _pine_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	var parts: Array = []
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.16
	trunk.bottom_radius = 0.26
	trunk.height = 2.0
	trunk.radial_segments = 5
	parts.append([trunk, Transform3D(Basis(), Vector3(0, 1.0, 0))])
	for i in 3:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 1.9 - i * 0.45
		cone.height = 2.6
		cone.radial_segments = 6
		parts.append([cone, Transform3D(Basis(), Vector3(0, 2.6 + i * 1.5, 0))])
	var first := true
	for p in parts:
		st.append_from(p[0], 0, p[1])
	var am := st.commit()
	return am


## Scatter pines inside [x0,x1] x [z0,z1], skipping the corridor |x| < keep_out around the road when keep_out > 0. One MultiMesh per 40 m cell so
## the renderer can cull and distance-hide whole cells (a single MultiMesh is always drawn in full).
func _forest(parent: Node3D, x0: float, x1: float, z0: float, z1: float, count: int, keep_out := 0.0, seed_v := 1) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var mesh := _pine_mesh()
	var mat := Surf.mat("forest_floor", 3.0, Color(0.16, 0.24, 0.22), 0.0, 0.0, 0.0)
	var cells := {}
	for i in count:
		var p := Vector3(rng.randf_range(x0, x1), 0, rng.randf_range(z0, z1))
		if keep_out > 0.0 and absf(p.x) < keep_out:
			continue
		var xf := Transform3D(Basis().scaled(Vector3.ONE * rng.randf_range(0.9, 1.9)).rotated(Vector3.UP, rng.randf() * TAU), p)
		var key := Vector2i(floori(p.x / 40.0), floori(p.z / 40.0))
		if not cells.has(key):
			cells[key] = []
		cells[key].append(xf)
	for key in cells:
		var xs: Array = cells[key]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = xs.size()
		for i in xs.size():
			mm.set_instance_transform(i, xs[i])
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = 120.0
		parent.add_child(mi)


func _tree(parent: Node3D, pos: Vector3) -> void:
	var trunk := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.1
	cm.bottom_radius = 0.2
	cm.height = 3.0
	cm.radial_segments = 6
	trunk.mesh = cm
	trunk.material_override = Surf.mat("planks_brown", 1.2, Color(0.3, 0.27, 0.27), 0.0, 0.8, 0.0)
	trunk.position = pos + Vector3(0, 1.5, 0)
	parent.add_child(trunk)
	for i in 3:
		var b := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.08, 1.4, 0.08)
		b.mesh = bm
		b.material_override = trunk.material_override
		b.position = pos + Vector3(0, 2.6 + i * 0.1, 0)
		b.rotation = Vector3(0.7 * (1 if i % 2 == 0 else -1), i * 2.1, 0.6)
		parent.add_child(b)
	_box(parent, pos + Vector3(0, 1.2, 0), Vector3(0.5, 2.4, 0.5), Toon.flat(Color.BLACK), true, true).visible = false


# ── dressing helpers ─────────────────────────────────────────────────────────

var reserved: Array[Rect2] = []             # footprints that scattered props must keep out of (the veranda roof and its ramp)
var occupied: Array[Vector3] = []          # centres of everything placed so far, so the scatter keeps clear of it and of the story spots


## A Poly Haven prop (assets/ph/<name>.glb), `size` metres tall (or long when by_length). Solid ones block the nav grid like any prop.
func _ph(parent: Node3D, model: String, pos: Vector3, size: float, rot_deg := 0.0, solid := true, by_length := false) -> Node3D:
	occupied.append(pos)
	if model == "boulder":
		return _boulder(parent, pos, size, rot_deg, solid)
	return _prop(parent, "ph/" + model, pos, size, rot_deg, by_length, solid, 0.012 if size >= 1.5 else 0.0)


## A lumpy rock: a displaced ico-sphere (a few hundred triangles) in the triplanar rock texture, with a box collider.
func _boulder(parent: Node3D, pos: Vector3, size: float, rot_deg: float, solid: bool) -> Node3D:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(absf(pos.x * 31.0 + pos.z * 17.0)) + 5
	var sm := SphereMesh.new()
	sm.radial_segments = 10
	sm.rings = 6
	var arrays := sm.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var off := {}
	for i in verts.size():
		var key := Vector3i(roundi(verts[i].x * 40), roundi(verts[i].y * 40), roundi(verts[i].z * 40))
		if not off.has(key):
			off[key] = rng.randf_range(0.78, 1.18)
		verts[i] = verts[i] * float(off[key])
		verts[i].y *= 0.75
	arrays[Mesh.ARRAY_VERTEX] = verts
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var holder := Node3D.new()
	holder.position = pos
	holder.rotation_degrees.y = rot_deg
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.scale = Vector3(size, size, size) * Vector3(1.2, 1.0, 1.0)
	mi.position.y = size * 0.3
	mi.material_override = Surf.mat("rock", 2.5, Color(0.55, 0.6, 0.64), 0.0, 0.8, 1.0)
	holder.add_child(mi)
	if solid:
		var body := StaticBody3D.new()
		body.collision_layer = Data.L_WORLD
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(size * 1.5, size * 0.9, size * 1.1)
		cs.shape = bs
		cs.position.y = size * 0.45
		body.add_child(cs)
		holder.add_child(body)
		if size > 0.8:
			nav.block_rect(Rect2(pos.x - size * 0.8, pos.z - size * 0.6, size * 1.6, size * 1.2), 0.2)
	parent.add_child(holder)
	return holder


func _free_spot(pos: Vector3, gap: float) -> bool:
	for r in reserved:
		if r.grow(1.0).has_point(Vector2(pos.x, pos.z)):
			return false
	for o in occupied:
		if Vector2(o.x - pos.x, o.z - pos.z).length() < gap:
			return false
	for k in spots:
		var sp: Vector3 = spots[k]
		if Vector2(sp.x - pos.x, sp.z - pos.z).length() < 2.4:
			return false
	return true


## Scatter props inside `area` (x, z rectangle). kinds: [model, size, by_length, solid, weight]. Keeps the road centre free unless `road` is true.
func _scatter(parent: Node3D, area: Rect2, kinds: Array, count: int, seed_v: int, gap := 2.0, road := false) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var total := 0.0
	for k in kinds:
		total += float(k[4])
	var placed := 0
	var tries := 0
	while placed < count and tries < count * 12:
		tries += 1
		var pos := Vector3(rng.randf_range(area.position.x, area.end.x), 0, rng.randf_range(area.position.y, area.end.y))
		if not road and absf(pos.x) < 5.0 and area.size.x > 8.0:
			continue
		if not _free_spot(pos, gap):
			continue
		var roll := rng.randf() * total
		var pick: Array = kinds[0]
		for k in kinds:
			roll -= float(k[4])
			if roll <= 0.0:
				pick = k
				break
		if road and bool(pick[3]) and absf(pos.x) < 3.4 and area.size.x > 8.0:
			continue       # solid things never narrow the middle of the road: the nav corridor must stay open
		_ph(parent, pick[0], pos, float(pick[1]) * rng.randf_range(0.9, 1.1), rng.randf() * 360.0, bool(pick[3]), bool(pick[2]))
		placed += 1


func _blood(parent: Node3D, pos: Vector3, size: float, rng: RandomNumberGenerator) -> void:
	var m := Toon.flat(Color(0.3, 0.03, 0.05), 0.0, 0.0)
	for i in rng.randi_range(2, 4):
		var q := _flat(parent, pos + Vector3(rng.randf_range(-size, size) * 0.5, 0.075 + i * 0.002, rng.randf_range(-size, size) * 0.5), Vector3(size * rng.randf_range(0.3, 0.7), 0.01, size * rng.randf_range(0.3, 0.7)), m)
		q.rotation.y = rng.randf() * TAU


# ── Chapter 1 places ─────────────────────────────────────────────────────────

func _clinic() -> void:
	var n := _new_zone("clinic", Rect2(-14, -28, 28, 44))
	var rng := RandomNumberGenerator.new()
	rng.seed = 21
	var wall := Surf.mat("plaster_beige", 3.0, Color(0.72, 0.78, 0.8), 0.55, 0.9)
	var wall2 := Surf.mat("plaster_blue", 3.0, Color(0.62, 0.72, 0.76), 0.55, 0.9)
	var floor_m := Surf.mat("tiles_check", 1.4, Color(0.6, 0.66, 0.68), 0.0, 0.6, 0.8)
	_flat(n, Vector3(0, 0.02, -6), Vector3(26, 0.06, 40), floor_m)
	# ward (start): x[-5,5] z[2,12]; corridor x[-2.5,2.5] z[-14,2]; storage west; office east; generator room z[-24,-14]
	var tile_blue := Surf.mat("tiles_blue", 1.1, Color(0.62, 0.72, 0.76), 0.0, 0.5, 0.8)
	var tile_brown := Surf.mat("tiles_brown", 1.1, Color(0.58, 0.58, 0.6), 0.0, 0.5, 0.8)
	var ceil_m := Surf.mat("concrete", 2.4, Color(0.34, 0.37, 0.4), 0.0, 0.9, 0.5)
	_room(n, Rect2(-5, 2, 10, 10), WALL_H, wall2, {"n": [[-1.2, 1.2]]}, tile_blue)
	_wall(n, Vector2(-2.5, 2), Vector2(-2.5, -14), WALL_H, 0.4, wall, [[-6.6, -3.4]], tile_brown)
	_wall(n, Vector2(2.5, 2), Vector2(2.5, -14), WALL_H, 0.4, wall, [[-6.6, -3.4]], tile_brown)
	_room(n, Rect2(-12, -12, 9.5, 10), WALL_H, wall, {"e": [[-6.6, -3.4]]}, tile_brown)
	_room(n, Rect2(2.5, -12, 9.5, 10), WALL_H, wall, {"w": [[-6.6, -3.4]]}, tile_brown)
	_room(n, Rect2(-7, -26, 14, 12), WALL_H, Surf.mat("concrete_block", 3.0, Color(0.6, 0.64, 0.66), 0.6, 1.0), {"s": [[-1.2, 1.2]], "n": [[-1.6, 1.6]]}, Surf.mat("metal", 1.4, Color(0.4, 0.46, 0.48), 0.0, 0.6, 0.0))
	for cr in [Rect2(-5, 2, 10, 10), Rect2(-2.5, -14, 5, 16), Rect2(-12, -12, 9.5, 10), Rect2(2.5, -12, 9.5, 10), Rect2(-7, -26, 14, 12)]:
		_ceiling(n, cr, WALL_H, ceil_m)
	_flat(n, Vector3(0, 3.05, -25.62), Vector3(1.0, 0.32, 0.08), Toon.flat(Color(0.2, 0.9, 0.45), 0.0, 0.0, Color(0.1, 1.0, 0.4), 1.4))
	var cs := Label3D.new()
	cs.text = "HARROW COVE CLINIC"
	cs.font_size = 64
	cs.pixel_size = 0.008
	cs.modulate = Color(0.9, 0.95, 1.0)
	cs.position = Vector3(0, 3.5, -26.32)
	cs.rotation.y = PI
	n.add_child(cs)
	exit_door = _box(n, Vector3(0, WALL_H * 0.5, -26), Vector3(3.2, WALL_H, 0.5), Surf.mat("shutter", 2.0, Color(0.55, 0.42, 0.42), 0.0, 0.6), false, true)
	Batcher.keep(exit_door)
	var wood := Surf.mat("planks_brown", 1.6, Color(0.7, 0.66, 0.62), 0.0, 0.5)
	var metal := Surf.mat("metal", 1.6, Color(0.55, 0.6, 0.62), 0.0, 0.6, 0.0)
	# ward: two beds, bedside tables, the cabinet with the crowbar, chairs, a wheelchair
	_prop(n, "clinic_bed", Vector3(-3.0, 0, 9.5), 2.0, 90, true)
	_prop(n, "clinic_bed", Vector3(3.0, 0, 9.5), 2.0, 90, true)
	_ph(n, "drawers", Vector3(3.6, 0, 6.0), 0.9, 180)
	_ph(n, "drawers", Vector3(-4.2, 0, 8.0), 0.8, 90)
	_ph(n, "chair", Vector3(-1.2, 0, 10.8), 0.95, 200)
	_ph(n, "wheelchair", Vector3(1.6, 0, 3.4), 1.0, 160, false)
	_ph(n, "desk_lamp", Vector3(-4.25, 0.8, 8.0), 0.35, 0, false)
	_ph(n, "wet_sign", Vector3(0.6, 0, 1.4), 0.6, 20, false)
	for b in [Vector3(0.5, 0, 6.5), Vector3(-3.5, 0, 6.5), Vector3(2.0, 0, 11.0)]:
		_blood(n, b, 1.1, rng)
	# corridor: blood trail, scattered stretcher parts
	for z in [-0.5, -3.5, -9.0, -12.0]:
		_blood(n, Vector3(rng.randf_range(-1.0, 1.0), 0, z), 0.9, rng)
	_ph(n, "hand_truck", Vector3(-1.9, 0, -10.2), 1.1, 90, false)
	_ph(n, "trashbag", Vector3(1.9, 0, -1.0), 0.6, 30, false)
	# storage (west): shelves, fuel, boxes
	_box(n, Vector3(-9.0, 0.9, -11.2), Vector3(5.0, 1.8, 0.8), metal)
	_ph(n, "carton", Vector3(-11.0, 0, -4.0), 0.7, 20)
	_ph(n, "carton", Vector3(-10.4, 0, -3.1), 0.55, 70)
	_ph(n, "crate_plastic", Vector3(-6.5, 0, -10.2), 0.6, 10)
	_ph(n, "bucket", Vector3(-4.0, 0, -4.4), 0.4, 0, false)
	_ph(n, "toolbox", Vector3(-11.2, 0, -9.0), 0.4, 40, false)
	# office (east): desk with the fuse, chairs, cabinet
	_ph(n, "table", Vector3(8.5, 0, -8.0), 0.95, 0)
	_ph(n, "chair", Vector3(8.5, 0, -6.6), 0.95, 180)
	_ph(n, "cabinet", Vector3(11.0, 0, -4.0), 1.9, 270)
	_ph(n, "medical_box", Vector3(4.2, 0, -4.2), 0.5, 20, false)
	_ph(n, "register", Vector3(8.4, 0.9, -3.8), 0.35, 0, false)
	_blood(n, Vector3(7.0, 0, -6.0), 1.4, rng)
	# generator room
	_box(n, Vector3(-5.5, 0.6, -24.6), Vector3(1.6, 1.2, 0.8), metal)
	_prop(n, "generator", Vector3(0, 0, -23.0), 1.1, 0, false, true)
	_ph(n, "barrel", Vector3(5.2, 0, -24.4), 0.95, 0)
	_ph(n, "barrel", Vector3(5.9, 0, -23.4), 0.95, 40)
	_ph(n, "crate_a", Vector3(-5.8, 0, -16.2), 0.9, 10)
	_ph(n, "hang_lamp", Vector3(0, 2.7, -20.0), 0.7, 0, false)
	# lights: dim red emergency until the generator runs
	for p in [Vector3(0, 3.0, 7), Vector3(0, 3.0, -4), Vector3(-7, 3.0, -7), Vector3(7, 3.0, -7), Vector3(0, 3.0, -20)]:
		var l := OmniLight3D.new()
		l.light_color = Color(0.75, 1.0, 0.88)
		l.light_energy = 0.9
		l.omni_range = 9.0
		l.shadow_enabled = false
		l.position = p
		n.add_child(l)
		clinic_lights.append(l)
	spots["spawn"] = Vector3(0, 0, 8.5)
	spots["crowbar"] = Vector3(3.6, 0.95, 6.0)
	spots["fuel"] = Vector3(-9.0, 0, -9.0)
	spots["fuse"] = Vector3(8.5, 0.95, -8.0)
	spots["generator"] = Vector3(0, 0, -21.2)
	spots["cabinet"] = Vector3(-5.5, 0, -23.4)
	spots["exit"] = Vector3(0, 0, -28.5)
	spots["note0"] = Vector3(-3.0, 0.7, 9.5)
	spots["note1"] = Vector3(8.5, 0.95, -9.4)
	# the doorway stays closed for pathing until the generator runs (exactly the gap between the wall ends)
	nav.block_rect(EXIT_GAP, 0.0)


func power_on() -> void:
	powered = true
	for l in clinic_lights:
		l.light_color = Color(1.0, 0.9, 0.75)
		l.light_energy = 1.6
	if exit_door != null:
		exit_door.queue_free()
		exit_door = null
		nav.unblock_rect(EXIT_GAP)


func _market_street() -> void:
	var n := _new_zone("market", Rect2(-30, -92, 60, 70))
	# west side blocks with alleys at z = -44 and -80 (street face = east)
	var west: Array = [[-28, -40, 9, 0, "COVE PHARMACY"], [-48, -78, 11, 1, "TIDE & TEA"], [-84, -92, 8, 4, "HARROW INN"]]
	for i in west.size():
		var b: Array = west[i]
		Kit.building(self, n, Rect2(-27, minf(b[0], b[1]), 16, absf(b[1] - b[0])), float(b[2]), int(b[3]), ["e", "n", "s"], ["e"], String(b[4]), 10 + i)
	# east side: blocks, then the radio shop (enterable) (street face = west)
	Kit.building(self, n, Rect2(11, -44, 14, 16), 9.0, 2, ["w", "n", "s"], ["w"], "FISHMONGER", 20)
	Kit.building(self, n, Rect2(11, -58, 14, 12), 8.0, 5, ["w", "n", "s"], ["w"], "BARBER", 21)
	Kit.building(self, n, Rect2(11, -82, 14, 10), 10.0, 3, ["w", "n", "s"], ["w"], "BOOKS", 22)
	Kit.building(self, n, Rect2(11, -92, 14, 8), 8.0, 6, ["w", "n"], ["w"], "GROCER", 23)
	var wall := Surf.mat("plaster_clay", 3.0, Color(0.74, 0.7, 0.66), 0.5, 0.9)
	var shop := Rect2(10.5, -72, 12, 14)
	_room(n, shop, WALL_H, wall, {"w": [[-66.0, -63.4]]}, Surf.mat("planks_brown", 1.5, Color(0.5, 0.46, 0.44), 0.0, 0.5))
	_ceiling(n, shop, WALL_H, Surf.mat("planks_brown", 1.6, Color(0.36, 0.33, 0.32), 0.0, 0.8, 0.0), false)
	_ph(n, "hang_lamp", Vector3(16.5, 2.75, -64.0), 0.7, 0, false)
	_flat(n, Vector3(16.5, 0.03, -65), Vector3(11.4, 0.06, 13.4), Surf.mat("wood_floor", 2.0, Color(0.6, 0.56, 0.54), 0.0, 0.7, 0.8))
	_wall(n, Vector2(10.5, -66), Vector2(22.5, -66), WALL_H, 0.4, wall, [[15.0, 17.0]], Surf.mat("planks_brown", 1.5, Color(0.5, 0.46, 0.44), 0.0, 0.5))
	storeroom_door = _box(n, Vector3(16.0, 1.3, -66), Vector3(2.0, 2.6, 0.45), Surf.mat("door_wood", 1.6, Color(0.6, 0.55, 0.52), 0.0, 0.6), false, true)
	Batcher.keep(storeroom_door)
	nav.block_rect(STORE_GAP, 0.0)
	# shop front sign
	_flat(n, Vector3(10.2, 3.75, -64.7), Vector3(0.14, 0.8, 3.6), Toon.flat(Color(0.12, 0.13, 0.16), 0.0, 0.2))
	var sl := Label3D.new()
	sl.text = "ARAI RADIO"
	sl.font_size = 64
	sl.pixel_size = 0.0075
	sl.modulate = Color(0.95, 0.85, 0.6)
	sl.position = Vector3(10.1, 3.75, -64.7)
	sl.rotation.y = -PI * 0.5
	n.add_child(sl)
	_ph(n, "dining", Vector3(14.0, 0, -60.3), 2.0, 0, true, true)
	_ph(n, "bucket", Vector3(13.2, 0.95, -60.3), 0.3, 0, false)
	_box(n, Vector3(20.5, 1.0, -62.0), Vector3(1.0, 2.0, 3.0), Surf.mat("planks_brown", 1.6, Color(0.62, 0.58, 0.55), 0.0, 0.6))
	_box(n, Vector3(20.5, 0.5, -69.2), Vector3(1.4, 1.0, 1.4), Surf.mat("planks_brown", 1.6, Color(0.55, 0.52, 0.5), 0.0, 0.6))
	_ph(n, "cart", Vector3(13.0, 0, -69.5), 0.9, 30)
	_ph(n, "carton", Vector3(12.0, 0, -61.5), 0.5, 10, false)
	_ph(n, "toolbox", Vector3(15.2, 0.95, -60.3), 0.3, 0, false)
	var shop_light := OmniLight3D.new()
	shop_light.light_color = Color(1.0, 0.82, 0.6)
	shop_light.light_energy = 1.3
	shop_light.omni_range = 9.0
	shop_light.position = Vector3(16, 2.8, -64)
	n.add_child(shop_light)
	# street dressing
	for z in [-34.0, -52.0, -70.0]:        # (the lamp that stood at -88 is now the light under the veranda roof)
		_lamp(n, Vector3(-9.2, 0, z))
	for z in [-34.0, -52.0, -70.0, -88.0]:
		_lamp(n, Vector3(9.2, 0, z - 9.0))
	_veranda(n, Rect2(-11.0, -86.0, 3.8, 8.0), 3.4)
	_prop(n, "car_wreck", Vector3(-3.2, 0, -38), 4.4, 12, true)
	_prop(n, "car_wreck", Vector3(3.5, 0, -57), 4.4, -8, true)
	_prop(n, "car_wreck", Vector3(-4.0, 0, -74), 4.4, 170, true)
	# the night the bus came in: the wreck of it on the verge and cars thrown over the road
	_prop(n, "bus", Vector3(-8.4, 0, -29.5), 10.5, 92, true)
	_flipped(n, "car_wreck", Vector3(2.2, 0, -46.0), 4.4, 35.0, 180.0)
	_flipped(n, "car_wreck", Vector3(-1.6, 0, -67.0), 4.4, -28.0, 180.0)
	_flipped(n, "police_car", Vector3(5.6, 0, -80.0), 4.4, 70.0, 90.0)
	_prop(n, "market_stall", Vector3(-7.8, 0, -47), 2.8, 90, true)
	_prop(n, "market_stall", Vector3(-7.8, 0, -55), 2.8, 90, true)
	_prop(n, "market_stall", Vector3(7.8, 0, -49), 2.8, -90, true)
	_prop(n, "crate", Vector3(-6.6, 0, -62), 0.95, 20)
	_prop(n, "crate", Vector3(-6.2, 0, -63.2), 0.95, 50)
	_prop(n, "crate", Vector3(6.8, 0, -36), 0.95, 0)
	occupied.append_array([Vector3(-3.2, 0, -38), Vector3(3.5, 0, -57), Vector3(-4, 0, -74), Vector3(-7.8, 0, -47), Vector3(-7.8, 0, -55), Vector3(7.8, 0, -49), Vector3(-6.4, 0, -62.6), Vector3(6.8, 0, -36)])
	spots["market_start"] = Vector3(0, 0, -30)
	spots["shop_door"] = Vector3(10.5, 0, -64.7)
	spots["workbench"] = Vector3(14.0, 0, -61.4)
	spots["storeroom"] = Vector3(16.0, 0, -65.0)
	spots["ally1"] = Vector3(17.5, 0, -69.0)
	spots["loot1"] = Vector3(-7.8, 0.9, -46.5)
	spots["loot2"] = Vector3(-7.8, 0.9, -55.5)
	spots["loot3"] = Vector3(7.6, 0.9, -48.5)
	spots["loot4"] = Vector3(-4.0, 0.9, -37.0)
	spots["loot5"] = Vector3(3.6, 0.9, -56.0)
	spots["loot6"] = Vector3(-5.0, 0.9, -72.5)
	spots["loot7"] = Vector3(20.5, 1.0, -62.0)
	spots["loot8"] = Vector3(-6.4, 0.9, -62.6)
	spots["note2"] = Vector3(9.4, 1.1, -64.5)
	# the rest of the street: bins, barrels, benches, hydrants, fences, tyres, rubbish along both sidewalks, barriers at the kerb
	var street := [["bin", 0.95, false, true, 3.0], ["barrel", 0.95, false, true, 2.5], ["bench", 0.9, false, true, 1.5], ["hydrant", 0.85, false, true, 1.0], ["planter", 0.7, false, true, 1.5],
		["trashbag", 0.55, false, false, 3.0], ["tyre", 0.7, false, false, 2.0], ["crate_b", 0.8, false, true, 2.0], ["utility_box", 1.3, false, true, 1.0], ["barrier", 2.2, true, true, 1.2], ["bucket", 0.4, false, false, 1.5]]
	_scatter(n, Rect2(7.3, -92, 2.0, 62), street, 22, 31, 3.0)
	_scatter(n, Rect2(-9.4, -92, 2.0, 62), street, 22, 32, 3.0)
	_scatter(n, Rect2(9.6, -92, 1.4, 62), [["fence", 2.2, true, false, 3.0], ["trashbag", 0.55, false, false, 2.0], ["bin", 0.95, false, true, 1.0]], 8, 33, 3.0)
	_scatter(n, Rect2(-11.0, -92, 1.6, 62), [["fence", 2.2, true, false, 3.0], ["trashbag", 0.55, false, false, 2.0], ["bin", 0.95, false, true, 1.0]], 8, 34, 3.0)
	_scatter(n, Rect2(-6.0, -92, 12.0, 62), [["tyre", 0.7, false, false, 2.0], ["trashbag", 0.55, false, false, 3.0], ["barrier", 2.2, true, true, 1.0], ["crate_plastic", 0.5, false, false, 1.5], ["covered_car", 4.2, true, true, 0.2]], 9, 35, 4.0, true)


## A roof you can climb onto: a veranda slab along the front of a building, posts at the street edge, a railing, and a ramp up from the ground at its
## far end. The ground under the slab stays walkable; the ramp is solid. A spitter waits up there and there is loot, so the roof is worth the climb.
func _veranda(parent: Node3D, r: Rect2, h: float) -> void:
	var wood := Surf.mat("planks_brown", 1.6, Color(0.6, 0.55, 0.5), 0.0, 0.7, 1.0)
	var iron := Surf.mat("metal", 1.6, Color(0.45, 0.48, 0.52), 0.0, 0.7, 0.0)
	var tiles := Surf.mat("roof_iron", 2.0, Color(0.55, 0.5, 0.5), 0.0, 0.8, 1.0)
	_box(parent, Vector3(r.get_center().x, h - 0.15, r.get_center().y), Vector3(r.size.x, 0.3, r.size.y), tiles, false, true)
	for z in [r.position.y + 0.3, r.get_center().y, r.end.y - 0.3]:
		_box(parent, Vector3(r.end.x - 0.15, (h - 0.3) * 0.5, z), Vector3(0.3, h - 0.3, 0.3), iron)
	# railing along the street side and the open end (the ramp comes in at the far end, z = r.position.y)
	var rail_h := 0.95
	_flat(parent, Vector3(r.end.x - 0.05, h + rail_h * 0.5, r.get_center().y), Vector3(0.1, rail_h, r.size.y), wood)
	_box(parent, Vector3(r.end.x - 0.05, h + rail_h * 0.5, r.get_center().y), Vector3(0.2, rail_h, r.size.y), wood, false, true).visible = false
	_flat(parent, Vector3(r.get_center().x, h + rail_h * 0.5, r.end.y - 0.05), Vector3(r.size.x, rail_h, 0.1), wood)
	_box(parent, Vector3(r.get_center().x, h + rail_h * 0.5, r.end.y - 0.05), Vector3(r.size.x, rail_h, 0.2), wood, false, true).visible = false
	# the ramp: rises from the ground at z = r.position.y - len up to the slab edge
	var len := 9.0
	var ramp_w := 2.4
	var rx := r.position.x + 1.6
	var rise := h
	var run := sqrt(len * len - rise * rise)
	var ang := atan2(rise, run)
	var body := StaticBody3D.new()
	body.collision_layer = Data.L_WORLD
	body.collision_mask = 0
	body.position = Vector3(rx, rise * 0.5 - 0.15, r.position.y - run * 0.5)
	body.rotation.x = -ang
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(ramp_w, 0.3, len + 0.2)
	cs.shape = bs
	body.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(ramp_w, 0.3, len + 0.2)
	mi.mesh = bm
	mi.material_override = wood
	body.add_child(mi)
	parent.add_child(body)
	nav.block_rect(Rect2(rx - ramp_w * 0.5, r.position.y - run, ramp_w, run), 0.3)
	for side in [-1.0, 1.0]:
		var rail := _flat(parent, Vector3(rx + side * (ramp_w * 0.5 + 0.05), rise * 0.5 + 0.5, r.position.y - run * 0.5), Vector3(0.1, 0.9, len), wood)
		rail.rotation.x = -ang
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.78, 0.5)
	lamp.light_energy = 1.6
	lamp.omni_range = 9.0
	lamp.position = Vector3(r.get_center().x, h - 0.5, r.get_center().y)
	parent.add_child(lamp)
	lamps.append(lamp)
	reserved.append(Rect2(r.position.x, r.position.y - run - 0.5, r.size.x, r.size.y + run + 0.5))
	spots["roof_loot"] = Vector3(r.get_center().x - 0.4, h + 0.2, r.get_center().y + 1.0)
	spots["loot13"] = spots["roof_loot"]
	spots["roof_ramp"] = Vector3(rx, 0, r.position.y - run - 0.5)
	spots["roof_top"] = Vector3(r.get_center().x, h, r.get_center().y)
	_prop(parent, "crate", Vector3(r.get_center().x - 1.2, h, r.get_center().y + 2.6), 0.95, 25, false)
	_ph(parent, "barrel", Vector3(r.position.x + 0.7, h, r.end.y - 0.9), 0.95, 0, false)


func _church() -> void:
	var n := _new_zone("church", Rect2(-34, -126, 60, 38))
	var stone := Surf.mat("church_brick", 3.0, Color(0.72, 0.72, 0.78), 0.5, 1.0)
	Kit.building(self, n, Rect2(11, -108, 14, 16), 9.0, 1, ["w", "n", "s"], ["w"], "HARBOUR CAFE", 40)
	Kit.building(self, n, Rect2(11, -124, 14, 14), 10.0, 4, ["w", "n", "s"], ["w"], "CHANDLER", 41)
	var ch := Rect2(-28, -118, 17, 22)
	_room(n, ch, 8.0, stone, {"e": [[-109.0, -105.5]]})
	_flat(n, Vector3(ch.get_center().x, 0.03, ch.get_center().y), Vector3(16.4, 0.06, 21.4), Surf.mat("tiles_brown", 1.6, Color(0.5, 0.5, 0.55), 0.0, 0.8, 0.8))
	# a steep slate roof over the nave and a belfry gable on the front
	var roof := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(ch.size.x + 1.6, 5.2, ch.size.y + 1.0)
	roof.mesh = pm
	roof.material_override = Surf.mat("roof_grey", 2.2, Color(0.42, 0.44, 0.5), 0.0, 1.0)
	roof.position = Vector3(ch.get_center().x, 8.0 + pm.size.y * 0.5 - 0.1, ch.get_center().y)
	n.add_child(roof)
	var pew := Surf.mat("planks_brown", 1.6, Color(0.56, 0.5, 0.46), 0.0, 0.6)
	for i in range(4):
		_box(n, Vector3(-23.5, 0.45, -113 + i * 3.6), Vector3(3.0, 0.9, 0.7), pew)
		_box(n, Vector3(-16.5, 0.45, -113 + i * 3.6), Vector3(3.0, 0.9, 0.7), pew)
	_box(n, Vector3(-26.5, 0.55, -107), Vector3(1.4, 1.1, 3.4), Surf.mat("stone", 1.6, Color(0.7, 0.7, 0.76), 0.0, 0.5))
	var cl := OmniLight3D.new()
	cl.light_color = Color(1.0, 0.8, 0.55)
	cl.light_energy = 1.4
	cl.omni_range = 11.0
	cl.position = Vector3(-19, 3.4, -107)
	n.add_child(cl)
	_ph(n, "lantern", Vector3(-24.8, 0.0, -104.0), 0.9, 0, false)
	_ph(n, "lantern", Vector3(-24.8, 0.0, -110.5), 0.9, 0, false)
	_ph(n, "bust", Vector3(-26.0, 1.1, -103.0), 0.7, 90, false)
	_prop(n, "church_bell", Vector3(-18, 0, -96.8), 3.2, 0, false, false)
	for z in [-96.0, -112.0, -120.0]:
		_lamp(n, Vector3(-9.2, 0, z))
		_lamp(n, Vector3(9.2, 0, z + 2.0))
	_prop(n, "car_wreck", Vector3(3.0, 0, -100), 4.4, 80, true)
	_prop(n, "crate", Vector3(-7.0, 0, -98), 0.95, 10)
	_prop(n, "crate", Vector3(-7.4, 0, -99.3), 0.95, 40)
	occupied.append_array([Vector3(3, 0, -100), Vector3(-7.2, 0, -98.6), Vector3(-18, 0, -96.8)])
	spots["church_door"] = Vector3(-10.8, 0, -107.3)
	spots["ally2"] = Vector3(-19.5, 0, -112.5)
	spots["plaza"] = Vector3(0, 0, -100)
	spots["loot9"] = Vector3(-7.2, 0.9, -98.6)
	spots["loot10"] = Vector3(-16.5, 1.0, -106.0)
	spots["note3"] = Vector3(-26.0, 1.1, -108.0)
	var street := [["bin", 0.95, false, true, 2.0], ["barrel", 0.95, false, true, 2.0], ["bench", 0.9, false, true, 2.0], ["planter", 0.7, false, true, 2.0], ["trashbag", 0.55, false, false, 3.0], ["crate_b", 0.8, false, true, 1.0], ["tyre", 0.7, false, false, 1.0]]
	_scatter(n, Rect2(7.3, -126, 2.0, 38), street, 12, 41, 3.0)
	_scatter(n, Rect2(-9.4, -126, 2.0, 38), street, 12, 42, 3.0)
	_scatter(n, Rect2(-6.0, -126, 12.0, 38), [["tyre", 0.7, false, false, 2.0], ["trashbag", 0.55, false, false, 3.0], ["barrier", 2.2, true, true, 1.0]], 6, 43, 4.0, true)
	_scatter(n, Rect2(-34, -126, 6.0, 38), [["dead_tree", 4.0, true, false, 2.0], ["boulder", 1.6, false, true, 1.0], ["fir", 8.0, false, true, 2.0]], 5, 44, 4.5, true)


func _bell_road() -> void:
	var n := _new_zone("road", Rect2(-30, -200, 60, 78))
	var rock := Surf.mat("rock", 4.0, Color(0.5, 0.55, 0.58), 0.0, 0.8, 1.0)
	for i in range(0, 12):
		var z := -128.0 - i * 6.0
		_box(n, Vector3(-6.2 - (i % 3) * 0.4, 0.8, z), Vector3(2.6, 1.6 + (i % 4) * 0.5, 3.2), rock)
		_box(n, Vector3(6.2 + (i % 2) * 0.5, 0.8, z - 2.5), Vector3(2.6, 1.6 + (i % 3) * 0.6, 3.2), rock)
	_box(n, Vector3(-14.0, 3.0, -160), Vector3(14, 6, 70), rock)
	_box(n, Vector3(14.0, 3.0, -160), Vector3(14, 6, 70), rock)
	for p in [Vector3(-9, 0, -132), Vector3(9, 0, -140), Vector3(-9, 0, -150), Vector3(9, 0, -158), Vector3(-9, 0, -170), Vector3(9, 0, -178)]:
		_tree(n, p)
	_lamp(n, Vector3(-5.2, 0, -138))
	_lamp(n, Vector3(5.2, 0, -166), false)
	_lamp(n, Vector3(-5.2, 0, -186))
	_prop(n, "car_wreck", Vector3(-1.5, 0, -150), 4.4, 20, true)
	_prop(n, "van_wreck", Vector3(3.6, 0, -158), 4.8, 35, true)
	_fire(n, Vector3(3.6, 0, -158))
	_flipped(n, "police_car", Vector3(-2.6, 0, -168), 4.4, -50.0, 180.0)
	_prop(n, "crate", Vector3(3.0, 0, -172), 0.95, 0)
	occupied.append_array([Vector3(-1.5, 0, -150), Vector3(3, 0, -172)])
	# the barricade: planks, tyres, barrels, jersey barriers
	var bm := Surf.mat("planks_brown", 1.4, Color(0.55, 0.42, 0.36), 0.0, 0.8, 1.0)
	barricade = _box(n, Vector3(0, 1.3, -124), Vector3(12, 2.6, 1.2), bm, true, true)
	Batcher.keep(barricade)
	var strut := _box(n, Vector3(-3.0, 2.4, -124), Vector3(0.3, 2.0, 0.4), bm, false, false)
	strut.rotation_degrees.z = 20
	Batcher.keep(strut)
	for dx in [-5.0, -2.5, 2.2, 5.0]:
		var t := _ph(n, "tyre", Vector3(dx, 0, -125.4), 0.7, 0, false)
		Batcher.keep(t)
		barricade_bits.append(t)
	for dx in [-4.0, 3.8]:
		var bb := _ph(n, "barrel", Vector3(dx, 0, -122.8), 0.95, 20, false)
		Batcher.keep(bb)
		barricade_bits.append(bb)
	spots["barricade"] = Vector3(0, 0, -122.4)
	spots["road_mid"] = Vector3(0, 0, -150)
	spots["loot11"] = Vector3(3.0, 0.9, -172)
	spots["loot12"] = Vector3(-1.5, 0.9, -148.5)
	spots["note4"] = Vector3(-6.0, 1.0, -140)
	_scatter(n, Rect2(-5.0, -196, 10.0, 66), [["tyre", 0.7, false, false, 2.0], ["trashbag", 0.55, false, false, 1.0], ["boulder", 0.9, false, true, 1.5], ["barrier", 2.2, true, true, 0.8]], 10, 51, 4.0, true)
	_scatter(n, Rect2(-24, -198, 15, 70), [["fir", 9.0, false, true, 3.0], ["boulder", 2.0, false, true, 2.0], ["dead_tree_b", 4.0, true, false, 1.0]], 8, 52, 5.0, true)
	_scatter(n, Rect2(9, -198, 15, 70), [["fir", 9.0, false, true, 3.0], ["boulder", 2.0, false, true, 2.0], ["dead_tree", 4.0, true, false, 1.0]], 8, 53, 5.0, true)


func open_storeroom() -> void:
	if storeroom_door != null:
		storeroom_door.queue_free()
		storeroom_door = null
	nav.unblock_rect(STORE_GAP)


func burn_barricade() -> void:
	if barricade == null:
		return
	game.fx.explosion(barricade.global_position + Vector3(0, 0.5, 0), 4.0)
	barricade.queue_free()
	barricade = null
	for b in barricade_bits:
		if is_instance_valid(b):
			b.queue_free()
	barricade_bits.clear()
	nav.unblock_rect(Rect2(-7.0, -125.5, 14, 3.5))


func _arena() -> void:
	var n := _new_zone("arena", Rect2(-30, -240, 60, 52))
	var rock := Surf.mat("stone", 3.0, Color(0.55, 0.58, 0.62), 0.3, 0.9, 1.0)
	_flat(n, Vector3(0, 0.04, -208), Vector3(36, 0.08, 34), Surf.mat("cobble", 2.4, Color(0.5, 0.52, 0.56), 0.0, 0.5, 1.0))
	_wall(n, Vector2(-18, -192), Vector2(-18, -226), 7.0, 1.0, rock)
	_wall(n, Vector2(18, -192), Vector2(18, -226), 7.0, 1.0, rock)
	_wall(n, Vector2(-18, -226), Vector2(18, -226), 7.0, 1.0, rock)
	arena_gate = _box(n, Vector3(0, 3.0, -191), Vector3(10, 6, 1.0), Surf.mat("shutter", 3.0, Color(0.5, 0.4, 0.4), 0.0, 0.6), false, true)
	Batcher.keep(arena_gate)
	arena_gate.visible = false
	arena_gate.get_child(1).disabled = true
	# the tower and its bell
	var tower := Surf.mat("church_brick", 3.0, Color(0.62, 0.62, 0.7), 0.4, 1.0, 1.0)
	_box(n, Vector3(0, 9.0, -224), Vector3(9, 18, 6), tower)
	_box(n, Vector3(0, 20.0, -224), Vector3(11, 4, 8), Surf.mat("stone", 3.0, Color(0.5, 0.52, 0.58), 0.2, 0.9), false, false)
	var spire := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(11.6, 6.0, 8.6)
	spire.mesh = pm
	spire.material_override = Surf.mat("roof_grey", 2.0, Color(0.38, 0.4, 0.46), 0.0, 1.0)
	spire.position = Vector3(0, 25.0, -224)
	n.add_child(spire)
	_prop(n, "church_bell", Vector3(0, 14.0, -221.5), 5.0, 0, false, false)
	var lamp_m := Surf.mat("metal", 2.0, Color(0.4, 0.42, 0.46), 0.0, 0.6, 0.0)
	for p in [Vector3(-15, 0, -198), Vector3(15, 0, -198), Vector3(-15, 0, -216), Vector3(15, 0, -216)]:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.25, 0.3)
		l.light_energy = 1.4
		l.omni_range = 14.0
		l.position = p + Vector3(0, 3, 0)
		l.shadow_enabled = false
		n.add_child(l)
		_box(n, p + Vector3(0, 1.0, 0), Vector3(1.0, 2.0, 1.0), lamp_m)
		_flat(n, p + Vector3(0, 2.1, 0), Vector3(0.7, 0.4, 0.7), Toon.flat(Color(1.0, 0.35, 0.4), 0.0, 0.0, Color(1.0, 0.15, 0.2), 1.6))
	for dx in [-9.0, 9.0]:
		_ph(n, "boulder", Vector3(dx, 0, -194.5), 1.8, dx * 11.0)
		_ph(n, "dead_tree", Vector3(dx * 1.7, 0, -222.0), 4.0, dx * 7.0, false, true)
	spots["arena"] = Vector3(0, 0, -200)
	spots["boss_spawn"] = Vector3(0, 0, -212)
	spots["arena_gate"] = Vector3(0, 0, -191)


func close_arena() -> void:
	if arena_gate != null:
		arena_gate.visible = true
		arena_gate.get_child(1).disabled = false
		nav.block_rect(Rect2(-5, -191.6, 10, 1.2), 0.1)


func _harbour() -> void:
	var n := _new_zone("harbour", Rect2(-100, -150, 70, 190))
	var water := Toon.flat(Color(0.1, 0.15, 0.18), 0.0, 0.0, Color(0.02, 0.05, 0.06), 0.5)
	_flat(n, Vector3(-65, -0.9, -60), Vector3(70, 0.1, 200), water)
	_flat(n, Vector3(-36, 0.0, -30), Vector3(8, 0.2, 80), Surf.mat("planks_brown", 1.8, Color(0.55, 0.52, 0.5), 0.0, 0.8, 1.0))
	var post := Surf.mat("planks_brown", 1.0, Color(0.42, 0.38, 0.36), 0.0, 0.8, 0.0)
	for i in 5:
		_box(n, Vector3(-39.5, 0.6, -6 - i * 14.0), Vector3(0.4, 1.2, 0.4), post, false, false)
	_prop(n, "boat", Vector3(-48, -0.2, -22), 6.0, 90, true, false)
	_prop(n, "boat", Vector3(-50, -0.2, -64), 5.5, 80, true, false)
	_ph(n, "ship", Vector3(-58, -0.6, -42), 14.0, 90, false, true)
	_ph(n, "pinnace", Vector3(-52, -0.5, 4), 10.0, 80, false, true)
	_ph(n, "lifebuoy", Vector3(-39.2, 0.4, -20.0), 0.7, 90, false)
	_ph(n, "buoy", Vector3(-40.5, 0, -52.0), 1.4, 0, false)
	_ph(n, "lantern", Vector3(-33.6, 0.0, -34.0), 0.9, 0, false)
	for z in [-12.0, -26.0, -40.0, -54.0]:
		_ph(n, "barrel", Vector3(-33.2, 0, z), 0.95, z * 5.0, false)
		_ph(n, "crate_a", Vector3(-34.6, 0, z - 3.5), 0.85, z * 3.0, false)
	_prop(n, "lighthouse", Vector3(-86, 0, -120), 30.0, 0, false, false)
	var beam := OmniLight3D.new()
	beam.light_color = Color(1.0, 0.85, 0.7)
	beam.light_energy = 4.0
	beam.omni_range = 60.0
	beam.position = Vector3(-86, 28, -120)
	n.add_child(beam)
	# boundary so nobody walks into the harbour
	_box(n, Vector3(-30, 1.5, -80), Vector3(1, 3, 230), Toon.flat(Color.BLACK), false, true).visible = false
	_box(n, Vector3(30, 1.5, -80), Vector3(1, 3, 230), Toon.flat(Color.BLACK), false, true).visible = false
	_box(n, Vector3(0, 1.5, 14), Vector3(60, 3, 1), Toon.flat(Color.BLACK), false, true).visible = false


func _mist() -> void:
	var sh := preload("res://shaders/mist.gdshader")
	for i in 1:
		var mi := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(150, 150)
		mi.mesh = pm
		var m := ShaderMaterial.new()
		m.shader = sh
		m.set_shader_parameter("density", 0.2)
		m.set_shader_parameter("speed", 0.012 + i * 0.006)
		m.set_shader_parameter("scale", 0.03 + i * 0.012)
		mi.material_override = m
		mi.position.y = 0.35
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		mist_sheets.append(mi)


# ── per frame ────────────────────────────────────────────────────────────────

## Streaming: zones further than STREAM_DIST from the player are hidden; only the nearest lamps keep their light on.
func update_streaming(p: Vector3) -> void:
	for z in zones:
		var r: Rect2 = zones[z].rect
		var cx := clampf(p.x, r.position.x, r.end.x)
		var cz := clampf(p.z, r.position.y, r.end.y)
		var d := Vector2(p.x - cx, p.z - cz).length()
		var on: bool = d < STREAM_DIST or z == "ground"
		var node: Node3D = zones[z].node
		if node.visible != on:
			node.visible = on
	var order: Array = []
	for l in lamps:
		order.append([l.global_position.distance_to(p), l])
	order.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for i in order.size():
		(order[i][1] as OmniLight3D).visible = i < _lamp_budget and order[i][0] < 40.0


## A car that has been thrown: upside down (or on its side), resting on its roof. `roll` 180 = flipped, 90 = on its flank.
func _flipped(parent: Node3D, model: String, pos: Vector3, length: float, yaw_deg: float, roll_deg := 180.0) -> void:
	var p := Assets.prop(model, length, true, 0.02, 0.5)
	var h := Assets.size_of(p).y
	var holder := Node3D.new()
	holder.position = Vector3(pos.x, 0, pos.z)
	holder.rotation_degrees.y = yaw_deg
	p.rotation_degrees.z = roll_deg
	p.position.y = h * (1.0 if roll_deg > 135.0 else 0.55)
	holder.add_child(p)
	parent.add_child(holder)
	var sz := Assets.size_of(p)
	var body := StaticBody3D.new()
	body.collision_layer = Data.L_WORLD
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(sz.x * 0.85, maxf(sz.y, 1.0), sz.z * 0.85)
	cs.shape = bs
	cs.position = Vector3(0, bs.size.y * 0.5, 0)
	body.add_child(cs)
	holder.add_child(body)
	var rr := deg_to_rad(yaw_deg)
	var w: float = absf(sz.x * cos(rr)) + absf(sz.z * sin(rr))
	var d: float = absf(sz.x * sin(rr)) + absf(sz.z * cos(rr))
	nav.block_rect(Rect2(pos.x - w * 0.5, pos.z - d * 0.5, w, d), 0.2)
	occupied.append(pos)


## A burning wreck: an orange light that flickers (updated in `update`).
func _fire(parent: Node3D, pos: Vector3) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.5, 0.2)
	l.omni_range = 11.0
	l.light_energy = 1.8
	l.shadow_enabled = false
	l.position = pos + Vector3(0, 1.4, 0)
	parent.add_child(l)
	fire_lights.append(l)
	var glow := Toon.flat(Color(1.0, 0.5, 0.1), 0.0, 0.0, Color(1.0, 0.45, 0.1), 2.2)
	_flat(parent, pos + Vector3(0, 1.1, 0), Vector3(0.7, 0.9, 0.7), glow)


## Rain over the street that follows the player: streaks falling in a box around them, thicker on higher graphics; none on LOW.
func _weather() -> void:
	rain = GPUParticles3D.new()
	rain.amount = 600
	rain.lifetime = 0.8
	rain.preprocess = 0.8
	rain.visibility_aabb = AABB(Vector3(-16, -14, -16), Vector3(32, 28, 32))
	rain.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(13, 0.5, 13)
	pm.direction = Vector3(0.12, -1, 0.05)
	pm.spread = 3.0
	pm.initial_velocity_min = 22.0
	pm.initial_velocity_max = 26.0
	pm.gravity = Vector3(0, -6, 0)
	rain.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.018, 0.55)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.75, 0.85, 0.95, 0.38)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	m.no_depth_test = false
	q.material = m
	rain.draw_pass_1 = q
	rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(rain)
	set_weather(weather_tier)


## 0 = clear streets (LOW), 1 = steady rain, 2 = heavy rain with lightning.
func set_weather(tier: int) -> void:
	weather_tier = tier
	if rain == null:
		return
	rain.emitting = tier > 0
	rain.amount_ratio = 0.0 if tier == 0 else (0.45 if tier == 1 else 1.0)
	rain.visible = tier > 0
	var g := get_parent()
	if g != null and g.get("sfx") != null:
		(g.sfx as Sfx).set_rain(0.0 if tier == 0 else (0.5 if tier == 1 else 1.0))


func _lightning(delta: float, p: Vector3) -> void:
	if weather_tier == 0:
		return
	_bolt_in -= delta
	if _bolt_in <= 0.0:
		_bolt_in = randf_range(16.0, 34.0)
		_bolt = 0.5
		var g := get_parent()
		if g != null and g.get("sfx") != null:
			(g.sfx as Sfx).play("thunder", -4.0, randf_range(0.55, 0.8))
	if _bolt > 0.0:
		_bolt = maxf(0.0, _bolt - delta)
		var flick := 1.0 if (int(_bolt * 24.0) % 3 != 1 and _bolt > 0.12) else 0.0
		env.ambient_light_energy = _amb_base + 1.1 * flick
		sun.light_energy = 0.62 + 0.9 * flick
	else:
		env.ambient_light_energy = _amb_base
		sun.light_energy = 0.62


## LOW graphics for weak phones: no mist sheet, fewer lamps, closer view distance, denser fog (hides the shorter draw distance).
func set_low(on: bool) -> void:
	low_gfx = on
	_lamp_budget = 3 if on else 6
	env.fog_density = 0.045 if on else 0.026
	for m in mist_sheets:
		m.visible = not on
	for z in zones:
		for c in zones[z].node.get_children():
			if c is MeshInstance3D and c.name.begins_with("batch"):
				(c as MeshInstance3D).visibility_range_end = 62.0 if on else 105.0
			elif c is MultiMeshInstance3D:
				(c as MultiMeshInstance3D).visibility_range_end = 70.0 if on else 120.0


func loaded_zones() -> Array:
	var out: Array = []
	for z in zones:
		if zones[z].node.visible:
			out.append(z)
	return out


func update(delta: float, p: Vector3) -> void:
	_t += delta
	if rain != null:
		rain.global_position = p + Vector3(0, 10.0, 0)
	_lightning(delta, p)
	for i in fire_lights.size():
		fire_lights[i].light_energy = 1.7 + 0.6 * sin(_t * 9.0 + i * 2.0) + 0.3 * sin(_t * 23.0 + i)
	for i in mist_sheets.size():
		mist_sheets[i].position.x = snappedf(p.x, 6.0)
		mist_sheets[i].position.z = snappedf(p.z, 6.0)
	if not powered:
		for i in clinic_lights.size():
			clinic_lights[i].light_energy = 0.6 + 0.4 * sin(_t * 2.0 + i) * (1.0 if sin(_t * 0.7 + i) > -0.6 else 0.2)
