class_name Detail
extends RefCounted
## What makes a set a place: ceiling pipes and ducts, cables, vents, posters, things written on the walls,
## streaks of blood, puddles, dust in the air, a siren turning in the dark, toys hung from the ceiling,
## toys strewn on the floor. None of it blocks the way (it is all out of reach or flat to the wall), and
## it is placed from a fixed seed, so the same building is dressed the same way every time.

const SHAFT := preload("res://shaders/shaft.gdshader")

var lv: Level
var rng := RandomNumberGenerator.new()
var _drip_tex: ImageTexture
var beacons := {}        # zone -> Array[Node3D]  (lit up when the power is off)


func _init(level: Level) -> void:
	lv = level
	rng.seed = 4242


func build() -> void:
	_drip_tex = _make_drip()
	for zone in Level.AREAS:
		_ceiling(zone)
	_posters()
	_writing()
	_streaks()
	_puddles()
	_dust()
	_hanging()
	_beacons()
	_litter()
	_wall_gear()


# ── ceilings ─────────────────────────────────────────────────────────────────

func _pipe(a: Vector3, b: Vector3, r: float, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = a.distance_to(b)
	cm.radial_segments = 8
	cm.rings = 1
	mi.mesh = cm
	mi.material_override = mat
	mi.position = (a + b) * 0.5
	var d := (b - a).normalized()
	mi.basis = Basis(Quaternion(Vector3.UP, d))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	lv.add_child(mi)


func _ceiling(zone: String) -> void:
	var a: Array = Level.AREAS[zone]
	var h: float = a[4]
	var rust := Assets.mat(Color(0.34, 0.2, 0.12), 0.7, 0.6)
	var steel := Assets.mat(Color(0.25, 0.27, 0.3), 0.55, 0.7)
	var w: float = a[1] - a[0]
	var d: float = a[3] - a[2]
	var along_x := w >= d
	var n := 2 if zone in ["hub", "control", "lab", "engine", "dorm"] else 1
	for i in range(n):
		var off := (float(i) + 0.5) / n
		if along_x:
			var z: float = a[2] + d * (0.2 + 0.6 * off)
			_pipe(Vector3(a[0] + 0.2, h - 0.28, z), Vector3(a[1] - 0.2, h - 0.28, z), 0.11 if i == 0 else 0.07, rust if i == 0 else steel)
		else:
			var x: float = a[0] + w * (0.2 + 0.6 * off)
			_pipe(Vector3(x, h - 0.28, a[2] + 0.2), Vector3(x, h - 0.28, a[3] - 0.2), 0.11 if i == 0 else 0.07, rust if i == 0 else steel)
	# A duct with a grille, and cables sagging between the hangers.
	var cx: float = (a[0] + a[1]) * 0.5
	var cz: float = (a[2] + a[3]) * 0.5
	var duct := lv._mesh_box(Vector3(2.2, 0.4, 0.5) if along_x else Vector3(0.5, 0.4, 2.2), Vector3(cx + (w * 0.18 if along_x else 0.0), h - 0.22, cz + (0.0 if along_x else d * 0.18)), steel)
	var grille := lv._mesh_box(Vector3(0.7, 0.03, 0.4) if along_x else Vector3(0.4, 0.03, 0.7), duct.position + Vector3(0, -0.21, 0), Assets.mat(Color(0.05, 0.05, 0.06), 0.6, 0.3))
	grille.name = "grille"
	var cable := Assets.mat(Color(0.03, 0.03, 0.03), 0.8)
	for k in range(int(maxf(w, d) / 3.0)):
		var t := rng.randf()
		var px: float = a[0] + 0.8 + (w - 1.6) * (t if along_x else rng.randf())
		var pz: float = a[2] + 0.8 + (d - 1.6) * (rng.randf() if along_x else t)
		var len := rng.randf_range(0.5, 1.6)
		_pipe(Vector3(px, h, pz), Vector3(px + rng.randf_range(-0.1, 0.1), h - len, pz + rng.randf_range(-0.1, 0.1)), 0.012, cable)


# ── things on the walls ──────────────────────────────────────────────────────

func _paper(pos: Vector3, yaw: float, size: Vector2, color: Color, text: String, tilt := 0.0) -> void:
	var m := lv._mesh_box(Vector3(size.x, size.y, 0.025), pos, Assets.mat(color, 0.85, 0.0, 0.12))
	m.rotation_degrees = Vector3(0, yaw, tilt)
	var l := Label3D.new()
	l.text = text
	l.font_size = 40
	l.pixel_size = 0.0036 * size.x
	l.modulate = Color(0.1, 0.07, 0.07)
	l.outline_size = 0
	l.shaded = true
	l.position = Vector3(0, 0, 0.016)
	m.add_child(l)


func _posters() -> void:
	var list := [
		# [position, yaw, size, colour, words, tilt]
		[Vector3(-9.82, 2.0, -7.0), 90.0, Vector2(0.9, 1.2), Color(0.95, 0.8, 0.3), "SMILE\nTODAY!", 3.0],
		[Vector3(9.82, 2.0, 7.0), -90.0, Vector2(0.9, 1.2), Color(0.9, 0.4, 0.5), "MR. GRIN\nLOVES\nYOU", -4.0],
		[Vector3(-3.0, 2.1, 9.82), 180.0, Vector2(0.8, 1.1), Color(0.6, 0.8, 0.9), "QUIET\nHOURS", 2.0],
		[Vector3(6.0, 2.1, -9.82), 0.0, Vector2(0.8, 1.1), Color(0.95, 0.95, 0.85), "NO\nRUNNING", -2.0],
		[Vector3(-1.0, 1.9, 5.0), 0.0, Vector2(0.0, 0.0), Color.BLACK, "", 0.0],
		[Vector3(-7.9, 1.8, -5.0), 0.0, Vector2(0.0, 0.0), Color.BLACK, "", 0.0],
		[Vector3(-21.0, 2.0, -7.84), 0.0, Vector2(0.9, 1.1), Color(0.9, 0.7, 0.8), "NAP TIME\nIS SACRED", 2.0],
		[Vector3(-30.0, 2.0, 7.84), 180.0, Vector2(0.9, 1.1), Color(0.7, 0.85, 0.7), "WASH YOUR\nHANDS", -3.0],
		[Vector3(-4.0, 2.0, 27.84), 180.0, Vector2(0.8, 1.0), Color(0.95, 0.85, 0.3), "CAUTION\nSTEAM", 2.0],
		[Vector3(4.0, 2.2, 15.84), 0.0, Vector2(0.8, 1.0), Color(0.85, 0.25, 0.2), "NO\nSMOKING", -3.0],
		[Vector3(19.5, 2.1, -7.84), 0.0, Vector2(0.8, 1.0), Color(0.8, 0.9, 0.95), "SAFETY\nGOGGLES", 2.0],
		[Vector3(30.5, 2.1, 7.84), 180.0, Vector2(0.9, 1.1), Color(0.9, 0.9, 0.6), "TEST\nEVERYTHING", -2.0],
		[Vector3(-6.5, 2.1, -27.84), 0.0, Vector2(0.9, 1.1), Color(0.95, 0.75, 0.75), "EMPLOYEE\nOF THE\nMONTH", 3.0],
		[Vector3(7.84, 2.0, -20.0), -90.0, Vector2(0.8, 1.0), Color(0.8, 0.8, 0.9), "OUR\nMASCOT\nIS WATCHING", 0.0],
	]
	for p in list:
		if (p[2] as Vector2).x > 0.0:
			_paper(p[0], p[1], p[2], p[3], p[4], p[5])


func _writing() -> void:
	# Painted by someone who did not have long. Dark red, drying down the wall.
	var items := [
		["HE HATES\nTHE LIGHT", Vector3(-9.83, 1.8, 2.5), 90.0, 0.014],
		["DON'T\nLET HIM\nHEAR YOU", Vector3(9.83, 1.7, -2.4), -90.0, 0.012],
		["CUBBY 7", Vector3(-17.2, 1.9, 4.0), 90.0, 0.012],
		["RUN", Vector3(1.8, 1.6, 13.0), 90.0, 0.03],
		["HE SMILES\nWHEN YOU\nHIDE", Vector3(-1.52, 1.8, -12.0), -90.0, 0.012],
		["STILL HERE", Vector3(-6.0, 2.0, -27.8), 0.0, 0.014],
		["I SEE\nYOU", Vector3(32.8, 1.8, -3.0), -90.0, 0.018],
		["THE GATE\nIS REAL", Vector3(10.2, 1.8, -8.8), 90.0, 0.011],
		["COUNT THE\nPIPES", Vector3(3.0, 1.9, 27.8), 180.0, 0.011],
	]
	for it in items:
		var l := Label3D.new()
		l.text = it[0]
		l.font_size = 64
		l.pixel_size = it[3]
		l.modulate = Color(0.55, 0.03, 0.03)
		l.outline_size = 0
		l.shaded = false
		l.position = it[1]
		l.rotation_degrees.y = it[2]
		lv.add_child(l)
		_streak(it[1] + Vector3(0, -0.2, 0), it[2], 1.6)


func _make_drip() -> ImageTexture:
	var img := Image.create(32, 128, false, Image.FORMAT_RGBA8)
	var r := RandomNumberGenerator.new()
	r.seed = 11
	for x in range(32):
		var len := r.randf_range(0.25, 1.0) if r.randf() < 0.55 else 0.0
		var w := r.randf_range(0.6, 1.6)
		for y in range(128):
			var t := float(y) / 128.0
			var a := 0.0
			if t < len:
				a = (1.0 - t / maxf(len, 0.01)) * 0.5 + 0.35
				if t > len - 0.06:
					a *= 0.6 + 0.4 * sin((t - len + 0.06) * 60.0)
			var edge := 1.0 - absf(float(x) - 16.0) / 16.0
			img.set_pixel(x, y, Color(0.35, 0.0, 0.0, clampf(a * edge * w, 0.0, 0.9)))
	return ImageTexture.create_from_image(img)


func _streak(pos: Vector3, yaw: float, height: float, width := 1.4) -> void:
	var q := QuadMesh.new()
	q.size = Vector2(width, height)
	var mi := MeshInstance3D.new()
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.albedo_texture = _drip_tex
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_color = Color(0.7, 0.7, 0.7)
	mi.material_override = m
	mi.position = pos + Vector3(0, -height * 0.5 + 0.2, 0)
	mi.rotation_degrees.y = yaw
	mi.scale = Vector3(1, -1, 1) if false else Vector3.ONE
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	lv.add_child(mi)


func _streaks() -> void:
	# Blood down the walls where nobody wrote anything.
	for p in [[-9.84, 3.2, -1.0, 90.0], [9.84, 3.4, 8.0, -90.0], [-4.5, 3.4, -9.84, 0.0], [5.0, 3.2, 9.84, 180.0], [-24.0, 2.8, 7.84, 180.0], [24.0, 2.8, 7.84, 180.0], [2.0, 2.7, -27.84, 0.0], [-2.0, 2.7, 27.84, 180.0], [1.52, 2.5, 12.0, -90.0], [-13.5, 2.5, 1.52, 180.0]]:
		var pos := Vector3(p[0], p[1], p[2]) if absf(p[3]) != 90.0 else Vector3(p[0], p[1], p[2])
		_streak(pos, p[3], rng.randf_range(1.8, 3.0), rng.randf_range(1.2, 2.0))


func _puddles() -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.03, 0.02, 0.025)
	m.roughness = 0.04
	m.metallic = 0.2
	m.metallic_specular = 1.0
	var red := StandardMaterial3D.new()
	red.albedo_color = Color(0.22, 0.0, 0.0)
	red.roughness = 0.08
	red.metallic_specular = 1.0
	var spots := [[-3.2, 3.0], [4.5, -2.5], [-6.0, -3.0], [2.0, 6.0], [0.0, -14.0], [14.0, 0.5], [0.0, 14.5], [-14.5, -0.5], [-24.0, 1.0], [24.0, -1.0], [-2.0, 22.5], [3.0, -22.0], [13.0, -7.0], [-20.5, 4.0]]
	for i in range(spots.size()):
		var q := QuadMesh.new()
		var s := rng.randf_range(0.8, 2.0)
		q.size = Vector2(s, s * rng.randf_range(0.6, 1.0))
		var mi := MeshInstance3D.new()
		mi.mesh = q
		mi.material_override = red if i % 4 == 0 else m
		mi.rotation_degrees = Vector3(-90, rng.randf() * 360.0, 0)
		mi.position = Vector3(spots[i][0], 0.012, spots[i][1])
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		lv.add_child(mi)


# ── air ──────────────────────────────────────────────────────────────────────

func _dust() -> void:
	for zone in ["hub", "control", "lab", "engine", "dorm"]:
		var a: Array = Level.AREAS[zone]
		var p := GPUParticles3D.new()
		p.amount = 90
		p.lifetime = 9.0
		p.preprocess = 9.0
		p.visibility_aabb = AABB(Vector3(-20, -1, -20), Vector3(40, 8, 40))
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		pm.emission_box_extents = Vector3((a[1] - a[0]) * 0.5 - 0.5, float(a[4]) * 0.5, (a[3] - a[2]) * 0.5 - 0.5)
		pm.gravity = Vector3(0, -0.01, 0)
		pm.direction = Vector3(0.3, 0.1, 0.2)
		pm.spread = 180.0
		pm.initial_velocity_min = 0.02
		pm.initial_velocity_max = 0.12
		pm.turbulence_enabled = true
		pm.turbulence_noise_strength = 0.4
		p.process_material = pm
		var q := QuadMesh.new()
		q.size = Vector2(0.025, 0.025)
		var dm := StandardMaterial3D.new()
		dm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		dm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		dm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		dm.albedo_color = Color(0.85, 0.9, 1.0, 0.30)
		q.material = dm
		p.draw_pass_1 = q
		p.position = Vector3((a[0] + a[1]) * 0.5, float(a[4]) * 0.5, (a[2] + a[3]) * 0.5)
		lv.add_child(p)


func _hanging() -> void:
	# Toys hung from the ceiling by their ankles, turning very slowly.
	var list := [
		["teddy", 0.9, Vector3(-4.5, 0, -3.0)], ["plush_bunny", 0.8, Vector3(3.5, 0, 3.8)], ["robot_toy", 0.6, Vector3(-3.0, 0, 5.5)],
		["teddy", 0.7, Vector3(5.0, 0, -5.5)], ["plush_bunny", 0.6, Vector3(0.0, 0, -13.0)], ["teddy", 0.7, Vector3(0.0, 0, 14.0)],
	]
	for it in list:
		var zone := lv.zone_at(it[2])
		var h: float = Level.AREAS[zone][4] if zone != "" else 3.0
		var holder := Node3D.new()
		holder.position = Vector3(it[2].x, h, it[2].z)
		lv.add_child(holder)
		var chain := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.01
		cm.bottom_radius = 0.01
		cm.height = 0.9
		chain.mesh = cm
		chain.position.y = -0.45
		chain.material_override = Assets.mat(Color(0.1, 0.1, 0.1), 0.6, 0.8)
		holder.add_child(chain)
		var toy := Assets.make(it[0], it[1])
		toy.rotation_degrees.x = 180.0
		toy.position.y = -0.9
		holder.add_child(toy)
		var tw := holder.create_tween().set_loops()
		var amp := rng.randf_range(2.0, 5.0)
		var t := rng.randf_range(2.0, 3.5)
		holder.rotation_degrees.z = -amp
		tw.tween_property(holder, "rotation_degrees:z", amp, t).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		tw.tween_property(holder, "rotation_degrees:z", -amp, t).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## A siren turning on the ceiling of each corridor and the hub: a red beam sweeping through the dust whenever the power is out.
func _beacons() -> void:
	for p in [["hub", Vector3(0, 4.3, -9.2)], ["hub", Vector3(0, 4.3, 9.2)], ["corN", Vector3(0, 2.8, -11.0)], ["corE", Vector3(11.5, 2.8, 0)], ["corS", Vector3(0, 2.8, 11.0)], ["corW", Vector3(-11.5, 2.8, 0)], ["engine", Vector3(0, 3.2, 17.0)], ["dorm", Vector3(-18.0, 3.2, 0)]]:
		var holder := Node3D.new()
		holder.position = p[1]
		lv.add_child(holder)
		var bulb := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.1
		sm.height = 0.2
		bulb.mesh = sm
		bulb.material_override = Assets.mat(Color(1.0, 0.1, 0.05), 0.3, 0.0, 3.0)
		holder.add_child(bulb)
		var beam := cone(Color(1.0, 0.1, 0.05), 0.35, 4.0, 6.0)
		beam.rotation_degrees.x = 90.0
		beam.position = Vector3(0, 0, -3.0)
		var spin := Node3D.new()
		spin.add_child(beam)
		holder.add_child(spin)
		var tw := spin.create_tween().set_loops()
		tw.tween_property(spin, "rotation_degrees:y", 360.0, 2.4).from(0.0)
		if not beacons.has(p[0]):
			beacons[p[0]] = []
		beacons[p[0]].append(holder)


## A cone of light: apex at the origin, opening along -Y by `length`. The tall cone is built here rather than loaded.
static func cone(color: Color, strength: float, base: float, length: float) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = 0.02
	cm.bottom_radius = base * 0.25
	cm.height = length
	cm.radial_segments = 12
	cm.rings = 1
	cm.cap_top = false
	cm.cap_bottom = false
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	var m := ShaderMaterial.new()
	m.shader = SHAFT
	m.set_shader_parameter("tint", color)
	m.set_shader_parameter("strength", strength)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


func set_power(zone: String, on: bool) -> void:
	for h in beacons.get(zone, []):
		h.visible = not on


# ── the floor and the walls, lived in ────────────────────────────────────────

func _litter() -> void:
	var kinds := [["teddy", 0.55], ["blocks", 0.35], ["toy_drum", 0.3], ["plush_bunny", 0.5], ["gift_box", 0.4], ["jack_box", 0.4], ["xylophone", 0.3]]
	for zone in ["hub", "dorm", "lab", "control", "engine"]:
		var a: Array = Level.AREAS[zone]
		var count := 7 if zone == "hub" else 5
		var placed := 0
		var guard := 0
		while placed < count and guard < 60:
			guard += 1
			var x: float = rng.randf_range(a[0] + 1.2, a[1] - 1.2)
			var z: float = rng.randf_range(a[2] + 1.2, a[3] - 1.2)
			# Keep clear of the objects the puzzles use and of the middle of the walkways.
			var near := false
			for u in lv.uses:
				if Vector2(u.global_position.x - x, u.global_position.z - z).length() < 1.6:
					near = true
			if near:
				continue
			var k: Array = kinds[rng.randi() % kinds.size()]
			var m := lv.prop(k[0], k[1] * rng.randf_range(0.8, 1.2), Vector3(x, 0.0, z), rng.randf() * 360.0, false)
			# Knocked over, some of them.
			if rng.randf() < 0.5:
				m.rotation_degrees.x = rng.randf_range(60.0, 100.0)
				m.position.y = 0.12
			placed += 1


## Things bolted to the walls that a factory has: fire boxes, switch plates, vent grilles, an old clock.
func _wall_gear() -> void:
	var metal := Assets.mat(Color(0.2, 0.2, 0.22), 0.5, 0.6)
	var red := Assets.mat(Color(0.65, 0.06, 0.05), 0.5, 0.2)
	var list := [
		[Vector3(-9.88, 1.4, 0.0), 90.0], [Vector3(9.88, 1.4, 0.0), -90.0], [Vector3(0.0, 1.4, 9.88), 180.0], [Vector3(-12.0, 1.3, -1.53), 0.0], [Vector3(12.0, 1.3, 1.53), 180.0],
	]
	for p in list:
		var box := lv._mesh_box(Vector3(0.35, 0.5, 0.12), p[0], red)
		box.rotation_degrees.y = p[1]
		var lab := Label3D.new()
		lab.text = "FIRE"
		lab.font_size = 36
		lab.pixel_size = 0.004
		lab.modulate = Color(1, 1, 1)
		lab.shaded = false
		lab.position = Vector3(0, 0.1, 0.07)
		box.add_child(lab)
	for p in [[Vector3(-9.9, 0.35, -2.0), 90.0], [Vector3(9.9, 0.35, 2.0), -90.0], [Vector3(2.0, 0.35, -9.9), 0.0], [Vector3(-2.0, 0.35, 9.9), 180.0]]:
		var vent := lv._mesh_box(Vector3(0.7, 0.35, 0.08), p[0], metal)
		vent.rotation_degrees.y = p[1]
		for k in range(4):
			lv._mesh_box(Vector3(0.62, 0.025, 0.02), Vector3(0, -0.12 + k * 0.08, 0.045), Assets.mat(Color(0.02, 0.02, 0.02), 0.8), vent)
