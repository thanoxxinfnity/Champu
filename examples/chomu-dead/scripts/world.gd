class_name World
extends Node3D
## Saint Aster at night. The clinic ward in the north, one long road south past
## the police car, the gas station, the church and its graveyard, down to the
## hospital yard where the helicopter waits. Everything is built from code and
## the TRELLIS models; this class only places things — it has no game rules.

const CLINIC := Rect2(-16, -86, 32, 24)       # x, z, w, h  (interior)
const ROAD_Z0 := -62.0
const ROAD_Z1 := 128.0
const CHURCH_YARD := Rect2(26, 2, 50, 50)
const GATE_POS := Vector3(26, 0, 24)
const ARENA := Rect2(-32, 88, 64, 44)

var game: Game
var sun: DirectionalLight3D
var env: Environment
var gate: StaticBody3D
var gate_chain: Node3D
var helicopter: Node3D
var pad_light: OmniLight3D
var _lamps: Array = []          # {light, base, flicker, timer}
var _rain: CPUParticles3D
var _bolt_t := 14.0
var _flash := 0.0
var _static := {}               # name -> StaticBody3D, for tests
var _ground_mat: ShaderMaterial
var _wall_mat: ShaderMaterial
var _floor_mat: ShaderMaterial
var _ceil_mat: ShaderMaterial
var _tick := 0.0


func build() -> void:
	_environment()
	_materials()
	_ground()
	_clinic()
	_street()
	_gas_station()
	_church()
	_south()
	_boundaries()


# ── environment ──────────────────────────────────────────────────────────────

func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.015, 0.02, 0.05)
	sm.sky_horizon_color = Color(0.05, 0.06, 0.1)
	sm.ground_horizon_color = Color(0.03, 0.035, 0.05)
	sm.ground_bottom_color = Color(0.01, 0.01, 0.015)
	sm.sky_energy_multiplier = 0.9
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.16, 0.2, 0.32)
	env.ambient_light_energy = 1.35
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.fog_enabled = true
	env.fog_light_color = Color(0.07, 0.085, 0.13)
	env.fog_density = 0.022
	env.fog_sky_affect = 0.9
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.05
	env.adjustment_enabled = true
	env.adjustment_saturation = 0.78
	env.adjustment_contrast = 1.12
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.light_color = Color(0.45, 0.55, 0.85)
	sun.light_energy = 0.55
	sun.rotation_degrees = Vector3(-52, 35, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 50.0
	add_child(sun)

	_rain = CPUParticles3D.new()
	_rain.amount = 420
	_rain.lifetime = 0.9
	_rain.preprocess = 1.0
	_rain.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	_rain.emission_box_extents = Vector3(16, 0.3, 16)
	_rain.direction = Vector3(0.12, -1, 0.05)
	_rain.spread = 3.0
	_rain.initial_velocity_min = 22.0
	_rain.initial_velocity_max = 26.0
	_rain.gravity = Vector3(0, -4, 0)
	var bm := BoxMesh.new()
	bm.size = Vector3(0.012, 0.55, 0.012)
	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.albedo_color = Color(0.7, 0.8, 1.0, 0.28)
	rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.material = rm
	_rain.mesh = bm
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_rain.position.y = 13.0
	add_child(_rain)


func _materials() -> void:
	_ground_mat = ShaderMaterial.new()
	_ground_mat.shader = preload("res://shaders/ground.gdshader")
	_wall_mat = ShaderMaterial.new()
	_wall_mat.shader = preload("res://shaders/grunge.gdshader")
	_wall_mat.set_shader_parameter("tile", 0.45)
	_floor_mat = ShaderMaterial.new()
	_floor_mat.shader = preload("res://shaders/grunge.gdshader")
	_floor_mat.set_shader_parameter("base", Vector3(0.3, 0.32, 0.3))
	_floor_mat.set_shader_parameter("tile", 0.6)
	_floor_mat.set_shader_parameter("rough", 0.45)
	_ceil_mat = ShaderMaterial.new()
	_ceil_mat.shader = preload("res://shaders/grunge.gdshader")
	_ceil_mat.set_shader_parameter("base", Vector3(0.38, 0.38, 0.34))


# ── primitives ───────────────────────────────────────────────────────────────

func _body(pos: Vector3, size: Vector3, mat: Material = null, visible_mesh := true) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = Data.L_WORLD
	b.collision_mask = 0
	b.position = pos
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	b.add_child(cs)
	if visible_mesh:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = mat
		b.add_child(mi)
	add_child(b)
	return b


## A wall between two floor points, `h` tall and `t` thick.
func _wall(a: Vector2, b: Vector2, h := 3.4, t := 0.3, mat: Material = null) -> StaticBody3D:
	var d := b - a
	var len := d.length()
	var body := _body(Vector3((a.x + b.x) * 0.5, h * 0.5, (a.y + b.y) * 0.5), Vector3(len, h, t), mat if mat != null else _wall_mat)
	body.rotation.y = -atan2(d.y, d.x)
	return body


func _invisible_wall(a: Vector2, b: Vector2, h := 6.0) -> void:
	var d := b - a
	var body := _body(Vector3((a.x + b.x) * 0.5, h * 0.5, (a.y + b.y) * 0.5), Vector3(d.length(), h, 0.6), null, false)
	body.rotation.y = -atan2(d.y, d.x)


## A TRELLIS model on the ground. `footprint` adds a collision box around it.
func place(model: String, pos: Vector3, size: float, yaw_deg := 0.0, footprint := 0.0, by_length := false, tint := Color.WHITE) -> Node3D:
	var m := Assets.make(model, size, by_length, false, tint)
	var holder: Node3D
	if footprint > 0.0:
		var dims := Assets.size_of(m)
		if m.has_meta("stand_in"):
			dims = Vector3(size, size, size)
		var body := StaticBody3D.new()
		body.collision_layer = Data.L_WORLD
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(maxf(dims.x * footprint, 0.2), maxf(dims.y, 0.5), maxf(dims.z * footprint, 0.2))
		cs.shape = bs
		cs.position.y = bs.size.y * 0.5
		body.add_child(cs)
		body.add_child(m)
		holder = body
	else:
		holder = m
	holder.position = pos
	holder.rotation_degrees.y = yaw_deg
	add_child(holder)
	_cull(m, 85.0 if size < 3.0 else 150.0)
	return holder


## Hides a prop past `dist` metres. Fog has swallowed it by then, so this is
## free frames on a phone rather than a visible change.
func _cull(node: Node, dist: float) -> void:
	for n in node.find_children("*", "MeshInstance3D", true, false):
		var gi := n as GeometryInstance3D
		gi.visibility_range_end = dist
		gi.visibility_range_end_margin = 10.0
		gi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED


func _light(pos: Vector3, color: Color, energy: float, rng: float, flicker := 0.0) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.position = pos
	l.light_color = color
	l.light_energy = energy
	l.omni_range = rng
	l.omni_attenuation = 1.4
	l.shadow_enabled = false
	add_child(l)
	_lamps.append({"light": l, "base": energy, "flicker": flicker, "timer": randf() * 3.0, "off": 0.0})
	return l


# ── ground and boundaries ────────────────────────────────────────────────────

func _ground() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(300, 300)
	pm.subdivide_width = 1
	pm.subdivide_depth = 1
	mi.mesh = pm
	mi.material_override = _ground_mat
	mi.position = Vector3(0, 0, 20)
	add_child(mi)
	var body := _body(Vector3(0, -1, 20), Vector3(300, 2, 300), null, false)
	_static["ground"] = body


func _boundaries() -> void:
	var x0 := -95.0
	var x1 := 95.0
	var z0 := -90.0
	var z1 := 140.0
	_invisible_wall(Vector2(x0, z0), Vector2(x1, z0))
	_invisible_wall(Vector2(x1, z0), Vector2(x1, z1))
	_invisible_wall(Vector2(x1, z1), Vector2(x0, z1))
	_invisible_wall(Vector2(x0, z1), Vector2(x0, z0))
	# A ring of dead trees outside the walls, so the edge of the world is fog and branches.
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	for i in range(18):
		var side := rng.randi() % 4
		var t := rng.randf()
		var pos := Vector3.ZERO
		match side:
			0: pos = Vector3(lerpf(x0, x1, t), 0, z0 - rng.randf_range(1, 6))
			1: pos = Vector3(x1 + rng.randf_range(1, 6), 0, lerpf(z0, z1, t))
			2: pos = Vector3(lerpf(x0, x1, t), 0, z1 + rng.randf_range(1, 6))
			_: pos = Vector3(x0 - rng.randf_range(1, 6), 0, lerpf(z0, z1, t))
		place("deadtree", pos, rng.randf_range(7.0, 11.0), rng.randf() * 360.0)


# ── the clinic ───────────────────────────────────────────────────────────────

func _clinic() -> void:
	var x0 := CLINIC.position.x
	var z0 := CLINIC.position.y
	var x1 := x0 + CLINIC.size.x
	var z1 := z0 + CLINIC.size.y
	# Floor and ceiling.
	_body(Vector3((x0 + x1) * 0.5, 0.05, (z0 + z1) * 0.5), Vector3(CLINIC.size.x, 0.1, CLINIC.size.y), _floor_mat)
	_body(Vector3((x0 + x1) * 0.5, 3.45, (z0 + z1) * 0.5), Vector3(CLINIC.size.x + 0.6, 0.2, CLINIC.size.y + 0.6), _ceil_mat)
	# Outer walls: the south wall has the exit door (x 6..10).
	_wall(Vector2(x0, z0), Vector2(x1, z0))
	_wall(Vector2(x0, z0), Vector2(x0, z1))
	_wall(Vector2(x1, z0), Vector2(x1, z1))
	_wall(Vector2(x0, z1), Vector2(6, z1))
	_wall(Vector2(10, z1), Vector2(x1, z1))
	_body(Vector3(8, 3.0, z1), Vector3(4, 0.8, 0.3), _wall_mat)         # lintel
	# Divider between ward and lobby, with a doorway at z -76..-72.
	_wall(Vector2(0, z0), Vector2(0, -76))
	_wall(Vector2(0, -72), Vector2(0, z1))
	_body(Vector3(0, 3.0, -74), Vector3(0.3, 0.8, 4), _wall_mat)

	# Ward: beds in two rows with torn curtains, a wheelchair, a body bag.
	var bed_pos := [Vector3(-13, 0, -83), Vector3(-9, 0, -83), Vector3(-5, 0, -83), Vector3(-13, 0, -72), Vector3(-9, 0, -72), Vector3(-5, 0, -72)]
	for i in range(bed_pos.size()):
		place("hospital_bed", bed_pos[i], 1.1, 90.0 + (12.0 if i % 2 == 0 else -9.0), 0.9, true)
	place("wheelchair", Vector3(-3, 0, -66), 1.0, 160.0, 0.8, false)
	place("bodybag", Vector3(-11, 0, -77), 0.35, 80.0, 0.0, true)
	place("crate", Vector3(-14.5, 0, -64), 0.9, 15.0, 0.9)
	_body(Vector3(-13.5, 0.45, -66), Vector3(2.2, 0.9, 0.8), _wall_mat)   # nurse cabinet with the pistol
	# Lobby: reception desk, chairs.
	_body(Vector3(8, 0.55, -80), Vector3(5, 1.1, 1.0), _wall_mat)
	place("hospital_bed", Vector3(12.5, 0, -68), 1.1, 0.0, 0.9, true)
	place("barrel", Vector3(14.6, 0, -84.4), 0.9, 0.0, 0.8)
	place("crate", Vector3(3.2, 0, -64.5), 0.8, 30.0, 0.9)
	# Lights: dying fluorescents and one red emergency lamp.
	_light(Vector3(-8, 3.0, -78), Color(0.75, 0.95, 0.9), 1.6, 10.0, 0.7)
	_light(Vector3(-8, 3.0, -68), Color(0.75, 0.95, 0.9), 1.3, 10.0, 0.4)
	_light(Vector3(8, 3.0, -76), Color(0.8, 0.95, 0.9), 1.4, 11.0, 0.55)
	_light(Vector3(8, 3.0, -66), Color(1.0, 0.12, 0.08), 1.8, 9.0, 0.0)
	# Exit sign beyond the door glows green.
	_light(Vector3(8, 2.7, -63), Color(0.2, 1.0, 0.35), 1.0, 5.0, 0.0)
	# Facade: sign over the door, seen from the street.
	_body(Vector3(8, 3.9, z1 + 0.05), Vector3(7, 0.5, 0.2), _ceil_mat)


# ── the street ───────────────────────────────────────────────────────────────

func _street() -> void:
	# Streetlamps down both sides, every 20 m, some of them broken.
	var i := 0
	for z in range(-52, 122, 20):
		for s in [-1, 1]:
			var lamp := place("streetlamp", Vector3(s * 6.4, 0, z + (6 if s > 0 else 0)), 5.2, 0.0, 0.25)
			var lit := (i % 3) != 2
			if lit:
				_light(Vector3(s * 6.4 - s * 0.9, 4.9, z + (6 if s > 0 else 0)), Color(1.0, 0.82, 0.55), 1.7, 15.0, 0.25 if i % 4 == 0 else 0.0)
			i += 1

	# Barricades and wrecks that shape the road.
	place("barrier", Vector3(-2.5, 0, -50), 1.1, 8.0, 0.9, true)
	place("barrier", Vector3(2.5, 0, -50.5), 1.1, -12.0, 0.9, true)
	place("sandbags", Vector3(-4, 0, -34), 1.0, 5.0, 0.9, true)
	place("police_car", Vector3(3.2, 0, -36), 1.6, 28.0, 0.9, true)
	_light(Vector3(3.2, 1.8, -36), Color(1.0, 0.1, 0.1), 1.6, 9.0, 0.0)
	_light(Vector3(3.2, 1.8, -37), Color(0.15, 0.3, 1.0), 1.6, 9.0, 0.0)
	place("car_wreck", Vector3(-3, 0, -18), 1.5, 80.0, 0.9, true)
	place("car_wreck", Vector3(3.5, 0, -8), 1.5, -20.0, 0.9, true, Color(0.85, 0.9, 1.0))
	place("van", Vector3(-2.5, 0, 12), 2.1, 10.0, 0.9, true)
	place("car_wreck", Vector3(2.5, 0, 32), 1.5, 160.0, 0.9, true, Color(1.0, 0.9, 0.85))
	place("dumpster", Vector3(-8.5, 0, -22), 1.4, 90.0, 0.9, true)
	place("dumpster", Vector3(9, 0, 6), 1.4, -90.0, 0.9, true)
	for p in [Vector3(-7.5, 0, -41), Vector3(7.5, 0, -24), Vector3(8, 0, -12), Vector3(-8, 0, 14), Vector3(8.5, 0, 38)]:
		place("barrel", p, 0.95, randf() * 360.0, 0.8)
	for p in [Vector3(-9, 0, -44), Vector3(10, 0, 16), Vector3(-9.5, 0, 28)]:
		place("crate", p, 0.9, randf() * 360.0, 0.9)

	# Houses on both sides, set back from the pavement.
	var west := [Vector3(-20, 0, -44), Vector3(-20, 0, -20), Vector3(-21, 0, 24), Vector3(-20, 0, 48)]
	var east := [Vector3(20, 0, -44), Vector3(20, 0, -16), Vector3(20, 0, 8), Vector3(20, 0, 56)]
	for p in west:
		place("house", p, 7.5, 90.0, 0.92, false)
	for p in east:
		place("house", p, 7.5, -90.0, 0.92, false)
		_light(p + Vector3(-5, 2.2, 0), Color(1.0, 0.7, 0.35), 0.5, 7.0, 0.8)
	# Dead trees between the houses.
	for p in [Vector3(-14, 0, -32), Vector3(14, 0, -30), Vector3(-15, 0, 2), Vector3(-14, 0, 38), Vector3(15, 0, 28), Vector3(14, 0, 44), Vector3(-30, 0, -30), Vector3(32, 0, -28), Vector3(-34, 0, 40), Vector3(60, 0, -20)]:
		place("deadtree", p, randf_range(6.0, 9.0), randf() * 360.0, 0.0)


func _gas_station() -> void:
	var pos := Vector3(-36, 0, 0)
	place("gas_station", pos, 5.5, 90.0, 0.85, true)
	_light(pos + Vector3(4, 4.2, 0), Color(1.0, 0.95, 0.75), 2.0, 14.0, 0.45)
	_light(pos + Vector3(-1, 3.0, 8), Color(0.3, 1.0, 0.5), 0.8, 7.0, 0.9)
	place("car_wreck", Vector3(-28, 0, 12), 1.5, 40.0, 0.9, true)
	_light(Vector3(-28, 4.5, 4), Color(1.0, 0.85, 0.6), 1.8, 18.0, 0.0)
	_light(Vector3(-40, 4.5, -6), Color(1.0, 0.8, 0.55), 1.4, 14.0, 0.5)
	place("barrel", Vector3(-44, 0, 8), 0.95, 0.0, 0.8)
	place("barrel", Vector3(-43, 0, 9), 0.95, 25.0, 0.8)
	place("crate", Vector3(-30, 0, -9), 0.9, 12.0, 0.9)
	place("dumpster", Vector3(-45, 0, -8), 1.4, 0.0, 0.9, true)


func _church() -> void:
	# The church faces the road; its yard is fenced with a chained gate on the west side.
	place("church", Vector3(56, 0, 22), 17.0, -90.0, 0.85, false)
	_light(Vector3(46, 4.0, 22), Color(1.0, 0.6, 0.25), 1.6, 14.0, 0.5)
	_light(Vector3(40, 3.0, 30), Color(0.9, 0.5, 0.2), 0.8, 8.0, 0.6)

	var y := CHURCH_YARD
	var x0 := y.position.x
	var z0 := y.position.y
	var x1 := x0 + y.size.x
	var z1 := z0 + y.size.y
	# Collision around the yard (invisible), with a gap exactly where the gate stands.
	_invisible_wall(Vector2(x0, z0), Vector2(x1, z0), 4.0)
	_invisible_wall(Vector2(x0, z1), Vector2(x1, z1), 4.0)
	_invisible_wall(Vector2(x1, z0), Vector2(x1, z1), 4.0)
	_invisible_wall(Vector2(x0, z0), Vector2(x0, GATE_POS.z - 3.0), 4.0)
	_invisible_wall(Vector2(x0, GATE_POS.z + 3.0), Vector2(x0, z1), 4.0)
	# Visible fence: a run of chain-link sections on every side.
	var seg := 4.0
	var fz := z0 + seg * 0.5
	while fz < z1:
		if absf(fz - GATE_POS.z) > 3.4:
			place("fence", Vector3(x0, 0, fz), seg, 90.0, 0.0, true)
		fz += seg
	var fx := x0 + seg * 1.5
	while fx < x1:
		place("fence", Vector3(fx, 0, z0), seg, 0.0, 0.0, true)
		place("fence", Vector3(fx, 0, z1), seg, 0.0, 0.0, true)
		fx += seg
	var ez := z0 + seg * 0.5
	while ez < z1:
		place("fence", Vector3(x1, 0, ez), seg, 90.0, 0.0, true)
		ez += seg

	# The gate: two posts and a chained gate leaf that blocks the path.
	gate = _body(GATE_POS + Vector3(0, 1.2, 0), Vector3(0.3, 2.4, 6.0), null, false)
	gate.add_child(_gate_visual())
	_light(GATE_POS + Vector3(-1, 2.8, 0), Color(1.0, 0.45, 0.2), 1.2, 7.0, 0.2)

	# Graveyard in the south-east of the yard.
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in range(18):
		var p := Vector3(rng.randf_range(34, 72), 0, rng.randf_range(34, 49))
		place("tombstone_cross" if i % 3 == 0 else "tombstone_slab", p, rng.randf_range(1.0, 1.5), rng.randf_range(-20, 20) + 90.0, 0.7)
	for p in [Vector3(38, 0, 8), Vector3(68, 0, 10), Vector3(70, 0, 44), Vector3(32, 0, 46)]:
		place("deadtree", p, rng.randf_range(7.0, 10.0), rng.randf() * 360.0)
	place("car_wreck", Vector3(22, 0, 40), 1.5, 70.0, 0.9, true)


func _gate_visual() -> Node3D:
	var n := Node3D.new()
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.16, 0.14, 0.12)
	metal.metallic = 0.7
	metal.roughness = 0.5
	for dz in [-2.9, 2.9]:
		var post := MeshInstance3D.new()
		var pm := BoxMesh.new()
		pm.size = Vector3(0.25, 2.6, 0.25)
		post.mesh = pm
		post.material_override = metal
		post.position = Vector3(0, 0, dz)
		n.add_child(post)
	for i in range(7):
		var bar := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.08, 2.3, 0.08)
		bar.mesh = bm
		bar.material_override = metal
		bar.position = Vector3(0, 0, -2.6 + i * 0.87)
		n.add_child(bar)
	for y in [-0.7, 0.8]:
		var rail := MeshInstance3D.new()
		var rm := BoxMesh.new()
		rm.size = Vector3(0.1, 0.1, 5.8)
		rail.mesh = rm
		rail.material_override = metal
		rail.position = Vector3(0, y, 0)
		n.add_child(rail)
	gate_chain = Node3D.new()
	var chain_mat := StandardMaterial3D.new()
	chain_mat.albedo_color = Color(0.35, 0.33, 0.3)
	chain_mat.metallic = 0.9
	chain_mat.roughness = 0.35
	var link := MeshInstance3D.new()
	var lm := BoxMesh.new()
	lm.size = Vector3(0.12, 0.12, 1.1)
	link.mesh = lm
	link.material_override = chain_mat
	link.position = Vector3(0.12, 0.1, 0)
	link.rotation_degrees = Vector3(0, 0, 25)
	gate_chain.add_child(link)
	var lock := MeshInstance3D.new()
	var lkm := BoxMesh.new()
	lkm.size = Vector3(0.18, 0.3, 0.22)
	lock.mesh = lkm
	lock.material_override = chain_mat
	lock.position = Vector3(0.2, 0.1, 0.3)
	gate_chain.add_child(lock)
	n.add_child(gate_chain)
	return n


func open_gate() -> void:
	if gate == null:
		return
	var tw := create_tween()
	tw.tween_property(gate, "rotation_degrees:y", -95.0, 1.2)
	# Walkable once it swings: drop the collision as soon as it moves.
	for c in gate.get_children():
		if c is CollisionShape3D:
			(c as CollisionShape3D).disabled = true
	if gate_chain != null:
		gate_chain.visible = false


# ── the south road and hospital yard ─────────────────────────────────────────

func _south() -> void:
	place("ambulance", Vector3(-3.5, 0, 70), 2.6, 12.0, 0.9, true)
	place("van", Vector3(4, 0, 62), 2.1, -25.0, 0.9, true)
	place("car_wreck", Vector3(-1, 0, 84), 1.5, 95.0, 0.9, true, Color(0.9, 0.95, 1.0))
	place("sandbags", Vector3(-3, 0, 90), 1.0, 0.0, 0.9, true)
	place("sandbags", Vector3(3.5, 0, 90.5), 1.0, 10.0, 0.9, true)
	place("barrier", Vector3(0, 0, 94), 1.1, 0.0, 0.9, true)
	for p in [Vector3(-18, 0, 76), Vector3(18, 0, 80), Vector3(-26, 0, 100), Vector3(26, 0, 104)]:
		place("deadtree", p, randf_range(6.0, 9.0), randf() * 360.0)
	for p in [Vector3(-8, 0, 60), Vector3(9, 0, 74), Vector3(-9, 0, 98), Vector3(10, 0, 100)]:
		place("barrel", p, 0.95, randf() * 360.0, 0.8)
	# The hospital behind the yard, the helicopter on its pad.
	place("clinic", Vector3(0, 0, 134), 15.0, 180.0, 0.8, false)
	_light(Vector3(-8, 4.0, 122), Color(1.0, 0.85, 0.6), 1.5, 14.0, 0.3)
	_light(Vector3(8, 4.0, 122), Color(1.0, 0.85, 0.6), 1.5, 14.0, 0.3)
	helicopter = place("helicopter", Vector3(0, 0, 112), 4.2, 0.0, 0.0, true)
	var pad := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 6.0
	cm.bottom_radius = 6.0
	cm.height = 0.04
	var pmat := StandardMaterial3D.new()
	pmat.albedo_color = Color(0.12, 0.13, 0.14)
	pmat.emission_enabled = true
	pmat.emission = Color(0.9, 0.2, 0.1)
	pmat.emission_energy_multiplier = 0.25
	cm.material = pmat
	pad.mesh = cm
	pad.position = Vector3(0, 0.03, 112)
	add_child(pad)
	pad_light = _light(Vector3(0, 5.0, 112), Color(1.0, 0.25, 0.15), 1.0, 16.0, 0.0)
	# Arena fence: invisible, so the Warden fight stays in the yard.
	_invisible_wall(Vector2(-32, 86), Vector2(-32, 132), 6.0)
	_invisible_wall(Vector2(32, 86), Vector2(32, 132), 6.0)
	_invisible_wall(Vector2(-32, 132), Vector2(32, 132), 6.0)
	for i in range(8):
		place("fence", Vector3(-32, 0, 88 + i * 5.5), 4.5, 90.0, 0.0, true)
		place("fence", Vector3(32, 0, 88 + i * 5.5), 4.5, 90.0, 0.0, true)


# ── per-frame ────────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	_tick += delta
	var p: Player = game.player if game != null else null
	if p != null:
		_rain.global_position = p.global_position + Vector3(0, 13.0, 0)
	# Lightning.
	_bolt_t -= delta
	if _bolt_t <= 0.0:
		_bolt_t = randf_range(18.0, 40.0)
		_lightning()
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - delta * 3.0)
		env.ambient_light_energy = 1.35 + _flash * 5.0
		game.hud.set_flash(_flash * 0.6)
	# Lamps: flicker the unstable ones, and only light what is near the player.
	for d in _lamps:
		var l: OmniLight3D = d.light
		if p != null:
			var near := l.global_position.distance_to(p.global_position) < 48.0
			if l.visible != near:
				l.visible = near
			if not near:
				continue
		var f: float = d.flicker
		if f > 0.0:
			d.timer -= delta
			if d.timer <= 0.0:
				d.timer = randf_range(0.04, 1.6)
				d.off = 1.0 if randf() < f * 0.5 else 0.0
			l.light_energy = float(d.base) * (0.08 if d.off > 0.0 else (0.85 + randf() * 0.3))


func _lightning() -> void:
	_flash = 1.0
	sun.light_energy = 1.4
	var tw := create_tween()
	tw.tween_property(sun, "light_energy", 0.55, 0.5)
	get_tree().create_timer(randf_range(0.6, 2.4)).timeout.connect(func() -> void: game.sfx.play("thunder", -2.0, randf_range(0.8, 1.1)))
