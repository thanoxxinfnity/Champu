class_name ArenaBuilder
extends RefCounted
## Builds the fight arena: a ruined night street in a ring of broken towers, with a skyline and mountains far behind.
## Every Sketchfab model arrives in its own units, so `prop()` rescales each one to a size we choose and stands it on y = 0.

const ENV := "res://assets/environment/"

static func _aabb(n: Node, xf := Transform3D.IDENTITY) -> AABB:
	var box := AABB()
	var first := true
	if n is MeshInstance3D:
		box = xf * (n as MeshInstance3D).get_aabb()
		first = false
	for c in n.get_children():
		if c is Node3D:
			var b := _aabb(c, xf * (c as Node3D).transform)
			if b.size != Vector3.ZERO:
				box = b if first else box.merge(b)
				first = false
	return box

## Load a glb, scale it so its height (or its longest side when `by_width`) is `size`, centre it on x/z and stand it on y = 0.
static func prop(path: String, size: float, by_width := false) -> Node3D:
	var res = load(path)
	if res == null:
		return null
	var inst: Node3D = res.instantiate()
	var holder := Node3D.new()
	holder.add_child(inst)
	var b := _aabb(inst)
	if b.size == Vector3.ZERO:
		return holder
	var ref := maxf(b.size.x, b.size.z) if by_width else b.size.y
	var k := size / maxf(ref, 0.0001)
	holder.set_meta("height", b.size.y * k)
	inst.scale = Vector3.ONE * k
	var c := b.get_center()
	inst.position = Vector3(-c.x * k, -b.position.y * k, -c.z * k)
	return holder

static func _ground(radius: float) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(radius * 2.0, radius * 2.0)
	m.mesh = plane
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.17, 0.17, 0.19)
	mat.roughness = 0.85
	m.material_override = mat
	return m

static func _strip(parent: Node3D, pos: Vector3, size: Vector3, color: Color) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	m.mesh = b
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 1.0
	m.material_override = mat
	m.position = pos
	parent.add_child(m)

## Returns {"root": Node3D, "sun": DirectionalLight3D, "env": Environment, "rubble": Array[Node3D]}
static func build(rich := true) -> Dictionary:
	var root := Node3D.new()
	root.name = "Arena"
	root.add_child(_ground(260.0))
	for i in 9:
		_strip(root, Vector3(0, 0.02, -16 + i * 4.0), Vector3(0.25, 0.02, 2.0), Color(0.85, 0.8, 0.5))
	_strip(root, Vector3(-9, 0.02, 0), Vector3(0.3, 0.02, 60.0), Color(0.8, 0.8, 0.8))
	_strip(root, Vector3(9, 0.02, 0), Vector3(0.3, 0.02, 60.0), Color(0.8, 0.8, 0.8))
	# ring of broken towers
	var ruins := ["props/ruin_building1.glb", "props/ruin_building2.glb", "props/ruin_building3.glb"]
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	var n := 10 if rich else 6
	for i in n:
		var a := TAU * float(i) / n + rng.randf_range(-0.12, 0.12)
		var r := rng.randf_range(30.0, 40.0)
		var p := prop(ENV + ruins[i % 3], rng.randf_range(24.0, 38.0), false)
		if p == null:
			continue
		p.position = Vector3(cos(a) * r, 0, sin(a) * r)
		p.rotation.y = -a + PI * 0.5 + rng.randf_range(-0.3, 0.3)
		p.add_to_group("buildings")
		root.add_child(p)
	if rich:
		var city := prop(ENV + "neon_city.glb", 70.0, true)
		if city != null:
			city.position = Vector3(0, 0, -62)
			root.add_child(city)
		var sky := prop(ENV + "skyline_night.glb", 330.0, true)
		if sky != null:
			sky.position = Vector3(40, 0, -150)
			root.add_child(sky)
		var sky2 := prop(ENV + "skyline_night.glb", 330.0, true)
		if sky2 != null:
			sky2.position = Vector3(-170, 0, 60)
			sky2.rotation.y = PI * 0.5
			root.add_child(sky2)
		for i in 3:
			var m := prop(ENV + ("mountain_a.glb" if i % 2 == 0 else "mountain_b.glb"), 150.0 + 30.0 * i, false)
			if m != null:
				var a2 := 0.6 + i * 2.1
				m.position = Vector3(cos(a2) * 420.0, 0, sin(a2) * 420.0)
				m.scale *= 1.6
				root.add_child(m)
		for i in 6:
			var lamp := prop(ENV + "props/lamp_post.glb", 7.0, false)
			if lamp != null:
				var a3 := TAU * i / 6.0 + 0.4
				lamp.position = Vector3(cos(a3) * 17.0, 0, sin(a3) * 17.0)
				root.add_child(lamp)
		for i in 4:
			var car := prop(ENV + "props/burned_cars.glb", 11.0, true)
			if car != null and i < 2:
				car.position = Vector3(-14 + i * 28.0, 0, -13)
				car.rotation.y = 0.4 + i
				root.add_child(car)
				break
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -35, 0)
	sun.light_color = Color(1.0, 0.88, 0.75)
	sun.light_energy = 1.35
	sun.shadow_enabled = true
	root.add_child(sun)
	var fill := OmniLight3D.new()
	fill.position = Vector3(0, 9, 0)
	fill.light_color = Color(0.65, 0.75, 1.0)
	fill.light_energy = 0.9
	fill.omni_range = 40.0
	root.add_child(fill)
	var env := Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.08, 0.1, 0.24)
	sky_mat.sky_horizon_color = Color(0.62, 0.42, 0.45)
	sky_mat.ground_horizon_color = Color(0.3, 0.2, 0.22)
	sky_mat.ground_bottom_color = Color(0.1, 0.09, 0.1)
	var sky_res := Sky.new()
	sky_res.sky_material = sky_mat
	env.sky = sky_res
	env.background_mode = Environment.BG_SKY
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 1.3
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.1
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.08
	env.adjustment_saturation = 1.1
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.08
	env.fog_enabled = true
	env.fog_light_color = Color(0.42, 0.38, 0.48)
	env.fog_density = 0.004
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	return {"root": root, "sun": sun, "env": env}
