class_name FireFx
extends Node3D
## A burning patch: flames, black smoke and rising embers with a flickering light. After `burn_time` the flames die first, the smoke thins and the
## embers fade — what is left is a dark ash mound — and the node removes itself. Procedural textures only; sized for phones (≤ 60 live particles).

static var _flame_tex: ImageTexture

var burn_time := 12.0
var radius := 2.0
var intensity := 1.0
var _flame: GPUParticles3D
var _smoke: GPUParticles3D
var _embers: GPUParticles3D
var _light: OmniLight3D
var _age := 0.0
var _ash: MeshInstance3D

static func flame_texture() -> ImageTexture:
	if _flame_tex != null:
		return _flame_tex
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var p := (Vector2(x, y) - Vector2(n * 0.5, n * 0.62)) / (n * 0.5)
			p.y *= 0.8
			var r := p.length()
			var a := pow(clampf(1.0 - r, 0.0, 1.0), 1.4)
			img.set_pixel(x, y, Color(1.0, 0.8, 0.4, a))
	_flame_tex = ImageTexture.create_from_image(img)
	return _flame_tex

static func _quad(tex: Texture2D, additive: bool) -> QuadMesh:
	var q := QuadMesh.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = tex
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	q.material = m
	return q

static func _ramp(stops: Array) -> GradientTexture1D:
	var g := Gradient.new()
	g.set_color(0, stops[0][1])
	g.set_color(1, stops[stops.size() - 1][1])
	for i in range(1, stops.size() - 1):
		g.add_point(stops[i][0], stops[i][1])
	var t := GradientTexture1D.new()
	t.gradient = g
	return t

func _ready() -> void:
	var box := AABB(Vector3(-radius * 2, -1, -radius * 2), Vector3(radius * 4, radius * 6, radius * 4))
	_flame = GPUParticles3D.new()
	_flame.amount = int(26 * intensity)
	_flame.lifetime = 1.1
	_flame.local_coords = false
	_flame.visibility_aabb = box
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = radius * 0.55
	pm.direction = Vector3.UP
	pm.spread = 14.0
	pm.initial_velocity_min = 1.2
	pm.initial_velocity_max = 3.0
	pm.gravity = Vector3(0, 1.2, 0)
	pm.scale_min = radius * 0.8
	pm.scale_max = radius * 1.5
	pm.color_ramp = _ramp([[0.0, Color(1, 0.95, 0.5, 0.9)], [0.35, Color(1, 0.5, 0.1, 0.8)], [0.75, Color(0.8, 0.12, 0.03, 0.4)], [1.0, Color(0.2, 0.0, 0.0, 0.0)]])
	_flame.process_material = pm
	_flame.draw_pass_1 = _quad(flame_texture(), true)
	add_child(_flame)
	_smoke = GPUParticles3D.new()
	_smoke.amount = int(14 * intensity)
	_smoke.lifetime = 3.2
	_smoke.local_coords = false
	_smoke.visibility_aabb = box
	var sm := ParticleProcessMaterial.new()
	sm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	sm.emission_sphere_radius = radius * 0.5
	sm.direction = Vector3.UP
	sm.spread = 20.0
	sm.initial_velocity_min = 1.5
	sm.initial_velocity_max = 3.2
	sm.gravity = Vector3(0.6, 0.8, 0)
	sm.scale_min = radius * 1.4
	sm.scale_max = radius * 2.6
	sm.color_ramp = _ramp([[0.0, Color(0.05, 0.05, 0.05, 0.0)], [0.2, Color(0.08, 0.08, 0.08, 0.7)], [1.0, Color(0.15, 0.14, 0.14, 0.0)]])
	_smoke.process_material = sm
	_smoke.draw_pass_1 = _quad(DestructionVfx.dust_texture(), false)
	add_child(_smoke)
	_embers = GPUParticles3D.new()
	_embers.amount = int(12 * intensity)
	_embers.lifetime = 2.2
	_embers.local_coords = false
	_embers.visibility_aabb = box
	var em := ParticleProcessMaterial.new()
	em.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	em.emission_sphere_radius = radius * 0.6
	em.direction = Vector3.UP
	em.spread = 30.0
	em.initial_velocity_min = 2.0
	em.initial_velocity_max = 5.0
	em.gravity = Vector3(0.3, 0.5, 0)
	em.scale_min = 0.05
	em.scale_max = 0.12
	em.color_ramp = _ramp([[0.0, Color(1, 0.8, 0.3, 1)], [1.0, Color(1, 0.2, 0.0, 0.0)]])
	_embers.process_material = em
	_embers.draw_pass_1 = _quad(flame_texture(), true)
	add_child(_embers)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.5, 0.2)
	_light.omni_range = radius * 5.0
	_light.position = Vector3(0, 1.0, 0)
	add_child(_light)
	_ash = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = radius * 0.7
	s.height = radius * 0.5
	_ash.mesh = s
	var am := StandardMaterial3D.new()
	am.albedo_color = Color(0.06, 0.06, 0.06)
	am.roughness = 1.0
	_ash.material_override = am
	_ash.position.y = radius * 0.1
	_ash.scale = Vector3.ONE * 0.01
	add_child(_ash)

func _process(delta: float) -> void:
	_age += delta
	var t := _age / burn_time
	_light.light_energy = (1.6 + sin(_age * 17.0) * 0.4 + sin(_age * 29.0) * 0.3) * clampf(1.4 - t * 1.4, 0.0, 1.0) * intensity
	_ash.scale = Vector3.ONE * clampf((t - 0.35) * 2.5, 0.01, 1.0)   # ash builds up as the fire eats the fuel
	if t > 0.55:
		_flame.emitting = false        # burnt down: only smoke and embers are left
	if t > 0.8:
		_embers.emitting = false
	if t > 0.95:
		_smoke.emitting = false
	if t >= 1.15:
		queue_free()

func is_burning() -> bool:
	return _age / burn_time < 0.55
