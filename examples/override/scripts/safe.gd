class_name Safe
extends RefCounted
## Safe stations: a pool of clean water that is dripping from a broken pipe, a green lamp, and the EMP charger. The creatures will not cross the
## water's spray (an invisible barrier that only they feel, and a hole in the navigation mesh), and they give up on anyone standing in it.
## There is one at each chapter's start, so a player who has just come out of a lift can get their breath, refill the stunner, and plan.

const BARRIER_R := 5.0        # creatures cannot come closer than this to the centre
const SAFE_R := 2.6           # a player nearer than this is out of reach of anything standing at the barrier

const STATIONS := [
	{"id": "s1", "room": "c1_cryo", "x": 5.0, "z": 4.0, "pool": 2.3, "co": Vector2(2.7, 0.0)},
	{"id": "s2", "room": "c2_lobby", "x": 102.6, "z": 6.0, "pool": 2.3, "co": Vector2(0.0, 2.7)},
	{"id": "s3", "room": "c3_floor", "x": 201.9, "z": 10.0, "pool": 2.3, "co": Vector2(0.0, 2.7)},
	{"id": "s4", "room": "c4_lobby", "x": 302.4, "z": 5.0, "pool": 2.3, "co": Vector2(-2.0, 2.2)},
]


## Is this point within the part of a station the creatures cannot reach? (`margin` widens it)
static func inside(p: Vector3, margin := 0.0) -> bool:
	for s in STATIONS:
		if Vector2(p.x - float(s.x), p.z - float(s.z)).length() < SAFE_R + margin:
			return true
	return false


## Within the barrier at all (creatures never stand here).
static func in_barrier(p: Vector3) -> bool:
	for s in STATIONS:
		if Vector2(p.x - float(s.x), p.z - float(s.z)).length() < BARRIER_R:
			return true
	return false


static func station_in(room: String) -> Dictionary:
	for s in STATIONS:
		if s.room == room:
			return s
	return {}


## Build the station in a room's node.
static func build(w: World, n: Node3D, st: Dictionary) -> void:
	var c := Vector3(float(st.x), 0.0, float(st.z))
	var holder := Node3D.new()
	holder.name = "Safe_" + String(st.id)
	n.add_child(holder)
	# the water and the ring: one flat quad
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(10.4, 10.4)
	q.mesh = qm
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/safe_water.gdshader")
	sm.set_shader_parameter("pool_r", float(st.pool))
	q.material_override = sm
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	holder.add_child(q)
	q.position = c + Vector3(0, 0.03, 0)
	q.rotation_degrees.x = -90.0
	# the barrier only the creatures feel
	var body := StaticBody3D.new()
	body.collision_layer = Data.L_BLOCK
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = BARRIER_R
	cyl.height = 3.0
	cs.shape = cyl
	body.add_child(cs)
	holder.add_child(body)
	body.position = c + Vector3(0, 1.5, 0)
	# a green lamp, and the pipe that drips into the pool
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(0.3, 1.0, 0.55)
	lamp.light_energy = 0.8
	lamp.omni_range = 6.0
	lamp.position = c + Vector3(0, 2.4, 0)
	lamp.add_to_group("pickup_light")
	lamp.visible = Quality.pickup_lights
	holder.add_child(lamp)
	var h: float = float(Rooms.LIST[st.room].h)
	var pipe := MeshInstance3D.new()
	var pm := CylinderMesh.new()
	pm.top_radius = 0.07
	pm.bottom_radius = 0.07
	pm.height = 0.5
	pipe.mesh = pm
	pipe.material_override = Assets.mat(Color(0.3, 0.32, 0.35), 0.5, 0.7)
	pipe.position = c + Vector3(0, h - 0.3, 0)
	pipe.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	holder.add_child(pipe)
	holder.add_child(_drips(c + Vector3(0, h - 0.55, 0), h - 0.6))
	# the charger, at the pool's edge, facing the middle
	var co: Vector2 = st.co        # where it stands, relative to the pool's middle (clear of every doorway and plank)
	var cp := c + Vector3(co.x, 0.0, co.y)
	var yaw := rad_to_deg(atan2(co.x, co.y))
	var ch := w.prop(holder, "charger", 1.5, cp, yaw, true, false, "", 0.7)
	ch.name = "Charger"
	var glow := OmniLight3D.new()
	glow.light_color = Color(0.35, 0.7, 1.0)
	glow.light_energy = 0.7
	glow.omni_range = 3.0
	glow.position = cp + Vector3(0, 1.2, 0)
	glow.add_to_group("pickup_light")
	glow.visible = Quality.pickup_lights
	holder.add_child(glow)
	var u := w.use(holder, "charger", Vector3(0.9, 1.6, 0.9), cp + Vector3(0, 0.8, 0), w.game.use_charger)
	u.far = true
	u.keep = true


static func _drips(pos: Vector3, fall: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = maxi(4, int(8.0 * Quality.particle_scale))
	p.lifetime = clampf(sqrt(2.0 * fall / 9.0) + 0.05, 0.4, 1.4)
	p.visibility_aabb = AABB(Vector3(-1, -fall - 1.0, -1), Vector3(2, fall + 2.0, 2))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, -1, 0)
	pm.spread = 3.0
	pm.initial_velocity_min = 0.2
	pm.initial_velocity_max = 0.5
	pm.gravity = Vector3(0, -9.0, 0)
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.03, 0.07)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(0.6, 0.85, 1.0, 0.85)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	q.material = m
	p.draw_pass_1 = q
	p.position = pos
	return p
