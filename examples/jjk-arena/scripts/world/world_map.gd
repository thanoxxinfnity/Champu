class_name WorldMap
extends Node3D
## Streams the 5.6 km open world in 128 m chunks around a focus point. Only the chunks inside `view_chunks` exist at any time (at most ~0.8 km
## from the player on the biggest setting), one new chunk per frame, so a phone never holds more than a few hundred meters of city.
## Each chunk: ground mesh (WorldGen.height), its city blocks' buildings (individually collapsible), trees, and footprint data for collision.

const CHUNK := 128.0
const GRID := 28                        ## quads per chunk edge (4.6 m)

var view_chunks := 3
var focus := Vector3.ZERO
var _chunks := {}                       ## Vector2i -> Node3D
var _footprints := {}                   ## Vector2i -> Array of {rect: Rect2, top: float}
var _terrain_mat: ShaderMaterial
var _wall_mats: Array[StandardMaterial3D] = []
var _tree_mesh: Mesh
var _roof_mat: StandardMaterial3D
var _queue: Array[Vector2i] = []
var _water: MeshInstance3D
var built_count := 0

func _ready() -> void:
	_terrain_mat = ShaderMaterial.new()
	_terrain_mat.shader = load("res://shaders/terrain.gdshader")
	var tex := _window_texture(false)
	var emi := _window_texture(true)
	for i in 4:
		var m := StandardMaterial3D.new()
		m.albedo_texture = tex
		m.albedo_color = [Color(0.55, 0.58, 0.64), Color(0.62, 0.52, 0.45), Color(0.42, 0.48, 0.55), Color(0.5, 0.5, 0.48)][i]
		m.emission_enabled = true
		m.emission_texture = emi
		m.emission = Color(1.0, 0.82, 0.5)
		m.emission_energy_multiplier = 0.3
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3.ONE / 22.0
		m.roughness = 0.8
		_wall_mats.append(m)
	_roof_mat = StandardMaterial3D.new()
	_roof_mat.albedo_color = Color(0.2, 0.2, 0.22)
	var cone := CylinderMesh.new()
	cone.top_radius = 0.0
	cone.bottom_radius = 2.2
	cone.height = 10.0
	cone.radial_segments = 5
	cone.rings = 1
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color(0.08, 0.22, 0.1)
	tm.roughness = 1.0
	cone.material = tm
	_tree_mesh = cone
	_water = MeshInstance3D.new()
	var wp := PlaneMesh.new()
	wp.size = Vector2(WorldGen.LAKE_R * 3.0, WorldGen.LAKE_R * 3.0)
	_water.mesh = wp
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.1, 0.3, 0.45, 0.78)
	wm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	wm.roughness = 0.1
	wm.metallic = 0.3
	_water.material_override = wm
	_water.position = Vector3(WorldGen.LAKE_C.x, -3.2, WorldGen.LAKE_C.y)
	add_child(_water)

static func _window_texture(emission: bool) -> ImageTexture:
	var n := 128
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var lit := {}
	for wy in 8:
		for wx in 6:
			lit[Vector2i(wx, wy)] = rng.randf() < 0.45
	for y in n:
		for x in n:
			var cx := x % 21
			var cy := y % 16
			var win := cx > 4 and cx < 17 and cy > 3 and cy < 13
			var key := Vector2i(x / 21, y / 16)
			var on: bool = lit.get(key, false)
			if emission:
				img.set_pixel(x, y, Color(1, 1, 1, 1) if (win and on) else Color(0, 0, 0, 1))
			else:
				img.set_pixel(x, y, Color(0.12, 0.14, 0.2, 1) if win else Color(0.72, 0.72, 0.74, 1))
	return ImageTexture.create_from_image(img)

func _key(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / CHUNK), floori(p.z / CHUNK))

## Call every frame with the player position: queues new chunks near it and frees old ones.
func update(at: Vector3) -> void:
	focus = at
	var c := _key(at)
	var want := {}
	for dz in range(-view_chunks, view_chunks + 1):
		for dx in range(-view_chunks, view_chunks + 1):
			if Vector2(dx, dz).length() <= view_chunks + 0.5:
				var k := Vector2i(c.x + dx, c.y + dz)
				if absf((k.x + 0.5) * CHUNK) < WorldGen.HALF and absf((k.y + 0.5) * CHUNK) < WorldGen.HALF:
					want[k] = true
	for k in _chunks.keys():
		if not want.has(k) and Vector2(k - c).length() > view_chunks + 1.5:
			_chunks[k].queue_free()
			_chunks.erase(k)
			_footprints.erase(k)
	_queue = _queue.filter(func(k: Vector2i) -> bool: return want.has(k) and not _chunks.has(k))
	for k in want:
		if not _chunks.has(k) and not _queue.has(k):
			_queue.append(k)
	_queue.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return Vector2(a - c).length() < Vector2(b - c).length())

func _process(_d: float) -> void:
	if not _queue.is_empty():
		var k: Vector2i = _queue.pop_front()
		if not _chunks.has(k):
			_build_chunk(k)

## Build every queued chunk right now (used when the world starts, so the player lands on ground).
func build_all_now() -> void:
	while not _queue.is_empty():
		var k: Vector2i = _queue.pop_front()
		if not _chunks.has(k):
			_build_chunk(k)

func chunk_count() -> int:
	return _chunks.size()

func _build_chunk(k: Vector2i) -> void:
	var node := Node3D.new()
	node.name = "Chunk_%d_%d" % [k.x, k.y]
	add_child(node)
	_chunks[k] = node
	built_count += 1
	var ox := k.x * CHUNK
	var oz := k.y * CHUNK
	node.add_child(_terrain(ox, oz))
	var feet := []
	# blocks whose centre falls inside this chunk
	var b0x := floori(ox / WorldGen.CELL)
	var b1x := floori((ox + CHUNK) / WorldGen.CELL)
	var b0z := floori(oz / WorldGen.CELL)
	var b1z := floori((oz + CHUNK) / WorldGen.CELL)
	for bx in range(b0x, b1x + 1):
		for bz in range(b0z, b1z + 1):
			var cx := (bx + 0.5) * WorldGen.CELL
			var cz := (bz + 0.5) * WorldGen.CELL
			if cx < ox or cx >= ox + CHUNK or cz < oz or cz >= oz + CHUNK:
				continue
			for b in WorldGen.block_buildings(bx, bz):
				node.add_child(_building(b))
				var s: Vector3 = b["size"]
				var p: Vector3 = b["pos"]
				feet.append({"rect": Rect2(p.x - s.x * 0.5, p.z - s.z * 0.5, s.x, s.z), "top": p.y + s.y})
	_footprints[k] = feet
	var trees := WorldGen.chunk_trees(k.x, k.y, CHUNK, 90)
	if not trees.is_empty():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = _tree_mesh
		mm.instance_count = trees.size()
		for i in trees.size():
			var t: Vector3 = trees[i]
			var sc := 0.7 + WorldGen.hash2(int(t.x), int(t.z), 8) * 1.1
			mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(sc, sc, sc)), t + Vector3(0, 5.0 * sc, 0)))
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		node.add_child(mi)

func _terrain(ox: float, oz: float) -> MeshInstance3D:
	var n := GRID + 1
	var step := CHUNK / GRID
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var idx := PackedInt32Array()
	verts.resize(n * n)
	norms.resize(n * n)
	for iz in n:
		for ix in n:
			var x := ox + ix * step
			var z := oz + iz * step
			var h := WorldGen.height(x, z)
			verts[iz * n + ix] = Vector3(x - ox, h, z - oz)
			var hx := WorldGen.height(x + 1.5, z) - WorldGen.height(x - 1.5, z)
			var hz := WorldGen.height(x, z + 1.5) - WorldGen.height(x, z - 1.5)
			norms[iz * n + ix] = Vector3(-hx, 3.0, -hz).normalized()
	for iz in GRID:
		for ix in GRID:
			var a := iz * n + ix
			idx.append_array([a, a + 1, a + n, a + 1, a + n + 1, a + n])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _terrain_mat
	mi.position = Vector3(ox, 0, oz)
	mi.custom_aabb = AABB(Vector3(0, -20, 0), Vector3(CHUNK, 700, CHUNK))
	return mi

func _building(b: Dictionary) -> Node3D:
	var holder := Node3D.new()
	var p: Vector3 = b["pos"]
	var s: Vector3 = b["size"]
	holder.position = p
	holder.set_meta("height", s.y)
	holder.set_meta("width", maxf(s.x, s.z))
	holder.add_to_group("buildings")
	var m := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	m.mesh = box
	m.scale = s
	m.position.y = s.y * 0.5
	m.material_override = _wall_mats[int(b["kind"]) % 4]
	holder.add_child(m)
	return holder

## Terrain height at a point (the fighters stand on this).
func ground(x: float, z: float) -> float:
	return maxf(WorldGen.height(x, z), -2.5)

## Push a ground-level position out of any building footprint it overlaps (flying above the roof is fine).
func resolve(p: Vector3) -> Vector3:
	var c := _key(p)
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			for f in _footprints.get(Vector2i(c.x + dx, c.y + dz), []):
				if p.y > f["top"] + 0.5:
					continue
				var r: Rect2 = f["rect"].grow(0.7)
				if r.has_point(Vector2(p.x, p.z)):
					var l := p.x - r.position.x
					var rr := r.end.x - p.x
					var t := p.z - r.position.y
					var bt := r.end.y - p.z
					var m := minf(minf(l, rr), minf(t, bt))
					if m == l: p.x = r.position.x
					elif m == rr: p.x = r.end.x
					elif m == t: p.z = r.position.y
					else: p.z = r.end.y
	return p
