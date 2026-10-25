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
var storeroom_door: StaticBody3D
var exit_door: StaticBody3D
var arena_gate: StaticBody3D
var env: Environment
var sun: DirectionalLight3D
var mist_sheets: Array[MeshInstance3D] = []
var powered := false
var _t := 0.0
var _zone_node: Node3D
var _rng := RandomNumberGenerator.new()
var _lamp_budget := 6

# palette
const C_WALL := Color(0.62, 0.64, 0.62)
const C_FLOOR := Color(0.46, 0.48, 0.47)
const C_ROAD := Color(0.2, 0.21, 0.23)
const C_WALK := Color(0.4, 0.4, 0.4)
const C_GROUND := Color(0.2, 0.24, 0.21)


func build() -> void:
	_rng.seed = 11
	nav.setup(Rect2(-100, -260, 200, 300), 0.5)
	_environment()
	_ground()
	_clinic()
	_market_street()
	_church()
	_bell_road()
	_arena()
	_harbour()
	_mist()
	for z in zones:
		zones[z].node.visible = true


# ── environment ──────────────────────────────────────────────────────────────

func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.34, 0.39, 0.42)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.66)
	env.ambient_light_energy = 0.5
	env.fog_enabled = true
	env.fog_light_color = Color(0.36, 0.41, 0.44)
	env.fog_density = 0.034
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
	_flat(n, Vector3(0, -0.05, -110), Vector3(200, 0.1, 300), Toon.flat(C_GROUND, 0.0, 0.8))
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
	# street + sidewalks
	_flat(n, Vector3(0, 0.0, -88), Vector3(14, 0.06, 126), Toon.flat(C_ROAD, 0.0, 0.7))
	_flat(n, Vector3(-8.2, 0.02, -88), Vector3(2.4, 0.08, 126), Toon.flat(C_WALK, 0.0, 0.6))
	_flat(n, Vector3(8.2, 0.02, -88), Vector3(2.4, 0.08, 126), Toon.flat(C_WALK, 0.0, 0.6))
	_flat(n, Vector3(0, 0.0, -158), Vector3(10, 0.06, 70), Toon.flat(C_ROAD.lightened(0.04), 0.0, 0.8))
	_forest(n, -95, 95, -10, 18, 70, 24, 3)
	_forest(n, -95, 95, -250, -20, 420, 30, 5)
	for i in range(0, 20):
		_flat(n, Vector3(0, 0.05, -28 - i * 6.0), Vector3(0.25, 0.02, 2.6), Toon.flat(Color(0.75, 0.72, 0.6), 0.0, 0.3))


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
func _wall(parent: Node3D, a: Vector2, b: Vector2, h: float, th: float, mat: Material, gaps: Array = []) -> void:
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


func _room(parent: Node3D, r: Rect2, h: float, mat: Material, gaps := {}) -> void:
	_wall(parent, Vector2(r.position.x, r.position.y), Vector2(r.end.x, r.position.y), h, 0.4, mat, gaps.get("n", []))
	_wall(parent, Vector2(r.position.x, r.end.y), Vector2(r.end.x, r.end.y), h, 0.4, mat, gaps.get("s", []))
	_wall(parent, Vector2(r.position.x, r.position.y), Vector2(r.position.x, r.end.y), h, 0.4, mat, gaps.get("w", []))
	_wall(parent, Vector2(r.end.x, r.position.y), Vector2(r.end.x, r.end.y), h, 0.4, mat, gaps.get("e", []))


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


## A building block with lit windows on the face toward the road (face = +1 east face, -1 west face).
func _building(parent: Node3D, r: Rect2, h: float, color: Color, face: int) -> void:
	_box(parent, Vector3(r.get_center().x, h * 0.5, r.get_center().y), Vector3(r.size.x, h, r.size.y), Toon.flat(color, 0.02, 0.8))
	# gabled roof (prism, ridge along z) + a chimney
	var roof := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(r.size.x + 1.2, 2.4 + r.size.x * 0.12, r.size.y + 1.0)
	roof.mesh = pm
	roof.material_override = Toon.flat(color.darkened(0.45).lerp(Color(0.25, 0.2, 0.2), 0.4), 0.025, 0.7)
	roof.position = Vector3(r.get_center().x, h + pm.size.y * 0.5, r.get_center().y)
	roof.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(roof)
	_flat(parent, Vector3(r.get_center().x + r.size.x * 0.25, h + pm.size.y * 0.7, r.get_center().y - r.size.y * 0.2), Vector3(0.9, 2.4, 0.9), Toon.flat(Color(0.3, 0.26, 0.26), 0.02, 0.5))
	if face == 0:
		return
	var x := r.end.x + 0.03 if face > 0 else r.position.x - 0.03
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var nx := float(face)
	var z := r.position.y + 2.0
	while z < r.end.y - 1.5:
		var y := 2.4
		while y < h - 1.2:
			if _rng.randf() < 0.5:
				var z0 := z
				var z1 := z + 1.2
				var y0 := y
				var y1 := y + 1.5
				var quad := [Vector3(x, y0, z0), Vector3(x, y1, z0), Vector3(x, y1, z1), Vector3(x, y0, z1)]
				var order := [0, 1, 2, 0, 2, 3] if face > 0 else [0, 2, 1, 0, 3, 2]
				for i in order:
					st.set_normal(Vector3(nx, 0, 0))
					st.add_vertex(quad[i])
			y += 3.2
		z += 3.0
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = Toon.flat(Color(1.0, 0.8, 0.5), 0.0, 0.0, Color(1.0, 0.55, 0.3), 1.5)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


## One combined pine (trunk + three stacked cones) used by every forest MultiMesh.
func _pine_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	var parts: Array = []
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.16
	trunk.bottom_radius = 0.26
	trunk.height = 2.0
	trunk.radial_segments = 6
	parts.append([trunk, Transform3D(Basis(), Vector3(0, 1.0, 0))])
	for i in 3:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 1.9 - i * 0.45
		cone.height = 2.6
		cone.radial_segments = 7
		parts.append([cone, Transform3D(Basis(), Vector3(0, 2.6 + i * 1.5, 0))])
	var first := true
	for p in parts:
		st.append_from(p[0], 0, p[1])
	var am := st.commit()
	return am


## Scatter pines inside [x0,x1] x [z0,z1], skipping the corridor |x| < keep_out around the road when keep_out > 0.
func _forest(parent: Node3D, x0: float, x1: float, z0: float, z1: float, count: int, keep_out := 0.0, seed_v := 1) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _pine_mesh()
	var xs: Array = []
	for i in count:
		var p := Vector3(rng.randf_range(x0, x1), 0, rng.randf_range(z0, z1))
		if keep_out > 0.0 and absf(p.x) < keep_out:
			continue
		xs.append(Transform3D(Basis().scaled(Vector3.ONE * rng.randf_range(0.8, 1.7)).rotated(Vector3.UP, rng.randf() * TAU), p))
	mm.instance_count = xs.size()
	for i in xs.size():
		mm.set_instance_transform(i, xs[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = Toon.flat(Color(0.13, 0.2, 0.17), 0.03, 0.4)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


func _tree(parent: Node3D, pos: Vector3) -> void:
	var trunk := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.1
	cm.bottom_radius = 0.2
	cm.height = 3.0
	cm.radial_segments = 6
	trunk.mesh = cm
	trunk.material_override = Toon.flat(Color(0.18, 0.12, 0.14), 0.02, 0.5)
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


# ── Chapter 1 places ─────────────────────────────────────────────────────────

func _clinic() -> void:
	var n := _new_zone("clinic", Rect2(-14, -28, 28, 44))
	var wall := Toon.flat(C_WALL, 0.02, 0.5)
	var floor_m := Toon.flat(C_FLOOR, 0.0, 0.5)
	_flat(n, Vector3(0, 0.02, -6), Vector3(26, 0.06, 40), floor_m)
	# ward (start): x[-5,5] z[2,12]; corridor x[-2.5,2.5] z[-14,2]; storage west; office east; generator room z[-24,-14]
	_room(n, Rect2(-5, 2, 10, 10), WALL_H, wall, {"n": [[-1.2, 1.2]]})
	_wall(n, Vector2(-2.5, 2), Vector2(-2.5, -14), WALL_H, 0.4, wall, [[-6.6, -3.4]])
	_wall(n, Vector2(2.5, 2), Vector2(2.5, -14), WALL_H, 0.4, wall, [[-6.6, -3.4]])
	_room(n, Rect2(-12, -12, 9.5, 10), WALL_H, wall, {"e": [[-6.6, -3.4]]})
	_room(n, Rect2(2.5, -12, 9.5, 10), WALL_H, wall, {"w": [[-6.6, -3.4]]})
	_room(n, Rect2(-7, -26, 14, 12), WALL_H, wall, {"s": [[-1.2, 1.2]], "n": [[-1.6, 1.6]]})
	exit_door = _box(n, Vector3(0, WALL_H * 0.5, -26), Vector3(3.2, WALL_H, 0.5), Toon.flat(Color(0.35, 0.18, 0.22), 0.02, 0.4), false, true)
	# furniture
	_prop(n, "clinic_bed", Vector3(-3.0, 0, 9.5), 2.0, 90, true)
	_prop(n, "clinic_bed", Vector3(3.0, 0, 9.5), 2.0, 90, true)
	_box(n, Vector3(3.6, 0.45, 6.0), Vector3(1.2, 0.9, 0.7), Toon.flat(Color(0.5, 0.36, 0.28), 0.02))
	_box(n, Vector3(-9.0, 0.9, -11.2), Vector3(5.0, 1.8, 0.8), Toon.flat(Color(0.4, 0.42, 0.48), 0.02))
	_box(n, Vector3(8.5, 0.45, -8.0), Vector3(2.4, 0.9, 1.0), Toon.flat(Color(0.5, 0.36, 0.28), 0.02))
	_box(n, Vector3(-5.5, 0.6, -24.6), Vector3(1.6, 1.2, 0.8), Toon.flat(Color(0.4, 0.45, 0.4), 0.02))
	_prop(n, "generator", Vector3(0, 0, -23.0), 1.1, 0, false, true)
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
	var cols := [Color(0.5, 0.46, 0.42), Color(0.42, 0.47, 0.52), Color(0.52, 0.42, 0.38), Color(0.43, 0.5, 0.46), Color(0.48, 0.45, 0.4)]
	# west side blocks with alleys at z = -44 and -80
	var west: Array = [[-28, -40, 9], [-48, -78, 11], [-84, -92, 8]]
	for i in west.size():
		var s: Array = west[i]
		_building(n, Rect2(-27, minf(s[0], s[1]), 16, absf(s[1] - s[0])), float(s[2]), cols[i % cols.size()], 1)
	# east side: blocks, then the radio shop (enterable)
	_building(n, Rect2(11, -44, 14, 16), 9.0, cols[2], -1)
	_building(n, Rect2(11, -58, 14, 12), 8.0, cols[4], -1)
	_building(n, Rect2(11, -82, 14, 10), 10.0, cols[1], -1)
	_building(n, Rect2(11, -92, 14, 8), 8.0, cols[3], -1)
	var wall := Toon.flat(Color(0.6, 0.55, 0.5), 0.02, 0.7)
	var shop := Rect2(10.5, -72, 12, 14)
	_room(n, shop, WALL_H, wall, {"w": [[-66.0, -63.4]]})
	_flat(n, Vector3(16.5, 0.03, -65), Vector3(11.4, 0.06, 13.4), Toon.flat(Color(0.4, 0.34, 0.38), 0.0, 0.4))
	_wall(n, Vector2(10.5, -66), Vector2(22.5, -66), WALL_H, 0.4, wall, [[15.0, 17.0]])
	storeroom_door = _box(n, Vector3(16.0, 1.3, -66), Vector3(2.0, 2.6, 0.45), Toon.flat(Color(0.3, 0.2, 0.2), 0.02), false, true)
	nav.block_rect(STORE_GAP, 0.0)
	_prop(n, "workbench", Vector3(14.0, 0, -60.3), 2.0, 0, true, true)
	_box(n, Vector3(20.5, 1.0, -62.0), Vector3(1.0, 2.0, 3.0), Toon.flat(Color(0.4, 0.34, 0.3), 0.02))
	_box(n, Vector3(20.5, 0.5, -69.2), Vector3(1.4, 1.0, 1.4), Toon.flat(Color(0.34, 0.28, 0.3), 0.02))
	var shop_light := OmniLight3D.new()
	shop_light.light_color = Color(1.0, 0.82, 0.6)
	shop_light.light_energy = 1.3
	shop_light.omni_range = 9.0
	shop_light.position = Vector3(16, 2.8, -64)
	n.add_child(shop_light)
	# street dressing
	for z in [-34.0, -52.0, -70.0, -88.0]:
		_lamp(n, Vector3(-9.2, 0, z))
		_lamp(n, Vector3(9.2, 0, z - 9.0))
	_prop(n, "car_wreck", Vector3(-3.2, 0, -38), 4.4, 12, true)
	_prop(n, "car_wreck", Vector3(3.5, 0, -57), 4.4, -8, true)
	_prop(n, "car_wreck", Vector3(-4.0, 0, -74), 4.4, 170, true)
	_prop(n, "market_stall", Vector3(-7.8, 0, -47), 2.8, 90, true)
	_prop(n, "market_stall", Vector3(-7.8, 0, -55), 2.8, 90, true)
	_prop(n, "market_stall", Vector3(7.8, 0, -49), 2.8, -90, true)
	_prop(n, "crate", Vector3(-6.6, 0, -62), 0.95, 20)
	_prop(n, "crate", Vector3(-6.2, 0, -63.2), 0.95, 50)
	_prop(n, "crate", Vector3(6.8, 0, -36), 0.95, 0)
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


func _church() -> void:
	var n := _new_zone("church", Rect2(-34, -126, 60, 38))
	var wall := Toon.flat(Color(0.6, 0.58, 0.55), 0.02, 0.7)
	_building(n, Rect2(11, -108, 14, 16), 9.0, Color(0.46, 0.4, 0.5), -1)
	_building(n, Rect2(11, -124, 14, 14), 10.0, Color(0.5, 0.42, 0.44), -1)
	var ch := Rect2(-28, -118, 17, 22)
	_room(n, ch, 8.0, wall, {"e": [[-109.0, -105.5]]})
	_flat(n, Vector3(ch.get_center().x, 0.03, ch.get_center().y), Vector3(16.4, 0.06, 21.4), Toon.flat(Color(0.36, 0.34, 0.32), 0.0, 0.4))
	for i in range(4):
		_box(n, Vector3(-23.5, 0.45, -113 + i * 3.6), Vector3(3.0, 0.9, 0.7), Toon.flat(Color(0.42, 0.28, 0.24), 0.02))
		_box(n, Vector3(-16.5, 0.45, -113 + i * 3.6), Vector3(3.0, 0.9, 0.7), Toon.flat(Color(0.42, 0.28, 0.24), 0.02))
	_box(n, Vector3(-26.5, 0.55, -107), Vector3(1.4, 1.1, 3.4), Toon.flat(Color(0.6, 0.55, 0.62), 0.02))
	var cl := OmniLight3D.new()
	cl.light_color = Color(1.0, 0.8, 0.55)
	cl.light_energy = 1.4
	cl.omni_range = 11.0
	cl.position = Vector3(-19, 3.4, -107)
	n.add_child(cl)
	_prop(n, "church_bell", Vector3(-18, 0, -96.8), 3.2, 0, false, false)
	for z in [-96.0, -112.0, -120.0]:
		_lamp(n, Vector3(-9.2, 0, z))
		_lamp(n, Vector3(9.2, 0, z + 2.0))
	_prop(n, "car_wreck", Vector3(3.0, 0, -100), 4.4, 80, true)
	_prop(n, "crate", Vector3(-7.0, 0, -98), 0.95, 10)
	_prop(n, "crate", Vector3(-7.4, 0, -99.3), 0.95, 40)
	spots["church_door"] = Vector3(-10.8, 0, -107.3)
	spots["ally2"] = Vector3(-19.5, 0, -112.5)
	spots["plaza"] = Vector3(0, 0, -100)
	spots["loot9"] = Vector3(-7.2, 0.9, -98.6)
	spots["loot10"] = Vector3(-16.5, 1.0, -106.0)
	spots["note3"] = Vector3(-26.0, 1.1, -108.0)


func _bell_road() -> void:
	var n := _new_zone("road", Rect2(-30, -200, 60, 78))
	var rock := Toon.flat(Color(0.3, 0.31, 0.3), 0.02, 0.8)
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
	_prop(n, "crate", Vector3(3.0, 0, -172), 0.95, 0)
	# the barricade
	var bm := Toon.flat(Color(0.35, 0.24, 0.2), 0.03, 0.6, Color(0, 0, 0))
	barricade = _box(n, Vector3(0, 1.3, -124), Vector3(12, 2.6, 1.2), bm, true, true)
	_box(n, Vector3(-3.0, 2.4, -124), Vector3(0.3, 2.0, 0.4), bm, false, false).rotation_degrees.z = 20
	spots["barricade"] = Vector3(0, 0, -122.4)
	spots["road_mid"] = Vector3(0, 0, -150)
	spots["loot11"] = Vector3(3.0, 0.9, -172)
	spots["loot12"] = Vector3(-1.5, 0.9, -148.5)
	spots["note4"] = Vector3(-6.0, 1.0, -140)


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
	nav.unblock_rect(Rect2(-7.0, -125.5, 14, 3.5))


func _arena() -> void:
	var n := _new_zone("arena", Rect2(-30, -240, 60, 52))
	var rock := Toon.flat(Color(0.28, 0.29, 0.29), 0.02, 0.8)
	_flat(n, Vector3(0, 0.04, -208), Vector3(36, 0.08, 34), Toon.flat(Color(0.3, 0.3, 0.3), 0.0, 0.7))
	_wall(n, Vector2(-18, -192), Vector2(-18, -226), 7.0, 1.0, rock)
	_wall(n, Vector2(18, -192), Vector2(18, -226), 7.0, 1.0, rock)
	_wall(n, Vector2(-18, -226), Vector2(18, -226), 7.0, 1.0, rock)
	arena_gate = _box(n, Vector3(0, 3.0, -191), Vector3(10, 6, 1.0), rock, false, true)
	arena_gate.visible = false
	arena_gate.get_child(1).disabled = true
	# the tower and its bell
	_box(n, Vector3(0, 9.0, -224), Vector3(9, 18, 6), Toon.flat(Color(0.48, 0.46, 0.46), 0.03, 0.8))
	_box(n, Vector3(0, 20.0, -224), Vector3(11, 4, 8), Toon.flat(Color(0.4, 0.38, 0.38), 0.03, 0.8), false, false)
	_prop(n, "church_bell", Vector3(0, 14.0, -221.5), 5.0, 0, false, false)
	for p in [Vector3(-15, 0, -198), Vector3(15, 0, -198), Vector3(-15, 0, -216), Vector3(15, 0, -216)]:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.25, 0.3)
		l.light_energy = 1.4
		l.omni_range = 14.0
		l.position = p + Vector3(0, 3, 0)
		l.shadow_enabled = false
		n.add_child(l)
		_box(n, p + Vector3(0, 1.0, 0), Vector3(1.0, 2.0, 1.0), rock)
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
	_flat(n, Vector3(-36, 0.0, -30), Vector3(8, 0.2, 80), Toon.flat(Color(0.32, 0.22, 0.2), 0.02, 0.6))
	for i in 5:
		_box(n, Vector3(-39.5, 0.6, -6 - i * 14.0), Vector3(0.4, 1.2, 0.4), Toon.flat(Color(0.2, 0.14, 0.14)), false, false)
	_prop(n, "boat", Vector3(-48, -0.2, -22), 6.0, 90, true, false)
	_prop(n, "boat", Vector3(-50, -0.2, -64), 5.5, 80, true, false)
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


func loaded_zones() -> Array:
	var out: Array = []
	for z in zones:
		if zones[z].node.visible:
			out.append(z)
	return out


func update(delta: float, p: Vector3) -> void:
	_t += delta
	for i in mist_sheets.size():
		mist_sheets[i].position.x = snappedf(p.x, 6.0)
		mist_sheets[i].position.z = snappedf(p.z, 6.0)
	if not powered:
		for i in clinic_lights.size():
			clinic_lights[i].light_energy = 0.6 + 0.4 * sin(_t * 2.0 + i) * (1.0 if sin(_t * 0.7 + i) > -0.6 else 0.2)
