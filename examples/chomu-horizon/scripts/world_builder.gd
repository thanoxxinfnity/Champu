class_name WorldBuilder
extends Node3D
## One open-world map, built from the data tools/bake_maps.py wrote to
## res://maps/<id>/: a 2 km heightfield, the road network, and the
## placement of every TRELLIS asset, building, ramp, coin and portal.
##
## Terrain is 16×16 chunks of one shared grid mesh, lifted in the vertex
## shader from the heightmap, in two LODs swapped by visibility range. The
## same heights feed a HeightMapShape3D, so what you see is what you drive
## on. Roads are ribbons with their own collision laid on a carved corridor.

const CHUNK := 128.0
const VEG_CELL := 96.0
const LANE := 3.5
const TEX_DIR := "res://textures/ground/"

## Look of each biome: ground layers, tints and fog.
const BIOMES := {
	"hills": {"flat": "grass", "steep": "rock", "patch": "dirt", "peak": "snow", "peak_start": 330.0,
		"flat_tint": Color(1.0, 1.0, 1.0), "steep_tint": Color(0.95, 0.95, 0.92), "patch_tint": Color(1, 1, 1),
		"steep_start": 0.3, "patch_amt": 0.35, "fog": 0.00045, "mountain": Color(0.24, 0.3, 0.26)},
	"city": {"flat": "grass", "steep": "rock", "patch": "dirt", "peak": "rock", "peak_start": 9999.0,
		"flat_tint": Color(0.95, 1.0, 0.9), "steep_tint": Color(1, 1, 1), "patch_tint": Color(1, 1, 1),
		"steep_start": 0.3, "patch_amt": 0.25, "fog": 0.0004, "mountain": Color(0.22, 0.27, 0.25)},
	"desert": {"flat": "sand", "steep": "redrock", "patch": "dirt", "peak": "redrock", "peak_start": 9999.0,
		"flat_tint": Color(1.0, 1.0, 1.0), "steep_tint": Color(1.0, 0.95, 0.92), "patch_tint": Color(1.3, 1.0, 0.8),
		"steep_start": 0.22, "patch_amt": 0.3, "fog": 0.00035, "mountain": Color(0.55, 0.3, 0.2)},
	"snow": {"flat": "snow", "steep": "rock", "patch": "rock", "peak": "snow", "peak_start": 9999.0,
		"flat_tint": Color(1.0, 1.0, 1.0), "steep_tint": Color(0.85, 0.87, 0.9), "patch_tint": Color(0.9, 0.9, 0.95),
		"steep_start": 0.45, "patch_amt": 0.12, "fog": 0.0006, "mountain": Color(0.75, 0.8, 0.88)},
}

var map_id := "hills"
var meta: Dictionary
var heights: PackedFloat32Array
var grid_n := 513
var spacing := 4.0
var half_size := 1024.0
var has_water := false
var water_level := -1000.0
var biome := "hills"
var is_city := false
var city_extent := 0.0
var minimap: Texture2D

# Road network: every road's samples (2 m apart) back to back, road 0 (the
# main loop) first, so main-loop indices are also global indices.
var samples := PackedVector3Array()
var tangents := PackedVector3Array()
var distances := PackedFloat32Array()
var curvature := PackedFloat32Array()
var sample_road := PackedInt32Array()
var road_ranges: Array[Vector2i] = []
var road_half := PackedFloat32Array()
var road_closed: Array[bool] = []
var main_count := 0
var total_length := 0.0
var speed_trap_index := 0
var drift_zone := Vector2i(0, 0)
var portals: Array[Dictionary] = []
var coins: CoinField
var traffic: TrafficSystem

var sun: DirectionalLight3D
var env: Environment
var sky_mat: ShaderMaterial
var time_of_day := "golden"
var quality := 1

var _grid := {}
var _lamp_mat: StandardMaterial3D
var _arch_mat: StandardMaterial3D
var _building_mat: ShaderMaterial
var _terrain_mat: ShaderMaterial
var _water_mat: ShaderMaterial
var _veg: Array = []          # [GeometryInstance3D, base_begin, base_end]
var _terrain_near: Array[MeshInstance3D] = []
var _terrain_far: Array[MeshInstance3D] = []
var _plaza_rect := Rect2()
var _textures := {}


func _init(id: String = "hills") -> void:
	map_id = id


func build() -> void:
	_load_data()
	_index_roads()
	_build_environment()
	_build_terrain()
	_build_water()
	_build_roads()
	_build_markings()
	_build_rails()
	_build_lamps()
	if is_city:
		_build_city()
	_build_vegetation()
	_build_colliders()
	_build_ramps()
	_build_plaza_and_portals()
	_build_start_arch()
	_build_far_mountains()
	_build_bounds()
	coins = CoinField.new()
	coins.name = "Coins"
	add_child(coins)
	coins.setup(meta.coins)
	traffic = TrafficSystem.new()
	traffic.name = "Traffic"
	add_child(traffic)
	traffic.setup(self)
	set_time_of_day(time_of_day)
	set_quality(quality)


# ─────────────────────────────── data ──────────────────────────────────────


func _load_data() -> void:
	var dir := "res://maps/%s/" % map_id
	meta = JSON.parse_string(FileAccess.get_file_as_string(dir + "meta.json"))
	heights = FileAccess.get_file_as_bytes(dir + "height.f32").to_float32_array()
	grid_n = int(meta.n)
	spacing = float(meta.spacing)
	half_size = float(meta.size) * 0.5
	has_water = meta.water != null
	water_level = float(meta.water) if has_water else -1000.0
	biome = meta.biome
	is_city = meta.city != null
	if is_city:
		city_extent = float(meta.city.extent)
	minimap = load(dir + "minimap.png")


## Terrain height at a world position (bilinear between the samples).
func height_at(x: float, z: float) -> float:
	var fx := clampf((x + half_size) / spacing, 0.0, grid_n - 1.001)
	var fz := clampf((z + half_size) / spacing, 0.0, grid_n - 1.001)
	var i := int(fx)
	var j := int(fz)
	var tx := fx - i
	var tz := fz - j
	var a := heights[j * grid_n + i]
	var b := heights[j * grid_n + i + 1]
	var c := heights[(j + 1) * grid_n + i]
	var d := heights[(j + 1) * grid_n + i + 1]
	# Same triangles as the terrain mesh and the collision shape.
	if tx + tz <= 1.0:
		return a + (b - a) * tx + (c - a) * tz
	return d + (c - d) * (1.0 - tx) + (b - d) * (1.0 - tz)


func _index_roads() -> void:
	var roads: Array = meta.roads
	for ri in roads.size():
		var r: Dictionary = roads[ri]
		var xs: Array = r.x
		var ys: Array = r.y
		var zs: Array = r.z
		var ks: Array = r.k
		var start := samples.size()
		var count := xs.size()
		var acc := 0.0
		for k in count:
			samples.append(Vector3(xs[k], ys[k], zs[k]))
			curvature.append(ks[k])
			sample_road.append(ri)
			if k > 0:
				acc += samples[start + k].distance_to(samples[start + k - 1])
			distances.append(acc)
		road_ranges.append(Vector2i(start, count))
		road_half.append(float(r.half))
		road_closed.append(bool(r.closed))
		for k in count:
			var prev := start + (k - 1 + count) % count if r.closed else start + maxi(k - 1, 0)
			var next := start + (k + 1) % count if r.closed else start + mini(k + 1, count - 1)
			var t := samples[next] - samples[prev]
			t.y = 0.0
			tangents.append(t.normalized())
	main_count = road_ranges[0].y
	total_length = distances[main_count - 1] + 2.0
	for i in samples.size():
		# Packed arrays are values: append to a local and store it back.
		var key := _cell(samples[i])
		var bucket: PackedInt32Array = _grid.get(key, PackedInt32Array())
		bucket.append(i)
		_grid[key] = bucket
	speed_trap_index = int(meta.speed_trap)
	drift_zone = Vector2i(int(meta.drift_zone[0]), int(meta.drift_zone[1]))
	var pz: Dictionary = meta.plaza
	var ps: Array = pz.size
	_plaza_rect = Rect2(pz.center[0] - ps[0] * 0.5 - 6.0, pz.center[2] - ps[1] * 0.5 - 6.0, ps[0] + 12.0, ps[1] + 12.0)


func _cell(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / 24.0), floori(p.z / 24.0))


## Nearest road sample. The grid search covers ±48 m; beyond that
## `exhaustive` falls back to scanning every sample (only resets need that).
func nearest_index(p: Vector3, exhaustive: bool = true) -> int:
	var c: Vector2i = _cell(p)
	var best := -1
	var best_d := INF
	for dx in range(-2, 3):
		for dz in range(-2, 3):
			var key := Vector2i(c.x + dx, c.y + dz)
			if not _grid.has(key):
				continue
			for i in (_grid[key] as PackedInt32Array):
				var d: float = Vector2(samples[i].x - p.x, samples[i].z - p.z).length_squared()
				if d < best_d:
					best_d = d
					best = i
	if best >= 0 or not exhaustive:
		return best
	for i in samples.size():
		var d2 := Vector2(samples[i].x - p.x, samples[i].z - p.z).length_squared()
		if d2 < best_d:
			best_d = d2
			best = i
	return best


func distance_to_road(p: Vector3) -> float:
	var i := nearest_index(p, false)
	if i < 0:
		return 999.0
	return Vector2(samples[i].x - p.x, samples[i].z - p.z).length()


func in_city(p: Vector3) -> bool:
	return is_city and absf(p.x) < city_extent + 8.0 and absf(p.z) < city_extent + 8.0


func on_plaza(p: Vector3) -> bool:
	return _plaza_rect.has_point(Vector2(p.x, p.z))


func is_offroad(p: Vector3) -> bool:
	if in_city(p) or on_plaza(p):
		return false
	var i := nearest_index(p, false)
	if i < 0:
		return true
	return Vector2(samples[i].x - p.x, samples[i].z - p.z).length() > road_half[sample_road[i]] + 1.2


## Where to put a car back on the road near `p`, facing along `heading`.
func reset_transform(p: Vector3, heading: Vector3) -> Transform3D:
	var i := nearest_index(p)
	var t := tangents[i]
	if heading.dot(t) < 0.0:
		t = -t
	var right := t.cross(Vector3.UP).normalized()
	var pos := samples[i] + right * LANE * 0.5 + Vector3.UP * 0.7
	return Transform3D(Basis.looking_at(-t, Vector3.UP), pos)


func spawn_transform() -> Transform3D:
	var i := int(meta.spawn_index)
	var t := tangents[i]
	var pos := samples[i] + t.cross(Vector3.UP).normalized() * LANE * 0.5 + Vector3.UP * 0.7
	return Transform3D(Basis.looking_at(-t, Vector3.UP), pos)


## Arrival point after a portal: on the plaza, facing the road.
func portal_arrival() -> Transform3D:
	var pz: Dictionary = meta.plaza
	var c := Vector3(pz.center[0], pz.center[1], pz.center[2])
	var nrm := Vector3(pz.normal[0], 0.0, pz.normal[1])
	var pos := c + nrm * -2.0 + Vector3.UP * 0.8
	return Transform3D(Basis.looking_at(nrm, Vector3.UP), pos)


func minimap_points() -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(0, main_count, 4):
		out.append(Vector2(samples[i].x, samples[i].z))
	return out


# ─────────────────────────────── environment ───────────────────────────────


func _tex(name: String) -> Texture2D:
	if not _textures.has(name):
		_textures[name] = load(TEX_DIR + name + ".jpg")
	return _textures[name]


static func _noise_tex(freq: float, seed_: int, normal: bool, size: int = 512, octaves: int = 5) -> NoiseTexture2D:
	var fn := FastNoiseLite.new()
	fn.seed = seed_
	fn.frequency = freq
	fn.fractal_octaves = octaves
	fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	var tex := NoiseTexture2D.new()
	tex.width = size
	tex.height = size
	tex.seamless = true
	tex.noise = fn
	if normal:
		tex.as_normal_map = true
		tex.bump_strength = 6.0
	return tex


func _build_environment() -> void:
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = preload("res://shaders/sky.gdshader")
	var clouds := _noise_tex(0.006, 77, false, 512, 6)
	sky_mat.set_shader_parameter("cloud_noise", clouds)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	sky.process_mode = Sky.PROCESS_MODE_QUALITY
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.75
	env.glow_bloom = 0.05
	env.glow_hdr_threshold = 1.1
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.fog_enabled = true
	env.fog_density = BIOMES[biome].fog
	env.fog_sky_affect = 0.15
	env.fog_aerial_perspective = 0.2
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.12
	env.adjustment_contrast = 1.07
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 110.0
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 1.2
	add_child(sun)


func set_time_of_day(mode: String) -> void:
	time_of_day = mode
	var night := mode == "night"
	var top: Color
	var horizon: Color
	var fog_col: Color
	var sun_tint: Color
	match mode:
		"day":
			sun.rotation_degrees = Vector3(-52.0, 38.0, 0.0)
			sun.light_color = Color(1.0, 0.97, 0.92)
			sun.light_energy = 1.3
			top = Color(0.14, 0.34, 0.72)
			horizon = Color(0.6, 0.74, 0.9)
			fog_col = Color(0.64, 0.75, 0.88)
			sun_tint = Color(1.0, 0.95, 0.85)
			env.ambient_light_energy = 1.0
			sky_mat.set_shader_parameter("cloud_light", Color(1.0, 1.0, 1.0))
			sky_mat.set_shader_parameter("cloud_shadow", Color(0.55, 0.6, 0.7))
			sky_mat.set_shader_parameter("cloud_cover", 0.42)
		"night":
			sun.rotation_degrees = Vector3(-35.0, -120.0, 0.0)
			sun.light_color = Color(0.55, 0.65, 1.0)
			sun.light_energy = 0.38
			top = Color(0.012, 0.022, 0.06)
			horizon = Color(0.07, 0.09, 0.17)
			fog_col = Color(0.05, 0.065, 0.11)
			sun_tint = Color(0.4, 0.5, 0.8)
			env.ambient_light_energy = 1.6
			sky_mat.set_shader_parameter("cloud_light", Color(0.08, 0.09, 0.13))
			sky_mat.set_shader_parameter("cloud_shadow", Color(0.02, 0.025, 0.04))
			sky_mat.set_shader_parameter("cloud_cover", 0.3)
		_:
			sun.rotation_degrees = Vector3(-12.0, 150.0, 0.0)
			sun.light_color = Color(1.0, 0.78, 0.56)
			sun.light_energy = 1.3
			top = Color(0.18, 0.3, 0.56)
			horizon = Color(0.98, 0.64, 0.38)
			fog_col = Color(0.92, 0.64, 0.45)
			sun_tint = Color(1.0, 0.7, 0.42)
			env.ambient_light_energy = 0.75
			sky_mat.set_shader_parameter("cloud_light", Color(1.0, 0.78, 0.58))
			sky_mat.set_shader_parameter("cloud_shadow", Color(0.42, 0.36, 0.45))
			sky_mat.set_shader_parameter("cloud_cover", 0.48)
	if biome == "desert" and not night:
		horizon = horizon.lerp(Color(0.95, 0.72, 0.5), 0.4)
		fog_col = fog_col.lerp(Color(0.9, 0.7, 0.5), 0.5)
	if biome == "snow" and not night:
		env.tonemap_exposure = 0.82
	else:
		env.tonemap_exposure = 1.0
	sky_mat.set_shader_parameter("top_color", top)
	sky_mat.set_shader_parameter("horizon_color", horizon)
	sky_mat.set_shader_parameter("ground_color", fog_col.darkened(0.5))
	sky_mat.set_shader_parameter("sun_tint", sun_tint)
	sky_mat.set_shader_parameter("stars", 1.0 if night else 0.0)
	env.fog_light_color = fog_col
	sun.shadow_enabled = not night and quality < 2
	if _lamp_mat:
		_lamp_mat.emission_energy_multiplier = 6.0 if night else 0.3
	if _arch_mat:
		_arch_mat.emission_energy_multiplier = 5.0 if night else 1.6
	if _building_mat:
		_building_mat.set_shader_parameter("night", 1.0 if night else 0.0)
	if _water_mat:
		_water_mat.set_shader_parameter("sky_color", horizon.lerp(top, 0.5))
	if traffic:
		traffic.set_lights(night)


## 0 = HIGH, 1 = BALANCED, 2 = BATTERY: how far detail is drawn.
func set_quality(q: int) -> void:
	quality = q
	var k := [1.0, 0.8, 0.55][clampi(q, 0, 2)] as float
	for entry in _veg:
		var gi: GeometryInstance3D = entry[0]
		gi.visibility_range_begin = entry[1] * k
		gi.visibility_range_end = entry[2] * k if entry[2] > 0.0 else 0.0
	var near_end := 480.0 * k
	for mi in _terrain_near:
		mi.visibility_range_end = near_end
	for mi in _terrain_far:
		mi.visibility_range_begin = near_end
	env.fog_density = BIOMES[biome].fog * (1.0 if q == 0 else 1.25 if q == 1 else 1.7)
	sun.shadow_enabled = time_of_day != "night" and q < 2


# ─────────────────────────────── terrain ───────────────────────────────────


func _grid_mesh(q: int, size: float) -> ArrayMesh:
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var norms := PackedVector3Array()
	var idx := PackedInt32Array()
	var s := size / q
	for j in q + 1:
		for i in q + 1:
			verts.append(Vector3(i * s, 0.0, j * s))
			cols.append(Color(1, 1, 1, 1))
			norms.append(Vector3.UP)
	for j in q:
		for i in q:
			var a := j * (q + 1) + i
			var b := a + 1
			var c := a + q + 1
			var d := c + 1
			idx.append_array([a, b, c, b, d, c])
	# Skirts: a copy of every edge vertex (alpha 0, pulled down in the shader).
	var edges: Array[PackedInt32Array] = [PackedInt32Array(), PackedInt32Array(), PackedInt32Array(), PackedInt32Array()]
	for k in q + 1:
		edges[0].append(k)
		edges[1].append(q * (q + 1) + k)
		edges[2].append(k * (q + 1))
		edges[3].append(k * (q + 1) + q)
	for e in edges:
		var base := verts.size()
		for k in e.size():
			verts.append(verts[e[k]])
			cols.append(Color(1, 1, 1, 0))
			norms.append(Vector3.UP)
		for k in e.size() - 1:
			var a2 := e[k]
			var b2 := e[k + 1]
			var c2 := base + k
			var d2 := base + k + 1
			idx.append_array([a2, b2, c2, b2, d2, c2, a2, c2, b2, b2, c2, d2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m


func _build_terrain() -> void:
	var b: Dictionary = BIOMES[biome]
	var img := Image.create_from_data(grid_n, grid_n, false, Image.FORMAT_RF, heights.to_byte_array())
	var htex := ImageTexture.create_from_image(img)
	_terrain_mat = ShaderMaterial.new()
	_terrain_mat.shader = preload("res://shaders/terrain.gdshader")
	var p := {
		"height_map": htex, "spacing": spacing, "half_size": half_size, "grid_n": grid_n,
		"flat_albedo": _tex(b.flat + "_a"), "flat_normal": _tex(b.flat + "_n"),
		"steep_albedo": _tex(b.steep + "_a"), "steep_normal": _tex(b.steep + "_n"),
		"patch_albedo": _tex(b.patch + "_a"), "peak_albedo": _tex(b.peak + "_a"),
		"macro_noise": _noise_tex(0.004, 9, false, 256, 4),
		"flat_tint": b.flat_tint, "steep_tint": b.steep_tint, "patch_tint": b.patch_tint,
		"steep_start": b.steep_start, "steep_end": b.steep_start + 0.22, "patch_amount": b.patch_amt,
		"peak_start": b.peak_start, "shore_level": water_level + 0.5 if has_water else -9999.0,
		"water_level": water_level if has_water else -9999.0,
	}
	for k in p:
		_terrain_mat.set_shader_parameter(k, p[k])
	var near_mesh := _grid_mesh(32, CHUNK)
	var far_mesh := _grid_mesh(8, CHUNK)
	var cn := int(half_size * 2.0 / CHUNK)
	var ranges: Array = meta.chunks
	var terrain := Node3D.new()
	terrain.name = "Terrain"
	add_child(terrain)
	for cj in cn:
		for ci in cn:
			var mm: Array = ranges[cj * cn + ci]
			var aabb := AABB(Vector3(0, float(mm[0]) - 10.0, 0), Vector3(CHUNK, float(mm[1]) - float(mm[0]) + 20.0, CHUNK))
			for lod in 2:
				var mi := MeshInstance3D.new()
				mi.mesh = near_mesh if lod == 0 else far_mesh
				mi.material_override = _terrain_mat
				mi.position = Vector3(-half_size + ci * CHUNK, 0.0, -half_size + cj * CHUNK)
				mi.custom_aabb = aabb
				if lod == 0:
					mi.visibility_range_end = 480.0
					mi.visibility_range_end_margin = 20.0
					_terrain_near.append(mi)
				else:
					mi.visibility_range_begin = 480.0
					mi.visibility_range_begin_margin = 20.0
					mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
					_terrain_far.append(mi)
				terrain.add_child(mi)
	# Collision: the same samples as a heightfield (uniformly scaled, so the
	# heights are stored divided by the spacing).
	var shape := HeightMapShape3D.new()
	shape.map_width = grid_n
	shape.map_depth = grid_n
	var scaled := heights.duplicate()
	var inv := 1.0 / spacing
	for k in scaled.size():
		scaled[k] *= inv
	shape.map_data = scaled
	var body := StaticBody3D.new()
	body.name = "Ground"
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.scale = Vector3.ONE * spacing
	body.add_child(cs)
	add_child(body)


func _build_water() -> void:
	if not has_water:
		return
	_water_mat = ShaderMaterial.new()
	_water_mat.shader = preload("res://shaders/water.gdshader")
	_water_mat.set_shader_parameter("waves", _noise_tex(0.05, 31, true, 512, 4))
	var frozen := biome == "snow"
	_water_mat.set_shader_parameter("ice", frozen)
	if frozen:
		_water_mat.set_shader_parameter("cracks", _tex("rock_a"))
	var mi := MeshInstance3D.new()
	mi.name = "Water"
	var pm := PlaneMesh.new()
	pm.size = Vector2(9000, 9000)
	mi.mesh = pm
	mi.material_override = _water_mat
	mi.position = Vector3(0, water_level, 0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	if frozen:
		# Frozen lakes are solid: a plane at the ice surface.
		var body := StaticBody3D.new()
		body.name = "Ice"
		body.add_to_group("ice")
		var cs := CollisionShape3D.new()
		cs.shape = WorldBoundaryShape3D.new()
		body.add_child(cs)
		body.position = Vector3(0, water_level, 0)
		add_child(body)


# ─────────────────────────────── roads ─────────────────────────────────────


func _asphalt_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = _tex("asphalt_a")
	m.normal_enabled = true
	m.normal_texture = _tex("asphalt_n")
	m.normal_scale = 0.6
	m.roughness = 0.72
	m.metallic_specular = 0.55
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


func _side(i: int) -> Vector3:
	return tangents[i].cross(Vector3.UP).normalized()


## Calls `emit(i, j)` for every segment of road `ri` that should be drawn.
func _segments(ri: int, skip: Dictionary, emit: Callable) -> void:
	var rr := road_ranges[ri]
	var segs := rr.y if road_closed[ri] else rr.y - 1
	for k in segs:
		var k2 := (k + 1) % rr.y
		if skip.has(k) or skip.has(k2):
			continue
		emit.call(rr.x + k, rr.x + k2)


func _skip_set(ri: int) -> Dictionary:
	var out := {}
	for k in (meta.roads[ri].skip as Array):
		out[int(k)] = true
	return out


func _build_roads() -> void:
	var asphalt := _asphalt_material()
	var gravel := StandardMaterial3D.new()
	gravel.albedo_texture = _tex("dirt_a")
	gravel.roughness = 1.0
	gravel.uv1_scale = Vector3(1, 1, 1)
	var roads := Node3D.new()
	roads.name = "Roads"
	add_child(roads)
	for ri in road_ranges.size():
		var r: Dictionary = meta.roads[ri]
		if not r.ribbon:
			continue
		var skip := _skip_set(ri)
		var half := road_half[ri]
		var y_off := 0.03 if ri == 0 else 0.022
		# Chunks of 150 samples so each piece can be frustum-culled.
		var chunk := {"st": null, "sh": null, "faces": PackedVector3Array(), "n": 0}
		var flush := func() -> void:
			if chunk.n == 0:
				return
			var mi := MeshInstance3D.new()
			mi.mesh = (chunk.st as SurfaceTool).commit()
			mi.material_override = asphalt
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			roads.add_child(mi)
			var mi2 := MeshInstance3D.new()
			mi2.mesh = (chunk.sh as SurfaceTool).commit()
			mi2.material_override = gravel
			mi2.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			roads.add_child(mi2)
			var body := StaticBody3D.new()
			var shape := ConcavePolygonShape3D.new()
			shape.set_faces(chunk.faces)
			var cs := CollisionShape3D.new()
			cs.shape = shape
			body.add_child(cs)
			roads.add_child(body)
			chunk.n = 0
		var emit := func(i: int, j: int) -> void:
			if chunk.n == 0:
				chunk.st = SurfaceTool.new()
				(chunk.st as SurfaceTool).begin(Mesh.PRIMITIVE_TRIANGLES)
				chunk.sh = SurfaceTool.new()
				(chunk.sh as SurfaceTool).begin(Mesh.PRIMITIVE_TRIANGLES)
				chunk.faces = PackedVector3Array()
			var si := _side(i)
			var sj := _side(j)
			var up := Vector3.UP * y_off
			var pi := samples[i] + up
			var pj := samples[j] + up
			var v0 := distances[i] / 8.0
			var v1 := v0 + 0.25
			var w := half + 0.4
			var a := pi - si * w
			var b := pi + si * w
			var c := pj - sj * w
			var d := pj + sj * w
			var st: SurfaceTool = chunk.st
			for q in [[a, 0.0, v0], [c, 0.0, v1], [b, 1.0, v0], [b, 1.0, v0], [c, 0.0, v1], [d, 1.0, v1]]:
				st.set_normal(Vector3.UP)
				st.set_uv(Vector2(q[1] * half / 4.0, q[2]))
				st.add_vertex(q[0])
			var faces: PackedVector3Array = chunk.faces
			faces.append_array(PackedVector3Array([a, c, b, b, c, d]))
			# Gravel shoulders sloping down into the verge.
			var sh: SurfaceTool = chunk.sh
			for side in [-1.0, 1.0]:
				var o0: Vector3 = pi + si * side * w
				var o1: Vector3 = pj + sj * side * w
				var e0: Vector3 = pi + si * side * (w + 2.2) - Vector3.UP * 0.1
				var e1: Vector3 = pj + sj * side * (w + 2.2) - Vector3.UP * 0.1
				var quad: Array = [o0, o1, e0, e0, o1, e1] if side > 0 else [o0, e0, o1, e0, e1, o1]
				for v in quad:
					sh.set_normal(Vector3.UP)
					sh.set_uv(Vector2((v as Vector3).x, (v as Vector3).z) / 3.0)
					sh.add_vertex(v)
				faces.append_array(PackedVector3Array(quad))
			chunk.faces = faces
			chunk.n += 1
			if chunk.n >= 150:
				flush.call()
		_segments(ri, skip, emit)
		flush.call()


func _build_markings() -> void:
	var white := StandardMaterial3D.new()
	white.albedo_color = Color(0.9, 0.9, 0.86)
	white.roughness = 0.55
	var yellow := StandardMaterial3D.new()
	yellow.albedo_color = Color(0.95, 0.7, 0.08)
	yellow.roughness = 0.55
	var sw := SurfaceTool.new()
	sw.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sy := SurfaceTool.new()
	sy.begin(Mesh.PRIMITIVE_TRIANGLES)
	for ri in road_ranges.size():
		var r: Dictionary = meta.roads[ri]
		if not r.ribbon:
			continue
		var skip := _skip_set(ri)
		var half := road_half[ri]
		var y := 0.05 if ri == 0 else 0.042
		var line := func(st: SurfaceTool, off: float, width: float, dashed: bool) -> void:
			_segments(ri, skip, func(i: int, j: int) -> void:
				if dashed and int(distances[i] / 4.0) % 3 != 0:
					return
				var si := _side(i)
				var sj := _side(j)
				var up := Vector3.UP * y
				var a := samples[i] + si * (off - width) + up
				var b := samples[i] + si * (off + width) + up
				var c := samples[j] + sj * (off - width) + up
				var d := samples[j] + sj * (off + width) + up
				for v in [a, c, b, b, c, d]:
					st.set_normal(Vector3.UP)
					st.add_vertex(v))
		if half >= 7.0:
			line.call(sy, -0.15, 0.06, false)
			line.call(sy, 0.15, 0.06, false)
			line.call(sw, -LANE, 0.07, true)
			line.call(sw, LANE, 0.07, true)
		else:
			line.call(sy, 0.0, 0.07, true)
		line.call(sw, -half + 0.25, 0.1, false)
		line.call(sw, half - 0.25, 0.1, false)
	var mesh := ArrayMesh.new()
	sw.commit(mesh)
	mesh.surface_set_material(0, white)
	sy.commit(mesh)
	mesh.surface_set_material(mesh.get_surface_count() - 1, yellow)
	var mi := MeshInstance3D.new()
	mi.name = "Markings"
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func _build_rails() -> void:
	var rail_mat := StandardMaterial3D.new()
	rail_mat.albedo_color = Color(0.72, 0.74, 0.76)
	rail_mat.metallic = 0.8
	rail_mat.roughness = 0.35
	var rs := SurfaceTool.new()
	rs.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := PackedVector3Array()
	var posts: Array[Transform3D] = []
	for ri in road_ranges.size():
		if not meta.roads[ri].ribbon:
			continue
		var skip := _skip_set(ri)
		var half := road_half[ri]
		_segments(ri, skip, func(i: int, j: int) -> void:
			var k := curvature[i]
			# Outside of bends, and wherever the verge drops away steeply.
			var s0 := _side(i)
			var drop_l := samples[i].y - height_at(samples[i].x - s0.x * (half + 9.0), samples[i].z - s0.z * (half + 9.0))
			var drop_r := samples[i].y - height_at(samples[i].x + s0.x * (half + 9.0), samples[i].z + s0.z * (half + 9.0))
			var sides: Array[float] = []
			if absf(k) > 0.008:
				sides.append(signf(k))
			if drop_l > 3.0 and not sides.has(-1.0):
				sides.append(-1.0)
			if drop_r > 3.0 and not sides.has(1.0):
				sides.append(1.0)
			for side in sides:
				var si := _side(i) * side
				var sj := _side(j) * side
				var off := half + 1.6
				var a := samples[i] + si * off + Vector3.UP * 0.45
				var b := samples[i] + si * off + Vector3.UP * 0.85
				var c := samples[j] + sj * off + Vector3.UP * 0.45
				var d := samples[j] + sj * off + Vector3.UP * 0.85
				for tri in [[a, b, c], [c, b, d]]:
					for p in tri:
						rs.set_normal(-si)
						rs.add_vertex(p)
					for p in [tri[0], tri[2], tri[1]]:
						rs.set_normal(si)
						rs.add_vertex(p)
					faces.append_array(PackedVector3Array([tri[0] - Vector3.UP * 0.45, tri[1], tri[2] - Vector3.UP * 0.45]))
				if i % 2 == 0:
					posts.append(Transform3D(Basis.IDENTITY, samples[i] + si * (off + 0.08) + Vector3.UP * 0.4)))
	if faces.is_empty():
		return
	var rails := MeshInstance3D.new()
	rails.name = "Rails"
	rails.mesh = rs.commit()
	rails.material_override = rail_mat
	add_child(rails)
	var body := StaticBody3D.new()
	body.name = "RailCollision"
	body.add_to_group("obstacle")
	var shape := ConcavePolygonShape3D.new()
	shape.backface_collision = true
	shape.set_faces(faces)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	body.add_child(cs)
	add_child(body)
	var post_mesh := BoxMesh.new()
	post_mesh.size = Vector3(0.1, 0.9, 0.1)
	_multimesh("RailPosts", post_mesh, posts, rail_mat, false)


func _multimesh(node_name: String, mesh: Mesh, xforms: Array[Transform3D], mat: Material, shadows: bool, colors: Array[Color] = [], parent: Node = null) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = not colors.is_empty()
	mm.mesh = mesh
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		if mm.use_colors:
			mm.set_instance_color(i, colors[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = node_name
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	(parent if parent else self).add_child(mmi)
	return mmi


func _lamp_materials() -> StandardMaterial3D:
	var pole_mat := StandardMaterial3D.new()
	pole_mat.albedo_color = Color(0.3, 0.32, 0.34)
	pole_mat.metallic = 0.7
	pole_mat.roughness = 0.4
	if _lamp_mat == null:
		_lamp_mat = StandardMaterial3D.new()
		_lamp_mat.albedo_color = Color(1.0, 0.9, 0.7)
		_lamp_mat.emission_enabled = true
		_lamp_mat.emission = Color(1.0, 0.8, 0.52)
		_lamp_mat.emission_energy_multiplier = 0.3
	return pole_mat


func _build_lamps() -> void:
	var pole_mat := _lamp_materials()
	var poles: Array[Transform3D] = []
	var heads: Array[Transform3D] = []
	var k := 0
	for li in (meta.lamps as Array):
		var i := int(li)
		var side := -1.0 if k % 2 == 0 else 1.0
		k += 1
		var s := _side(i) * side
		var base := samples[i] + s * (road_half[0] + 3.2)
		poles.append(Transform3D(Basis.IDENTITY, base + Vector3.UP * 4.0))
		heads.append(Transform3D(Basis.looking_at(-s, Vector3.UP), base - s * 1.6 + Vector3.UP * 7.9))
	var pole := CylinderMesh.new()
	pole.top_radius = 0.09
	pole.bottom_radius = 0.14
	pole.height = 8.0
	pole.radial_segments = 8
	pole.rings = 0
	var mmi := _multimesh("LampPoles", pole, poles, pole_mat, true)
	_veg.append([mmi, 0.0, 700.0])
	var head := BoxMesh.new()
	head.size = Vector3(0.45, 0.14, 3.4)
	var hmi := _multimesh("LampHeads", head, heads, _lamp_mat, false)
	_veg.append([hmi, 0.0, 1200.0])


# ─────────────────────────────── city ──────────────────────────────────────


func _build_city() -> void:
	var c: Dictionary = meta.city
	var ext := float(c.extent)
	var sh := float(c.street_half)
	var pitch := float(c.pitch)
	var city := Node3D.new()
	city.name = "City"
	add_child(city)
	# Street surface: one asphalt slab over the whole grid, solid at y = 0.
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(ext * 2.0 + sh * 2.0, ext * 2.0 + sh * 2.0)
	ground.mesh = pm
	var am := _asphalt_material()
	am.uv1_scale = Vector3((ext * 2.0 + sh * 2.0) / 8.0, (ext * 2.0 + sh * 2.0) / 8.0, 1.0)
	ground.material_override = am
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ground.position.y = 0.01
	city.add_child(ground)
	var gb := StaticBody3D.new()
	gb.name = "CityGround"
	var gshape := BoxShape3D.new()
	gshape.size = Vector3(ext * 2.0 + sh * 2.0, 2.0, ext * 2.0 + sh * 2.0)
	var gcs := CollisionShape3D.new()
	gcs.shape = gshape
	gcs.position.y = -1.0
	gb.add_child(gcs)
	city.add_child(gb)

	# Blocks: raised pavement (grass for parks), with curb collision.
	var pave := StandardMaterial3D.new()
	pave.albedo_texture = _tex("pavement_a")
	pave.normal_enabled = true
	pave.normal_texture = _tex("pavement_n")
	pave.uv1_triplanar = true
	pave.uv1_world_triplanar = true
	pave.uv1_scale = Vector3(0.25, 0.25, 0.25)
	pave.roughness = 0.8
	var grass := StandardMaterial3D.new()
	grass.albedo_texture = _tex("grass_a")
	grass.uv1_triplanar = true
	grass.uv1_world_triplanar = true
	grass.uv1_scale = Vector3(0.15, 0.15, 0.15)
	var unit := BoxMesh.new()
	var pave_x: Array[Transform3D] = []
	var grass_x: Array[Transform3D] = []
	var body := StaticBody3D.new()
	body.name = "Blocks"
	body.add_to_group("obstacle")
	city.add_child(body)
	for b in (meta.blocks as Array):
		var x0 := float(b[0])
		var z0 := float(b[1])
		var x1 := float(b[2])
		var z1 := float(b[3])
		var size := Vector3(x1 - x0, 0.2, z1 - z0)
		var center := Vector3((x0 + x1) * 0.5, 0.1, (z0 + z1) * 0.5)
		pave_x.append(Transform3D(Basis.IDENTITY.scaled(size), center))
		if b[4] == "park":
			grass_x.append(Transform3D(Basis.IDENTITY.scaled(size - Vector3(8, -0.04, 8)), center + Vector3.UP * 0.02))
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		cs.position = center
		body.add_child(cs)
	_multimesh("Pavement", unit, pave_x, pave, false, [], city)
	if not grass_x.is_empty():
		_multimesh("Parks", unit, grass_x, grass, false, [], city)

	# Towers: unit boxes with the facade shader, chunked by district.
	_building_mat = ShaderMaterial.new()
	_building_mat.shader = preload("res://shaders/building.gdshader")
	_building_mat.set_shader_parameter("grime", _tex("rock_a"))
	var districts := {}
	var bbody := StaticBody3D.new()
	bbody.name = "Buildings"
	bbody.add_to_group("obstacle")
	city.add_child(bbody)
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for b in (meta.buildings as Array):
		var x := float(b[0])
		var z := float(b[1])
		var w := float(b[2])
		var d := float(b[3])
		var h := float(b[4])
		var style := int(b[5])
		var seed_ := float(b[6]) / 99999.0
		var key := Vector2i(floori(x / 280.0), floori(z / 280.0))
		if not districts.has(key):
			districts[key] = [[] as Array[Transform3D], [] as Array[Color]]
		var hue := rng.randf()
		var parts: Array = [[Vector3(w, h, d), Vector3(x, 0.2 + h * 0.5, z)]]
		if h > 70.0:
			var th := h * rng.randf_range(0.1, 0.2)
			parts.append([Vector3(w * 0.68, th, d * 0.68), Vector3(x, 0.2 + h + th * 0.5, z)])
			if rng.randf() < 0.5:
				parts.append([Vector3(1.2, th * 1.6, 1.2), Vector3(x, 0.2 + h + th * 1.3, z)])
		for part in parts:
			(districts[key][0] as Array).append(Transform3D(Basis.IDENTITY.scaled(part[0]), part[1]))
			(districts[key][1] as Array).append(Color(style / 4.0, seed_, hue, 0.0))
		var cs2 := CollisionShape3D.new()
		var bs2 := BoxShape3D.new()
		bs2.size = Vector3(w, h, d)
		cs2.shape = bs2
		cs2.position = Vector3(x, 0.2 + h * 0.5, z)
		bbody.add_child(cs2)
	for key in districts:
		var xs: Array = districts[key][0]
		var cols: Array = districts[key][1]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = unit
		mm.instance_count = xs.size()
		for i in xs.size():
			mm.set_instance_transform(i, xs[i])
			mm.set_instance_custom_data(i, cols[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Towers_%d_%d" % [key.x, key.y]
		mmi.multimesh = mm
		mmi.material_override = _building_mat
		city.add_child(mmi)

	# Markings: dashed centre lines between junctions, zebra crossings.
	var white := StandardMaterial3D.new()
	white.albedo_color = Color(0.88, 0.88, 0.84)
	white.roughness = 0.6
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var quad := func(center: Vector3, along: Vector3, length: float, width: float) -> void:
		var across := along.cross(Vector3.UP).normalized()
		var a := center - along * length * 0.5 - across * width * 0.5
		var b2 := center - along * length * 0.5 + across * width * 0.5
		var c2 := center + along * length * 0.5 - across * width * 0.5
		var d2 := center + along * length * 0.5 + across * width * 0.5
		for v in [a, b2, c2, b2, d2, c2]:
			st.set_normal(Vector3.UP)
			st.add_vertex(v)
	var lines := int(round(ext * 2.0 / pitch)) + 1
	for li in lines:
		var c0 := -ext + li * pitch
		for bi in lines - 1:
			var s0 := -ext + bi * pitch + sh + 3.0
			var s1 := -ext + (bi + 1) * pitch - sh - 3.0
			var t := s0
			while t < s1:
				quad.call(Vector3(c0, 0.03, t + 1.5), Vector3.BACK, 3.0, 0.15)
				quad.call(Vector3(t + 1.5, 0.03, c0), Vector3.RIGHT, 3.0, 0.15)
				t += 7.0
			# Zebra crossings at both ends of this stretch, both directions.
			for zc in [s0 - 1.5, s1 + 1.5]:
				for stripe in range(-3, 4):
					quad.call(Vector3(c0 + stripe * 2.0, 0.03, zc), Vector3.BACK, 3.0, 0.9)
					quad.call(Vector3(zc, 0.03, c0 + stripe * 2.0), Vector3.RIGHT, 3.0, 0.9)
	var mk := MeshInstance3D.new()
	mk.name = "CityMarkings"
	mk.mesh = st.commit()
	mk.material_override = white
	mk.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	city.add_child(mk)

	# Street lamps along every street.
	var pole_mat := _lamp_materials()
	var poles: Array[Transform3D] = []
	var heads: Array[Transform3D] = []
	for li in lines:
		var c0 := -ext + li * pitch
		var t := -ext + 20.0
		var k := 0
		while t < ext - 10.0:
			for dir in [0, 1]:
				var side := 1.0 if k % 2 == 0 else -1.0
				var along := Vector3.BACK if dir == 0 else Vector3.RIGHT
				var across := Vector3.RIGHT if dir == 0 else Vector3.BACK
				var base := (Vector3(c0, 0.2, t) if dir == 0 else Vector3(t, 0.2, c0)) + across * side * (sh + 1.2)
				poles.append(Transform3D(Basis.IDENTITY, base + Vector3.UP * 4.0))
				heads.append(Transform3D(Basis.looking_at(along, Vector3.UP), base - across * side * 1.6 + Vector3.UP * 7.9))
			t += 42.0
			k += 1
	var pole := CylinderMesh.new()
	pole.top_radius = 0.08
	pole.bottom_radius = 0.12
	pole.height = 8.0
	pole.radial_segments = 6
	pole.rings = 0
	var pmi := _multimesh("StreetLampPoles", pole, poles, pole_mat, false, [], city)
	_veg.append([pmi, 0.0, 500.0])
	var head := BoxMesh.new()
	head.size = Vector3(3.2, 0.14, 0.45)
	var hmi := _multimesh("StreetLampHeads", head, heads, _lamp_mat, false, [], city)
	_veg.append([hmi, 0.0, 900.0])


# ─────────────────────────────── vegetation & props ────────────────────────


func _build_vegetation() -> void:
	var inst: Dictionary = meta.instances
	var root := Node3D.new()
	root.name = "Vegetation"
	add_child(root)
	var rng := RandomNumberGenerator.new()
	rng.seed = 13
	for asset in inst.keys():
		var list: Array = inst[asset]
		if list.is_empty():
			continue
		var info := AssetLibrary.info(asset)
		var plant: bool = info.kind == "plant"
		var cells := {}
		for e in list:
			var x := float(e[0])
			var z := float(e[2])
			var s := float(e[4])
			var xf := Transform3D(Basis(Vector3.UP, float(e[3])).scaled(Vector3(s, s, s)), Vector3(x, float(e[1]), z))
			var key := Vector2i(floori(x / VEG_CELL), floori(z / VEG_CELL))
			if not cells.has(key):
				cells[key] = [[] as Array[Transform3D], [] as Array[Color]]
			(cells[key][0] as Array).append(xf)
			var v := rng.randf_range(0.82, 1.12)
			(cells[key][1] as Array).append(Color(v * rng.randf_range(0.95, 1.05), v, v * rng.randf_range(0.9, 1.0)) if plant else Color.WHITE)
		# LOD chain: textured (props, up close) → near → far.
		var lods: Array = []
		var near_end: float = info.near
		if info.kind == "prop" and AssetLibrary.has(asset, "tex"):
			var tex_end := minf(55.0, near_end * 0.5)
			lods.append(["tex", 0.0, tex_end, true])
			lods.append(["near", tex_end, near_end, true])
		else:
			lods.append(["near", 0.0, near_end, true])
		# Plants go straight to their impostor: simplified foliage breaks up
		# into floating shards, a picture of the full mesh does not.
		if plant and AssetLibrary.has(asset, "imp"):
			lods.append(["imp", near_end, info.far, false])
		elif info.far > 0.0:
			lods.append(["far", near_end, info.far, false])
		for lod in lods:
			var mesh := AssetLibrary.mesh(asset, lod[0])
			if mesh == null:
				continue
			var mat := AssetLibrary.material(asset, lod[0])
			for key in cells:
				var xs: Array[Transform3D] = []
				xs.assign(cells[key][0])
				var cs: Array[Color] = []
				if plant:
					cs.assign(cells[key][1])
				var mmi := _multimesh("%s_%s_%d_%d" % [asset, lod[0], key.x, key.y], mesh, xs, mat, lod[3] and asset != "bush", cs, root)
				mmi.visibility_range_begin = lod[1]
				mmi.visibility_range_end = lod[2]
				mmi.visibility_range_begin_margin = 8.0
				mmi.visibility_range_end_margin = 8.0
				_veg.append([mmi, lod[1], lod[2]])


func _build_colliders() -> void:
	var body := StaticBody3D.new()
	body.name = "PropCollision"
	body.add_to_group("obstacle")
	add_child(body)
	var shapes := {}
	for c in (meta.colliders as Array):
		var r := snappedf(float(c[3]), 0.05)
		var h := snappedf(float(c[4]), 0.5)
		var key := Vector2(r, h)
		if not shapes.has(key):
			var cyl := CylinderShape3D.new()
			cyl.radius = r
			cyl.height = h
			shapes[key] = cyl
		var cs := CollisionShape3D.new()
		cs.shape = shapes[key]
		cs.position = Vector3(float(c[0]), float(c[1]) + h * 0.5, float(c[2]))
		body.add_child(cs)
	for b in (meta.boxes as Array):
		var cs2 := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(float(b[3]), float(b[4]), float(b[5]))
		cs2.shape = bs
		cs2.transform = Transform3D(Basis(Vector3.UP, float(b[6])), Vector3(float(b[0]), float(b[1]), float(b[2])))
		body.add_child(cs2)


func _build_ramps() -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = _stripe_texture()
	mat.roughness = 0.6
	var root := Node3D.new()
	root.name = "Ramps"
	add_child(root)
	for r in (meta.ramps as Array):
		var slope := float(r[4])
		var L := 10.0
		var W := 5.2
		var H := 1.9
		# Wedge in local space: +Z is the direction of travel.
		var pts := PackedVector3Array()
		for zc in [-L * 0.5, L * 0.5]:
			for xc in [-W * 0.5, W * 0.5]:
				var base_y: float = slope * (zc + L * 0.5)
				pts.append(Vector3(xc, base_y - 0.05, zc))
		pts.append(Vector3(-W * 0.5, slope * L + H, L * 0.5))
		pts.append(Vector3(W * 0.5, slope * L + H, L * 0.5))
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		# pts: 0 bl-back, 1 br-back, 2 bl-front, 3 br-front, 4 tl-front, 5 tr-front
		var tris := [[0, 4, 1], [1, 4, 5], [2, 4, 0], [1, 5, 3], [3, 5, 4], [3, 4, 2]]
		for t in tris:
			var a: Vector3 = pts[t[0]]
			var b: Vector3 = pts[t[1]]
			var c: Vector3 = pts[t[2]]
			var n := (c - a).cross(b - a).normalized()
			for v in [a, b, c]:
				st.set_normal(n)
				st.set_uv(Vector2(v.x / W + 0.5, v.z / 2.0))
				st.add_vertex(v)
		var body := StaticBody3D.new()
		body.name = "Ramp"
		body.transform = Transform3D(Basis(Vector3.UP, float(r[3])), Vector3(float(r[0]), float(r[1]), float(r[2])))
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		body.add_child(mi)
		var shape := ConvexPolygonShape3D.new()
		shape.points = pts
		var cs := CollisionShape3D.new()
		cs.shape = shape
		body.add_child(cs)
		root.add_child(body)


func _stripe_texture() -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	for y in 64:
		for x in 64:
			var on := ((x + y) / 16) % 2 == 0
			img.set_pixel(x, y, Color(0.95, 0.72, 0.05) if on else Color(0.05, 0.05, 0.05))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


# ─────────────────────────────── hub, portals, horizon ─────────────────────


func _build_plaza_and_portals() -> void:
	var pz: Dictionary = meta.plaza
	var c := Vector3(pz.center[0], pz.center[1], pz.center[2])
	var size := Vector2(pz.size[0], pz.size[1])
	var yaw := float(pz.yaw)
	var hub := Node3D.new()
	hub.name = "PortalPlaza"
	add_child(hub)
	if not is_city:
		var slab := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = size + Vector2(8, 8)
		slab.mesh = pm
		var am := _asphalt_material()
		am.uv1_scale = Vector3(size.x / 8.0, size.y / 8.0, 1.0)
		slab.material_override = am
		slab.transform = Transform3D(Basis(Vector3.UP, yaw), c + Vector3.UP * 0.035)
		slab.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		hub.add_child(slab)
		var body := StaticBody3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(size.x + 8.0, 1.0, size.y + 8.0)
		var cs := CollisionShape3D.new()
		cs.shape = bs
		body.add_child(cs)
		body.transform = Transform3D(Basis(Vector3.UP, yaw), c + Vector3.UP * (0.035 - 0.5))
		hub.add_child(body)
	var noise := _noise_tex(0.02, 3, false, 256, 3)
	var colors := {"hills": Color(0.3, 1.0, 0.4), "metro": Color(0.9, 0.2, 1.0), "canyon": Color(1.0, 0.45, 0.1), "frost": Color(0.3, 0.8, 1.0)}
	for p in (meta.portals as Array):
		var pos := Vector3(p.pos[0], p.pos[1], p.pos[2])
		var nrm := Vector3(pz.normal[0], 0.0, pz.normal[1])
		var col: Color = colors.get(p.to, Color.CYAN)
		var gate := Node3D.new()
		gate.name = "Portal_" + str(p.to)
		gate.transform = Transform3D(Basis.looking_at(nrm, Vector3.UP), pos + Vector3.UP * 5.2)
		hub.add_child(gate)
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 4.3
		tm.outer_radius = 5.0
		tm.rings = 48
		tm.ring_segments = 10
		ring.mesh = tm
		ring.rotation = Vector3(PI * 0.5, 0, 0)
		var rm := StandardMaterial3D.new()
		rm.albedo_color = col.darkened(0.6)
		rm.emission_enabled = true
		rm.emission = col
		rm.emission_energy_multiplier = 3.0
		rm.metallic = 0.6
		rm.roughness = 0.3
		ring.material_override = rm
		gate.add_child(ring)
		var disc := MeshInstance3D.new()
		var qm := QuadMesh.new()
		qm.size = Vector2(8.8, 8.8)
		disc.mesh = qm
		var dm := ShaderMaterial.new()
		dm.shader = preload("res://shaders/portal.gdshader")
		dm.set_shader_parameter("color_a", col)
		dm.set_shader_parameter("color_b", col.lerp(Color.WHITE, 0.4).inverted().lerp(col, 0.5))
		dm.set_shader_parameter("noise", noise)
		disc.material_override = dm
		disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		gate.add_child(disc)
		var light := OmniLight3D.new()
		light.light_color = col
		light.light_energy = 2.5
		light.omni_range = 16.0
		light.position = Vector3(0, 0, 2.0)
		gate.add_child(light)
		for face in [1.0, -1.0]:
			var label := Label3D.new()
			label.text = str(p.name).to_upper()
			label.font_size = 96
			label.pixel_size = 0.014
			label.outline_size = 18
			label.outline_modulate = Color(0, 0, 0, 0.7)
			label.double_sided = false
			label.modulate = col.lerp(Color.WHITE, 0.6)
			label.position = Vector3(0, 6.6, 0.1 * face)
			label.rotation = Vector3(0, 0.0 if face > 0 else PI, 0)
			gate.add_child(label)
		portals.append({"to": str(p.to), "name": str(p.name), "pos": pos + Vector3.UP * 1.0, "normal": nrm})


func _build_start_arch() -> void:
	var i := (int(meta.spawn_index) + 25) % main_count
	var t := tangents[i]
	var base := samples[i]
	var half := road_half[0]
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.12, 0.12, 0.14)
	steel.metallic = 0.8
	steel.roughness = 0.3
	_arch_mat = StandardMaterial3D.new()
	_arch_mat.albedo_color = Color(1.0, 0.45, 0.1)
	_arch_mat.emission_enabled = true
	_arch_mat.emission = Color(1.0, 0.42, 0.08)
	_arch_mat.emission_energy_multiplier = 1.6
	var arch := StaticBody3D.new()
	arch.name = "StartArch"
	arch.add_to_group("obstacle")
	arch.transform = Transform3D(Basis.looking_at(-t, Vector3.UP), base)
	add_child(arch)
	for side in [-1.0, 1.0]:
		var leg := MeshInstance3D.new()
		var lm := BoxMesh.new()
		lm.size = Vector3(1.2, 10.0, 1.2)
		leg.mesh = lm
		leg.material_override = steel
		leg.position = Vector3(side * (half + 3.4), 4.0, 0)
		arch.add_child(leg)
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = lm.size
		cs.shape = bs
		cs.position = leg.position
		arch.add_child(cs)
	var beam := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(half * 2.0 + 8.0, 1.8, 1.0)
	beam.mesh = bm
	beam.material_override = steel
	beam.position = Vector3(0, 9.4, 0)
	arch.add_child(beam)
	var strip := MeshInstance3D.new()
	var sm := BoxMesh.new()
	sm.size = Vector3(half * 2.0 + 7.4, 0.18, 1.05)
	strip.mesh = sm
	strip.material_override = _arch_mat
	strip.position = Vector3(0, 8.45, 0)
	arch.add_child(strip)
	for face in [-1.0, 1.0]:
		var label := Label3D.new()
		label.text = "CHOMU HORIZON  ·  " + str(meta.name).to_upper()
		label.font_size = 110
		label.pixel_size = 0.011
		label.modulate = Color(1.0, 0.95, 0.9)
		label.double_sided = false
		label.position = Vector3(0, 9.45, face * 0.52)
		label.rotation = Vector3(0, 0.0 if face > 0 else PI, 0)
		arch.add_child(label)


func _build_far_mountains() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	var xforms: Array[Transform3D] = []
	for i in 40:
		var a: float = TAU * float(i) / 40.0 + rng.randf_range(-0.04, 0.04)
		var r := rng.randf_range(1900.0, 2600.0)
		var h := rng.randf_range(260.0, 620.0)
		var w := rng.randf_range(500.0, 800.0)
		xforms.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(w, h, w)), Vector3(cos(a) * r, -60.0, sin(a) * r)))
	# The TRELLIS boulder, blown up, gives irregular mountain silhouettes.
	var rock_mesh := AssetLibrary.mesh("boulder", "far")
	var rock := StandardMaterial3D.new()
	rock.albedo_color = BIOMES[biome].mountain
	rock.albedo_texture = _tex(BIOMES[biome].steep + "_a")
	rock.uv1_triplanar = true
	rock.uv1_scale = Vector3(0.01, 0.01, 0.01)
	rock.uv1_world_triplanar = true
	rock.roughness = 1.0
	var mmi := _multimesh("FarMountains", rock_mesh, xforms, rock, false)
	mmi.extra_cull_margin = 100.0
	# A ground disc under everything so the horizon never shows a void.
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(12000, 12000)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = BIOMES[biome].mountain.darkened(0.3)
	fm.roughness = 1.0
	floor_mi.material_override = fm
	floor_mi.position.y = float(meta.height_range[0]) - 30.0
	floor_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(floor_mi)


func _build_bounds() -> void:
	var body := StaticBody3D.new()
	body.name = "WorldBounds"
	add_child(body)
	var lim := half_size - 6.0
	for d in [Vector3.RIGHT, Vector3.LEFT, Vector3.FORWARD, Vector3.BACK]:
		var cs := CollisionShape3D.new()
		var plane := WorldBoundaryShape3D.new()
		plane.plane = Plane(-d, -lim)
		cs.shape = plane
		body.add_child(cs)
