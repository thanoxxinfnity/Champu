class_name Scenery
extends Node3D
## What makes the city look lived in rather than modelled: real photographic ground (asphalt, pavement) on the streets, trees, bushes,
## benches, bus stops and kiosks along the pavements, and rolling hills on the horizon beyond the city, tiled from the PBR ground
## textures. Everything is placed from a seed so the city is the same every run.

const SCENERY := "res://assets/scenery/"
const TEX := "res://assets/textures/"
const TERRAIN_INNER := 440.0
const TERRAIN_OUTER := 1700.0
const TERRAIN_STEP := 28.0
const SIDEWALK_INNER := 38.7        # from a block centre: just inside the pavement, away from the lamp posts and the walking line

var trees: Array[Node3D] = []
var props: Array[Node3D] = []
var terrain: MeshInstance3D
var _rng := RandomNumberGenerator.new()
var _avoid: Array[Rect2] = []       # footprints of hand-built places that keep their own landscaping


static func pbr(name: String, tile_m: float, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = load(TEX + name + "_a.jpg")
	m.normal_enabled = true
	m.normal_texture = load(TEX + name + "_n.jpg")
	m.roughness = rough
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE / tile_m
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


func build(seed_value: int, avoid_plots: Array[Vector2i]) -> void:
	_rng.seed = seed_value
	name = "Scenery"
	for idx in avoid_plots:
		var c := City.block_center(idx)
		_avoid.append(Rect2(c.x - City.BLOCK * 0.5, c.z - City.BLOCK * 0.5, City.BLOCK, City.BLOCK))
	_pavement_trees()
	_street_furniture()
	_terrain()


func _blocked(p: Vector3) -> bool:
	for r in _avoid:
		if r.has_point(Vector2(p.x, p.z)):
			return true
	return false


func _model(file: String) -> Node3D:
	var scene := load(SCENERY + file) as PackedScene
	return scene.instantiate() as Node3D if scene != null else null


## A row of trees along every block's pavement, with bushes between, skipping the hand-built plots (they have their own).
func _pavement_trees() -> void:
	var kinds := [["oak_near.glb", 8.5], ["birch_near.glb", 7.5], ["palm_near.glb", 8.0], ["pine_near.glb", 9.5]]
	for bx in range(-1, 2):
		for bz in range(-1, 2):
			var c := City.block_center(Vector2i(bx, bz))
			if _blocked(c):
				continue
			for side in range(4):
				for t in range(-33, 34, 11):
					var jitter := _rng.randf_range(-1.5, 1.5)
					var p := _edge_point(c, side, float(t) + jitter, SIDEWALK_INNER)
					var near_corner := absf(float(t)) > 31.0
					if near_corner:
						continue                       # keep the crossings clear
					if _rng.randf() < 0.28:
						_place_bush(p)
					else:
						var k: Array = kinds[_rng.randi() % kinds.size()]
						_place_tree(p, k[0], k[1] * _rng.randf_range(0.85, 1.2))


## A point on the pavement along one side of a block (0 = +x side, 1 = -x, 2 = +z, 3 = -z); `t` runs along it.
func _edge_point(c: Vector3, side: int, t: float, off: float) -> Vector3:
	match side:
		0: return Vector3(c.x + off, 0, c.z + t)
		1: return Vector3(c.x - off, 0, c.z + t)
		2: return Vector3(c.x + t, 0, c.z + off)
	return Vector3(c.x + t, 0, c.z - off)


func _place_tree(p: Vector3, file: String, height: float) -> void:
	var n := _model(file)
	if n == null:
		return
	add_child(n)
	ModelFit.place_by_height(n, height, _rng.randf_range(0.0, 360.0), City.CURB)
	n.position += Vector3(p.x, 0, p.z)
	# Only the trunk is solid: a thin post, so people can walk under the crown.
	var sb := StaticBody3D.new()
	sb.collision_layer = Data.L_WORLD
	sb.collision_mask = 0
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = 0.3
	cyl.height = 3.0
	cs.shape = cyl
	sb.add_child(cs)
	sb.position = Vector3(p.x, City.CURB + 1.5, p.z)
	add_child(sb)
	trees.append(n)


func _place_bush(p: Vector3) -> void:
	var n := _model("bush_near.glb")
	if n == null:
		return
	add_child(n)
	ModelFit.place_by_height(n, _rng.randf_range(1.0, 1.5), _rng.randf_range(0.0, 360.0), City.CURB)
	n.position += Vector3(p.x, 0, p.z)
	props.append(n)


## Benches, bus stops and kiosks, facing the road, in the middle of a few blocks' sides.
func _street_furniture() -> void:
	var specs := [["bench_tex.glb", 1.0, 0.0], ["busstop_tex.glb", 2.9, 0.0], ["kiosk_tex.glb", 2.6, 0.0]]
	for bx in range(-1, 2):
		for bz in range(-1, 2):
			var c := City.block_center(Vector2i(bx, bz))
			if _blocked(c):
				continue
			for side in range(4):
				if _rng.randf() > 0.55:
					continue
				var s: Array = specs[_rng.randi() % specs.size()]
				var t := _rng.randf_range(-18.0, 18.0)
				var p := _edge_point(c, side, t, SIDEWALK_INNER + 0.4)
				var n := _model(s[0])
				if n == null:
					continue
				add_child(n)
				# The models' fronts face +Z; turn each to look across the pavement at the road.
				var yaw: float = [90.0, -90.0, 0.0, 180.0][side]
				ModelFit.place_by_height(n, s[1], yaw, City.CURB)
				n.position += Vector3(p.x, 0, p.z)
				if s[0] != "bench_tex.glb":
					ModelFit.collider_for(n, 0.8)
				props.append(n)


## Hills round the horizon: flat where they meet the city, climbing to a few hundred metres at the rim. Grass and rock by slope.
func _terrain() -> void:
	var noise := FastNoiseLite.new()
	noise.seed = 3
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = 0.0022
	noise.fractal_octaves = 4
	var span := TERRAIN_OUTER * 2.0
	var n := int(span / TERRAIN_STEP) + 1
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var idx := PackedInt32Array()
	verts.resize(n * n)
	norms.resize(n * n)
	for i in range(n):
		for j in range(n):
			var x := -TERRAIN_OUTER + i * TERRAIN_STEP
			var z := -TERRAIN_OUTER + j * TERRAIN_STEP
			verts[i * n + j] = Vector3(x, _height(noise, x, z), z)
	for i in range(n):
		for j in range(n):
			var a := verts[maxi(i - 1, 0) * n + j]
			var b := verts[mini(i + 1, n - 1) * n + j]
			var c := verts[i * n + maxi(j - 1, 0)]
			var d := verts[i * n + mini(j + 1, n - 1)]
			norms[i * n + j] = (d - c).cross(b - a).normalized()
	for i in range(n - 1):
		for j in range(n - 1):
			var cx := -TERRAIN_OUTER + (i + 0.5) * TERRAIN_STEP
			var cz := -TERRAIN_OUTER + (j + 0.5) * TERRAIN_STEP
			if absf(cx) < TERRAIN_INNER - TERRAIN_STEP and absf(cz) < TERRAIN_INNER - TERRAIN_STEP:
				continue                               # the city's own ground covers this
			var v00 := i * n + j
			var v10 := (i + 1) * n + j
			var v01 := i * n + j + 1
			var v11 := (i + 1) * n + j + 1
			idx.append_array([v00, v01, v10, v10, v01, v11])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/terrain.gdshader")
	for k in ["grass", "rock"]:
		mat.set_shader_parameter(k + "_a", load(TEX + k + "_a.jpg"))
		mat.set_shader_parameter(k + "_n", load(TEX + k + "_n.jpg"))
	terrain = MeshInstance3D.new()
	terrain.name = "Terrain"
	terrain.mesh = mesh
	terrain.material_override = mat
	terrain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(terrain)


## Flat for the first stretch past the city edge, then rising; never below the slab it starts from.
static func _height(noise: FastNoiseLite, x: float, z: float) -> float:
	var d := maxf(absf(x), absf(z))
	var rise := smoothstep(TERRAIN_INNER - 10.0, TERRAIN_INNER + 520.0, d)
	var h := (noise.get_noise_2d(x, z) * 0.5 + 0.5) * 230.0 * rise * rise
	return h - 0.35 + 0.3 * rise
