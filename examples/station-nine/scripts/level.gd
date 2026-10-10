class_name Level
extends Node3D
## The station: a hub with four corridors, four sectors, an airlock and a pod bay, built from boxes
## so every wall is solid and every doorway is exactly as wide as it looks. Also the waypoint graph
## the Hollow walks, and every thing in the world you can press USE on.
##
##            CONTROL (-28..-16)
##                |
##   DORM  --  HUB (±10)  --  LAB          AIRLOCK on the hub's west wall (south end),
##                |                        POD BAY on its east wall (north end).
##            ENGINE (16..28)

const H_HUB := 4.5
const H_ROOM := 3.4
const H_COR := 3.0
const DOOR_W := 3.0
const DOOR_H := 2.7
const T := 0.3
# Yaw that makes a model face +x, -x, +z, -z (a model's front is its -Z side at yaw 0).
const FPX := -90.0
const FNX := 90.0
const FPZ := 180.0
const FNZ := 0.0

# Floor areas: zone -> [x0, x1, z0, z1, ceiling height]. Searched in this order for zone_at().
const AREAS := {
	"airlock": [-16.0, -10.0, 3.5, 9.5, 3.2],
	"pod": [10.0, 16.0, -9.5, -3.5, 3.2],
	"corN": [-1.5, 1.5, -16.0, -10.0, 3.0],
	"corE": [10.0, 17.0, -1.5, 1.5, 3.0],
	"corS": [-1.5, 1.5, 10.0, 16.0, 3.0],
	"corW": [-17.0, -10.0, -1.5, 1.5, 3.0],
	"control": [-8.0, 8.0, -28.0, -16.0, 3.4],
	"lab": [17.0, 33.0, -8.0, 8.0, 3.4],
	"engine": [-9.0, 9.0, 16.0, 28.0, 3.4],
	"dorm": [-33.0, -17.0, -8.0, 8.0, 3.4],
	"hub": [-10.0, 10.0, -10.0, 10.0, 4.5],
}

var game: Game
var lit := {}                 # zone -> bool
var lights := {}              # zone -> Array[Dictionary{light, glow}]
var nodes := {}               # id -> {pos: Vector3, zone: String}
var edges := {}               # id -> Array[{to: String, door: String}]
var doors := {}               # id -> Door
var uses: Array[Use] = []
var lockers: Array[Use] = []
var valve_labels := {}        # "A" -> Label3D
var mat_wall: ShaderMaterial
var mat_floor: ShaderMaterial
var mat_ceil: ShaderMaterial
var mat_door: ShaderMaterial
var _tween_lights := {}


func build(g: Game) -> void:
	game = g
	_materials()
	for zone in AREAS:
		lit[zone] = zone == "airlock"
		lights[zone] = []
		_floor_and_ceiling(zone)
	_walls()
	_doors()
	_graph()
	_lamps()
	_dressing()
	_signs()
	_door_panels()
	for zone in lit:
		set_lit(zone, lit[zone], true)


# ── materials ────────────────────────────────────────────────────────────────

func _materials() -> void:
	var shader := load("res://shaders/station.gdshader") as Shader
	mat_wall = ShaderMaterial.new()
	mat_wall.shader = shader
	mat_wall.set_shader_parameter("mode", 0)
	mat_floor = ShaderMaterial.new()
	mat_floor.shader = shader
	mat_floor.set_shader_parameter("mode", 1)
	mat_ceil = ShaderMaterial.new()
	mat_ceil.shader = shader
	mat_ceil.set_shader_parameter("mode", 2)
	mat_door = ShaderMaterial.new()
	mat_door.shader = shader
	mat_door.set_shader_parameter("mode", 0)
	mat_door.set_shader_parameter("base", Vector3(0.26, 0.3, 0.34))
	mat_door.set_shader_parameter("rust", 0.2)


func _mesh_box(size: Vector3, pos: Vector3, mat: Material, parent: Node = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	(parent if parent != null else self).add_child(mi)
	return mi


func _solid(size: Vector3, pos: Vector3, parent: Node = null) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = Data.L_WORLD
	b.collision_mask = 0
	b.position = pos
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	b.add_child(cs)
	(parent if parent != null else self).add_child(b)
	return b


# ── floors, ceilings, walls ──────────────────────────────────────────────────

func _tiles(x0: float, x1: float, z0: float, z1: float, y: float, thick: float, mat: Material) -> void:
	var nx := int(ceil((x1 - x0) / 6.0))
	var nz := int(ceil((z1 - z0) / 6.0))
	for i in range(nx):
		for j in range(nz):
			var ax := x0 + (x1 - x0) * float(i) / nx
			var bx := x0 + (x1 - x0) * float(i + 1) / nx
			var az := z0 + (z1 - z0) * float(j) / nz
			var bz := z0 + (z1 - z0) * float(j + 1) / nz
			_mesh_box(Vector3(bx - ax, thick, bz - az), Vector3((ax + bx) * 0.5, y, (az + bz) * 0.5), mat)


func _floor_and_ceiling(zone: String) -> void:
	var a: Array = AREAS[zone]
	_tiles(a[0], a[1], a[2], a[3], -0.1, 0.2, mat_floor)
	_tiles(a[0], a[1], a[2], a[3], float(a[4]) + 0.1, 0.2, mat_ceil)
	_solid(Vector3(a[1] - a[0] + 0.4, 0.4, a[3] - a[2] + 0.4), Vector3((a[0] + a[1]) * 0.5, -0.2, (a[2] + a[3]) * 0.5))


## A wall along `axis` ("x": runs along x at z = fixed; "z": runs along z at x = fixed) from a to b,
## with doorway gaps [[g0, g1], ...] (a lintel closes the top of each).
func _wall(axis: String, fixed: float, a: float, b: float, h: float, gaps: Array = []) -> void:
	var cuts: Array = [a]
	gaps = gaps.duplicate()
	gaps.sort_custom(func(x, y): return x[0] < y[0])
	for g in gaps:
		cuts.append(g[0])
		cuts.append(g[1])
	cuts.append(b)
	for i in range(0, cuts.size(), 2):
		_wall_piece(axis, fixed, cuts[i], cuts[i + 1], 0.0, h)
	for g in gaps:
		_wall_piece(axis, fixed, g[0], g[1], DOOR_H, h)


func _wall_piece(axis: String, fixed: float, a: float, b: float, y0: float, y1: float) -> void:
	if b - a < 0.01 or y1 - y0 < 0.01:
		return
	var n := int(ceil((b - a) / 6.0))
	for i in range(n):
		var s := a + (b - a) * float(i) / n
		var e := a + (b - a) * float(i + 1) / n
		var len := e - s
		var size := Vector3(len, y1 - y0, T) if axis == "x" else Vector3(T, y1 - y0, len)
		var pos := Vector3((s + e) * 0.5, (y0 + y1) * 0.5, fixed) if axis == "x" else Vector3(fixed, (y0 + y1) * 0.5, (s + e) * 0.5)
		var body := _solid(size, pos)
		_mesh_box(size, Vector3.ZERO, mat_wall, body)


func _walls() -> void:
	# The hub.
	_wall("x", -10.0, -10.0, 10.0, H_HUB, [[-1.5, 1.5]])
	_wall("x", 10.0, -10.0, 10.0, H_HUB, [[-1.5, 1.5]])
	_wall("z", 10.0, -10.0, 10.0, H_HUB, [[-1.5, 1.5], [-8.0, -5.0]])
	_wall("z", -10.0, -10.0, 10.0, H_HUB, [[-1.5, 1.5], [5.0, 8.0]])
	# Corridors.
	for x in [-1.5, 1.5]:
		_wall("z", x, -16.0, -10.0, H_COR)
		_wall("z", x, 10.0, 16.0, H_COR)
	for z in [-1.5, 1.5]:
		_wall("x", z, 10.0, 17.0, H_COR)
		_wall("x", z, -17.0, -10.0, H_COR)
	# Control room.
	_wall("x", -16.0, -8.0, 8.0, H_ROOM, [[-1.5, 1.5]])
	_wall("x", -28.0, -8.0, 8.0, H_ROOM)
	_wall("z", -8.0, -28.0, -16.0, H_ROOM)
	_wall("z", 8.0, -28.0, -16.0, H_ROOM)
	# Laboratory.
	_wall("z", 17.0, -8.0, 8.0, H_ROOM, [[-1.5, 1.5]])
	_wall("z", 33.0, -8.0, 8.0, H_ROOM)
	_wall("x", -8.0, 17.0, 33.0, H_ROOM)
	_wall("x", 8.0, 17.0, 33.0, H_ROOM)
	# Engine room.
	_wall("x", 16.0, -9.0, 9.0, H_ROOM, [[-1.5, 1.5]])
	_wall("x", 28.0, -9.0, 9.0, H_ROOM)
	_wall("z", -9.0, 16.0, 28.0, H_ROOM)
	_wall("z", 9.0, 16.0, 28.0, H_ROOM)
	# Dormitory.
	_wall("z", -17.0, -8.0, 8.0, H_ROOM, [[-1.5, 1.5]])
	_wall("z", -33.0, -8.0, 8.0, H_ROOM)
	_wall("x", -8.0, -33.0, -17.0, H_ROOM)
	_wall("x", 8.0, -33.0, -17.0, H_ROOM)
	# Airlock (its east wall is the hub's).
	_wall("x", 9.5, -16.0, -10.0, 3.2)
	_wall("x", 3.5, -16.0, -10.0, 3.2)
	_wall("z", -16.0, 3.5, 9.5, 3.2)
	# Pod bay (its west wall is the hub's).
	_wall("x", -9.5, 10.0, 16.0, 3.2)
	_wall("x", -3.5, 10.0, 16.0, 3.2)
	_wall("z", 16.0, -9.5, -3.5, 3.2)


func _doors() -> void:
	_door("lab_door", Vector3(17.0, 0.0, 0.0), DOOR_W, false)
	_door("control_door", Vector3(0.0, 0.0, -16.0), DOOR_W, true)
	_door("pod_door", Vector3(10.0, 0.0, -6.5), DOOR_W, false)


func _door(id: String, pos: Vector3, w: float, along_x: bool) -> void:
	var d := Door.new()
	d.build(id, w, DOOR_H, mat_door, along_x)
	d.position = pos
	d.sfx = game.sfx
	add_child(d)
	doors[id] = d


# ── the waypoint graph ───────────────────────────────────────────────────────

func _n(id: String, x: float, z: float, zone: String) -> void:
	nodes[id] = {"pos": Vector3(x, 0.0, z), "zone": zone}
	edges[id] = []


func _e(a: String, b: String, door := "") -> void:
	edges[a].append({"to": b, "door": door})
	edges[b].append({"to": a, "door": door})


func _graph() -> void:
	for p in [["h0", 0, 0], ["hn", 0, -7], ["hs", 0, 7], ["he", 7, 0], ["hw", -7, 0], ["hne", 7, -7], ["hnw", -7, -7], ["hse", 7, 7], ["hsw", -7, 7]]:
		_n(p[0], p[1], p[2], "hub")
	_n("hpod", 8.0, -6.5, "hub")
	_n("hair", -8.0, 6.5, "hub")
	_n("ai", -13.0, 6.5, "airlock")
	_n("pod_in", 13.0, -6.0, "pod")
	_n("cn", 0.0, -13.0, "corN")
	_n("ce", 13.5, 0.0, "corE")
	_n("cs", 0.0, 13.0, "corS")
	_n("cw", -13.5, 0.0, "corW")
	_n("ct_in", 0.0, -17.5, "control")
	_n("ct_a", -5.0, -21.0, "control")
	_n("ct_b", 5.0, -21.0, "control")
	_n("ct_c", 0.0, -25.0, "control")
	_n("lb_in", 19.0, 0.0, "lab")
	_n("lb_a", 24.0, -4.5, "lab")
	_n("lb_b", 24.0, 4.5, "lab")
	_n("lb_c", 29.5, 0.0, "lab")
	_n("en_in", 0.0, 18.0, "engine")
	_n("en_a", -4.5, 22.0, "engine")
	_n("en_b", 4.5, 22.0, "engine")
	_n("en_c", 0.0, 25.0, "engine")
	_n("dm_in", -19.0, 0.0, "dorm")
	_n("dm_a", -25.0, -4.0, "dorm")
	_n("dm_b", -25.0, 4.0, "dorm")
	_n("dm_c", -29.5, 0.0, "dorm")
	for pair in [["h0", "hn"], ["h0", "hs"], ["h0", "he"], ["h0", "hw"], ["hnw", "hn"], ["hnw", "hw"], ["hne", "hn"], ["hne", "he"], ["hse", "hs"], ["hse", "he"], ["hsw", "hs"], ["hsw", "hw"], ["hpod", "hne"], ["hpod", "he"], ["hair", "hsw"], ["hair", "hw"], ["hair", "ai"]]:
		_e(pair[0], pair[1])
	_e("hn", "cn")
	_e("he", "ce")
	_e("hs", "cs")
	_e("hw", "cw")
	_e("hpod", "pod_in", "pod_door")
	_e("cn", "ct_in", "control_door")
	_e("ct_in", "ct_a")
	_e("ct_in", "ct_b")
	_e("ct_a", "ct_c")
	_e("ct_b", "ct_c")
	_e("ct_a", "ct_b")
	_e("ce", "lb_in", "lab_door")
	_e("lb_in", "lb_a")
	_e("lb_in", "lb_b")
	_e("lb_a", "lb_c")
	_e("lb_b", "lb_c")
	_e("lb_a", "lb_b")
	_e("cs", "en_in")
	_e("en_in", "en_a")
	_e("en_in", "en_b")
	_e("en_a", "en_c")
	_e("en_b", "en_c")
	_e("en_a", "en_b")
	_e("cw", "dm_in")
	_e("dm_in", "dm_a")
	_e("dm_in", "dm_b")
	_e("dm_a", "dm_c")
	_e("dm_b", "dm_c")
	_e("dm_a", "dm_b")


## The zone a point is in; "" outside the station.
func zone_at(p: Vector3) -> String:
	for zone in AREAS:
		var a: Array = AREAS[zone]
		if p.x >= a[0] and p.x <= a[1] and p.z >= a[2] and p.z <= a[3]:
			return zone
	return ""


func nearest_node(p: Vector3, dark_only := false) -> String:
	var best := ""
	var best_d := INF
	for id in nodes:
		if dark_only and lit.get(nodes[id].zone, false):
			continue
		var d := p.distance_squared_to(nodes[id].pos)
		if d < best_d:
			best_d = d
			best = id
	return best


## Shortest route (node ids) from `a` to `b` over open doors, never through a lit zone.
func route(a: String, b: String, allow_lit := false) -> Array:
	if a == b:
		return [a]
	var prev := {a: ""}
	var dist := {a: 0.0}
	var open_set := [a]
	while not open_set.is_empty():
		var best_i := 0
		for i in range(open_set.size()):
			if dist[open_set[i]] < dist[open_set[best_i]]:
				best_i = i
		var cur: String = open_set.pop_at(best_i)
		if cur == b:
			break
		for e in edges[cur]:
			var to: String = e.to
			if e.door != "" and not doors[e.door].open:
				continue
			if not allow_lit and lit.get(nodes[to].zone, false) and to != b:
				continue
			var nd: float = dist[cur] + nodes[cur].pos.distance_to(nodes[to].pos)
			if not dist.has(to) or nd < dist[to]:
				dist[to] = nd
				prev[to] = cur
				if not open_set.has(to):
					open_set.append(to)
	if not prev.has(b):
		return []
	var path: Array = []
	var at := b
	while at != "":
		path.push_front(at)
		at = prev[at]
	return path


# ── light ────────────────────────────────────────────────────────────────────

func _lamp(zone: String, x: float, y: float, z: float, range_dark := 7.0, range_lit := 12.0) -> void:
	var l := OmniLight3D.new()
	l.position = Vector3(x, y - 0.2, z)
	l.omni_range = range_dark
	l.light_energy = 0.0
	l.shadow_enabled = false
	add_child(l)
	var fixture := _mesh_box(Vector3(0.7, 0.08, 0.25), Vector3(x, y, z), Assets.mat(Color(0.3, 0.3, 0.3), 0.5, 0.0, 0.0))
	lights[zone].append({"light": l, "fixture": fixture, "dark": range_dark, "lit": range_lit})


func _lamps() -> void:
	for p in [[-6, -6], [6, -6], [-6, 6], [6, 6], [0, 0]]:
		_lamp("hub", p[0], 4.4, p[1], 8.0, 13.0)
	_lamp("corN", 0, 2.9, -13)
	_lamp("corE", 13.5, 2.9, 0)
	_lamp("corS", 0, 2.9, 13)
	_lamp("corW", -13.5, 2.9, 0)
	for p in [[-4, -22], [4, -22], [0, -18]]:
		_lamp("control", p[0], 3.3, p[1])
	for p in [[21, 0], [28, 0], [24.5, -5]]:
		_lamp("lab", p[0], 3.3, p[1])
	for p in [[-4, 22], [4, 22], [0, 19]]:
		_lamp("engine", p[0], 3.3, p[1])
	for p in [[-29, 0], [-23, 0], [-26, 5]]:
		_lamp("dorm", p[0], 3.3, p[1])
	_lamp("airlock", -13, 3.1, 6.5)
	_lamp("pod", 13, 3.1, -6.5)


func is_lit(zone: String) -> bool:
	return lit.get(zone, false)


func set_lit(zone: String, on: bool, instant := false) -> void:
	lit[zone] = on
	for entry in lights.get(zone, []):
		var l: OmniLight3D = entry.light
		var fix: MeshInstance3D = entry.fixture
		var fm: StandardMaterial3D = (fix.material_override as StandardMaterial3D).duplicate()
		fix.material_override = fm
		fm.emission_enabled = true
		var target_energy := 1.5 if on else 0.8
		var color := Color(0.82, 0.93, 1.0) if on else Color(1.0, 0.1, 0.06)
		l.omni_range = entry.lit if on else entry.dark
		l.light_color = color
		fm.albedo_color = color
		fm.emission = color
		fm.emission_energy_multiplier = 2.0 if on else 0.5
		if instant:
			l.light_energy = target_energy
		else:
			var tw := create_tween()
			# A power-up stutter: the lamps catch and fail before they hold.
			if on:
				tw.tween_property(l, "light_energy", 0.0, 0.05)
				tw.tween_property(l, "light_energy", target_energy, 0.1)
				tw.tween_property(l, "light_energy", 0.2, 0.08)
				tw.tween_property(l, "light_energy", target_energy, 0.4)
			else:
				tw.tween_property(l, "light_energy", target_energy, 0.2)


# ── things in the world ──────────────────────────────────────────────────────

func _label(text: String, pos: Vector3, yaw_deg: float, size := 0.012, color := Color(0.85, 0.9, 0.95), emissive := true) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.position = pos
	l.rotation_degrees.y = yaw_deg
	l.pixel_size = size
	l.modulate = color
	l.outline_size = 0
	l.shaded = not emissive
	l.double_sided = false
	l.font_size = 48
	add_child(l)
	return l


## A model standing at `pos`, turned `yaw` degrees about Y. Solid unless `collide` is off.
func prop(model: String, size: float, pos: Vector3, yaw := 0.0, collide := true, by_length := false, align := "") -> Node3D:
	var m := Assets.make(model, size, by_length, false, align)
	m.position = pos
	m.rotation_degrees.y = yaw
	add_child(m)
	if collide:
		var s := Assets.size_of(m)
		var rot := Basis(Vector3.UP, deg_to_rad(yaw))
		var ext := (rot * s).abs()
		if ext.x > 0.3 or ext.z > 0.3:
			var b := _solid(Vector3(maxf(ext.x * 0.9, 0.3), maxf(s.y, 0.3), maxf(ext.z * 0.9, 0.3)), pos + Vector3(0, s.y * 0.5, 0))
			b.name = "col_" + model
	return m


func use(id: String, text: String, size: Vector3, pos: Vector3, act: Callable, keep := true) -> Use:
	var u := Use.new().setup(id, text, size, pos, act)
	u.keep = keep
	add_child(u)
	uses.append(u)
	return u


func note(id: String, pos: Vector3, yaw := 0.0) -> Use:
	var paper := _mesh_box(Vector3(0.28, 0.01, 0.2), pos, Assets.mat(Color(0.9, 0.88, 0.78), 0.95, 0.0, 0.25))
	paper.rotation_degrees.y = yaw
	var u := use("note_" + id, "Read note", Vector3(0.5, 0.35, 0.5), pos, game.read_note.bind(id))
	u.tag = id
	return u


func locker_hide(pos: Vector3, yaw: float) -> Use:
	prop("locker", 2.0, pos, yaw)
	# Lockers face where the camera will look when you are inside.
	var out := Vector3(-sin(deg_to_rad(yaw)), 0, -cos(deg_to_rad(yaw)))
	var u := use("hide_%d" % lockers.size(), "Hide", Vector3(0.9, 1.9, 0.9), pos + Vector3(0, 1.0, 0) + out * 0.1, game.hide_in)
	u.hide_pos = pos + Vector3(0, 1.45, 0)
	u.hide_yaw = yaw
	lockers.append(u)
	return u


func pickup(item: String, model: String, size: float, pos: Vector3, text: String, glow := Color(1.0, 0.85, 0.4)) -> Use:
	var holder := Node3D.new()
	holder.position = pos
	add_child(holder)
	var m := Assets.make(model, size)
	holder.add_child(m)
	var l := OmniLight3D.new()
	l.light_color = glow
	l.light_energy = 0.45
	l.omni_range = 2.2
	l.position = Vector3(0, size + 0.15, 0)
	holder.add_child(l)
	var u := use("pick_" + item, text, Vector3(0.6, maxf(size, 0.3) + 0.3, 0.6), pos + Vector3(0, size * 0.5, 0), game.pick_up.bind(item, holder), false)
	u.tag = item
	u.set_meta("holder", holder)
	return u


func _dressing() -> void:
	_airlock()
	_hub()
	_dorm()
	_engine()
	_lab()
	_control()
	_pod()


func _airlock() -> void:
	prop("submarine", 4.0, Vector3(-13.0, 0.0, 8.6), 0.0, true, true, "x")
	prop("crate", 0.8, Vector3(-15.3, 0.0, 4.4), 20.0)
	prop("oxygen_tank", 1.3, Vector3(-15.4, 0.0, 5.6))
	prop("oxygen_tank", 1.3, Vector3(-15.0, 0.0, 5.5))
	prop("desk", 0.8, Vector3(-12.2, 0.0, 4.4), 0.0, true, true, "x")
	note("intro", Vector3(-12.2, 0.82, 4.4), 10.0)
	_label("AIRLOCK", Vector3(-10.2, 2.6, 6.5), -90.0, 0.012)


func _hub() -> void:
	locker_hide(Vector3(-9.35, 0.0, -4.5), FPX)
	locker_hide(Vector3(9.35, 0.0, 4.5), FNX)
	locker_hide(Vector3(4.0, 0.0, 9.35), FNZ)
	locker_hide(Vector3(-4.0, 0.0, -9.35), FPZ)
	prop("crate", 0.8, Vector3(-9.0, 0.0, -9.0), 15.0)
	prop("crate", 0.7, Vector3(-8.1, 0.0, -9.3), -10.0)
	prop("barrel", 0.95, Vector3(9.0, 0.0, -9.0))
	prop("barrel", 0.95, Vector3(8.0, 0.0, -9.2))
	prop("cart", 1.1, Vector3(-9.0, 0.0, 9.0), 35.0, true, true)
	prop("pipes", 1.0, Vector3(9.4, 0.0, 9.0), 90.0, true, true, "z")
	prop("diving_suit", 1.9, Vector3(-9.3, 0.0, 3.2), 90.0)
	prop("gurney", 0.9, Vector3(5.5, 0.0, -9.2), 0.0, true, true, "x")
	note("hub_scrawl", Vector3(2.4, 1.4, -9.8), 0.0)
	pickup("battery_hub1", "battery", 0.18, Vector3(-8.2, 0.82, -9.3), "Take battery", Color(0.4, 1.0, 0.5))
	pickup("battery_hub2", "battery", 0.18, Vector3(5.5, 0.0, 9.3), "Take battery", Color(0.4, 1.0, 0.5))


func _dorm() -> void:
	for i in range(4):
		var x := -30.0 + 3.0 * i
		prop("bunk_bed", 1.9, Vector3(x, 0.0, -7.0), 0.0, true, false, "z")
		_label(str(i + 1), Vector3(x, 2.9, -7.82), 0.0, 0.03, Color(0.9, 0.85, 0.5))
	note("dorm_diary", Vector3(-27.0, 0.95, -5.85), 0.0)
	note("dorm_scribble", Vector3(-21.0, 1.25, -5.9), 0.0)
	prop("desk", 0.8, Vector3(-18.6, 0.0, 6.6), 0.0, true, true, "x")
	prop("chair", 0.95, Vector3(-18.6, 0.0, 5.5), 180.0, false)
	note("dorm_locker", Vector3(-18.6, 0.82, 6.6), 5.0)
	# Crew locker 7: the code lock.
	prop("locker", 2.0, Vector3(-32.4, 0.0, 0.0), FPX)
	var lk := use("crew_locker", "Crew locker 7", Vector3(0.9, 1.9, 0.9), Vector3(-32.0, 1.0, 0.0), game.crew_locker)
	lk.prompt_fn = func(): return "Open crew locker 7" if not game.s.locker_open else "Empty"
	_label("7", Vector3(-31.9, 1.75, 0.0), 90.0, 0.012, Color(0.9, 0.9, 0.6))
	locker_hide(Vector3(-32.4, 0.0, -5.5), FPX)
	locker_hide(Vector3(-20.0, 0.0, 7.35), FNZ)
	prop("toolbox", 0.28, Vector3(-30.5, 0.0, 6.9))
	prop("barrel", 0.95, Vector3(-32.2, 0.0, 6.9))
	pickup("battery_dorm", "battery", 0.18, Vector3(-30.5, 0.3, 6.9), "Take battery", Color(0.4, 1.0, 0.5))
	_label("DORMITORY", Vector3(-17.2, 2.6, 0.0), 90.0, 0.012)


func _engine() -> void:
	prop("generator", 1.5, Vector3(-8.0, 0.0, 22.0), FPX, true, true, "z")
	prop("pipes", 1.0, Vector3(0.0, 0.0, 27.5), 0.0, true, true, "x")
	for i in range(5):
		var x := 6.0 - 3.0 * i   # A is on the left as you face the manifold
		var letter: String = Puzzles.VALVES[i]
		var w := prop("valve_wheel", 0.8, Vector3(x, 0.9, 27.0), 0.0, false)
		w.name = "valve_" + letter
		_label(letter, Vector3(x, 2.25, 27.7), 180.0, 0.03, Color(0.95, 0.85, 0.4))
		valve_labels[letter] = _label("CLOSED", Vector3(x, 0.55, 27.7), 180.0, 0.01, Color(0.9, 0.3, 0.25))
		var u := use("valve_" + letter, "Turn valve " + letter, Vector3(0.8, 0.9, 0.7), Vector3(x, 1.2, 26.9), game.turn_valve.bind(letter))
		u.prompt_fn = func(): return ("Close valve " if game.s.valves[letter] else "Open valve ") + letter
	prop("terminal", 1.2, Vector3(8.5, 0.0, 22.0), FNX)
	var start := use("gen_start", "Start generator", Vector3(0.8, 1.2, 1.0), Vector3(8.2, 1.0, 22.0), game.gen_start)
	start.prompt_fn = func(): return "Start generator" if not game.s.gen_on else "Generator running"
	note("engine_manual1", Vector3(-8.6, 1.5, 17.4), 90.0)
	prop("desk", 0.8, Vector3(7.6, 0.0, 25.8), 0.0, true, true, "x")
	note("engine_manual2", Vector3(7.6, 0.82, 25.8), 190.0)
	note("engine_log", Vector3(-8.6, 1.3, 20.2), 90.0)
	locker_hide(Vector3(-8.4, 0.0, 26.3), FPX)
	locker_hide(Vector3(8.4, 0.0, 18.0), FNX)
	prop("barrel", 0.95, Vector3(6.4, 0.0, 17.6))
	prop("crate", 0.8, Vector3(-6.4, 0.0, 17.5), 30.0)
	pickup("battery_engine", "battery", 0.18, Vector3(-6.4, 0.8, 17.5), "Take battery", Color(0.4, 1.0, 0.5))
	_label("ENGINE ROOM", Vector3(0.0, 2.8, 16.2), 180.0, 0.012)


func _lab() -> void:
	prop("lab_bench", 0.95, Vector3(21.0, 0.0, -7.0), 0.0, true, true, "x")
	prop("lab_bench", 0.95, Vector3(28.0, 0.0, -7.0), 0.0, true, true, "x")
	prop("lab_bench", 0.95, Vector3(21.0, 0.0, 7.0), 0.0, true, true, "x")
	prop("lab_bench", 0.95, Vector3(28.0, 0.0, 7.0), 0.0, true, true, "x")
	prop("specimen_tank", 2.3, Vector3(31.8, 0.0, -6.3))
	prop("specimen_tank", 2.3, Vector3(31.8, 0.0, 6.3))
	# The whiteboard on the north wall.
	_mesh_box(Vector3(2.6, 1.2, 0.05), Vector3(24.5, 1.8, -7.8), Assets.mat(Color(0.88, 0.9, 0.9), 0.6, 0.0, 0.2))
	_label("RADIO TEST WORD\n" + "  ".join(Puzzles.scrambled_word().split("")), Vector3(24.5, 1.95, -7.76), 0.0, 0.008, Color(0.1, 0.1, 0.15), false)
	var board := use("lab_board", "Read whiteboard", Vector3(2.6, 1.4, 0.6), Vector3(24.5, 1.8, -7.4), game.read_note.bind("lab_board"))
	board.tag = "lab_board"
	# The breaker panel on the east wall.
	prop("breaker_box", 1.0, Vector3(32.6, 0.0, 0.0), 90.0, false)
	_mesh_box(Vector3(0.2, 1.4, 1.4), Vector3(32.9, 1.0, 0.0), Assets.mat(Color(0.2, 0.22, 0.25), 0.5, 0.5))
	var bp := use("breaker", "Breaker panel", Vector3(0.9, 1.4, 1.5), Vector3(32.3, 1.0, 0.0), game.breaker_panel)
	bp.prompt_fn = func(): return "Breaker panel" if not game.s.breaker_open else ("Breaker panel (solved)" if game.s.breaker_solved else "Use the breaker panel")
	locker_hide(Vector3(18.0, 0.0, -7.35), FPZ)
	locker_hide(Vector3(32.4, 0.0, 3.2), FNX)
	prop("cart", 1.1, Vector3(19.5, 0.0, 3.5), 70.0, true, true)
	pickup("battery_lab", "battery", 0.18, Vector3(28.0, 0.95, 7.0), "Take battery", Color(0.4, 1.0, 0.5))
	_label("LABORATORY", Vector3(16.8, 2.6, 0.0), -90.0, 0.012)


func _control() -> void:
	prop("terminal", 1.2, Vector3(0.0, 0.0, -27.2), FPZ)
	var radio := use("radio", "Radio", Vector3(1.4, 1.2, 0.8), Vector3(0.0, 0.8, -26.8), game.radio_use)
	radio.prompt_fn = func(): return "Use the radio" if not game.s.radio_solved else "Radio (decoded)"
	prop("radio", 0.25, Vector3(1.3, 0.8, -27.2), 0.0, false)
	prop("desk", 0.8, Vector3(-5.5, 0.0, -26.8), 0.0, true, true, "x")
	prop("chair", 0.95, Vector3(-5.5, 0.0, -25.5), 170.0, false)
	prop("desk", 0.8, Vector3(5.5, 0.0, -26.8), 0.0, true, true, "x")
	note("control_note", Vector3(-5.5, 0.82, -26.8), 8.0)
	locker_hide(Vector3(-7.35, 0.0, -19.5), FPX)
	locker_hide(Vector3(7.35, 0.0, -23.0), FNX)
	prop("crate", 0.8, Vector3(7.0, 0.0, -17.2), 8.0)
	prop("terminal", 1.1, Vector3(-7.4, 0.0, -24.5), FPX)
	pickup("battery_control", "battery", 0.18, Vector3(5.5, 0.82, -26.8), "Take battery", Color(0.4, 1.0, 0.5))
	_label("CONTROL ROOM", Vector3(0.0, 2.8, -16.2), 0.0, 0.012)


func _pod() -> void:
	prop("escape_pod", 2.4, Vector3(13.7, 0.0, -8.3), 0.0, true, true)
	prop("oxygen_tank", 1.3, Vector3(15.4, 0.0, -4.2))
	prop("terminal", 1.1, Vector3(12.8, 0.0, -3.9), FNZ)
	var c := use("pod_console", "Pod console", Vector3(1.0, 1.3, 0.8), Vector3(12.8, 0.9, -4.1), game.pod_console)
	c.prompt_fn = func(): return game.pod_prompt()
	_label("POD BAY", Vector3(10.2, 2.6, -6.5), 90.0, 0.012)


func _door_panels() -> void:
	use("door_control", "Door panel", Vector3(0.5, 0.6, 0.4), Vector3(1.2, 1.3, -15.75), game.door_panel.bind("control_door"))
	use("door_lab", "Door panel", Vector3(0.4, 0.6, 0.5), Vector3(16.75, 1.3, 1.2), game.door_panel.bind("lab_door"))
	use("door_pod", "Door panel", Vector3(0.4, 0.6, 0.5), Vector3(9.75, 1.3, -4.6), game.door_panel.bind("pod_door"))
	for p in [[Vector3(1.2, 1.3, -15.85), 0.0], [Vector3(16.85, 1.3, 1.2), 90.0], [Vector3(9.85, 1.3, -4.6), 90.0]]:
		var m := _mesh_box(Vector3(0.3, 0.4, 0.06), p[0], Assets.mat(Color(0.2, 0.9, 0.5), 0.3, 0.0, 1.2))
		m.rotation_degrees.y = p[1]


func _signs() -> void:
	# Names over the doorways, on the hub side, so nobody is lost.
	_label("CONTROL ROOM", Vector3(0.0, 3.4, -9.8), 0.0, 0.02, Color(0.95, 0.8, 0.35))
	_label("LABORATORY", Vector3(9.8, 3.4, 0.0), -90.0, 0.02, Color(0.95, 0.8, 0.35))
	_label("ENGINE ROOM", Vector3(0.0, 3.4, 9.8), 180.0, 0.02, Color(0.95, 0.8, 0.35))
	_label("DORMITORY", Vector3(-9.8, 3.4, 0.0), 90.0, 0.02, Color(0.95, 0.8, 0.35))
	_label("POD BAY", Vector3(9.8, 3.0, -6.5), -90.0, 0.02, Color(0.95, 0.8, 0.35))
	_label("AIRLOCK", Vector3(-9.8, 3.0, 6.5), 90.0, 0.02, Color(0.95, 0.8, 0.35))
