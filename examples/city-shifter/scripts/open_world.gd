class_name OpenWorld
extends Node3D
## The open world: an anime countryside with a looping road, a small Japanese town with a stable, a river with an arched bridge, mountains on the horizon and
## a jungle on both sides of the road. Everything you see is a real model (generated, then prepared for phones: assets/world, assets/vehicles, assets/animals);
## the jungle is thousands of them as MultiMesh cells (one draw call per kind per cell) that disappear beyond the view distance. Vehicles and horses stand by the
## town. Eight glowing gates round the loop are the goal: pass them in order for coins.
## The same members as TrainWorld (spawn_points, progress, view_dist, update, set_view_distance, set_far_visible), so Main drives both the same way.

signal checkpoint(index: int, total: int, lap: int)
signal destroyed(at: Vector3, size: Vector3, color: Color, final: bool)
signal damaged(at: Vector3, radius: float, amount: float)   # (a local hit: Main tells the other phones)
signal smashed(at: Vector3, count: int)

const ROAD_W := 9.0
const LOOP := [Vector2(-60, 0), Vector2(60, 0), Vector2(130, -50), Vector2(160, -130), Vector2(110, -210), Vector2(20, -250), Vector2(-90, -220),
	Vector2(-160, -150), Vector2(-170, -60), Vector2(-120, -10)]
const RIVER_AT := Vector2(100, -28)
const RIVER_DIR := Vector2(0.58, 0.81)
const HALF := 330.0                       # the world is HALF*2 square
const CELL := 80.0
const TREES := [
	["res://assets/world/tree_jungle_b.glb", 10.0, 0.1], ["res://assets/world/tree_jungle_c.glb", 13.0, 0.09],
	["res://assets/world/tree_jungle_d.glb", 9.0, 0.09], ["res://assets/world/palm.glb", 9.0, 0.08], ["res://assets/world/banana.glb", 4.0, 0.06],
	["res://assets/world/bamboo.glb", 8.0, 0.07], ["res://assets/world/tree_pine.glb", 12.0, 0.08], ["res://assets/world/tree_maple.glb", 9.0, 0.05],
	["res://assets/world/tree_willow.glb", 9.0, 0.04], ["res://assets/world/tree_acacia.glb", 8.0, 0.04], ["res://assets/world/tree_baobab.glb", 10.0, 0.03],
	["res://assets/world/cherry_tree.glb", 7.0, 0.06]]
const UNDER := [["res://assets/world/bush.glb", 1.3, 12], ["res://assets/world/fern.glb", 1.1, 12], ["res://assets/world/flower_patch.glb", 0.8, 8],
	["res://assets/world/rock_small.glb", 1.2, 4], ["res://assets/world/log.glb", 1.6, 2], ["res://assets/world/rock_big.glb", 3.2, 1]]

var spawn_points: Array[Marker3D] = []
var blocked: Array[Rect2] = []            # (x, z) footprints of the houses and the like: nothing is dropped inside them
var progress := 0.0
var goal_z := -1.0e9
var speed := 0.0
var view_dist := Data.VIEW_RADIUS
var mounts: Array = []                    # Mount
var path: PackedVector2Array = PackedVector2Array()      # the road, a point every ~6 m
var gates: Array = []                     # [position, node]
var next_gate := 0
var lap := 1
var focus: Node3D                         # the local player (petals and the checkpoint test follow it)
var audio: Audio                          # set by Main: engine, hooves
var _cells: Array = []                    # MultiMeshInstance3D
var _plants := {}                         # Vector2i cell -> Array of [MultiMesh, instance index, Vector2 position, is_tree, scale]
var _gone := {}                           # "cell:index:kind" of the plants already smashed
var _far: Array = []
var _env: Environment
var _petals: CPUParticles3D
var _gate_t := 0.0
var _beam: MeshInstance3D


var lazy := false                        # true: Main builds the world a step at a time (build_async) behind the loading screen


func _ready() -> void:
	if not lazy:
		for step in _steps():
			(step[0] as Callable).call()


## [[callable, weight], ...]: the build, in order.
func _steps() -> Array:
	return [[_environment, 1], [_ground, 1], [_road, 3], [_river, 1], [_town, 2], [_district, 3], [_mountains, 2], [_jungle_prepare, 1], [func() -> void: _jungle_slice(0), 2], [func() -> void: _jungle_slice(1), 2], [func() -> void: _jungle_slice(2), 2], [func() -> void: _jungle_slice(3), 2], [func() -> void: _jungle_slice(4), 2], [func() -> void: _jungle_slice(5), 2], [_gates, 1], [_petals_fx, 1], [_spawn_points, 1], [_spawn_mounts, 4],
		[func() -> void: set_view_distance(view_dist), 1]]


func _spawn_points() -> void:
	for i in 8:
		var m := Marker3D.new()
		m.position = Vector3(-8.0 + float(i % 4) * 2.2, 0.3, 3.0 + float(i / 4) * 2.2)
		add_child(m)
		spawn_points.append(m)


## The same build as _ready, one step per frame, reporting progress 0..1 (the loading screen keeps animating between the steps).
func build_async(on_progress: Callable) -> void:
	var steps := _steps()
	var total := 0.0
	for st in steps:
		total += float(st[1])
	var done := 0.0
	for st in steps:
		(st[0] as Callable).call()
		done += float(st[1])
		on_progress.call(done / total)
		await get_tree().process_frame


# ── sky, light, ground ───────────────────────────────────────────────────────

func _environment() -> void:
	_env = Environment.new()
	_env.background_mode = Environment.BG_SKY
	_env.sky = Anime.sky()
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	_env.ambient_light_energy = 0.9
	_env.fog_enabled = true
	_env.fog_light_color = Color(0.8, 0.88, 1.0)
	_env.fog_density = 0.003
	_env.fog_sky_affect = 0.1
	_env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = _env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -22, 0)
	sun.light_color = Color(1.0, 0.95, 0.85)
	sun.light_energy = 1.25
	sun.shadow_enabled = false
	add_child(sun)


func _ground() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(HALF * 2.0 + 400.0, HALF * 2.0 + 400.0)
	mi.mesh = pm
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/ground.gdshader") as Shader
	mi.material_override = sm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(HALF * 2.0 + 100.0, 2.0, HALF * 2.0 + 100.0)
	cs.shape = bs
	cs.position.y = -1.0
	body.add_child(cs)
	add_child(body)


# ── the road ─────────────────────────────────────────────────────────────────

func _spline(pts: Array, t: float) -> Vector2:
	var n := pts.size()
	var i := int(floor(t))
	var f := t - float(i)
	var p0: Vector2 = pts[(i - 1 + n) % n]
	var p1: Vector2 = pts[i % n]
	var p2: Vector2 = pts[(i + 1) % n]
	var p3: Vector2 = pts[(i + 2) % n]
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f * f * f)


func _road() -> void:
	var raw := PackedVector2Array()
	for seg in LOOP.size():
		for k in 8:
			raw.append(_spline(LOOP, float(seg) + float(k) / 8.0))
	# resample evenly (~6 m)
	path = PackedVector2Array()
	var acc := 0.0
	path.append(raw[0])
	for i in range(1, raw.size() + 1):
		var a: Vector2 = raw[i - 1]
		var b: Vector2 = raw[i % raw.size()]
		acc += a.distance_to(b)
		if acc >= 6.0:
			path.append(b)
			acc = 0.0
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	var run := 0.0
	var n := path.size()
	for i in n + 1:
		var p: Vector2 = path[i % n]
		var q: Vector2 = path[(i + 1) % n]
		var r: Vector2 = path[(i - 1 + n) % n]
		var tdir := (q - r).normalized()
		var nrm := Vector2(-tdir.y, tdir.x)
		verts.append(Vector3(p.x + nrm.x * ROAD_W * 0.5, 0.06, p.y + nrm.y * ROAD_W * 0.5))
		verts.append(Vector3(p.x - nrm.x * ROAD_W * 0.5, 0.06, p.y - nrm.y * ROAD_W * 0.5))
		uvs.append(Vector2(0.0, run / 8.0))
		uvs.append(Vector2(1.0, run / 8.0))
		run += p.distance_to(path[(i + 1) % n])
		if i < n:
			var b := i * 2
			idx.append_array([b, b + 2, b + 1, b + 1, b + 2, b + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_TEX_UV] = uvs
	arr[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = am
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/road.gdshader") as Shader
	mi.material_override = sm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func road_distance(p: Vector2) -> float:
	var best := 1.0e9
	for q in path:
		best = minf(best, p.distance_to(q))
	return best


func _river() -> void:
	# a river across the road where it bends east, with the arched bridge on top
	var at := RIVER_AT
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(16.0, 260.0)
	mi.mesh = pm
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/water.gdshader") as Shader
	mi.material_override = sm
	mi.position = Vector3(at.x, 0.03, at.y)
	mi.rotation.y = deg_to_rad(35.6)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var br := ModelKit.fitted("res://assets/world/bridge_arch.glb", 15.0, "bottom")
	if br != null:
		br.position = Vector3(at.x, 0.0, at.y)
		br.rotation.y = deg_to_rad(125.6)
		add_child(br)
		Anime.style(br)


# ── the town ─────────────────────────────────────────────────────────────────

func _place(path_: String, pos: Vector3, yaw: float, length: float, collide := false, hp := 0.0) -> Node3D:
	var m := ModelKit.fitted(path_, length, "bottom")
	if m == null:
		return null
	m.position = pos
	m.rotation.y = yaw
	add_child(m)
	Anime.style(m)
	var sz: Vector3 = m.get_meta("size")
	var body: StaticBody3D = null
	var rect_i := -1
	if collide:
		var half := maxf(sz.x, sz.z) * 0.5
		blocked.append(Rect2(pos.x - half, pos.z - half, half * 2.0, half * 2.0))
		rect_i = blocked.size() - 1
		body = StaticBody3D.new()
		body.collision_layer = 1
		body.collision_mask = 0
		body.position = pos + Vector3(0, sz.y * 0.5, 0)
		body.rotation.y = yaw
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = sz * 0.9
		cs.shape = bs
		body.add_child(cs)
		add_child(body)
	if hp > 0.0:
		_props.append({"node": m, "body": body, "hp": hp, "max": hp, "pos": Vector2(pos.x, pos.z), "r": maxf(sz.x, sz.z) * 0.5, "h": sz.y, "size": sz, "rect": rect_i, "alive": true})
	return m


var _props: Array = []                   # the breakable things of the town and the plaza


## Something hit the world at `at`: towers, houses, signs and machines within `radius` take `amount` damage (a local hit is told to the other phones).
## Returns how many things were touched.
func damage_at(at: Vector3, radius: float, amount: float, local := true) -> int:
	var n := 0
	if district != null:
		n += district.damage_at(at, radius, amount)
	for p in _props:
		if not bool(p.alive):
			continue
		var pp: Vector2 = p.pos
		if Vector2(at.x, at.z).distance_to(pp) > radius + float(p.r) or at.y > float(p.h) + 3.0:
			continue
		n += 1
		p.hp = float(p.hp) - amount
		if float(p.hp) <= 0.0:
			p.alive = false
			(p.node as Node3D).visible = false
			if p.body != null:
				(p.body as Node3D).queue_free()
			if int(p.rect) >= 0:
				blocked[int(p.rect)] = Rect2(-9999, -9999, 1, 1)
			var sz: Vector3 = p.size
			destroyed.emit(Vector3(pp.x, sz.y * 0.5, pp.y), sz, Color(0.78, 0.6, 0.45), true)
	if n > 0 and local:
		damaged.emit(at, radius, amount)
	return n


func _town() -> void:
	for i in 6:
		var x := -44.0 + float(i) * 17.0
		var north := i % 2 == 0
		_place("res://assets/world/shop_house.glb", Vector3(x, 0, -13.5 if north else 13.5), 0.0 if north else PI, 11.0, true, 280.0)
	for i in 8:
		var x := -40.0 + float(i) * 11.5
		_place("res://assets/world/stone_lantern.glb", Vector3(x, 0, -6.5 if i % 2 == 0 else 6.5), 0.0, 2.2, false, 30.0)
	_place("res://assets/world/torii.glb", Vector3(-56, 0, 0), PI * 0.5, 13.0, false, 320.0)
	_place("res://assets/world/torii.glb", Vector3(58, 0, 0), PI * 0.5, 13.0, false, 320.0)
	_place("res://assets/world/vending.glb", Vector3(-30, 0, -8.5), 0.0, 2.1, true, 60.0)
	_place("res://assets/world/vending.glb", Vector3(20, 0, 8.5), PI, 2.1, true, 60.0)
	_place("res://assets/world/road_sign.glb", Vector3(66, 0, 6), PI * 0.5, 3.0, false, 40.0)
	_place("res://assets/world/stable.glb", Vector3(60, 0, 31), PI, 12.0, true, 360.0)
	_place("res://assets/world/pagoda.glb", Vector3(-70, 0, -24), 0.0, 16.0, true, 700.0)
	_place("res://assets/world/windmill.glb", Vector3(40, 0, -30), 0.0, 14.0, true, 520.0)
	_place("res://assets/world/tent.glb", Vector3(-72, 0, 20), 0.6, 4.0, false, 30.0)
	for i in 5:
		_place("res://assets/world/cherry_tree.glb", Vector3(-46.0 + float(i) * 24.0, 0, -22.0 if i % 2 == 0 else 22.0), float(i), 8.0)


const DISTRICT_AT := Vector2(-170, 165)
var district: CityDistrict


## Downtown: towers, streets, a plaza with cherry trees, parked vehicles (see CityDistrict).
func _district() -> void:
	district = CityDistrict.new()
	district.name = "Downtown"
	add_child(district)
	district.build(DISTRICT_AT)
	district.destroyed.connect(func(at: Vector3, size: Vector3, color: Color, final: bool) -> void: destroyed.emit(at, size, color, final))
	var base := blocked.size()
	for r in district.blocked:
		blocked.append(r)
	district.cleared.connect(func(i: int) -> void: blocked[base + i] = Rect2(-9999, -9999, 1, 1))
	_extra_pois.append([district.plaza, 60.0, 3.0])
	for c in district.get_children():
		if c is GeometryInstance3D:
			(c as GeometryInstance3D).visibility_range_end = 330.0
	var pz := district.plaza
	for i in 8:
		var a := float(i) / 8.0 * TAU
		_place("res://assets/world/cherry_tree.glb", Vector3(pz.x + cos(a) * 11.0, 0, pz.y + sin(a) * 11.0), a, 8.0)
	for i in 6:
		var a2 := float(i) / 6.0 * TAU + 0.3
		_place("res://assets/world/stone_lantern.glb", Vector3(pz.x + cos(a2) * 6.5, 0, pz.y + sin(a2) * 6.5), 0.0, 2.2, false, 30.0)
	_place("res://assets/world/torii.glb", Vector3(pz.x, 0, pz.y + 14.5), 0.0, 13.0, false, 320.0)
	_place("res://assets/world/torii.glb", Vector3(pz.x, 0, pz.y - 14.5), 0.0, 13.0, false, 320.0)
	_place("res://assets/world/pagoda.glb", Vector3(pz.x, 0, pz.y), 0.0, 14.0, true, 700.0)
	var ext := CityDistrict.extent()
	for i in 6:
		var o := district.rect.position + Vector2(CityDistrict.STREET + 2.0 + float(i) * 24.0, CityDistrict.STREET + 1.0)
		_place("res://assets/world/vending.glb", Vector3(o.x, 0, o.y), 0.0, 2.1, true, 60.0)
	_place("res://assets/world/road_sign.glb", Vector3(district.rect.position.x + ext + 2.0, 0, DISTRICT_AT.y), -PI * 0.5, 3.0)


## True when a (x, z) point lies inside a building, a shop or another solid prop.
func is_blocked(p: Vector2) -> bool:
	for r in blocked:
		if (r as Rect2).has_point(p):
			return true
	return false


func _mountains() -> void:
	# a ring of huge boulders as the mountains on the horizon (the same real rock model, scaled up and fogged)
	if not ModelKit.exists("res://assets/world/rock_big.glb"):
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 26:
		var a := float(i) / 26.0 * TAU
		var r := HALF + 70.0 + rng.randf() * 40.0
		var m := ModelKit.fitted("res://assets/world/rock_big.glb", 90.0 + rng.randf() * 80.0, "bottom")
		m.position = Vector3(cos(a) * r, -6.0, sin(a) * r)
		m.rotation.y = rng.randf() * TAU
		m.scale = Vector3(1.0, 1.4 + rng.randf() * 0.8, 1.0)
		add_child(m)
		Anime.style(m)
		_far.append(m)


# ── the jungle ───────────────────────────────────────────────────────────────

var _jr := RandomNumberGenerator.new()
var _jkinds: Array = []
const JUNGLE_SLICES := 6


func _jungle() -> void:
	_jungle_prepare()
	for k in JUNGLE_SLICES:
		_jungle_slice(k)


func _jungle_prepare() -> void:
	_jr.seed = 2024
	var kinds: Array = []          # [mesh, target height, weight/count, is_tree]
	for t in TREES:
		var mesh := ModelKit.first_mesh(String(t[0]))
		if mesh != null:
			Anime.style_mesh(mesh)
			kinds.append([mesh, float(t[1]), float(t[2]), true, String(t[0])])
	for u in UNDER:
		var mesh2 := ModelKit.first_mesh(String(u[0]))
		if mesh2 != null:
			Anime.style_mesh(mesh2)
			kinds.append([mesh2, float(u[1]), float(u[2]), false, String(u[0])])
	_jkinds = kinds


## One slice of the grid columns (the rng runs on from slice to slice, so every phone grows the same jungle).
func _jungle_slice(part: int) -> void:
	var kinds := _jkinds
	var rng := _jr
	if kinds.is_empty():
		return
	var n := int(ceil(HALF * 2.0 / CELL))
	var c0 := (n * part) / JUNGLE_SLICES
	var c1 := (n * (part + 1)) / JUNGLE_SLICES
	for cx in range(c0, c1):
		for cz in n:
			var o := Vector2(-HALF + float(cx) * CELL, -HALF + float(cz) * CELL)
			var per_kind: Array = []
			for k in kinds:
				per_kind.append([])
			var count := 40
			for j in count:
				var p := o + Vector2(rng.randf(), rng.randf()) * CELL
				var near_road := road_distance(p) < ROAD_W * 0.5 + 4.0
				var in_town := absf(p.x) < 82.0 and p.y > -34.0 and p.y < 56.0
				if near_road or in_town or (district != null and district.rect.grow(10.0).has_point(p)):
					continue
				# trees: weighted pick; undergrowth fills the rest
				var roll := rng.randf()
				var ki := -1
				var acc := 0.0
				for q in kinds.size():
					if bool(kinds[q][3]):
						acc += float(kinds[q][2]) * 0.9
						if roll < acc and ki < 0:
							ki = q
				if ki < 0:
					var u_idx: Array = []
					for q in kinds.size():
						if not bool(kinds[q][3]):
							for rep in int(kinds[q][2]):
								u_idx.append(q)
					if u_idx.is_empty():
						continue
					ki = u_idx[rng.randi() % u_idx.size()]
				if String(kinds[ki][4]).ends_with("cherry_tree.glb") and p.length() > 150.0:
					continue
				per_kind[ki].append(p)
			for q in kinds.size():
				var pts: Array = per_kind[q]
				if pts.is_empty():
					continue
				var mm := MultiMesh.new()
				mm.transform_format = MultiMesh.TRANSFORM_3D
				mm.mesh = kinds[q][0]
				mm.instance_count = pts.size()
				var bb := (kinds[q][0] as Mesh).get_aabb()
				var base := float(kinds[q][1]) / maxf(bb.size.y, 0.01)
				var mid := o + Vector2(CELL, CELL) * 0.5            # the node sits in the middle of its cell: the visibility range measures from there
				var ckey := Vector2i(cx, cz)
				if not _plants.has(ckey):
					_plants[ckey] = []
				for i in pts.size():
					var p2: Vector2 = pts[i]
					var s := base * rng.randf_range(0.8, 1.35)
					var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.92, 1.12), s))
					mm.set_instance_transform(i, Transform3D(b, Vector3(p2.x - mid.x, 0.0, p2.y - mid.y)))
					(_plants[ckey] as Array).append([mm, i, p2, bool(kinds[q][3]), float(kinds[q][1]), Transform3D(b, Vector3(p2.x - mid.x, 0.0, p2.y - mid.y)), q])
				var mmi := MultiMeshInstance3D.new()
				mmi.multimesh = mm
				mmi.position = Vector3(mid.x, 0.0, mid.y)
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				add_child(mmi)
				_cells.append(mmi)


# ── gates (the goal) ─────────────────────────────────────────────────────────

func _gates() -> void:
	var n := path.size()
	var count := 8
	for g in count:
		var p: Vector2 = path[(g * n / count + n / count) % n]
		var q: Vector2 = path[(g * n / count + n / count + 1) % n]
		var yaw := atan2(-(q.x - p.x), -(q.y - p.y))
		var root := Node3D.new()
		root.position = Vector3(p.x, 0, p.y)
		root.rotation.y = yaw
		add_child(root)
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 4.6
		tm.outer_radius = 5.2
		tm.rings = 20
		tm.ring_segments = 8
		ring.mesh = tm
		ring.rotation_degrees = Vector3(90, 0, 0)
		ring.position.y = 5.2
		ring.material_override = Mat.unlit(Color(1.0, 0.45, 0.75), 0.9)
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(ring)
		gates.append([Vector3(p.x, 0, p.y), root, ring])
	_beam = MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.2
	cm.bottom_radius = 1.2
	cm.height = 60.0
	cm.radial_segments = 10
	cm.rings = 1
	_beam.mesh = cm
	_beam.material_override = Mat.unlit(Color(1.0, 0.85, 0.3), 0.28)
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_beam)
	_mark_gate()


func _mark_gate() -> void:
	for i in gates.size():
		var ring: MeshInstance3D = gates[i][2]
		ring.visible = true
		ring.scale = Vector3.ONE * (1.0 if i == next_gate else 0.7)
		ring.material_override = Mat.unlit(Color(1.0, 0.85, 0.3) if i == next_gate else Color(0.6, 0.55, 0.8), 0.9 if i == next_gate else 0.45)
	var p: Vector3 = gates[next_gate][0]
	_beam.position = p + Vector3(0, 30.0, 0)


func gate_position() -> Vector3:
	return gates[next_gate][0]


# ── mounts ───────────────────────────────────────────────────────────────────

func _spawn_mounts() -> void:
	# the car park south of the town: two rows, every kind of vehicle that has a model; the horses by the stable
	var id := 0
	var slot := 0
	for k in Vehicle.SPEC:
		if not Vehicle.available(k):
			continue
		var row := slot % 2
		var col := slot / 2
		var v := Vehicle.new()
		add_child(v)
		v.setup(id, k)
		v.position = Vector3(-60.0 + float(col) * 13.0, 0, 38.0 + float(row) * 11.0)
		v.yaw = PI * 0.5 if row == 0 else -PI * 0.5
		v.rotation.y = v.yaw
		mounts.append(v)
		id += 1
		slot += 1
	if district != null:
		var kinds := ["taxi", "police", "sports", "van", "bus", "ambulance", "firetruck", "car", "truck", "pickup"]
		var n := 0
		for si in district.car_slots.size():
			if si % 3 != 1 or n >= kinds.size():
				continue
			var k: String = kinds[n]
			n += 1
			if not Vehicle.available(k):
				continue
			var spot: Array = district.car_slots[si]
			var v2 := Vehicle.new()
			add_child(v2)
			v2.setup(id, k)
			v2.position = spot[0]
			v2.yaw = float(spot[1])
			v2.rotation.y = v2.yaw
			mounts.append(v2)
			id += 1
	if Horse.available():
		for i in 4:
			var h := Horse.new()
			add_child(h)
			h.setup(id)
			h.hoofed.connect(_on_hoof.bind(h))
			h.position = Vector3(48.0 + float(i) * 4.0, 0, 22.0 + float(i % 2) * 3.0)
			h.yaw = PI * 0.5 + float(i) * 0.4
			h.rotation.y = h.yaw
			mounts.append(h)
			id += 1


func _on_hoof(strength: float, h: Horse) -> void:
	if audio == null or focus == null:
		return
	var d := focus.global_position.distance_to(h.global_position)
	if d < 28.0:
		audio.play("hoof", lerpf(-8.0, -22.0, clampf(d / 28.0, 0.0, 1.0)) + strength * 3.0, randf_range(0.85, 1.15))


func get_mount(id: int) -> Mount:
	for m in mounts:
		if (m as Mount).mount_id == id:
			return m
	return null


## Everything that grows within `reach` metres of `at` (flat) is knocked flat: its instance shrinks to nothing and a burst of leaves flies. Trees slow whoever hits them.
## Returns how many trees were hit. `local` false = this is another phone's smash (no event is sent back).
func smash(at: Vector3, reach: float, local := true) -> int:
	var trees := 0
	var any := 0
	var c0 := Vector2i(int(floor((at.x + HALF) / CELL)), int(floor((at.z + HALF) / CELL)))
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var key := Vector2i(c0.x + dx, c0.y + dz)
			if not _plants.has(key):
				continue
			for e in _plants[key]:
				var tag := "%d:%d:%d" % [key.x, key.y, int(e[1]) * 31 + int(e[6])]
				if _gone.has(tag):
					continue
				var pp: Vector2 = e[2]
				var rr := reach + (0.0 if bool(e[3]) else -0.6)
				if Vector2(at.x, at.z).distance_to(pp) < rr:
					_gone[tag] = true
					var t: Transform3D = e[5]
					(e[0] as MultiMesh).set_instance_transform(int(e[1]), Transform3D(Basis().scaled(Vector3.ONE * 0.0001), t.origin))
					any += 1
					if bool(e[3]):
						trees += 1
	if any > 0:
		smashed.emit(at, any if local else -any)
	return trees


## Where weapons and people gather: [centre, radius, weight].
func pois() -> Array:
	return [[Vector2(0, 18), 55.0, 3.0], [Vector2(-10, 43), 35.0, 1.5], [Vector2(60, 31), 25.0, 1.5], [Vector2(-70, -24), 28.0, 1.0], [Vector2(40, -30), 25.0, 1.0],
		[Vector2(-72, 20), 20.0, 0.8], [Vector2(100, -28), 25.0, 0.8], [Vector2(-150, -120), 60.0, 1.2], [Vector2(130, -170), 50.0, 1.0]] + _extra_pois


var _extra_pois: Array = []


## The free mount closest to `pos` within its own reach, or null.
func nearest_mount(pos: Vector3) -> Mount:
	var best: Mount = null
	var bd := 1.0e9
	for m in mounts:
		var mm := m as Mount
		if not mm.is_free():
			continue
		var d := pos.distance_to(mm.global_position)
		if d < mm.radius + 1.2 and d < bd:
			bd = d
			best = mm
	return best


# ── per frame ────────────────────────────────────────────────────────────────

func update(delta: float) -> void:
	_gate_t += delta
	if audio != null and focus != null:
		var pc := focus as PlayerController
		if pc != null and pc.mount is Vehicle:
			var v := pc.mount as Vehicle
			var f := clampf(absf(v.speed) / float(v.spec.max), 0.0, 1.0)
			audio.set_engine(0.15 + f * 0.85, 0.7 + f * 1.5 + (0.25 if v.boosting else 0.0))
		else:
			audio.set_engine(-1.0, 1.0)
	if focus != null:
		_petals.global_position = focus.global_position + Vector3(0, 9, 0)
		var fp := focus.global_position
		var g: Vector3 = gates[next_gate][0]
		if Vector2(fp.x - g.x, fp.z - g.z).length() < 8.0 and fp.y < 9.0:
			next_gate += 1
			progress += 100.0
			if next_gate >= gates.size():
				next_gate = 0
				lap += 1
			checkpoint.emit(next_gate, gates.size(), lap)
			_mark_gate()
	var pulse := 1.0 + 0.06 * sin(_gate_t * 4.0)
	(gates[next_gate][2] as MeshInstance3D).scale = Vector3.ONE * pulse


func _petals_fx() -> void:
	_petals = CPUParticles3D.new()
	_petals.amount = 90
	_petals.lifetime = 9.0
	_petals.preprocess = 9.0
	_petals.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_petals.emission_box_extents = Vector3(22, 1, 22)
	_petals.direction = Vector3(0.4, -1, 0.2)
	_petals.spread = 25.0
	_petals.initial_velocity_min = 0.6
	_petals.initial_velocity_max = 1.4
	_petals.gravity = Vector3(0.3, -0.4, 0.1)
	_petals.angular_velocity_min = -120.0
	_petals.angular_velocity_max = 120.0
	var qm := QuadMesh.new()
	qm.size = Vector2(0.16, 0.1)
	_petals.mesh = qm
	_petals.material_override = Mat.unlit(Color(1.0, 0.72, 0.82))
	add_child(_petals)


func set_view_distance(d: float) -> void:
	view_dist = clampf(d, 30.0, Data.VIEW_RADIUS)          # nobody sees farther than 50 m: no advantage
	for c in _cells:
		var g := c as GeometryInstance3D
		g.visibility_range_end = view_dist + 25.0
		g.visibility_range_end_margin = 12.0
		g.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	if _env != null:
		_env.fog_density = 1.3 / (view_dist + 80.0) * 0.5


func set_far_visible(on: bool) -> void:
	for f in _far:
		(f as Node3D).visible = on
