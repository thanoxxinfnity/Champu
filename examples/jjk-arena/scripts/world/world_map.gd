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
	var batch := {}                       # "model#part" -> {mesh, xforms: [], markers: [[marker, idx]]}
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
				_place_building(node, b, bx, bz, feet, batch)
	_footprints[k] = feet
	_flush_batch(node, batch)
	if props_enabled:
		_street_props(node, ox, oz, k)
	var trees := WorldGen.chunk_trees(k.x, k.y, CHUNK, 70)
	if not trees.is_empty():
		var tb := {}
		for t in trees:
			var h := WorldGen.hash2(int(t.x), int(t.z), 8)
			_add_tree(tb, t, 7.0 + h * 6.0, h)
		_flush_batch(node, tb)

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
	var TB := {}
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
				node.add_child(_park_patch(cx, cz))
				for t in 6:
					var px := cx + (WorldGen.hash2(bx, bz, 400 + t) - 0.5) * 50.0
					var pz := cz + (WorldGen.hash2(bx, bz, 500 + t) - 0.5) * 50.0
					_add_tree(TB, Vector3(px, WorldGen.height(px, pz), pz), 8.0 + WorldGen.hash2(bx, bz, 600 + t) * 6.0, WorldGen.hash2(bx, bz, t))
				X["bench"].append(Transform3D(Basis.IDENTITY, Vector3(cx, WorldGen.height(cx, cz - 8.0) + 0.25, cz - 8.0)))
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
					var p := start + dir * d
					p.y = WorldGen.height(p.x, p.z)
					var h := WorldGen.hash2(bx * 4 + e, bz * 4 + n, 700)
					if n % 3 == 0:
						X["pole"].append(Transform3D(Basis.IDENTITY, p + Vector3(0, 3.5, 0)))
						X["head"].append(Transform3D(face, p + Vector3(0, 7.0, 0) + out * 0.6))
					elif h < 0.55:
						_add_tree(TB, p, 6.0 + h * 4.0, h)
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
				var c := Vector3(x0 - 0.5, WorldGen.height(x0 - 0.5, z0 - 0.5), z0 - 0.5)
				X["pole"].append(Transform3D(Basis.from_scale(Vector3(1, 0.7, 1)), c + Vector3(0, 2.45, 0)))
				X["tlight"].append(Transform3D(Basis.IDENTITY, c + Vector3(0, 5.2, 0)))
	for key in X:
		_mm(node, _props[key], X[key], C.get(key, []))
	_flush_batch(node, TB)

## Add one tree (a real model, picked by `pick` 0..1) of `height` meters at `at` to a batch.
func _add_tree(batch: Dictionary, at: Vector3, height: float, pick: float) -> void:
	var name: String = ModelCatalog.TREES[int(pick * ModelCatalog.TREES.size()) % ModelCatalog.TREES.size()]
	var e := ModelCatalog.entry(name)
	if e.is_empty():
		return
	var s: float = height / maxf(e["size"].y, 0.01)
	var xf := Transform3D(Basis(Vector3.UP, pick * TAU).scaled(Vector3.ONE * s), at)
	_batch_parts(batch, name, e, xf, null)

func _batch_parts(batch: Dictionary, name: String, e: Dictionary, xf: Transform3D, marker: Node3D) -> void:
	var parts: Array = e["parts"]
	for i in parts.size():
		var key := "%s#%d" % [name, i]
		if not batch.has(key):
			batch[key] = {"mesh": parts[i][0], "xforms": [], "markers": []}
		var slot: Dictionary = batch[key]
		if marker != null:
			slot["markers"].append([marker, slot["xforms"].size()])
		slot["xforms"].append(xf * (parts[i][1] as Transform3D))

func _flush_batch(node: Node3D, batch: Dictionary) -> void:
	for key in batch:
		var slot: Dictionary = batch[key]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = slot["mesh"]
		mm.instance_count = slot["xforms"].size()
		for i in mm.instance_count:
			mm.set_instance_transform(i, slot["xforms"][i])
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		node.add_child(mi)
		for m in slot["markers"]:
			var marker: Node3D = m[0]
			var list: Array = marker.get_meta("mm", [])
			list.append([mm, m[1]])
			marker.set_meta("mm", list)

## A real building model on this footprint. The visible copy is part of the chunk's MultiMeshes; a light marker node carries its size and,
## when it has to collapse, swaps itself for a full node copy (`materialize`) so the tween can tilt and sink it.
func _place_building(node: Node3D, b: Dictionary, bx: int, bz: int, feet: Array, batch: Dictionary) -> void:
	var p: Vector3 = b["pos"]
	var fs: Vector3 = b["size"]
	var tall := fs.y > 40.0
	var list: Array = ModelCatalog.TOWERS if tall else ModelCatalog.MIDRISE
	var name: String = list[int(WorldGen.hash2(bx * 3 + int(p.x), bz * 5 + int(p.z), 77) * list.size()) % list.size()]
	var e := ModelCatalog.entry(name)
	if e.is_empty():
		node.add_child(_building(b))
		var s0: Vector3 = b["size"]
		feet.append({"rect": Rect2(p.x - s0.x * 0.5, p.z - s0.z * 0.5, s0.x, s0.z), "top": p.y + s0.y})
		return
	var size: Vector3 = e["size"]
	var foot := minf(fs.x, fs.z) / maxf(minf(size.x, size.z), 0.2)
	var sc := minf(maxf(fs.x, fs.z), foot) * 0.95
	if tall:
		sc = maxf(sc, fs.y / maxf(size.y, 0.3) * 0.6)      # towers keep some of their planned height
		sc = minf(sc, maxf(fs.x, fs.z) * 1.6)
	var rot := (int(WorldGen.hash2(bx, bz, int(p.x)) * 4.0) % 4) * PI * 0.5
	var marker := Node3D.new()
	marker.position = p
	marker.rotation.y = rot
	marker.add_to_group("buildings")
	var h: float = size.y * sc
	var sx: float = size.x * sc
	var sz: float = size.z * sc
	if int(round(rot / (PI * 0.5))) % 2 == 1:
		var t := sx
		sx = sz
		sz = t
	marker.set_meta("height", h)
	marker.set_meta("width", maxf(sx, sz))
	marker.set_meta("model", name)
	marker.set_meta("scale", sc)
	marker.set_meta("materialize", _materialize.bind(marker))
	node.add_child(marker)
	_batch_parts(batch, name, e, Transform3D(Basis(Vector3.UP, rot).scaled(Vector3.ONE * sc), p), marker)
	feet.append({"rect": Rect2(p.x - sx * 0.5, p.z - sz * 0.5, sx, sz), "top": p.y + h})

func _materialize(marker: Node3D) -> void:
	if marker.has_meta("solid"):
		return
	marker.set_meta("solid", true)
	for pair in marker.get_meta("mm", []):
		(pair[0] as MultiMesh).set_instance_transform(pair[1], Transform3D(Basis.from_scale(Vector3.ONE * 0.0001), Vector3(0, -500, 0)))
	var copy := ModelCatalog.instance(marker.get_meta("model"))
	if copy != null:
		copy.scale = Vector3.ONE * float(marker.get_meta("scale"))
		marker.add_child(copy)

## Park lawn that follows the slope (a small grid draped over the terrain) instead of a flat plane that would sink into a hillside.
func _park_patch(cx: float, cz: float) -> MeshInstance3D:
	var half := (WorldGen.CELL - WorldGen.ROAD - 9.0) * 0.5
	var n := 8
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz in n:
		for ix in n:
			var quad := []
			for c in [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]:
				var x: float = cx - half + (ix + c[0]) * half * 2.0 / n
				var z: float = cz - half + (iz + c[1]) * half * 2.0 / n
				quad.append(Vector3(x, WorldGen.height(x, z) + 0.08, z))
			for v in quad:
				st.set_normal(Vector3.UP)
				st.add_vertex(v)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = _props["grass"].material
	return mi
