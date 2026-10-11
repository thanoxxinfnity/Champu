class_name Dressing
extends RefCounted
## What is in each room: set dressing, the things the player can pick up or use, the traps and the creatures.
## Built when the streamer loads the room, from the saved state, so a room the player left looks the way it was left.

## Water: rooms that are flooded, and the dry planks in them as [x0, x1, z0, z1]. Outside a plank it is wet.
const DRY := {
	"c2_lobby": [[100, 105, 3, 9], [105, 109, 5, 7], [109, 114, 4, 8]],
	"c2_pipe": [[115, 129, 5, 7]],
}
## The three conveyor belts of the assembly floor: [x0, x1, z0, z1, push in x (m/s)].
const BELTS := [[204, 224, 3.2, 4.8, 1.4], [204, 224, 7.2, 8.8, -1.4], [204, 224, 11.2, 12.8, 1.4]]


static func in_water(room: String, p: Vector3) -> bool:
	if not DRY.has(room):
		return false
	var r: Array = Rooms.LIST[room].r
	if p.x < r[0] or p.x > r[1] or p.z < r[2] or p.z > r[3]:
		return false
	for d in DRY[room]:
		if p.x >= d[0] and p.x <= d[1] and p.z >= d[2] and p.z <= d[3]:
			return false
	return true


static func build(w: World, id: String, n: Node3D) -> void:
	var spec: Dictionary = Rooms.LIST[id]
	var r: Array = spec.r
	_lamps(w, n, id, r, float(spec.h))
	_ceiling(w, n, r, float(spec.h))
	match id:
		"c1_cryo": _c1_cryo(w, n)
		"c1_hall": _c1_hall(w, n)
		"c1_server": _c1_server(w, n)
		"c1_store": _c1_store(w, n)
		"c1_lift", "c2_lift", "c3_lift": _lift(w, n, id)
		"c2_lobby": _c2_lobby(w, n)
		"c2_pipe": _c2_pipe(w, n)
		"c2_ctrl": _c2_ctrl(w, n)
		"c2_pump": _c2_pump(w, n)
		"c3_floor": _c3_floor(w, n)
		"c3_lockers": _c3_lockers(w, n)
		"c3_office": _c3_office(w, n)
		"c3_work": _c3_work(w, n)
		"c4_lobby": _c4_lobby(w, n)
		"c4_corr": _c4_corr(w, n)
		"c4_reactor": _c4_reactor(w, n)
		"c4_waste": _c4_waste(w, n)
		"c4_return": _c4_return(w, n)
		"c4_exit": _lift(w, n, id)
	if DRY.has(id):
		_water(w, n, id)


# ── common pieces ────────────────────────────────────────────────────────────

static func _lamps(w: World, n: Node3D, id: String, r: Array, h: float) -> void:
	var white: bool = Rooms.LIST[id].pal in ["clean", "lift"]
	var cx: float = (r[0] + r[1]) * 0.5
	var cz: float = (r[2] + r[3]) * 0.5
	var wd: float = r[1] - r[0]
	var dp: float = r[3] - r[2]
	var count := clampi(int(maxf(wd, dp) / 7.0), 1, 4)
	for i in range(count):
		var t := (float(i) + 0.5) / count
		var p := Vector3(cx, h - 0.05, cz)
		if wd >= dp:
			p.x = r[0] + wd * t
		else:
			p.z = r[2] + dp * t
		w.lamp(n, p, white, 8.0)


static func _ceiling(w: World, n: Node3D, r: Array, h: float) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r[0] * 31 + r[2] * 17)
	var steel := Assets.mat(Color(0.25, 0.27, 0.3), 0.55, 0.7)
	var rust := Assets.mat(Color(0.34, 0.2, 0.12), 0.7, 0.6)
	var wd: float = r[1] - r[0]
	var dp: float = r[3] - r[2]
	for i in range(2):
		var off := 0.25 + 0.5 * i
		var m := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.1
		cm.bottom_radius = 0.1
		cm.height = (wd if wd >= dp else dp) - 0.4
		cm.radial_segments = 8
		cm.rings = 1
		m.mesh = cm
		m.material_override = rust if i == 0 else steel
		if wd >= dp:
			m.rotation_degrees = Vector3(0, 0, 90)
			m.position = Vector3((r[0] + r[1]) * 0.5, h - 0.3, r[2] + dp * off)
		else:
			m.rotation_degrees = Vector3(90, 0, 0)
			m.position = Vector3(r[0] + wd * off, h - 0.3, (r[2] + r[3]) * 0.5)
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.add_child(m)
	# Cables hanging.
	var cable := Assets.mat(Color(0.03, 0.03, 0.03), 0.8)
	for k in range(int(maxf(wd, dp) / 4.0)):
		var m2 := w.mesh_box(Vector3(0.02, rng.randf_range(0.6, 1.6), 0.02), Vector3(rng.randf_range(r[0] + 0.8, r[1] - 0.8), h - 0.5, rng.randf_range(r[2] + 0.8, r[3] - 0.8)), cable, n)
		m2.name = "cable"


static func _sparks(n: Node3D, pos: Vector3) -> void:
	var p := GPUParticles3D.new()
	p.amount = 24
	p.lifetime = 0.8
	p.explosiveness = 0.15
	p.visibility_aabb = AABB(Vector3(-3, -3, -3), Vector3(6, 6, 6))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, -1, 0)
	pm.spread = 55.0
	pm.initial_velocity_min = 1.2
	pm.initial_velocity_max = 3.0
	pm.gravity = Vector3(0, -7.0, 0)
	pm.scale_min = 0.5
	pm.scale_max = 1.0
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.03, 0.03)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(1.0, 0.85, 0.4)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.7, 0.2)
	m.emission_energy_multiplier = 4.0
	q.material = m
	p.draw_pass_1 = q
	p.position = pos
	n.add_child(p)
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.8, 0.4)
	l.omni_range = 4.0
	l.light_energy = 0.0
	l.position = pos
	n.add_child(l)
	var tw := l.create_tween().set_loops()
	tw.tween_interval(randf_range(0.6, 2.2))
	tw.tween_property(l, "light_energy", 2.2, 0.03)
	tw.tween_property(l, "light_energy", 0.0, 0.18)


static func _skeleton(w: World, n: Node3D, pos: Vector3, yaw: float) -> void:
	var s := w.prop(n, "skeleton", 1.7, pos + Vector3(0, 0.12, 0), yaw, false)
	s.rotation_degrees.x = 90.0     # lying where it fell


static func _pickup(w: World, n: Node3D, id: String, model: String, size: float, pos: Vector3, glow := Color(1.0, 0.85, 0.4)) -> void:
	if w.game.s.taken.has(id):
		return
	var holder := Node3D.new()
	holder.position = pos
	n.add_child(holder)
	holder.add_child(Assets.make(model, size))
	var l := OmniLight3D.new()
	l.light_color = glow
	l.light_energy = 0.5
	l.omni_range = 2.2
	l.position = Vector3(0, size + 0.15, 0)
	holder.add_child(l)
	var u := w.use(n, id, Vector3(0.6, maxf(size, 0.3) + 0.3, 0.6), pos + Vector3(0, size * 0.5, 0), w.game.pick_up.bind(id, holder))
	u.far = true
	u.set_meta("holder", holder)


static func _paper(w: World, n: Node3D, paper: String, pos: Vector3, yaw := 0.0) -> void:
	var sheet := w.mesh_box(Vector3(0.28, 0.01, 0.2), pos, Assets.mat(Color(0.88, 0.84, 0.7), 0.95, 0.0, 0.2), n)
	sheet.rotation_degrees.y = yaw
	w.use(n, "paper_" + paper, Vector3(0.55, 0.4, 0.55), pos, w.game.read_paper.bind(paper))


static func _locker(w: World, n: Node3D, pos: Vector3, yaw: float) -> void:
	w.prop(n, "locker", 2.0, pos, yaw, true, false, "", 0.95)
	var out := Vector3(-sin(deg_to_rad(yaw)), 0, -cos(deg_to_rad(yaw)))
	var u := w.use(n, "hide", Vector3(0.9, 1.9, 0.9), pos + Vector3(0, 1.0, 0) + out * 0.1, w.game.hide_in)
	u.hide_pos = pos + Vector3(0, 1.45, 0)
	u.hide_yaw = yaw


static func _enemy(w: World, n: Node3D, kind: String, pos: Vector3, patrol: Array) -> void:
	var e := Enemy.new()
	e.name = "%s_%d" % [kind, n.get_child_count()]
	e.kind = kind
	e.game = w.game
	e.patrol = patrol
	e.position = pos
	n.add_child(e)
	w.game.enemies.append(e)


## Pipes that come down from the ceiling the moment the player steps into the trigger.
static func _debris(w: World, n: Node3D, id: String, centre: Vector3, size: Vector3) -> void:
	if w.game.s.sprung.has(id):
		return
	var a := Area3D.new()
	a.collision_layer = 0
	a.collision_mask = Data.L_PLAYER
	a.position = centre
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	a.add_child(cs)
	n.add_child(a)
	a.body_entered.connect(func(body: Node3D):
		if body is Player and not w.game.s.sprung.has(id):
			w.game.s.sprung[id] = true
			w.game.drop_debris(n, centre))


static func _water(w: World, n: Node3D, id: String) -> void:
	var r: Array = Rooms.LIST[id].r
	var q := QuadMesh.new()
	q.size = Vector2(r[1] - r[0], r[3] - r[2])
	var mi := MeshInstance3D.new()
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.03, 0.09, 0.1, 0.82)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.03
	m.metallic = 0.3
	m.metallic_specular = 1.0
	m.emission_enabled = true
	m.emission = Color(0.0, 0.25, 0.3)
	m.emission_energy_multiplier = 0.4
	mi.material_override = m
	mi.rotation_degrees.x = -90
	mi.position = Vector3((r[0] + r[1]) * 0.5, 0.045, (r[2] + r[3]) * 0.5)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.name = "Water"
	n.add_child(mi)
	# Planks over the water, on the dry rectangles.
	for d in DRY[id]:
		# Boards laid on the floor, a hand's breadth high: low enough to step onto without a ramp.
		var plank := w.mesh_box(Vector3(d[1] - d[0], 0.07, d[3] - d[2]), Vector3((d[0] + d[1]) * 0.5, 0.035, (d[2] + d[3]) * 0.5), Assets.mat(Color(0.28, 0.2, 0.12), 0.9), n)
		plank.name = "Plank"


# ── chapter 1 ────────────────────────────────────────────────────────────────

static func _c1_cryo(w: World, n: Node3D) -> void:
	for x in [2.0, 5.0, 8.0]:
		w.prop(n, "cryo_pod", 2.4, Vector3(x, 0.0, 1.3), 180.0, true, false, "", 1.6)
	w.prop(n, "desk", 0.8, Vector3(8.4, 0.0, 6.6), 0.0, true, false, "x")
	_pickup(w, n, "emp", "emp_stunner", 0.32, Vector3(8.2, 0.85, 6.6), Color(0.4, 0.7, 1.0))
	_paper(w, n, "p_wake", Vector3(8.9, 0.86, 6.5), 12.0)
	_pickup(w, n, "cell_cryo", "battery", 0.18, Vector3(1.6, 0.0, 6.8), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_a", "toolbox", 0.18, Vector3(3.5, 0.0, 6.9), Color(0.8, 0.85, 1.0))
	w.prop(n, "terminal", 0.5, Vector3(1.5, 0.0, 4.0), 90.0, false)
	w.prop(n, "chair", 0.95, Vector3(2.4, 0.0, 6.4), 200.0, false)


static func _c1_hall(w: World, n: Node3D) -> void:
	_locker(w, n, Vector3(13.0, 0.0, 2.4), 180.0)
	_locker(w, n, Vector3(25.0, 0.0, 5.6), 0.0)
	w.prop(n, "breaker_box", 1.2, Vector3(22.0, 0.0, 2.35), 180.0, true, false, "", 0.9)
	var fb := w.use(n, "fusebox", Vector3(0.9, 1.3, 0.5), Vector3(22.0, 0.9, 2.5), w.game.fusebox)
	fb.prompt = "fusebox"
	_debris(w, n, "c1_hall", Vector3(18.0, 1.5, 4.0), Vector3(3.0, 3.0, 4.0))
	_sparks(n, Vector3(16.0, 2.7, 2.4))
	_skeleton(w, n, Vector3(15.0, 0.0, 4.6), 20.0)
	w.prop(n, "crate", 0.8, Vector3(12.0, 0.0, 5.4), 15.0)
	_paper(w, n, "p_fusebox", Vector3(22.0, 1.65, 2.45), 0.0)
	if w.game.s.chapter == 1:
		_enemy(w, n, "crawler", Vector3(16.0, 0.0, 4.0), [Vector3(14, 0, 3), Vector3(24, 0, 4.5), Vector3(19, 0, 3.5)])


static func _c1_server(w: World, n: Node3D) -> void:
	for i in range(4):
		w.prop(n, "server_rack", 2.1, Vector3(12.4, 0.0, 8.5 + 1.8 * i), -90.0, true, false, "", 1.0)
	for i in range(3):
		w.prop(n, "server_rack", 2.1, Vector3(20.0, 0.0, 9.0 + 1.8 * i), 90.0, true, false, "", 1.0)
	w.prop(n, "desk", 0.8, Vector3(16.0, 0.0, 13.6), 0.0, true, false, "x")
	_pickup(w, n, "fuse_1", "fuse", 0.12, Vector3(16.0, 0.86, 13.6), Color(1.0, 0.8, 0.3))
	_paper(w, n, "p_ch1_log", Vector3(17.0, 0.86, 13.5), -20.0)
	_sparks(n, Vector3(15.5, 2.8, 8.0))
	_locker(w, n, Vector3(14.0, 0.0, 14.6), 0.0)
	if w.game.s.chapter == 1:
		_enemy(w, n, "crawler", Vector3(16.0, 0.0, 10.5), [Vector3(15, 0, 9), Vector3(17, 0, 12), Vector3(16, 0, 14)])


static func _c1_store(w: World, n: Node3D) -> void:
	for p in [[12.5, -6.0], [14.0, -6.2], [19.5, -6.0], [20.3, -3.0], [12.5, -1.0]]:
		w.prop(n, "crate", 0.85, Vector3(p[0], 0.0, p[1]), randf() * 40.0)
	w.prop(n, "barrel", 0.95, Vector3(18.0, 0.0, -6.0), 0.0)
	w.prop(n, "barrel", 0.95, Vector3(17.2, 0.0, -6.2), 0.0)
	_pickup(w, n, "fuse_2", "fuse", 0.12, Vector3(14.0, 0.86, -6.2), Color(1.0, 0.8, 0.3))
	_pickup(w, n, "fuse_3", "fuse", 0.12, Vector3(20.3, 0.86, -3.0), Color(1.0, 0.8, 0.3))
	_pickup(w, n, "cable", "wiring", 0.22, Vector3(16.0, 0.0, -3.5), Color(1.0, 0.5, 0.3))
	_pickup(w, n, "cell_store", "battery", 0.18, Vector3(12.0, 0.0, -2.5), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_b", "toolbox", 0.18, Vector3(13.4, 0.0, -2.2), Color(0.8, 0.85, 1.0))
	_skeleton(w, n, Vector3(15.0, 0.0, -1.0), 70.0)
	if w.game.s.chapter == 1:
		_enemy(w, n, "crawler", Vector3(16.0, 0.0, -4.0), [Vector3(13, 0, -2), Vector3(19, 0, -2), Vector3(16, 0, -5)])


static func _lift(w: World, n: Node3D, id: String) -> void:
	var r: Array = Rooms.LIST[id].r
	var cx: float = (r[0] + r[1]) * 0.5
	var cz: float = (r[2] + r[3]) * 0.5
	var key: int = {"c1_lift": 1, "c2_lift": 2, "c3_lift": 3, "c4_exit": 4}[id]
	# The call panel on the far wall.
	var east: bool = id != "c4_exit"
	var panel_pos := Vector3(r[1] - 0.3, 1.2, cz) if east else Vector3(r[0] + 0.3, 1.2, cz)
	w.mesh_box(Vector3(0.12, 0.5, 0.35), panel_pos, Assets.mat(Color(0.2, 0.9, 0.5), 0.3, 0.0, 1.6), n)
	var u := w.use(n, "lift_%d" % key, Vector3(0.7, 0.8, 1.0), panel_pos + Vector3(-0.3 if east else 0.3, 0, 0), w.game.lift_button.bind(key))
	u.prompt = "lift"


# ── chapter 2 ────────────────────────────────────────────────────────────────

static func _c2_lobby(w: World, n: Node3D) -> void:
	_paper(w, n, "p_flood", Vector3(101.5, 0.1, 5.4), 30.0)
	w.prop(n, "barrel", 0.95, Vector3(108.5, 0.0, 2.0), 0.0)
	w.prop(n, "crate", 0.85, Vector3(111.5, 0.0, 10.0), 40.0)
	w.prop(n, "forklift", 1.8, Vector3(103.0, 0.0, 1.2), 30.0, false, true)
	_sparks(n, Vector3(107.0, 3.6, 6.0))
	_sparks(n, Vector3(110.5, 3.6, 2.5))
	_skeleton(w, n, Vector3(107.0, 0.08, 5.8), 100.0)
	_pickup(w, n, "cell_lobby", "battery", 0.18, Vector3(106.5, 0.08, 6.2), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_c", "toolbox", 0.18, Vector3(108.6, 0.08, 6.4), Color(0.8, 0.85, 1.0))
	if w.game.s.chapter == 2:
		_enemy(w, n, "hunter", Vector3(104.0, 0.0, 11.0), [Vector3(103, 0, 10), Vector3(110, 0, 10), Vector3(108, 0, 2), Vector3(102, 0, 2)])
		_enemy(w, n, "hunter", Vector3(111.0, 0.0, 2.0), [Vector3(111, 0, 10), Vector3(106, 0, 8), Vector3(111, 0, 1)])


static func _c2_pipe(w: World, n: Node3D) -> void:
	w.prop(n, "pipes", 1.0, Vector3(118.0, 0.0, 4.6), 0.0, true, true, "x")
	_sparks(n, Vector3(122.0, 2.7, 6.0))
	_skeleton(w, n, Vector3(124.0, 0.3, 6.0), 10.0)
	_debris(w, n, "c2_pipe", Vector3(123.0, 1.5, 6.0), Vector3(3.0, 3.0, 3.0))
	if w.game.s.chapter == 2:
		_enemy(w, n, "hunter", Vector3(126.0, 0.0, 6.0), [Vector3(117, 0, 6), Vector3(127, 0, 6)])


static func _c2_ctrl(w: World, n: Node3D) -> void:
	w.prop(n, "desk", 0.8, Vector3(120.0, 0.0, 15.8), 0.0, true, false, "x")
	_pickup(w, n, "timer", "timer", 0.22, Vector3(120.0, 0.86, 15.8), Color(0.4, 0.85, 1.0))
	w.prop(n, "terminal", 0.5, Vector3(118.4, 0.86, 15.8), 180.0, false)
	_paper(w, n, "p_ch2_log", Vector3(121.4, 0.86, 15.6), -15.0)
	_pickup(w, n, "cell_ctrl", "battery", 0.18, Vector3(116.0, 0.0, 10.5), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_d", "toolbox", 0.18, Vector3(117.6, 0.0, 10.9), Color(0.8, 0.85, 1.0))
	_locker(w, n, Vector3(124.4, 0.0, 12.0), 90.0)


static func _c2_pump(w: World, n: Node3D) -> void:
	w.prop(n, "generator", 1.5, Vector3(136.0, 0.0, 9.0), 0.0, true, true, "x")
	var cols := {"red": Color(0.95, 0.15, 0.1), "blue": Color(0.2, 0.45, 1.0), "green": Color(0.2, 0.9, 0.35)}
	var xs := {"red": 133.0, "blue": 136.0, "green": 139.0}
	for lever in Data.LEVERS:
		var base := w.mesh_box(Vector3(0.3, 1.0, 0.18), Vector3(xs[lever], 0.5, 0.4), Assets.mat(Color(0.2, 0.2, 0.22), 0.5, 0.6), n)
		base.name = "Lever_" + lever
		w.mesh_box(Vector3(0.12, 0.5, 0.12), Vector3(xs[lever], 1.15, 0.45), Assets.mat(cols[lever], 0.3, 0.0, 1.8), n)
		var u := w.use(n, "lever_" + lever, Vector3(0.7, 1.4, 0.6), Vector3(xs[lever], 0.9, 0.5), w.game.lever.bind(lever))
		u.prompt = "lever"
	w.prop(n, "desk", 0.8, Vector3(140.4, 0.0, 6.0), 90.0, true, false, "z")
	_pickup(w, n, "wiring", "wiring", 0.22, Vector3(140.4, 0.86, 6.0), Color(1.0, 0.5, 0.3))
	_pickup(w, n, "cell_pump", "battery", 0.18, Vector3(131.2, 0.0, 8.8), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_e", "toolbox", 0.18, Vector3(132.6, 0.0, 9.4), Color(0.8, 0.85, 1.0))
	_debris(w, n, "c2_pump", Vector3(136.0, 1.5, 4.5), Vector3(4.0, 3.0, 4.0))
	_sparks(n, Vector3(134.0, 3.2, 5.0))
	_locker(w, n, Vector3(131.0, 0.0, 1.0), 180.0)


# ── chapter 3 ────────────────────────────────────────────────────────────────

static func _c3_floor(w: World, n: Node3D) -> void:
	for b in BELTS:
		var cx: float = (b[0] + b[1]) * 0.5
		var cz: float = (b[2] + b[3]) * 0.5
		for k in range(int((b[1] - b[0]) / 2.4)):
			w.prop(n, "conveyor", 2.4, Vector3(b[0] + 1.2 + k * 2.4, 0.0, cz), 0.0, false, true)
		w.solid(Vector3(b[1] - b[0], 0.8, 1.0), Vector3(cx, 0.4, cz), n)
		for k in range(3):
			w.prop(n, "crate", 0.5, Vector3(b[0] + 3.0 + k * 6.0, 0.8, cz), randf() * 30.0, false)
	for x in [202.0, 206.0, 210.0, 214.0, 218.0]:
		_locker(w, n, Vector3(x, 0.0, 0.7), 180.0)
	w.prop(n, "forklift", 1.8, Vector3(226.0, 0.0, 14.0), 200.0, true, true)
	w.prop(n, "forklift", 1.8, Vector3(226.0, 0.0, 2.0), 160.0, true, true)
	_paper(w, n, "p_factory", Vector3(201.8, 0.86, 8.0), 0.0)
	_debris(w, n, "c3_floor", Vector3(214.0, 2.0, 6.0), Vector3(4.0, 4.0, 4.0))
	_debris(w, n, "c3_floor2", Vector3(220.0, 2.0, 10.0), Vector3(4.0, 4.0, 4.0))
	_sparks(n, Vector3(210.0, 4.6, 6.0))
	_sparks(n, Vector3(222.0, 4.6, 9.5))
	_skeleton(w, n, Vector3(208.0, 0.0, 10.0), 40.0)
	_skeleton(w, n, Vector3(216.0, 0.0, 14.0), 160.0)
	_pickup(w, n, "cell_floor", "battery", 0.18, Vector3(225.0, 0.0, 9.0), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_f", "toolbox", 0.18, Vector3(226.6, 0.0, 9.6), Color(0.8, 0.85, 1.0))


static func _c3_lockers(w: World, n: Node3D) -> void:
	for i in range(6):
		_locker(w, n, Vector3(201.0 + 1.5 * i, 0.0, 23.4), 0.0)
	var sw := w.use(n, "office_switch", Vector3(0.6, 0.8, 0.5), Vector3(209.4, 1.2, 20.0), w.game.office_switch)
	sw.prompt = "switch"
	w.mesh_box(Vector3(0.12, 0.5, 0.35), Vector3(209.7, 1.2, 20.0), Assets.mat(Color(0.2, 0.9, 0.5), 0.3, 0.0, 1.6), n)
	_sparks(n, Vector3(205.0, 2.9, 20.0))
	_skeleton(w, n, Vector3(206.0, 0.0, 19.5), 80.0)


static func _c3_office(w: World, n: Node3D) -> void:
	w.prop(n, "desk", 0.8, Vector3(219.0, 0.0, 23.6), 0.0, true, false, "x")
	_pickup(w, n, "keycard", "keycard", 0.12, Vector3(219.0, 0.86, 23.6), Color(1.0, 0.95, 0.4))
	w.prop(n, "terminal", 0.5, Vector3(217.8, 0.86, 23.6), 180.0, false)
	_paper(w, n, "p_ch3_log", Vector3(220.4, 0.86, 23.4), 10.0)
	_locker(w, n, Vector3(212.6, 0.0, 22.0), -90.0)
	_pickup(w, n, "cell_office", "battery", 0.18, Vector3(224.5, 0.0, 18.5), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_g", "toolbox", 0.18, Vector3(223.0, 0.0, 19.0), Color(0.8, 0.85, 1.0))


static func _c3_work(w: World, n: Node3D) -> void:
	w.prop(n, "lab_table", 0.9, Vector3(235.0, 0.0, 7.0), 0.0, true, false, "x")
	w.prop(n, "barrel", 0.95, Vector3(238.5, 0.0, 10.5), 0.0)
	_pickup(w, n, "gel", "gel", 0.3, Vector3(238.5, 0.95, 10.5), Color(0.4, 1.0, 0.45))
	_pickup(w, n, "cell_work", "battery", 0.18, Vector3(231.0, 0.0, 3.2), Color(0.4, 0.8, 1.0))
	_pickup(w, n, "scrap_h", "toolbox", 0.18, Vector3(232.4, 0.0, 3.7), Color(0.8, 0.85, 1.0))
	var panel := w.use(n, "door_panel_lift3", Vector3(0.5, 0.6, 0.8), Vector3(240.5, 1.3, 7.8), w.game.door_panel.bind("lift3"))
	panel.prompt = "keypanel"
	w.mesh_box(Vector3(0.12, 0.4, 0.3), Vector3(240.7, 1.3, 7.8), Assets.mat(Color(0.2, 0.9, 0.5), 0.3, 0.0, 1.6), n)
	_locker(w, n, Vector3(232.0, 0.0, 11.4), 0.0)


# ── chapter 4 ────────────────────────────────────────────────────────────────

static func _c4_lobby(w: World, n: Node3D) -> void:
	_paper(w, n, "p_core", Vector3(301.5, 0.86, 7.0), 0.0)
	w.prop(n, "crate", 0.85, Vector3(304.5, 0.0, 3.0), 20.0)


static func _c4_corr(w: World, n: Node3D) -> void:
	_debris(w, n, "c4_corr", Vector3(314.0, 1.5, 5.5), Vector3(3.0, 3.0, 3.0))
	_sparks(n, Vector3(311.0, 2.7, 5.5))
	_skeleton(w, n, Vector3(318.0, 0.0, 5.0), 120.0)
	if w.game.s.chapter == 4:
		_enemy(w, n, "crawler", Vector3(316.0, 0.0, 5.5), [Vector3(309, 0, 5.5), Vector3(319, 0, 5.5)])


static func _c4_reactor(w: World, n: Node3D) -> void:
	var core := w.prop(n, "reactor_core", 5.0, Vector3(331.0, 0.0, 5.0), 0.0, true, false, "", 4.0)
	core.name = "Core"
	var l := OmniLight3D.new()
	l.light_color = Color(0.3, 0.6, 1.0)
	l.light_energy = 1.6
	l.omni_range = 14.0
	l.position = Vector3(331.0, 3.0, 5.0)
	n.add_child(l)
	var plant := w.use(n, "plant", Vector3(1.4, 1.4, 1.0), Vector3(331.0, 1.2, 8.3), w.game.plant_bomb)
	plant.prompt = "plant"
	_sparks(n, Vector3(325.0, 5.5, 3.0))
	_sparks(n, Vector3(337.0, 5.5, 9.0))
	_skeleton(w, n, Vector3(326.0, 0.0, 8.0), 60.0)
	_skeleton(w, n, Vector3(336.0, 0.0, 2.0), 200.0)
	_locker(w, n, Vector3(322.7, 0.0, 10.5), -90.0)
	_locker(w, n, Vector3(339.3, 0.0, 0.5), 90.0)
	_debris(w, n, "c4_reactor", Vector3(327.0, 3.0, 5.0), Vector3(3.0, 5.0, 4.0))
	if w.game.s.chapter == 4:
		_enemy(w, n, "hunter", Vector3(336.0, 0.0, 9.0), [Vector3(336, 0, 9), Vector3(326, 0, 9), Vector3(326, 0, 1), Vector3(336, 0, 1)])


static func _c4_waste(w: World, n: Node3D) -> void:
	for p in [[324.0, 14.5], [338.0, 20.0], [336.0, 14.6]]:
		w.prop(n, "barrel", 0.95, Vector3(p[0], 0.0, p[1]), 0.0)
	_sparks(n, Vector3(331.0, 3.7, 17.0))
	_skeleton(w, n, Vector3(328.0, 0.0, 18.0), 10.0)
	_skeleton(w, n, Vector3(334.0, 0.0, 16.0), 100.0)
	_locker(w, n, Vector3(339.3, 0.0, 17.0), 90.0)
	if w.game.s.chapter == 4:
		_enemy(w, n, "crawler", Vector3(328.0, 0.0, 17.0), [Vector3(325, 0, 15), Vector3(337, 0, 19), Vector3(330, 0, 15)])
		_enemy(w, n, "crawler", Vector3(335.0, 0.0, 18.0), [Vector3(337, 0, 15), Vector3(326, 0, 20)])


static func _c4_return(w: World, n: Node3D) -> void:
	_debris(w, n, "c4_return", Vector3(314.0, 1.5, 17.0), Vector3(3.0, 3.0, 3.0))
	_sparks(n, Vector3(310.0, 2.7, 16.0))
	_skeleton(w, n, Vector3(318.0, 0.0, 16.0), 30.0)
	if w.game.s.chapter == 4:
		_enemy(w, n, "hunter", Vector3(313.0, 0.0, 17.0), [Vector3(309, 0, 16), Vector3(319, 0, 18)])
