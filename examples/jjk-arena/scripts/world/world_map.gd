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
var props_enabled := true
var _props := {}                        ## prop name -> Mesh (shared by every chunk's MultiMesh)

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
	_make_props()
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
	if props_enabled:
		_street_props(node, ox, oz, k)
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

static func _mat(c: Color, rough := 0.8, metal := 0.0, emit := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit > 0.0:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = emit
	return m

## Street furniture meshes, built once: lamp posts, lamp heads, car bodies and cabins (instance-coloured), tree trunks and crowns,
## traffic-light poles and boxes, benches, bins and park grass.
func _make_props() -> void:
	var pole := CylinderMesh.new()
	pole.top_radius = 0.08
	pole.bottom_radius = 0.12
	pole.height = 7.0
	pole.radial_segments = 6
	pole.material = _mat(Color(0.15, 0.16, 0.18), 0.5, 0.6)
	_props["pole"] = pole
	var head := BoxMesh.new()
	head.size = Vector3(0.5, 0.18, 1.4)
	head.material = _mat(Color(1.0, 0.9, 0.7), 0.4, 0.0, 2.0)
	_props["head"] = head
	var body := BoxMesh.new()
	body.size = Vector3(1.9, 0.75, 4.4)
	var bm := _mat(Color(1, 1, 1), 0.3, 0.5)
	bm.vertex_color_use_as_albedo = true
	body.material = bm
	_props["car"] = body
	var cab := BoxMesh.new()
	cab.size = Vector3(1.7, 0.6, 2.3)
	cab.material = _mat(Color(0.08, 0.1, 0.13), 0.1, 0.4)
	_props["cab"] = cab
	var wheelbar := BoxMesh.new()
	wheelbar.size = Vector3(2.0, 0.55, 0.55)
	wheelbar.material = _mat(Color(0.05, 0.05, 0.05), 0.9)
	_props["wheels"] = wheelbar
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.12
	trunk.bottom_radius = 0.18
	trunk.height = 2.6
	trunk.radial_segments = 5
	trunk.material = _mat(Color(0.25, 0.17, 0.1), 1.0)
	_props["trunk"] = trunk
	var crown := SphereMesh.new()
	crown.radius = 1.6
	crown.height = 2.8
	crown.radial_segments = 8
	crown.rings = 4
	var cm := _mat(Color(1, 1, 1), 1.0)
	cm.vertex_color_use_as_albedo = true
	crown.material = cm
	_props["crown"] = crown
	var tl := BoxMesh.new()
	tl.size = Vector3(0.35, 1.0, 0.3)
	tl.material = _mat(Color(0.9, 0.2, 0.15), 0.4, 0.0, 1.5)
	_props["tlight"] = tl
	var bench := BoxMesh.new()
	bench.size = Vector3(1.8, 0.45, 0.55)
	bench.material = _mat(Color(0.35, 0.22, 0.12), 0.9)
	_props["bench"] = bench
	var bin := CylinderMesh.new()
	bin.top_radius = 0.28
	bin.bottom_radius = 0.24
	bin.height = 0.9
	bin.radial_segments = 6
	bin.material = _mat(Color(0.12, 0.3, 0.16), 0.6)
	_props["bin"] = bin
	var grass := PlaneMesh.new()
	grass.size = Vector2(WorldGen.CELL - WorldGen.ROAD - 9.0, WorldGen.CELL - WorldGen.ROAD - 9.0)
	grass.material = _mat(Color(0.18, 0.33, 0.14), 1.0)
	_props["grass"] = grass

func _mm(node: Node3D, mesh: Mesh, xforms: Array, colors: Array = []) -> void:
	if xforms.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = not colors.is_empty()
	mm.mesh = mesh
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		if mm.use_colors:
			mm.set_instance_color(i, colors[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if mesh != _props["car"] else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	node.add_child(mi)

const CAR_COLORS := [Color(0.75, 0.1, 0.1), Color(0.9, 0.9, 0.92), Color(0.1, 0.1, 0.12), Color(0.15, 0.3, 0.7), Color(0.6, 0.6, 0.62), Color(0.9, 0.7, 0.1), Color(0.2, 0.45, 0.25)]

## Lamps, trees and benches along every sidewalk, cars parked at the kerb, traffic lights on the corners, and grass + trees on empty lots.
func _street_props(node: Node3D, ox: float, oz: float, k: Vector2i) -> void:
	var X := {"pole": [], "head": [], "car": [], "cab": [], "wheels": [], "trunk": [], "crown": [], "tlight": [], "bench": [], "bin": [], "grass": []}
	var C := {"car": [], "crown": []}
	var cell := WorldGen.CELL
	var half := WorldGen.ROAD * 0.5
	var b0x := floori(ox / cell)
	var b0z := floori(oz / cell)
	for bx in range(b0x, floori((ox + CHUNK) / cell) + 1):
		for bz in range(b0z, floori((oz + CHUNK) / cell) + 1):
			var cx := (bx + 0.5) * cell
			var cz := (bz + 0.5) * cell
			if cx < ox or cx >= ox + CHUNK or cz < oz or cz >= oz + CHUNK or not WorldGen.in_city(cx, cz):
				continue
			var y := WorldGen.height(cx, cz)
			var x0 := bx * cell + half + 1.6          # sidewalk line inside the block
			var x1 := (bx + 1) * cell - half - 1.6
			var z0 := bz * cell + half + 1.6
			var z1 := (bz + 1) * cell - half - 1.6
			var empty := WorldGen.block_buildings(bx, bz).is_empty()
			if empty:
				X["grass"].append(Transform3D(Basis.IDENTITY, Vector3(cx, y + 0.05, cz)))
				for t in 6:
					var px := cx + (WorldGen.hash2(bx, bz, 400 + t) - 0.5) * 50.0
					var pz := cz + (WorldGen.hash2(bx, bz, 500 + t) - 0.5) * 50.0
					X["trunk"].append(Transform3D(Basis.IDENTITY, Vector3(px, y + 1.3, pz)))
					X["crown"].append(Transform3D(Basis.from_scale(Vector3.ONE * (1.0 + WorldGen.hash2(bx, bz, 600 + t))), Vector3(px, y + 3.6, pz)))
					C["crown"].append(Color(0.12, 0.3 + 0.1 * WorldGen.hash2(bx, bz, t), 0.1))
				X["bench"].append(Transform3D(Basis.IDENTITY, Vector3(cx, y + 0.25, cz - 8.0)))
			# four sidewalks around the block
			var edges := [[Vector3(x0, 0, z0), Vector3(1, 0, 0), x1 - x0], [Vector3(x0, 0, z1), Vector3(1, 0, 0), x1 - x0],
				[Vector3(x0, 0, z0), Vector3(0, 0, 1), z1 - z0], [Vector3(x1, 0, z0), Vector3(0, 0, 1), z1 - z0]]
			for e in 4:
				var start: Vector3 = edges[e][0]
				var dir: Vector3 = edges[e][1]
				var length: float = edges[e][2]
				var out := Vector3(0, 0, -1) if e == 0 else (Vector3(0, 0, 1) if e == 1 else (Vector3(-1, 0, 0) if e == 2 else Vector3(1, 0, 0)))
				var face := Basis.looking_at(-out, Vector3.UP)
				var d := 6.0
				var n := 0
				while d < length - 4.0:
					var p := start + dir * d + Vector3(0, y, 0)
					var h := WorldGen.hash2(bx * 4 + e, bz * 4 + n, 700)
					if n % 3 == 0:
						X["pole"].append(Transform3D(Basis.IDENTITY, p + Vector3(0, 3.5, 0)))
						X["head"].append(Transform3D(face, p + Vector3(0, 7.0, 0) + out * 0.6))
					elif h < 0.55:
						X["trunk"].append(Transform3D(Basis.IDENTITY, p + Vector3(0, 1.3, 0)))
						X["crown"].append(Transform3D(Basis.from_scale(Vector3.ONE * (0.8 + h * 0.6)), p + Vector3(0, 3.5, 0)))
						C["crown"].append(Color(0.13, 0.32 + 0.12 * h, 0.1))
					elif h < 0.68:
						X["bench"].append(Transform3D(face, p + Vector3(0, 0.25, 0)))
					elif h < 0.78:
						X["bin"].append(Transform3D(Basis.IDENTITY, p + Vector3(0, 0.45, 0)))
					# a parked car at the kerb now and then
					if WorldGen.hash2(bx * 9 + e, bz * 9 + n, 800) < 0.28:
						var cp := p + out * 4.0 + Vector3(0, 0.55, 0)
						var cb := Basis.looking_at(dir, Vector3.UP)
						X["car"].append(Transform3D(cb, cp))
						X["cab"].append(Transform3D(cb, cp + Vector3(0, 0.65, 0) - dir * 0.2))
						X["wheels"].append(Transform3D(cb, cp + Vector3(0, -0.3, 0) + dir * 1.3))
						X["wheels"].append(Transform3D(cb, cp + Vector3(0, -0.3, 0) - dir * 1.3))
						C["car"].append(CAR_COLORS[int(WorldGen.hash2(bx, bz, 900 + n + e * 31) * CAR_COLORS.size()) % CAR_COLORS.size()])
					d += 8.0
					n += 1
			# traffic light on the corner
			if WorldGen.hash2(bx, bz, 950) < 0.6:
				var c := Vector3(x0 - 0.5, y, z0 - 0.5)
				X["pole"].append(Transform3D(Basis.from_scale(Vector3(1, 0.7, 1)), c + Vector3(0, 2.45, 0)))
				X["tlight"].append(Transform3D(Basis.IDENTITY, c + Vector3(0, 5.2, 0)))
	for key in X:
		_mm(node, _props[key], X[key], C.get(key, []))
