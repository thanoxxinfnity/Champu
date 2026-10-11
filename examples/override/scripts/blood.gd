class_name Blood
extends RefCounted
## Blood on the set: splatters and drag trails on the floors, bloody hand prints on the walls, and observation glass
## with hand prints slid down it and drips running from the top. The pictures are alpha PNGs (tools/make_blood.gd);
## every decal is a thin quad a hair off the surface, with one shared material per picture.

const DIR := "res://assets/blood/"
static var _mats := {}
static var _tex := {}
static var placed := {}        # room id -> how many decals it got (the test reads it)
static var records := {}       # room id -> [{name, pos, normal}] (the test reads it)
const ATLAS_ORDER := ["splat_0", "splat_1", "splat_2", "splat_3", "splat_4", "splat_5", "hand_0", "hand_1", "hand_2", "hand_3", "smear_0", "smear_1", "smear_2", "drip_0", "drip_1"]
const ATLAS_SIZE := {"smear": Vector2(128, 256), "drip": Vector2(192, 256)}
static var _batch: Array = []
static var _atlas_mat: StandardMaterial3D


static func texture(name: String) -> Texture2D:
	if not _tex.has(name):
		_tex[name] = load("%s%s.png" % [DIR, name])
	return _tex[name]


static func material(name: String) -> StandardMaterial3D:
	if not _mats.has(name):
		var m := StandardMaterial3D.new()
		m.albedo_texture = texture(name)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.roughness = 0.22              # wet: it takes the red lamps as a sheen
		m.metallic_specular = 0.9
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		_mats[name] = m
	return _mats[name]


static func atlas_material() -> StandardMaterial3D:
	if _atlas_mat == null:
		_atlas_mat = StandardMaterial3D.new()
		_atlas_mat.albedo_texture = texture("atlas")
		_atlas_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_atlas_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		_atlas_mat.roughness = 0.22              # wet: it takes the red lamps as a sheen
		_atlas_mat.metallic_specular = 0.9
		_atlas_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	return _atlas_mat


## Where a picture is on the atlas, as a UV rectangle.
static func uv_rect(name: String) -> Rect2:
	var i := ATLAS_ORDER.find(name)
	var kind := name.get_slice("_", 0)
	var px: Vector2 = ATLAS_SIZE.get(kind, Vector2(256, 256))
	return Rect2(Vector2((i % 4) * 256.0, (i / 4) * 256.0) / 1024.0, px / 1024.0)


## A flat picture, queued: `normal` is the way the surface faces. All of a room's pictures are built into one mesh by _flush().
static func decal(_parent: Node, name: String, pos: Vector3, normal: Vector3, size: Vector2, roll := 0.0) -> void:
	var up := Vector3.UP if absf(normal.y) < 0.9 else Vector3.FORWARD
	var basis := Basis.looking_at(-normal, up) * Basis(Vector3.BACK, roll)
	_batch.append({"name": name, "xf": Transform3D(basis, pos + normal * 0.012), "size": size})


## Build everything queued into a single mesh (one surface, one draw call) under `parent`.
static func _flush(parent: Node, id: String) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_material(atlas_material())
	var recs: Array = []
	for d in _batch:
		var xf: Transform3D = d.xf
		var sz: Vector2 = d.size
		var uv := uv_rect(d.name)
		var hx := sz.x * 0.5
		var hy := sz.y * 0.5
		var corners := [Vector3(-hx, -hy, 0), Vector3(hx, -hy, 0), Vector3(hx, hy, 0), Vector3(-hx, hy, 0)]
		var uvs := [Vector2(uv.position.x, uv.end.y), Vector2(uv.end.x, uv.end.y), Vector2(uv.end.x, uv.position.y), Vector2(uv.position.x, uv.position.y)]
		var nrm := xf.basis.z.normalized()
		for k in [0, 2, 1, 0, 3, 2]:
			st.set_normal(nrm)
			st.set_uv(uvs[k])
			st.add_vertex(xf * (corners[k] as Vector3))
		recs.append({"name": d.name, "pos": xf.origin, "normal": nrm})
	records[id] = recs
	if _batch.size() > 0:
		var mi := MeshInstance3D.new()
		mi.name = "Decals"
		mi.mesh = st.commit()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)
	_batch.clear()


## Is a point on a wall of room `id` (axis "x": the wall x = at; "z": z = at) in front of one of that room's doorways?
static func _at_door(id: String, wall: String, coord: float, along: float, margin: float) -> bool:
	for d in Rooms.DOORS:
		if d.a != id and d.b != id:
			continue
		var r: Array = Rooms.LIST[id].r
		var axis: String = d.axis
		var edge_a := float(d.at)          # near face of the wall, on the lower room's side
		var on_this := false
		if axis == "x":
			on_this = (wall == "w" and absf(edge_a + 1.0 - r[0]) < 1.5) or (wall == "e" and absf(edge_a - r[1]) < 1.5)
		else:
			on_this = (wall == "s" and absf(edge_a + 1.0 - r[2]) < 1.5) or (wall == "n" and absf(edge_a - r[3]) < 1.5)
		if on_this and along >= float(d.span[0]) - margin and along <= float(d.span[1]) + 1.0 + margin:
			return true
	return false


## wall: w (x = r0, faces +x), e (x = r1, faces -x), s (z = r2, faces +z), n (z = r3, faces -z).
static func _wall_point(r: Array, wall: String, along: float, y: float) -> Array:
	match wall:
		"w": return [Vector3(r[0], y, along), Vector3.RIGHT]
		"e": return [Vector3(r[1], y, along), Vector3.LEFT]
		"s": return [Vector3(along, y, r[2]), Vector3.BACK]
		_: return [Vector3(along, y, r[3]), Vector3.FORWARD]


static func _wall_len(r: Array, wall: String) -> Array:
	return [r[2], r[3]] if wall in ["w", "e"] else [r[0], r[1]]


static func dress(w: World, n: Node3D, id: String) -> void:
	var spec: Dictionary = Rooms.LIST[id]
	var r: Array = spec.r
	var h: float = spec.h
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(id)
	var count := 0
	var wd: float = r[1] - r[0]
	var dp: float = r[3] - r[2]
	var holder := Node3D.new()
	holder.name = "Blood"
	n.add_child(holder)
	_batch.clear()
	# Splatters on the floor.
	for i in range(clampi(int(wd * dp / 20.0), 2, 7)):
		var p := Vector3(rng.randf_range(r[0] + 1.0, r[1] - 1.0), 0.0, rng.randf_range(r[2] + 1.0, r[3] - 1.0))
		var s := rng.randf_range(0.9, 2.0)
		decal(holder, "splat_%d" % rng.randi_range(0, 5), p, Vector3.UP, Vector2(s, s), rng.randf() * TAU)
		count += 1
	# A trail dragged to the first doorway of the room.
	for d in Rooms.DOORS:
		if d.a != id and d.b != id:
			continue
		var door: Vector3
		var inward: Vector3
		if d.axis == "x":
			var east: bool = absf(float(d.at) - r[1]) < 1.5
			door = Vector3(r[1] if east else r[0], 0.0, (float(d.span[0]) + float(d.span[1]) + 1.0) * 0.5)
			inward = Vector3.LEFT if east else Vector3.RIGHT
		else:
			var north: bool = absf(float(d.at) - r[3]) < 1.5
			door = Vector3((float(d.span[0]) + float(d.span[1]) + 1.0) * 0.5, 0.0, r[3] if north else r[2])
			inward = Vector3.FORWARD if north else Vector3.BACK
		for k in range(4):
			var p2 := door + inward * (1.2 + k * 1.3) + Vector3(rng.randf_range(-0.2, 0.2), 0, rng.randf_range(-0.2, 0.2))
			var yaw := atan2(inward.x, inward.z)
			decal(holder, "smear_%d" % rng.randi_range(0, 2), p2, Vector3.UP, Vector2(0.55, 1.1), yaw)
			count += 1
		break
	# Hand prints on the walls, with the glass further down.
	var hands := clampi(int((wd + dp) / 7.0), 2, 6)
	var tries := 0
	while hands > 0 and tries < 40:
		tries += 1
		var wall: String = ["w", "e", "s", "n"][rng.randi_range(0, 3)]
		var span := _wall_len(r, wall)
		var along := rng.randf_range(float(span[0]) + 0.8, float(span[1]) - 0.8)
		if _at_door(id, wall, 0.0, along, 1.0):
			continue
		var y := rng.randf_range(0.8, minf(1.9, h - 1.2))
		var wp := _wall_point(r, wall, along, y)
		decal(holder, "hand_%d" % rng.randi_range(0, 3), wp[0], wp[1], Vector2(0.55, 0.55), rng.randf_range(-0.35, 0.35))
		count += 1
		if rng.randf() < 0.6:
			decal(holder, "smear_%d" % rng.randi_range(0, 2), wp[0] + Vector3.DOWN * 0.55, wp[1], Vector2(0.28, 0.75))
			count += 1
		hands -= 1
	# Observation glass: a dark pane in a frame, bloody hands slid down it and drips from the top.
	if wd * dp >= 24.0:
		for t in range(30):
			var wall2: String = ["w", "e", "s", "n"][rng.randi_range(0, 3)]
			var span2 := _wall_len(r, wall2)
			if float(span2[1]) - float(span2[0]) < 5.0:
				continue
			var along2 := rng.randf_range(float(span2[0]) + 1.8, float(span2[1]) - 1.8)
			if _at_door(id, wall2, 0.0, along2 - 1.2, 0.8) or _at_door(id, wall2, 0.0, along2 + 1.2, 0.8):
				continue
			_glass(holder, wall2, r, along2, minf(1.6, h - 1.6), rng)
			count += 5
			break
	placed[id] = count
	_flush(holder, id)



static func _glass(parent: Node, wall: String, r: Array, along: float, y0: float, rng: RandomNumberGenerator) -> void:
	var wp := _wall_point(r, wall, along, y0 + 0.7)
	var nrm: Vector3 = wp[1]
	var size := Vector2(2.2, 1.4)
	# A pane in the wall's own frame: local +z points into the room, local x runs along the wall. Two draw calls: the glass over a dark
	# room, and the frame (four bars in one mesh). The blood on it joins the room's decal batch.
	var tr := Transform3D(Basis.looking_at(-nrm, Vector3.UP), wp[0])
	var pane := Node3D.new()
	parent.add_child(pane)
	pane.global_transform = tr
	var glass := MeshInstance3D.new()
	var qg := QuadMesh.new()
	qg.size = size
	glass.mesh = qg
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.05, 0.1, 0.13, 0.82)       # a dark room seen through glass
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.roughness = 0.04
	gm.metallic_specular = 1.0
	gm.cull_mode = BaseMaterial3D.CULL_DISABLED
	glass.material_override = gm
	glass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	glass.position = Vector3(0, 0, 0.02)
	pane.add_child(glass)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_material(Assets.mat(Color(0.12, 0.13, 0.15), 0.6, 0.7))
	var hx := size.x * 0.5 + 0.06
	var hy := size.y * 0.5 + 0.06
	var bars := [Rect2(-hx, hy - 0.1, hx * 2.0, 0.1), Rect2(-hx, -hy, hx * 2.0, 0.1), Rect2(-hx, -hy, 0.1, hy * 2.0), Rect2(hx - 0.1, -hy, 0.1, hy * 2.0)]
	for b in bars:
		var rc: Rect2 = b
		var cs := [Vector3(rc.position.x, rc.position.y, 0.03), Vector3(rc.end.x, rc.position.y, 0.03), Vector3(rc.end.x, rc.end.y, 0.03), Vector3(rc.position.x, rc.end.y, 0.03)]
		for k in [0, 2, 1, 0, 3, 2]:
			st.set_normal(Vector3.BACK)
			st.add_vertex(cs[k])
	var frame := MeshInstance3D.new()
	frame.mesh = st.commit()
	frame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	pane.add_child(frame)
	# Blood on the glass: drips from the top edge, two hands slid down, a splatter.
	var side := tr.basis.x
	var base: Vector3 = wp[0] + nrm * 0.02
	decal(parent, "drip_%d" % rng.randi_range(0, 1), base + Vector3.UP * (size.y * 0.5 - 0.5), nrm, Vector2(size.x, 1.0))
	for k in range(2):
		decal(parent, "hand_%d" % rng.randi_range(2, 3), base + side * rng.randf_range(-0.7, 0.7) + Vector3.UP * rng.randf_range(-0.2, 0.3) + nrm * 0.002 * (k + 1), nrm, Vector2(0.62, 0.62), rng.randf_range(-0.3, 0.3))
	decal(parent, "splat_%d" % rng.randi_range(0, 5), base + side * rng.randf_range(-0.6, 0.6) + Vector3.UP * 0.3 + nrm * 0.006, nrm, Vector2(0.7, 0.7), rng.randf() * TAU)
