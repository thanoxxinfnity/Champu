class_name WorldBuilder
extends Node3D
## The open world: a closed highway loop through countryside, a festival hub
## with a drift plaza at the start line, and the sky/lighting presets.
##
## The ground is one infinite collision plane and the road lies flat on it,
## so physics never has to fight a seam between road and terrain; the road
## is a visual ribbon plus the rules that come with it (off-road drag,
## reset-to-road, speed trap, drift zone).

const ROAD_HALF := 7.0
const SAMPLE_STEP := 2.0
const WORLD_RADIUS := 950.0
const CONTROL := [
	Vector2(0, -100), Vector2(0, 350), Vector2(60, 560), Vector2(230, 650),
	Vector2(420, 600), Vector2(520, 450), Vector2(470, 300), Vector2(560, 180),
	Vector2(520, 40), Vector2(380, -20), Vector2(300, 80), Vector2(200, 20),
	Vector2(180, -160), Vector2(90, -260),
]

var samples: PackedVector3Array = PackedVector3Array()
var tangents: PackedVector3Array = PackedVector3Array()
var distances: PackedFloat32Array = PackedFloat32Array()
var curvature: PackedFloat32Array = PackedFloat32Array()
var total_length := 0.0
var speed_trap_index := 0
var drift_zone := Vector2i(0, 0)

var sun: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var time_of_day := "golden"

var _grid := {}
var _lamp_mat: StandardMaterial3D
var _arch_mat: StandardMaterial3D


func build() -> void:
	_sample_track()
	_build_environment()
	_build_ground()
	_build_road()
	_build_markings()
	_build_curbs_and_rails()
	_build_lamps()
	_build_trees()
	_build_mountains()
	_build_hub()
	set_time_of_day(time_of_day)


# ─────────────────────────────── track ─────────────────────────────────────


func _sample_track() -> void:
	var n := CONTROL.size()
	var dense: Array[Vector2] = []
	for i in n:
		var p0: Vector2 = CONTROL[(i - 1 + n) % n]
		var p1: Vector2 = CONTROL[i]
		var p2: Vector2 = CONTROL[(i + 1) % n]
		var p3: Vector2 = CONTROL[(i + 2) % n]
		var seg := p1.distance_to(p2)
		var steps := maxi(int(seg / 0.5), 4)
		for s in steps:
			var t := float(s) / steps
			dense.append(_catmull(p0, p1, p2, p3, t))
	# Resample at an even spacing so dashes, lamps and curbs are regular.
	var acc := 0.0
	var next := 0.0
	var prev := dense[0]
	samples.append(Vector3(prev.x, 0.0, prev.y))
	distances.append(0.0)
	for i in range(1, dense.size() + 1):
		var cur := dense[i % dense.size()]
		var d: float = prev.distance_to(cur)
		while acc + d >= next + SAMPLE_STEP:
			next += SAMPLE_STEP
			var t := (next - acc) / d
			var p := prev.lerp(cur, t)
			samples.append(Vector3(p.x, 0.0, p.y))
			distances.append(next)
		acc += d
		prev = cur
	total_length = acc
	var count := samples.size()
	tangents.resize(count)
	curvature.resize(count)
	for i in count:
		var a: Vector3 = samples[(i - 1 + count) % count]
		var b: Vector3 = samples[(i + 1) % count]
		tangents[i] = (b - a).normalized()
	for i in count:
		var t0 := tangents[(i - 3 + count) % count]
		var t1 := tangents[(i + 3) % count]
		curvature[i] = t0.signed_angle_to(t1, Vector3.UP) / (SAMPLE_STEP * 6.0)
	for i in count:
		# Packed arrays are values: append to a local and store it back.
		var key := _cell(samples[i])
		var bucket: PackedInt32Array = _grid.get(key, PackedInt32Array())
		bucket.append(i)
		_grid[key] = bucket
	# The long northern straight gets the speed trap; the twisty section
	# around the hairpin is the drift zone.
	speed_trap_index = nearest_index(Vector3(0, 0, 250))
	drift_zone = Vector2i(nearest_index(Vector3(560, 0, 180)), nearest_index(Vector3(300, 0, 80)))


func _catmull(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


func _cell(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / 24.0), floori(p.z / 24.0))


## Nearest centreline sample. The grid search covers ±60 m; beyond that
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


func is_offroad(p: Vector3) -> bool:
	if absf(p.x - 30.0) < 45.0 and absf(p.z + 150.0) < 45.0:
		return false  # drift plaza
	return distance_to_road(p) > ROAD_HALF + 1.2


## Where to put a car back on the road near `p`, facing along `heading`.
func reset_transform(p: Vector3, heading: Vector3) -> Transform3D:
	var i := nearest_index(p)
	var t := tangents[i]
	if heading.dot(t) < 0.0:
		t = -t
	var side := t.cross(Vector3.UP).normalized()
	var pos := samples[i] + side * 3.5 * signf(side.dot(p - samples[i]) + 0.001) + Vector3.UP * 0.6
	return Transform3D(Basis.looking_at(-t, Vector3.UP), pos)


func spawn_transform() -> Transform3D:
	var i := nearest_index(Vector3(0, 0, -60))
	var t := tangents[i]
	var pos := samples[i] + t.cross(Vector3.UP).normalized() * -3.5 + Vector3.UP * 0.6
	return Transform3D(Basis.looking_at(-t, Vector3.UP), pos)


func minimap_points() -> PackedVector2Array:
	var out := PackedVector2Array()
	for i in range(0, samples.size(), 4):
		out.append(Vector2(samples[i].x, samples[i].z))
	return out


# ─────────────────────────────── environment ───────────────────────────────


func _build_environment() -> void:
	sky_mat = ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.06
	env.glow_hdr_threshold = 1.1
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.fog_enabled = true
	env.fog_density = 0.0011
	env.fog_sky_affect = 0.35
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.12
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 90.0
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 1.2
	add_child(sun)


func set_time_of_day(mode: String) -> void:
	time_of_day = mode
	var night := mode == "night"
	match mode:
		"day":
			sun.rotation_degrees = Vector3(-52.0, 38.0, 0.0)
			sun.light_color = Color(1.0, 0.97, 0.92)
			sun.light_energy = 1.35
			sky_mat.sky_top_color = Color(0.16, 0.36, 0.72)
			sky_mat.sky_horizon_color = Color(0.62, 0.74, 0.88)
			sky_mat.ground_horizon_color = Color(0.55, 0.62, 0.66)
			sky_mat.ground_bottom_color = Color(0.2, 0.22, 0.2)
			env.fog_light_color = Color(0.66, 0.76, 0.88)
			env.ambient_light_energy = 1.0
		"night":
			sun.rotation_degrees = Vector3(-35.0, -120.0, 0.0)
			sun.light_color = Color(0.55, 0.65, 1.0)
			sun.light_energy = 0.12
			sky_mat.sky_top_color = Color(0.01, 0.015, 0.04)
			sky_mat.sky_horizon_color = Color(0.05, 0.06, 0.12)
			sky_mat.ground_horizon_color = Color(0.03, 0.03, 0.05)
			sky_mat.ground_bottom_color = Color(0.0, 0.0, 0.0)
			env.fog_light_color = Color(0.04, 0.05, 0.09)
			env.ambient_light_energy = 0.35
		_:
			sun.rotation_degrees = Vector3(-13.0, 150.0, 0.0)
			sun.light_color = Color(1.0, 0.73, 0.46)
			sun.light_energy = 1.55
			sky_mat.sky_top_color = Color(0.2, 0.33, 0.58)
			sky_mat.sky_horizon_color = Color(0.98, 0.66, 0.4)
			sky_mat.ground_horizon_color = Color(0.72, 0.5, 0.36)
			sky_mat.ground_bottom_color = Color(0.16, 0.12, 0.1)
			env.fog_light_color = Color(0.93, 0.66, 0.46)
			env.ambient_light_energy = 0.9
	sky_mat.sun_angle_max = 30.0
	sky_mat.sun_curve = 0.1
	sun.shadow_enabled = not night
	if _lamp_mat:
		_lamp_mat.emission_energy_multiplier = 6.0 if night else 0.4
	if _arch_mat:
		_arch_mat.emission_energy_multiplier = 5.0 if night else 1.6


# ─────────────────────────────── textures ──────────────────────────────────


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


func _asphalt_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var alb := _noise_tex(0.09, 11, false)
	var grad := Gradient.new()
	grad.set_color(0, Color(0.1, 0.1, 0.105))
	grad.set_color(1, Color(0.165, 0.165, 0.17))
	alb.color_ramp = grad
	m.albedo_texture = alb
	m.normal_enabled = true
	m.normal_texture = _noise_tex(0.35, 23, true)
	m.normal_scale = 0.4
	m.roughness = 0.82
	m.metallic_specular = 0.35
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _grass_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var alb := _noise_tex(0.02, 5, false, 512, 4)
	var grad := Gradient.new()
	grad.set_color(0, Color(0.2, 0.3, 0.09))
	grad.set_color(1, Color(0.42, 0.48, 0.18))
	grad.add_point(0.55, Color(0.3, 0.4, 0.12))
	alb.color_ramp = grad
	m.albedo_texture = alb
	m.uv1_scale = Vector3(90.0, 90.0, 1.0)
	m.roughness = 0.95
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


# ─────────────────────────────── geometry ──────────────────────────────────


func _build_ground() -> void:
	var body := StaticBody3D.new()
	body.name = "Ground"
	var col := CollisionShape3D.new()
	col.shape = WorldBoundaryShape3D.new()
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(3200, 3200)
	mi.mesh = pm
	mi.material_override = _grass_material()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(mi)
	add_child(body)


func _ribbon(st: SurfaceTool, left: float, right: float, y: float, filter: Callable = Callable(), vscale: float = 0.1) -> void:
	var n := samples.size()
	for i in n:
		var j := (i + 1) % n
		if filter.is_valid() and not filter.call(i):
			continue
		var si: Vector3 = tangents[i].cross(Vector3.UP).normalized()
		var sj: Vector3 = tangents[j].cross(Vector3.UP).normalized()
		var a: Vector3 = samples[i] + si * left + Vector3.UP * y
		var b: Vector3 = samples[i] + si * right + Vector3.UP * y
		var c: Vector3 = samples[j] + sj * left + Vector3.UP * y
		var d: Vector3 = samples[j] + sj * right + Vector3.UP * y
		var v0 := distances[i] * vscale
		var v1 := v0 + SAMPLE_STEP * vscale
		for q in [[a, 0.0, v0], [c, 0.0, v1], [b, 1.0, v0], [b, 1.0, v0], [c, 0.0, v1], [d, 1.0, v1]]:
			st.set_normal(Vector3.UP)
			st.set_uv(Vector2(q[1], q[2]))
			st.add_vertex(q[0])


func _build_road() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_ribbon(st, -ROAD_HALF - 0.8, ROAD_HALF + 0.8, 0.012)
	var mi := MeshInstance3D.new()
	mi.name = "Road"
	mi.mesh = st.commit()
	mi.material_override = _asphalt_material()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# Drift plaza next to the start: open asphalt with cones.
	var plaza := MeshInstance3D.new()
	plaza.name = "DriftPlaza"
	var pm := PlaneMesh.new()
	pm.size = Vector2(90, 90)
	plaza.mesh = pm
	var pmat := _asphalt_material()
	pmat.uv1_scale = Vector3(9, 9, 1)
	plaza.material_override = pmat
	plaza.position = Vector3(30, 0.01, -150)
	add_child(plaza)


func _build_markings() -> void:
	var white := StandardMaterial3D.new()
	white.albedo_color = Color(0.92, 0.92, 0.88)
	white.roughness = 0.6
	white.cull_mode = BaseMaterial3D.CULL_DISABLED
	var yellow := StandardMaterial3D.new()
	yellow.albedo_color = Color(0.95, 0.72, 0.1)
	yellow.roughness = 0.6
	yellow.cull_mode = BaseMaterial3D.CULL_DISABLED
	var sw := SurfaceTool.new()
	sw.begin(Mesh.PRIMITIVE_TRIANGLES)
	var dashed := func(i: int) -> bool: return int(distances[i] / 4.0) % 3 == 0
	for lane in [-3.5, 3.5]:
		_ribbon(sw, lane - 0.08, lane + 0.08, 0.02, dashed)
	for edge in [-ROAD_HALF + 0.25, ROAD_HALF - 0.25]:
		_ribbon(sw, edge - 0.1, edge + 0.1, 0.02)
	var sy := SurfaceTool.new()
	sy.begin(Mesh.PRIMITIVE_TRIANGLES)
	for c in [-0.15, 0.15]:
		_ribbon(sy, c - 0.06, c + 0.06, 0.02)
	var mesh := ArrayMesh.new()
	sw.commit(mesh)
	mesh.surface_set_material(0, white)
	sy.commit(mesh)
	mesh.surface_set_material(1, yellow)
	var mi := MeshInstance3D.new()
	mi.name = "Markings"
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func _build_curbs_and_rails() -> void:
	var curb_mat := StandardMaterial3D.new()
	curb_mat.vertex_color_use_as_albedo = true
	curb_mat.roughness = 0.7
	curb_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := samples.size()
	for i in n:
		var k := absf(curvature[i])
		if k < 0.012:
			continue
		var j := (i + 1) % n
		var col := Color(0.85, 0.08, 0.06) if int(distances[i] / 2.0) % 2 == 0 else Color(0.95, 0.95, 0.95)
		var inner_side := -signf(curvature[i])
		for side in [inner_side]:
			var si: Vector3 = tangents[i].cross(Vector3.UP).normalized() * side
			var sj: Vector3 = tangents[j].cross(Vector3.UP).normalized() * side
			var a: Vector3 = samples[i] + si * (ROAD_HALF + 0.8) + Vector3.UP * 0.03
			var b: Vector3 = samples[i] + si * (ROAD_HALF + 2.0) + Vector3.UP * 0.07
			var c: Vector3 = samples[j] + sj * (ROAD_HALF + 0.8) + Vector3.UP * 0.03
			var d: Vector3 = samples[j] + sj * (ROAD_HALF + 2.0) + Vector3.UP * 0.07
			for p in [a, c, b, b, c, d]:
				st.set_color(col)
				st.set_normal(Vector3.UP)
				st.add_vertex(p)
	var curbs := MeshInstance3D.new()
	curbs.name = "Curbs"
	curbs.mesh = st.commit()
	curbs.material_override = curb_mat
	curbs.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(curbs)

	# Guard rails on the outside of every bend, with real collision.
	var rail_mat := StandardMaterial3D.new()
	rail_mat.albedo_color = Color(0.72, 0.74, 0.76)
	rail_mat.metallic = 0.8
	rail_mat.roughness = 0.35
	var rs := SurfaceTool.new()
	rs.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := PackedVector3Array()
	var post_xforms: Array[Transform3D] = []
	for i in n:
		var k2 := absf(curvature[i])
		if k2 < 0.008:
			continue
		var j := (i + 1) % n
		var outer := signf(curvature[i])
		var si: Vector3 = tangents[i].cross(Vector3.UP).normalized() * outer
		var sj: Vector3 = tangents[j].cross(Vector3.UP).normalized() * outer
		var off := ROAD_HALF + 3.2
		var a: Vector3 = samples[i] + si * off + Vector3.UP * 0.45
		var b: Vector3 = samples[i] + si * off + Vector3.UP * 0.85
		var c: Vector3 = samples[j] + sj * off + Vector3.UP * 0.45
		var d: Vector3 = samples[j] + sj * off + Vector3.UP * 0.85
		for tri in [[a, b, c], [c, b, d]]:
			for p in tri:
				rs.set_normal(-si)
				rs.add_vertex(p)
			for p in [tri[0], tri[2], tri[1]]:
				rs.set_normal(si)
				rs.add_vertex(p)
			faces.append_array(PackedVector3Array([tri[0] - Vector3.UP * 0.45, tri[1], tri[2] - Vector3.UP * 0.45]))
			faces.append_array(PackedVector3Array([tri[0] - Vector3.UP * 0.45, tri[2] - Vector3.UP * 0.45, tri[1]]))
		if i % 2 == 0:
			post_xforms.append(Transform3D(Basis.IDENTITY, samples[i] + si * (off + 0.08) + Vector3.UP * 0.45))
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
	_multimesh("RailPosts", post_mesh, post_xforms, rail_mat, false)


func _multimesh(node_name: String, mesh: Mesh, xforms: Array[Transform3D], mat: Material, shadows: bool, colors: Array[Color] = []) -> MultiMeshInstance3D:
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
	add_child(mmi)
	return mmi


func _build_lamps() -> void:
	var pole_mat := StandardMaterial3D.new()
	pole_mat.albedo_color = Color(0.3, 0.32, 0.34)
	pole_mat.metallic = 0.7
	pole_mat.roughness = 0.4
	_lamp_mat = StandardMaterial3D.new()
	_lamp_mat.albedo_color = Color(1.0, 0.9, 0.7)
	_lamp_mat.emission_enabled = true
	_lamp_mat.emission = Color(1.0, 0.82, 0.55)
	_lamp_mat.emission_energy_multiplier = 0.4
	var poles: Array[Transform3D] = []
	var heads: Array[Transform3D] = []
	var n := samples.size()
	for i in range(0, n, 24):
		var side := -1.0 if (i / 24) % 2 == 0 else 1.0
		var s := tangents[i].cross(Vector3.UP).normalized() * side
		var base := samples[i] + s * (ROAD_HALF + 4.5)
		var basis := Basis.looking_at(-s, Vector3.UP)
		poles.append(Transform3D(Basis.IDENTITY, base + Vector3.UP * 4.0))
		heads.append(Transform3D(basis, base - s * 1.6 + Vector3.UP * 7.9))
	var pole := CylinderMesh.new()
	pole.top_radius = 0.09
	pole.bottom_radius = 0.14
	pole.height = 8.0
	pole.radial_segments = 8
	pole.rings = 0
	_multimesh("LampPoles", pole, poles, pole_mat, true)
	var head := BoxMesh.new()
	head.size = Vector3(0.45, 0.14, 3.4)
	_multimesh("LampHeads", head, heads, _lamp_mat, false)


func _build_trees() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	# Trees are bucketed into 250 m chunks, one MultiMesh each, so the
	# renderer can cull whole chunks behind the camera and outside shadow
	# range instead of drawing all of them every pass.
	var chunks := {}
	var near_road: Array[Vector3] = []
	var placed := 0
	var tries := 0
	while placed < 1200 and tries < 9000:
		tries += 1
		var p := Vector3(rng.randf_range(-700, 1000), 0, rng.randf_range(-800, 1000))
		var d: float = distance_to_road(p)
		if d < ROAD_HALF + 14.0:
			continue
		if absf(p.x - 30.0) < 60.0 and absf(p.z + 150.0) < 60.0:
			continue
		var s := rng.randf_range(0.8, 1.6)
		var rot := Basis(Vector3.UP, rng.randf() * TAU)
		var key := Vector2i(floori(p.x / 250.0), floori(p.z / 250.0))
		if not chunks.has(key):
			chunks[key] = [[] as Array[Transform3D], [] as Array[Transform3D]]
		(chunks[key][0] as Array).append(Transform3D(rot.scaled(Vector3(s, s, s)), p + Vector3.UP * 1.5 * s))
		(chunks[key][1] as Array).append(Transform3D(rot.scaled(Vector3(s, s * rng.randf_range(0.9, 1.3), s)), p + Vector3.UP * 5.2 * s))
		placed += 1
		if d < 80.0:
			near_road.append(p)
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.18
	trunk.bottom_radius = 0.3
	trunk.height = 3.0
	trunk.radial_segments = 6
	trunk.rings = 0
	var bark := StandardMaterial3D.new()
	bark.albedo_color = Color(0.28, 0.2, 0.14)
	bark.roughness = 1.0
	var crown := CylinderMesh.new()
	crown.top_radius = 0.0
	crown.bottom_radius = 2.3
	crown.height = 6.5
	crown.radial_segments = 7
	crown.rings = 0
	var leaves := StandardMaterial3D.new()
	leaves.albedo_color = Color(0.16, 0.3, 0.12)
	leaves.roughness = 0.9
	for key in chunks.keys():
		var t_list: Array[Transform3D] = []
		t_list.assign(chunks[key][0])
		var c_list: Array[Transform3D] = []
		c_list.assign(chunks[key][1])
		_multimesh("Trunks_%d_%d" % [key.x, key.y], trunk, t_list, bark, false)
		_multimesh("Crowns_%d_%d" % [key.x, key.y], crown, c_list, leaves, true)
	# Collision only where a car can plausibly reach.
	var body := StaticBody3D.new()
	body.name = "TreeCollision"
	body.add_to_group("obstacle")
	var shape := CylinderShape3D.new()
	shape.radius = 0.4
	shape.height = 4.0
	for p in near_road:
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.position = p + Vector3.UP * 2.0
		body.add_child(cs)
	add_child(body)


func _build_mountains() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	var xforms: Array[Transform3D] = []
	for i in 34:
		var a: float = TAU * float(i) / 34.0 + rng.randf_range(-0.05, 0.05)
		var r := rng.randf_range(1250.0, 1500.0)
		var h := rng.randf_range(160.0, 380.0)
		var w := rng.randf_range(240.0, 420.0)
		xforms.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(w, h, w)), Vector3(cos(a) * r + 200.0, h * 0.5 - 10.0, sin(a) * r + 200.0)))
	var cone := CylinderMesh.new()
	cone.top_radius = 0.06
	cone.bottom_radius = 0.5
	cone.height = 1.0
	cone.radial_segments = 9
	cone.rings = 0
	var rock := StandardMaterial3D.new()
	rock.albedo_color = Color(0.2, 0.24, 0.24)
	rock.roughness = 1.0
	_multimesh("Mountains", cone, xforms, rock, false)


func _build_hub() -> void:
	var hub := Node3D.new()
	hub.name = "FestivalHub"
	add_child(hub)
	# Start arch over the road.
	var i := nearest_index(Vector3(0, 0, -40))
	var t := tangents[i]
	var s := t.cross(Vector3.UP).normalized()
	var base := samples[i]
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.12, 0.12, 0.14)
	steel.metallic = 0.8
	steel.roughness = 0.3
	_arch_mat = StandardMaterial3D.new()
	_arch_mat.albedo_color = Color(1.0, 0.45, 0.1)
	_arch_mat.emission_enabled = true
	_arch_mat.emission = Color(1.0, 0.42, 0.08)
	_arch_mat.emission_energy_multiplier = 1.6
	var arch_basis := Basis.looking_at(-t, Vector3.UP)
	var arch := StaticBody3D.new()
	arch.add_to_group("obstacle")
	arch.transform = Transform3D(arch_basis, base)
	hub.add_child(arch)
	for side in [-1.0, 1.0]:
		var leg := MeshInstance3D.new()
		var lm := BoxMesh.new()
		lm.size = Vector3(1.2, 9.0, 1.2)
		leg.mesh = lm
		leg.material_override = steel
		leg.position = Vector3(side * (ROAD_HALF + 2.2), 4.5, 0)
		arch.add_child(leg)
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = lm.size
		cs.shape = bs
		cs.position = leg.position
		arch.add_child(cs)
	var beam := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(ROAD_HALF * 2.0 + 5.6, 1.8, 1.0)
	beam.mesh = bm
	beam.material_override = steel
	beam.position = Vector3(0, 9.4, 0)
	arch.add_child(beam)
	var strip := MeshInstance3D.new()
	var sm := BoxMesh.new()
	sm.size = Vector3(ROAD_HALF * 2.0 + 5.0, 0.18, 1.05)
	strip.mesh = sm
	strip.material_override = _arch_mat
	strip.position = Vector3(0, 8.45, 0)
	arch.add_child(strip)
	for face in [-1.0, 1.0]:
		var label := Label3D.new()
		label.text = "CHOMU HORIZON"
		label.font_size = 160
		label.pixel_size = 0.012
		label.outline_size = 0
		label.modulate = Color(1.0, 0.95, 0.9)
		label.position = Vector3(0, 9.45, face * 0.52)
		label.rotation = Vector3(0, 0.0 if face > 0 else PI, 0)
		arch.add_child(label)
	# Festival flags along the start straight: two MultiMeshes (poles and
	# per-instance-coloured flags) instead of 48 separate draws.
	var flag_cols := [Color(1.0, 0.4, 0.05), Color(0.1, 0.8, 1.0), Color(1.0, 0.1, 0.55), Color(0.95, 0.85, 0.1)]
	var pole_x: Array[Transform3D] = []
	var flag_x: Array[Transform3D] = []
	var flag_c: Array[Color] = []
	for k in 12:
		var j := nearest_index(Vector3(0, 0, -100 + k * 10))
		for side2 in [-1.0, 1.0]:
			var fp: Vector3 = samples[j] + tangents[j].cross(Vector3.UP).normalized() * side2 * (ROAD_HALF + 6.0)
			pole_x.append(Transform3D(Basis.IDENTITY, fp + Vector3.UP * 3.0))
			flag_x.append(Transform3D(Basis.looking_at(tangents[j].cross(Vector3.UP), Vector3.UP), fp + Vector3(0, 4.6, 0) + tangents[j] * 0.55))
			flag_c.append(flag_cols[(k + (1 if side2 > 0 else 0)) % flag_cols.size()])
	var pm := CylinderMesh.new()
	pm.top_radius = 0.05
	pm.bottom_radius = 0.05
	pm.height = 6.0
	pm.radial_segments = 6
	pm.rings = 0
	_multimesh("FlagPoles", pm, pole_x, steel, false)
	var fm := BoxMesh.new()
	fm.size = Vector3(0.04, 2.2, 1.0)
	var fmat := StandardMaterial3D.new()
	fmat.vertex_color_use_as_albedo = true
	var flags := _multimesh("Flags", fm, flag_x, fmat, false, flag_c)
	flags.reparent(hub)
	# Cones on the drift plaza — light rigid bodies you can knock about.
	var cone_mesh := CylinderMesh.new()
	cone_mesh.top_radius = 0.03
	cone_mesh.bottom_radius = 0.2
	cone_mesh.height = 0.55
	cone_mesh.radial_segments = 10
	var cone_mat := StandardMaterial3D.new()
	cone_mat.albedo_color = Color(1.0, 0.4, 0.05)
	var cone_shape := CylinderShape3D.new()
	cone_shape.radius = 0.16
	cone_shape.height = 0.55
	for k2 in 16:
		var ang := TAU * float(k2) / 16.0
		var cone := RigidBody3D.new()
		cone.mass = 4.0
		cone.position = Vector3(30 + cos(ang) * 16.0, 0.3, -150 + sin(ang) * 16.0)
		var cm := MeshInstance3D.new()
		cm.mesh = cone_mesh
		cm.material_override = cone_mat
		cone.add_child(cm)
		var ccs := CollisionShape3D.new()
		ccs.shape = cone_shape
		cone.add_child(ccs)
		hub.add_child(cone)
	# A few festival buildings round the plaza.
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.1, 0.14, 0.2)
	glass.metallic = 0.7
	glass.roughness = 0.08
	var concrete := StandardMaterial3D.new()
	concrete.albedo_color = Color(0.7, 0.68, 0.64)
	concrete.roughness = 0.85
	var blocks := [[Vector3(95, 0, -150), Vector3(18, 14, 40), glass], [Vector3(30, 0, -215), Vector3(50, 8, 16), concrete], [Vector3(-40, 0, -205), Vector3(22, 20, 22), glass]]
	for b in blocks:
		var bb := StaticBody3D.new()
		bb.add_to_group("obstacle")
		var size: Vector3 = b[1]
		bb.position = (b[0] as Vector3) + Vector3.UP * size.y * 0.5
		var mi := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = size
		mi.mesh = box
		mi.material_override = b[2]
		bb.add_child(mi)
		var cs2 := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs2.shape = sh
		bb.add_child(cs2)
		hub.add_child(bb)
