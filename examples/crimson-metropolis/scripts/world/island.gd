class_name Island
extends Node3D
## A Bermuda-style survival island 2 km across: a clock-tower town in the middle, a windmill on the western hill, a factory yard to the
## east, a shipyard with a lighthouse on the south coast, a village in the north, a lake, a watch-tower on the rocky peak and a
## cape in the south-east, joined by dirt roads. The ground is one heightfield (with matching collision) painted by slope and
## height; the landmarks are Blender-built models (tools/blender/make_landmarks.py); trees are instanced.

const SIZE := 2000.0
const STEP := 10.0
const RADIUS := 820.0
const SEA_Y := -0.55
const PEAK := Vector2(280.0, -430.0)
const LAKE := Vector2(-420.0, -150.0)

## name, centre (x, z), flat radius
const SITES := [
	{"name": "Clock Tower", "pos": Vector2(0, 0), "r": 75.0},
	{"name": "Mill", "pos": Vector2(-330, 150), "r": 45.0},
	{"name": "Factory", "pos": Vector2(320, 90), "r": 95.0},
	{"name": "Shipyard", "pos": Vector2(40, 600), "r": 85.0, "h": 5.0},
	{"name": "Rim Nam", "pos": Vector2(-120, -380), "r": 70.0},
	{"name": "Cape", "pos": Vector2(480, 380), "r": 55.0, "h": 7.0},
	{"name": "Watch Peak", "pos": PEAK, "r": 32.0},
]
const ROADS := [["Clock Tower", "Mill"], ["Clock Tower", "Factory"], ["Clock Tower", "Shipyard"], ["Clock Tower", "Rim Nam"], ["Rim Nam", "Watch Peak"], ["Factory", "Cape"]]

var terrain: MeshInstance3D
var sea: MeshInstance3D
var blades: Array[Node3D] = []
var landmarks: Dictionary = {}          # name -> Node3D, for tests and the minimap
var trees := 0
var _noise := FastNoiseLite.new()
var _coast := FastNoiseLite.new()
var _site_h: Dictionary = {}
var _heights := PackedFloat32Array()
var _n := 0
var _rng := RandomNumberGenerator.new()
var _roads: Array[PackedVector2Array] = []


func build() -> void:
	name = "Island"
	_rng.seed = 5
	_noise.seed = 9
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 0.0045
	_noise.fractal_octaves = 4
	_coast.seed = 2
	_coast.frequency = 0.7
	for s in SITES:
		_site_h[s.name] = s.h if s.has("h") else maxf(_raw_height(s.pos.x, s.pos.y), 4.0)
	_plan_roads()
	_build_terrain()
	_build_sea()
	_build_roads()
	_place_landmarks()
	_scatter_trees()


# ── the shape of the land ─────────────────────────────────────────────────────

func _raw_height(x: float, z: float) -> float:
	var d := Vector2(x, z).length()
	var ang := atan2(z, x)
	var r := RADIUS * (1.0 + 0.13 * _coast.get_noise_2d(cos(ang) * 1.4, sin(ang) * 1.4))
	var mask := smoothstep(r, r - 260.0, d)
	var n1 := _noise.get_noise_2d(x, z) * 0.5 + 0.5
	var hills := n1 * 46.0 + n1 * n1 * 30.0
	var h := mask * (hills + 5.0) + (1.0 - mask) * -16.0
	var pk := Vector2(x, z).distance_to(PEAK)
	h += 175.0 * exp(-(pk * pk) / (2.0 * 120.0 * 120.0)) * mask
	var lk := Vector2(x, z).distance_to(LAKE)
	h -= 32.0 * exp(-(lk * lk) / (2.0 * 58.0 * 58.0)) * mask
	return h


func height_at(x: float, z: float) -> float:
	var h := _raw_height(x, z)
	for s in SITES:
		var d := Vector2(x, z).distance_to(s.pos)
		var w := smoothstep(s.r * 1.7, s.r, d)
		if w > 0.0:
			h = lerpf(h, _site_h[s.name], w)
	return h


func _plan_roads() -> void:
	var by_name := {}
	for s in SITES:
		by_name[s.name] = s.pos
	for pair in ROADS:
		var a: Vector2 = by_name[pair[0]]
		var b: Vector2 = by_name[pair[1]]
		var pts := PackedVector2Array()
		var len := a.distance_to(b)
		var steps := int(len / 8.0)
		var side := Vector2(-(b - a).y, (b - a).x).normalized()
		for i in range(steps + 1):
			var t := float(i) / steps
			var bend := sin(t * PI) * 28.0 * _noise.get_noise_2d(a.x + b.x, a.y + b.y) * 2.0
			pts.append(a.lerp(b, t) + side * bend)
		_roads.append(pts)


func _road_dist(x: float, z: float) -> float:
	var best := 1e9
	var p := Vector2(x, z)
	for pts in _roads:
		var i := 0
		while i < pts.size() - 1:
			var a := pts[i]
			var b := pts[i + 1]
			var ab := b - a
			var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
			best = minf(best, p.distance_to(a + ab * t))
			i += 1
	return best


func _build_terrain() -> void:
	_n = int(SIZE / STEP) + 1
	_heights.resize(_n * _n)
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	var norms := PackedVector3Array()
	verts.resize(_n * _n)
	colors.resize(_n * _n)
	norms.resize(_n * _n)
	for i in range(_n):
		for j in range(_n):
			var x := -SIZE * 0.5 + i * STEP
			var z := -SIZE * 0.5 + j * STEP
			var h := height_at(x, z)
			_heights[j * _n + i] = h
			verts[i * _n + j] = Vector3(x, h, z)
			# Bare earth round settlements and under the roads.
			var dirt := 0.0
			for s in SITES:
				dirt = maxf(dirt, smoothstep(s.r * 0.95, s.r * 0.45, Vector2(x, z).distance_to(s.pos)) * 0.85)
			dirt = maxf(dirt, smoothstep(5.0, 2.0, _road_dist(x, z)))
			colors[i * _n + j] = Color(dirt, 0, 0, 1)
	for i in range(_n):
		for j in range(_n):
			var a := verts[maxi(i - 1, 0) * _n + j]
			var b := verts[mini(i + 1, _n - 1) * _n + j]
			var c := verts[i * _n + maxi(j - 1, 0)]
			var d := verts[i * _n + mini(j + 1, _n - 1)]
			norms[i * _n + j] = (d - c).cross(b - a).normalized()
	var idx := PackedInt32Array()
	for i in range(_n - 1):
		for j in range(_n - 1):
			var v00 := i * _n + j
			var v10 := (i + 1) * _n + j
			var v01 := i * _n + j + 1
			var v11 := (i + 1) * _n + j + 1
			idx.append_array([v00, v10, v01, v10, v11, v01])       # clockwise from above
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/island.gdshader")
	for k in ["sand", "grass", "rock", "dirt"]:
		mat.set_shader_parameter(k + "_a", load(Scenery.TEX + k + "_a.jpg"))
		mat.set_shader_parameter(k + "_n", load(Scenery.TEX + k + "_n.jpg"))
	terrain = MeshInstance3D.new()
	terrain.name = "Terrain"
	terrain.mesh = mesh
	terrain.material_override = mat
	add_child(terrain)
	# Collision from the very same samples.
	var body := StaticBody3D.new()
	body.name = "TerrainBody"
	body.collision_layer = Data.L_WORLD
	var hm := HeightMapShape3D.new()
	hm.map_width = _n
	hm.map_depth = _n
	hm.map_data = _heights
	var cs := CollisionShape3D.new()
	cs.shape = hm
	cs.scale = Vector3(STEP, 1.0, STEP)
	body.add_child(cs)
	add_child(body)


func _build_sea() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(24000, 24000)
	plane.subdivide_width = 160
	plane.subdivide_depth = 160
	sea = MeshInstance3D.new()
	sea.name = "Sea"
	sea.mesh = plane
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/water.gdshader")
	mat.set_shader_parameter("radial_radius", RADIUS)
	var noise := FastNoiseLite.new()
	noise.frequency = 0.02
	var nt := NoiseTexture2D.new()
	nt.noise = noise
	nt.as_normal_map = true
	nt.bump_strength = 6.0
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	mat.set_shader_parameter("wave_n", nt)
	sea.material_override = mat
	sea.position = Vector3(0, SEA_Y, 0)
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sea)


func _build_roads() -> void:
	pass       # roads are painted into the ground (vertex-colour dirt); there is nothing extra to build


# ── landmarks ─────────────────────────────────────────────────────────────────

func _put(file: String, x: float, z: float, yaw_deg := 0.0, solid := true) -> Node3D:
	var scene := load("res://assets/island/%s.glb" % file) as PackedScene
	if scene == null:
		return null
	var n := scene.instantiate() as Node3D
	add_child(n)
	n.position = Vector3(x, height_at(x, z) - 0.15, z)
	n.rotation_degrees.y = yaw_deg
	if solid:
		ModelFit.collider_for(n, 0.95)
	return n


func _ring(file: String, centre: Vector2, radius: float, count: int, start := 0.0, face_centre := true) -> void:
	for i in range(count):
		var a := start + TAU * i / count
		var p := centre + Vector2(cos(a), sin(a)) * radius
		var yaw := -rad_to_deg(a) - 90.0 if face_centre else _rng.randf_range(0, 360)
		_put(file, p.x, p.y, yaw)


func _place_landmarks() -> void:
	var c := Vector2.ZERO
	landmarks["Clock Tower"] = _put("clock_tower", 0, 0)
	_ring("hut", c, 34.0, 7, 0.3)
	_ring("hut", c, 56.0, 5, 0.9)
	var m: Vector2 = SITES[1].pos
	var mill := _put("windmill", m.x, m.y, 20.0)
	landmarks["Mill"] = mill
	if mill != null:
		var b := mill.find_child("Blades", true, false) as Node3D
		if b != null:
			# Spin the sails round the hub (0, 11.2, 3.6 in the model): a pivot at the hub with the sails offset back by the same amount.
			var hub := Vector3(0, 11.2, 3.6)
			var pivot := Node3D.new()
			pivot.name = "SailPivot"
			mill.add_child(pivot)
			pivot.position = hub
			b.reparent(pivot, false)
			b.position = -hub
			blades.append(pivot)
	_put("hut", m.x + 24, m.y + 10, 200.0)
	_put("hut", m.x - 20, m.y + 22, 120.0)
	var f: Vector2 = SITES[2].pos
	landmarks["Factory"] = _put("factory", f.x, f.y, 90.0)
	var kinds := ["container_blue", "container_orange", "container_green"]
	for i in range(9):
		var p := f + Vector2(-50 + (i % 3) * 11.0, 42 + (i / 3) * 7.0 - 18.0) + Vector2(40, -30)
		_put(kinds[i % 3], p.x, p.y, 0.0 if i % 2 == 0 else 90.0)
	var s: Vector2 = SITES[3].pos
	landmarks["Shipyard"] = _put("lighthouse", s.x + 60, s.y + 30, 0.0)
	for i in range(8):
		var p := s + Vector2(-60 + (i % 4) * 9.0, -20 + (i / 4) * 14.0)
		_put(kinds[i % 3], p.x, p.y, 90.0 if i < 4 else 0.0)
	var r: Vector2 = SITES[4].pos
	landmarks["Rim Nam"] = _put("hut", r.x, r.y, 0.0)
	_ring("hut", r, 36.0, 8, 0.2)
	var k: Vector2 = SITES[5].pos
	landmarks["Cape"] = _put("watchtower", k.x, k.y, 0.0)
	_ring("hut", k, 30.0, 5, 0.7)
	landmarks["Watch Peak"] = _put("watchtower", PEAK.x, PEAK.y, 45.0)


# ── vegetation ────────────────────────────────────────────────────────────────

func _scatter_trees() -> void:
	var kinds := [["oak_near.glb", 8.5], ["pine_near.glb", 10.0], ["palm_near.glb", 8.0], ["birch_near.glb", 7.5], ["bush_near.glb", 1.4]]
	var cluster := FastNoiseLite.new()
	cluster.seed = 31
	cluster.frequency = 0.012
	for k in kinds:
		var scene := load(Scenery.SCENERY + k[0]) as PackedScene
		if scene == null:
			continue
		var inst := scene.instantiate() as Node3D
		var mi := inst.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
		var aabb := mi.get_aabb()
		var scale_k: float = k[1] / maxf(aabb.size.y, 0.001)
		var xforms: Array[Transform3D] = []
		var want := 220 if k[0] != "bush_near.glb" else 300
		var tries := 0
		while xforms.size() < want and tries < want * 40:
			tries += 1
			var x := _rng.randf_range(-RADIUS, RADIUS)
			var z := _rng.randf_range(-RADIUS, RADIUS)
			var h := height_at(x, z)
			var is_palm: bool = k[0] == "palm_near.glb"
			if is_palm and (h < 1.0 or h > 5.5):
				continue
			if not is_palm and (h < 5.0 or h > 110.0):
				continue
			if cluster.get_noise_2d(x, z) < -0.05 and k[0] != "bush_near.glb":
				continue
			if _near_site(x, z) or _road_dist(x, z) < 7.0:
				continue
			if absf(height_at(x + 4.0, z) - h) > 3.2 or absf(height_at(x, z + 4.0) - h) > 3.2:
				continue
			var sc := scale_k * _rng.randf_range(0.8, 1.25)
			var basis := Basis(Vector3.UP, _rng.randf_range(0.0, TAU)).scaled(Vector3.ONE * sc)
			var centre := Vector3(aabb.position.x + aabb.size.x * 0.5, aabb.position.y, aabb.position.z + aabb.size.z * 0.5)
			xforms.append(Transform3D(basis, Vector3(x, h - 0.1, z) - basis * centre))
		if xforms.is_empty():
			inst.free()
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mi.mesh
		mm.instance_count = xforms.size()
		for i in range(xforms.size()):
			mm.set_instance_transform(i, xforms[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Trees_" + String(k[0]).get_basename()
		mmi.multimesh = mm
		var smat: Material = mi.get_active_material(0)
		if smat != null:
			mmi.material_override = smat
		inst.free()
		add_child(mmi)
		trees += xforms.size()


func _near_site(x: float, z: float) -> bool:
	for s in SITES:
		if Vector2(x, z).distance_to(s.pos) < s.r * 0.9:
			return true
	return false


func spawn_point() -> Vector3:
	return Vector3(6.0, height_at(6.0, 44.0) + 0.3, 44.0)


func _process(delta: float) -> void:
	for b in blades:
		b.rotation.z += delta * 0.6
