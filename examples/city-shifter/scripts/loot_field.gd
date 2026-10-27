class_name LootField
extends Node3D
## The weapons lying around the open world: 12 of every gauntlet and a handful of every melee weapon (200+ in all), the same on every phone (a fixed seed), dropped
## ones added when somebody dies. Each is a real weapon model floating and spinning over a glowing disc with a thin light column, drawn only within the view radius.
## Pickups are identified by a number (`uid`): the static ones 0..N-1, dropped ones from a counter the host hands out.

signal taken(uid: int, id: String, by: int)

const GUN_COPIES := 12
const MELEE_COPIES := {"hammer_big": 9, "katana": 10, "axe": 9, "spear": 8}
const SEED := 20260429

var items := {}                          # uid -> {id, pos, node, alive}
var next_uid := 0
var static_count := 0
var _meshes := {}                        # weapon id -> [Mesh, material]
var _disc: Mesh
var _beam: Mesh
var _view := Data.VIEW_RADIUS + 8.0


## Place everything. `half` = half the map size, `pois` = [[Vector2 centre, radius, weight], ...] (towns, camps), `blocked` = Rects (x, z) where nothing may lie.
func build(half: float, pois: Array, blocked: Array, river_a: Vector2, river_b: Vector2) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED
	var wanted: Array = []
	for id in Data.WEAPON_ORDER:
		for i in GUN_COPIES:
			wanted.append(id)
	for id in MELEE_COPIES:
		for i in int(MELEE_COPIES[id]):
			wanted.append(id)
	# shuffle so the points of interest get a mix, not 12 of one kind
	for i in range(wanted.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var tmp = wanted[i]
		wanted[i] = wanted[j]
		wanted[j] = tmp
	var total_w := 0.0
	for p in pois:
		total_w += float(p[2])
	var placed: Array[Vector2] = []
	for id in wanted:
		var pos := Vector2.ZERO
		for attempt in 40:
			if rng.randf() < 0.6 and not pois.is_empty():
				var pick := rng.randf() * total_w
				var poi: Array = pois[0]
				for p in pois:
					pick -= float(p[2])
					if pick <= 0.0:
						poi = p
						break
				var a := rng.randf() * TAU
				var rr := sqrt(rng.randf()) * float(poi[1])
				pos = (poi[0] as Vector2) + Vector2(cos(a), sin(a)) * rr
			else:
				pos = Vector2(rng.randf_range(-half + 25.0, half - 25.0), rng.randf_range(-half + 25.0, half - 25.0))
			if pos.length() > half - 20.0:
				continue
			if _bad(pos, blocked, river_a, river_b, placed):
				continue
			break
		placed.append(pos)
		_add(id, Vector3(pos.x, 0.0, pos.y))
	static_count = items.size()
	next_uid = 100000                    # dropped weapons count from here (the host's counter takes over online)


func _bad(p: Vector2, blocked: Array, ra: Vector2, rb: Vector2, placed: Array[Vector2]) -> bool:
	for r in blocked:
		if (r as Rect2).grow(1.2).has_point(p):
			return true
	# the river: a band of 9 m around the segment, except where the bridge is
	var ab := rb - ra
	var t := clampf((p - ra).dot(ab) / maxf(ab.length_squared(), 0.001), 0.0, 1.0)
	if (p - (ra + ab * t)).length() < 9.0:
		return true
	for q in placed:
		if q.distance_to(p) < 3.0:
			return true
	return false


func _mesh_for(id: String) -> Array:
	if _meshes.has(id):
		return _meshes[id]
	var path := "res://assets/weapons/%s.glb" % id
	var info: Dictionary = Data.info_of(id)
	var mesh: Mesh = null
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/pickup.gdshader") as Shader
	mat.set_shader_parameter("glow", info.color)
	var node := WeaponModels.build(id, 1.0)
	if node != null:
		var mi := node.find_children("*", "MeshInstance3D", true, false)
		if not mi.is_empty():
			var m0 := mi[0] as MeshInstance3D
			mesh = m0.mesh
			var sm := m0.mesh.surface_get_material(0)
			if sm is BaseMaterial3D and (sm as BaseMaterial3D).albedo_texture != null:
				mat.set_shader_parameter("albedo_tex", (sm as BaseMaterial3D).albedo_texture)
				mat.set_shader_parameter("has_tex", true)
			# the fitted holder scales the model: carry that scale into the instance (the shader floats it)
			_meshes[id] = [mesh, mat, (m0.global_transform.basis.get_scale() if m0.is_inside_tree() else _scale_of(m0, node))]
		node.free()
	if not _meshes.has(id):
		var bm := BoxMesh.new()
		bm.size = Vector3(0.6, 0.3, 1.0)
		_meshes[id] = [bm, mat, Vector3.ONE]
	return _meshes[id]


func _scale_of(m: Node3D, root: Node3D) -> Vector3:
	var s := Vector3.ONE
	var cur: Node = m
	while cur != null and cur != root.get_parent():
		if cur is Node3D:
			s *= (cur as Node3D).scale
		cur = cur.get_parent()
	return s


func _add(id: String, pos: Vector3, uid := -1) -> int:
	if uid < 0:
		uid = items.size() if next_uid == 0 or items.size() < 100000 and static_count == 0 else next_uid
	var info: Dictionary = Data.info_of(id)
	var holder := Node3D.new()
	holder.position = pos
	var m := _mesh_for(id)
	var mi := MeshInstance3D.new()
	mi.mesh = m[0]
	mi.material_override = m[1]
	mi.scale = m[2] * 1.9
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = _view
	mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	holder.add_child(mi)
	if _disc == null:
		var cm := CylinderMesh.new()
		cm.top_radius = 1.2
		cm.bottom_radius = 1.2
		cm.height = 0.04
		cm.radial_segments = 14
		cm.rings = 1
		_disc = cm
		var bm := CylinderMesh.new()
		bm.top_radius = 0.1
		bm.bottom_radius = 0.1
		bm.height = 7.0
		bm.radial_segments = 5
		bm.rings = 1
		_beam = bm
	var c: Color = info.color
	var d := MeshInstance3D.new()
	d.mesh = _disc
	d.material_override = Mat.unlit(c, 0.5)
	d.position.y = 0.05
	d.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	d.visibility_range_end = _view
	holder.add_child(d)
	var b := MeshInstance3D.new()
	b.mesh = _beam
	b.material_override = Mat.unlit(c, 0.28)
	b.position.y = 3.5
	b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	b.visibility_range_end = _view
	holder.add_child(b)
	add_child(holder)
	items[uid] = {"id": id, "pos": pos, "node": holder, "alive": true}
	return uid


## A weapon dropped by a player who died (or swapped out): `uid` comes from the host when online.
func drop(id: String, pos: Vector3, uid := -1) -> int:
	if uid < 0:
		uid = next_uid
		next_uid += 1
	else:
		next_uid = maxi(next_uid, uid + 1)
	return _add(id, Vector3(pos.x, 0.0, pos.z), uid)


## The uid of the nearest free pickup within `r` metres of `pos` (flat), or -1.
func nearest(pos: Vector3, r: float) -> int:
	var best := -1
	var bd := r
	for uid in items:
		var it: Dictionary = items[uid]
		if not bool(it.alive):
			continue
		var p: Vector3 = it.pos
		var d := Vector2(p.x - pos.x, p.z - pos.z).length()
		if d < bd and absf(pos.y - p.y) < 3.5:
			bd = d
			best = uid
	return best


func take(uid: int, by := 0) -> String:
	if not items.has(uid) or not bool(items[uid].alive):
		return ""
	var it: Dictionary = items[uid]
	it.alive = false
	(it.node as Node3D).queue_free()
	taken.emit(uid, String(it.id), by)
	return String(it.id)


func alive_count() -> int:
	var n := 0
	for uid in items:
		if bool(items[uid].alive):
			n += 1
	return n


func count_of(id: String) -> int:
	var n := 0
	for uid in items:
		if bool(items[uid].alive) and String(items[uid].id) == id:
			n += 1
	return n
