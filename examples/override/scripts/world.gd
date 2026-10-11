class_name World
extends Node3D
## The facility, built room by room. Only the room the player is in and the rooms one door away exist at any
## time; a room two doors behind is queue_free()d and built again from the saved state if the player returns.
## The navigation mesh, on the other hand, covers the whole map and never changes, so a creature can be told to
## walk anywhere and the path is always known.

signal room_changed(room: String)

const PALETTE := {
	# wall paint, wall trim, floor tile A, floor tile B
	"clean": [Color(0.62, 0.72, 0.74), Color(0.25, 0.55, 0.62), Color(0.78, 0.82, 0.84), Color(0.55, 0.62, 0.66)],
	"dark": [Color(0.24, 0.26, 0.27), Color(0.35, 0.22, 0.14), Color(0.20, 0.21, 0.22), Color(0.14, 0.15, 0.16)],
	"lift": [Color(0.32, 0.35, 0.38), Color(0.85, 0.7, 0.1), Color(0.26, 0.28, 0.3), Color(0.2, 0.22, 0.24)],
	"wet": [Color(0.18, 0.28, 0.27), Color(0.12, 0.2, 0.22), Color(0.15, 0.22, 0.22), Color(0.1, 0.16, 0.17)],
	"factory": [Color(0.34, 0.3, 0.22), Color(0.9, 0.7, 0.08), Color(0.22, 0.22, 0.22), Color(0.17, 0.17, 0.17)],
	"core": [Color(0.3, 0.14, 0.1), Color(0.8, 0.3, 0.1), Color(0.2, 0.12, 0.1), Color(0.14, 0.08, 0.07)],
}
const SLAB := 0.5          # each room builds half of the wall between it and its neighbour
const DOOR_H := 2.7

var game: Game
var current := ""
var loaded := {}            # room id -> Node3D
var doors := {}             # door id -> Door  (only of loaded rooms)
var uses: Array[Use] = []   # everything usable in the loaded rooms
var nav_region: NavigationRegion3D
var _mats := {}             # pal -> {wall, floor, ceil}
var _cells := {}            # Vector2i -> true : every walkable metre cell on the map
var auto_follow := true     # follow the player by position as well as by doorway triggers (a test turns it off to prove the triggers)
var build_count := 0        # how many rooms were ever built (the stream test reads it)


func _ready() -> void:
	_build_nav()


# ── navigation: one mesh for the whole map ───────────────────────────────────

const NAV := 0.5            # navigation cell, metres
const NAV_MARGIN := 0.5     # how far from a wall the walkable cells start, so a path never grazes a corner


func _build_nav() -> void:
	var half := int(1.0 / NAV)
	# Cells are keyed by their lower corner in NAV units. A room contributes the cells whose whole square lies at least NAV_MARGIN
	# inside it; a doorway contributes the strip through the wall, joining the cells either side.
	var rects: Array = []
	for id in Rooms.LIST:
		var r: Array = Rooms.LIST[id].r
		rects.append([r[0] + NAV_MARGIN, r[1] - NAV_MARGIN, r[2] + NAV_MARGIN, r[3] - NAV_MARGIN])
	for d in Rooms.DOORS:
		var sp: Array = d.span
		if d.axis == "x":
			rects.append([d.at - NAV_MARGIN, d.at + Data.WALL + NAV_MARGIN, sp[0] + NAV_MARGIN, sp[1] - NAV_MARGIN])
		else:
			rects.append([sp[0] + NAV_MARGIN, sp[1] - NAV_MARGIN, d.at - NAV_MARGIN, d.at + Data.WALL + NAV_MARGIN])
	for rc in rects:
		var x0 := int(round(rc[0] / NAV))
		var x1 := int(round(rc[1] / NAV))
		var z0 := int(round(rc[2] / NAV))
		var z1 := int(round(rc[3] / NAV))
		for x in range(x0, x1):
			for z in range(z0, z1):
				_cells[Vector2i(x, z)] = true
	var verts := PackedVector3Array()
	var index := {}
	var polys: Array = []
	for c in _cells:
		var corners: Array[Vector2i] = [c, c + Vector2i(1, 0), c + Vector2i(1, 1), c + Vector2i(0, 1)]
		var ids := PackedInt32Array()
		for q in corners:
			if not index.has(q):
				index[q] = verts.size()
				verts.append(Vector3(q.x * NAV, 0.0, q.y * NAV))
			ids.append(index[q])
		polys.append(ids)
	half = half
	var nm := NavigationMesh.new()
	nm.vertices = verts
	for p in polys:
		nm.add_polygon(p)
	nm.cell_size = 0.25
	nm.agent_radius = 0.35
	nav_region = NavigationRegion3D.new()
	nav_region.navigation_mesh = nm
	add_child(nav_region)


## A point on the walkable map nearest to `p` (so a creature always has somewhere legal to stand).
func snap(p: Vector3) -> Vector3:
	return NavigationServer3D.map_get_closest_point(get_world_3d().navigation_map, p)


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	return NavigationServer3D.map_get_path(get_world_3d().navigation_map, from, to, true)


# ── streaming ────────────────────────────────────────────────────────────────

func start_at(room: String) -> void:
	current = ""
	focus(room)


func wanted(room: String) -> Array:
	var out := [room]
	out.append_array(Rooms.neighbours(room))
	return out


## Make `room` the one the player is in: build it and its neighbours, free the rest.
func focus(room: String) -> void:
	if room == "" or not Rooms.LIST.has(room):
		return
	var changed := room != current
	current = room
	var keep := wanted(room)
	for id in keep:
		if not loaded.has(id):
			_load(id)
	for id in loaded.keys():
		if id not in keep:
			_unload(id)
	if changed:
		room_changed.emit(room)


func _load(id: String) -> void:
	var n := Node3D.new()
	n.name = "Room_" + id
	n.set_meta("room", id)    # the name can be changed by the engine when a freed room of the same id is still waiting to go
	add_child(n)
	loaded[id] = n
	build_count += 1
	_build_room(id, n)
	Dressing.build(self, id, n)
	game.room_built(id, n)


func _unload(id: String) -> void:
	var n: Node3D = loaded[id]
	loaded.erase(id)
	for u in uses.duplicate():
		if n.is_ancestor_of(u):
			uses.erase(u)
	for k in doors.keys():
		if not is_instance_valid(doors[k]) or n.is_ancestor_of(doors[k]):
			doors.erase(k)
	game.room_freed(id)
	n.queue_free()


## A safety net under the doorway triggers: if the player is somehow in a room that is not the current one, follow them.
func focus_if_needed(pos: Vector3) -> void:
	if not auto_follow:
		return
	var r := Rooms.at(pos)
	if r != "" and r != current:
		focus(r)


func is_loaded(id: String) -> bool:
	return loaded.has(id)


# ── building a room ──────────────────────────────────────────────────────────

func _materials(pal: String) -> Dictionary:
	if not _mats.has(pal):
		var c: Array = PALETTE[pal]
		var m := {}
		for mode in [0, 1, 2]:
			var sm := ShaderMaterial.new()
			sm.shader = load("res://shaders/station.gdshader") as Shader
			sm.set_shader_parameter("mode", mode)
			if mode == 0:
				sm.set_shader_parameter("base", Vector3(c[0].r, c[0].g, c[0].b))
				sm.set_shader_parameter("trim", Vector3(c[1].r, c[1].g, c[1].b))
			elif mode == 1:
				sm.set_shader_parameter("base", Vector3(c[2].r, c[2].g, c[2].b))
				sm.set_shader_parameter("trim", Vector3(c[3].r, c[3].g, c[3].b))
			else:
				sm.set_shader_parameter("base", Vector3(c[0].r * 0.5, c[0].g * 0.5, c[0].b * 0.5))
			m[["wall", "floor", "ceil"][mode]] = sm
		_mats[pal] = m
	return _mats[pal]


func mesh_box(size: Vector3, pos: Vector3, mat: Material, parent: Node) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


func solid(size: Vector3, pos: Vector3, parent: Node, layer := Data.L_WORLD) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = layer
	b.collision_mask = 0
	b.position = pos
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	b.add_child(cs)
	parent.add_child(b)
	return b


func _build_room(id: String, node: Node3D) -> void:
	var spec: Dictionary = Rooms.LIST[id]
	var r: Array = spec.r
	var h: float = spec.h
	var m := _materials(spec.pal)
	var x0 := float(r[0])
	var x1 := float(r[1])
	var z0 := float(r[2])
	var z1 := float(r[3])
	var cx := (x0 + x1) * 0.5
	var cz := (z0 + z1) * 0.5
	# Floor and ceiling run out under the half-walls so a doorway has ground in it.
	var fw := x1 - x0 + 2.0 * SLAB
	var fd := z1 - z0 + 2.0 * SLAB
	mesh_box(Vector3(fw, 0.2, fd), Vector3(cx, -0.1, cz), m.floor, node)
	solid(Vector3(fw, 0.4, fd), Vector3(cx, -0.2, cz), node)
	mesh_box(Vector3(fw, 0.2, fd), Vector3(cx, h + 0.1, cz), m.ceil, node)
	solid(Vector3(fw, 0.4, fd), Vector3(cx, h + 0.2, cz), node)
	# Four walls, each with the doorways that open on it.
	_side(node, id, "x", x0, -1, z0, z1, h, m)
	_side(node, id, "x", x1, 1, z0, z1, h, m)
	_side(node, id, "z", z0, -1, x0, x1, h, m)
	_side(node, id, "z", z1, 1, x0, x1, h, m)


## One side of a room. `axis` "x": the wall is the plane x = at, running along z from a to b; "z": the plane z = at, along x.
func _side(node: Node3D, id: String, axis: String, at: float, dir: int, a: float, b: float, h: float, m: Dictionary) -> void:
	var gaps: Array = []
	for d in Rooms.DOORS:
		if d.axis != axis:
			continue
		var edge := float(d.at) if dir > 0 else float(d.at + 1)
		if (d.a == id and dir > 0 and edge == at) or (d.b == id and dir < 0 and edge == at):
			gaps.append([float(d.span[0]), float(d.span[1])])
			_door(node, d)
	gaps.sort_custom(func(p, q): return p[0] < q[0])
	var cuts: Array = [a - SLAB]
	for g in gaps:
		cuts.append(g[0])
		cuts.append(g[1])
	cuts.append(b + SLAB)
	for i in range(0, cuts.size(), 2):
		_slab(node, axis, at, dir, cuts[i], cuts[i + 1], 0.0, h, m)
	for g in gaps:
		_slab(node, axis, at, dir, g[0], g[1], DOOR_H, h, m)


func _slab(node: Node3D, axis: String, at: float, dir: int, from: float, to: float, y0: float, y1: float, m: Dictionary) -> void:
	if to - from < 0.01 or y1 - y0 < 0.01:
		return
	var out := at + dir * SLAB * 0.5
	var size := Vector3(SLAB, y1 - y0, to - from) if axis == "x" else Vector3(to - from, y1 - y0, SLAB)
	var pos := Vector3(out, (y0 + y1) * 0.5, (from + to) * 0.5) if axis == "x" else Vector3((from + to) * 0.5, (y0 + y1) * 0.5, out)
	var body := solid(size, pos, node)
	mesh_box(size, Vector3.ZERO, m.wall, body)
	# What is behind a wall is not drawn: every slab is also an occluder.
	var occ := OccluderInstance3D.new()
	var bo := BoxOccluder3D.new()
	bo.size = size
	occ.occluder = bo
	body.add_child(occ)


## A doorway: a trigger across it that tells the streamer which side the player is walking into, and a steel
## door when the doorway is locked.
func _door(node: Node3D, d: Dictionary) -> void:
	var span: Array = d.span
	var mid: float = (span[0] + span[1]) * 0.5
	var at := float(d.at) + 0.5
	var area := Area3D.new()
	area.collision_layer = 0
	area.collision_mask = Data.L_PLAYER
	area.name = "Trigger_" + d.id
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	# Just the gap in the wall (a hair deeper): standing in the doorway is crossing it.
	bs.size = Vector3(1.2, 2.5, span[1] - span[0]) if d.axis == "x" else Vector3(span[1] - span[0], 2.5, 1.2)
	cs.shape = bs
	area.add_child(cs)
	area.position = Vector3(at, 1.25, mid) if d.axis == "x" else Vector3(mid, 1.25, at)
	node.add_child(area)
	area.body_entered.connect(func(body: Node3D):
		if body is Player:
			game.door_entered(d))
	if d.has("locked") and not game.s.unlocked.has(d.locked):
		var door := Door.new()
		door.build(d.id, float(span[1] - span[0]), DOOR_H, _door_mat(), d.axis == "z")
		door.position = Vector3(at, 0.0, mid) if d.axis == "x" else Vector3(mid, 0.0, at)
		door.sfx = game.sfx
		door.set_meta("locked", d.locked)
		node.add_child(door)
		doors[d.id + "/" + node.name] = door


func _door_mat() -> Material:
	if not _mats.has("door"):
		var sm := ShaderMaterial.new()
		sm.shader = load("res://shaders/station.gdshader") as Shader
		sm.set_shader_parameter("mode", 0)
		sm.set_shader_parameter("base", Vector3(0.3, 0.32, 0.34))
		sm.set_shader_parameter("trim", Vector3(0.9, 0.7, 0.1))
		_mats["door"] = sm
	return _mats["door"]


func unlock(key: String) -> void:
	game.s.unlocked[key] = true
	for k in doors.keys():
		var door: Door = doors[k]
		if door.get_meta("locked", "") == key:
			door.set_open(true)


# ── things in the rooms ──────────────────────────────────────────────────────

## A model standing at `pos`, turned `yaw` degrees. Solid unless `collide` is off.
func prop(parent: Node, model: String, size: float, pos: Vector3, yaw := 0.0, collide := true, by_length := false, align := "", foot := 0.0) -> Node3D:
	var m := Assets.make(model, size, by_length, false, align, foot)
	m.position = pos
	m.rotation_degrees.y = yaw
	parent.add_child(m)
	if collide:
		var s := Assets.size_of(m)
		var rot := Basis(Vector3.UP, deg_to_rad(yaw))
		var ext := (rot * s).abs()
		if ext.x > 0.3 or ext.z > 0.3:
			solid(Vector3(maxf(ext.x * 0.9, 0.3), maxf(s.y, 0.3), maxf(ext.z * 0.9, 0.3)), pos + Vector3(0, s.y * 0.5, 0), parent)
	return m


func use(parent: Node, id: String, size: Vector3, pos: Vector3, act: Callable) -> Use:
	var u := Use.new().setup(id, id, size, pos, act)
	parent.add_child(u)
	uses.append(u)
	return u


## A lamp: a light and a fixture, in the emergency colour (red) unless `white`.
func lamp(parent: Node, pos: Vector3, white := false, rng_m := 7.0) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.position = pos - Vector3(0, 0.2, 0)
	l.omni_range = rng_m
	l.light_color = Color(0.85, 0.95, 1.0) if white else Color(1.0, 0.12, 0.07)
	l.light_energy = 1.4 if white else 1.1
	l.shadow_enabled = false
	parent.add_child(l)
	var fix := mesh_box(Vector3(0.6, 0.08, 0.22), pos, Assets.mat(l.light_color, 0.4, 0.0, 2.2), parent)
	fix.name = "Fixture"
	# A cone of dust-light under it: the substitute for volumetric fog this renderer cannot do.
	var shaft := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.02
	cm.bottom_radius = 1.2
	cm.height = maxf(pos.y - 0.1, 1.0)
	cm.radial_segments = 12
	cm.rings = 1
	cm.cap_top = false
	cm.cap_bottom = false
	shaft.mesh = cm
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/shaft.gdshader")
	sm.set_shader_parameter("tint", l.light_color)
	sm.set_shader_parameter("strength", 0.08 if white else 0.12)
	sm.set_shader_parameter("flicker", 0.0 if white else 0.25)
	shaft.material_override = sm
	shaft.position = Vector3(pos.x, pos.y - 0.1 - cm.height * 0.5, pos.z)
	shaft.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(shaft)
	return l
