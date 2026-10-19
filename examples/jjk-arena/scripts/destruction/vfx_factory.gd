class_name DestructionVfx
extends RefCounted
## Procedural materials/textures for the destruction effects, so no asset files are needed and the arena stays small.

static var _spark_tex: ImageTexture
static var _dust_tex: ImageTexture

## Radial burst of blue and red cursed-energy sparks, drawn once (128 px, additive).
static func spark_texture() -> ImageTexture:
	if _spark_tex != null:
		return _spark_tex
	var n := 128
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for y in n:
		for x in n:
			var p := (Vector2(x, y) - Vector2(n, n) * 0.5) / (n * 0.5)
			var r := p.length()
			var a := clampf(1.0 - r, 0.0, 1.0)
			var ang := atan2(p.y, p.x)
			var ray := pow(maxf(0.0, sin(ang * 9.0 + r * 4.0)), 6.0)
			var c := Color(0.2, 0.45, 1.0) if sin(ang * 3.0) > 0.0 else Color(1.0, 0.18, 0.12)
			var glow := a * a * 0.55 + ray * a * 0.9
			img.set_pixel(x, y, Color(c.r, c.g, c.b, clampf(glow, 0.0, 1.0)))
	for i in 70:
		var q := Vector2(rng.randf(), rng.randf()) * n
		if (q - Vector2(n, n) * 0.5).length() < n * 0.46:
			var col := Color(0.6, 0.8, 1.0, 1.0) if rng.randf() < 0.5 else Color(1.0, 0.5, 0.35, 1.0)
			img.set_pixel(int(q.x), int(q.y), col)
	_spark_tex = ImageTexture.create_from_image(img)
	return _spark_tex

## Soft grey puff for dust and smoke.
static func dust_texture() -> ImageTexture:
	if _dust_tex != null:
		return _dust_tex
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var r := (Vector2(x, y) - Vector2(n, n) * 0.5).length() / (n * 0.5)
			img.set_pixel(x, y, Color(0.62, 0.6, 0.57, pow(clampf(1.0 - r, 0.0, 1.0), 1.6)))
	_dust_tex = ImageTexture.create_from_image(img)
	return _dust_tex

## Alpha-quad "decal": the Compatibility renderer has no Decal node, so the mark is a flat additive quad just above the ground.
static func spark_decal_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_texture = spark_texture()
	m.albedo_color = Color(1, 1, 1, 1)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = false
	return m

static func dust_particles(amount: int) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.one_shot = true
	p.explosiveness = 0.9
	p.lifetime = 1.8
	p.emitting = false
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 70.0
	pm.initial_velocity_min = 2.0
	pm.initial_velocity_max = 7.0
	pm.gravity = Vector3(0, 0.6, 0)
	pm.damping_min = 1.5
	pm.damping_max = 3.0
	pm.scale_min = 1.2
	pm.scale_max = 3.2
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.3))
	curve.add_point(Vector2(0.35, 1.0))
	curve.add_point(Vector2(1, 1.0))
	var ct := CurveTexture.new()
	ct.curve = curve
	pm.scale_curve = ct
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.85))
	g.set_color(1, Color(1, 1, 1, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = dust_texture()
	quad.material = mat
	p.draw_pass_1 = quad
	p.visibility_aabb = AABB(Vector3(-15, -2, -15), Vector3(30, 20, 30))
	return p

## Small blue/red spark burst that flies out with the rubble.
static func spark_particles(amount: int) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.one_shot = true
	p.explosiveness = 1.0
	p.lifetime = 0.7
	p.emitting = false
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 80.0
	pm.initial_velocity_min = 5.0
	pm.initial_velocity_max = 14.0
	pm.gravity = Vector3(0, -12, 0)
	pm.scale_min = 0.08
	pm.scale_max = 0.22
	pm.color_ramp = _spark_ramp()
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = spark_texture()
	quad.material = mat
	p.draw_pass_1 = quad
	p.visibility_aabb = AABB(Vector3(-15, -2, -15), Vector3(30, 20, 30))
	return p

static func _spark_ramp() -> GradientTexture1D:
	var g := Gradient.new()
	g.set_color(0, Color(0.35, 0.6, 1.0, 1.0))
	g.add_point(0.5, Color(1.0, 0.25, 0.2, 0.9))
	g.set_color(g.get_point_count() - 1, Color(1.0, 0.2, 0.1, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	return gt
