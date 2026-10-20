class_name MoveVfx
extends RefCounted
## Signature-move effects for Gojo and Sukuna, all procedural (spheres, quads, particles, additive materials) so they cost no textures and
## stay cheap on phones. Every effect frees itself.
##   Gojo:   special = Reversal: Red, ultimate = Hollow Purple
##   Sukuna: special = Dismantle,     ultimate = Fuga (flame arrow)
## Plus hit sparks for every landed punch/kick.

static func glow_mat(c: Color, energy := 3.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(c.r * energy, c.g * energy, c.b * energy, c.a)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

static func _sphere(parent: Node, r: float, c: Color, energy := 3.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 20
	s.rings = 10
	mi.mesh = s
	mi.material_override = glow_mat(c, energy)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi

static func _billboard(parent: Node, size: float, c: Color, tex: Texture2D) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	mi.mesh = q
	var m := glow_mat(c, 2.0)
	m.albedo_texture = tex
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi

static func _light(parent: Node, c: Color, energy: float, rng: float) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = c
	l.light_energy = energy
	l.omni_range = rng
	parent.add_child(l)
	return l

static func _root(world: Node3D, at: Vector3, life: float) -> Node3D:
	var n := Node3D.new()
	world.add_child(n)
	n.global_position = at
	world.get_tree().create_timer(life).timeout.connect(func() -> void:
		if is_instance_valid(n):
			n.queue_free())
	return n

static func hand_pos(f: Node3D) -> Vector3:
	var fwd := -f.global_transform.basis.z
	return f.global_position + Vector3.UP * 1.35 + fwd * 0.7

## Flash + ring where a punch or kick lands.
static func hit_spark(world: Node3D, at: Vector3, heavy: bool) -> void:
	var n := _root(world, at, 0.5)
	var c := Color(1.0, 0.85, 0.6) if not heavy else Color(1.0, 0.6, 0.3)
	var b := _billboard(n, 1.0, c, DestructionVfx.spark_texture())
	var tw := n.create_tween().set_parallel(true)
	var s := 1.6 if heavy else 1.0
	tw.tween_property(b, "scale", Vector3.ONE * s, 0.08).from(Vector3.ONE * 0.2)
	tw.tween_property(b.material_override, "albedo_color:a", 0.0, 0.25).set_delay(0.06)
	var l := _light(n, c, 2.5 if heavy else 1.2, 4.0)
	tw.tween_property(l, "light_energy", 0.0, 0.2)

## Reversal: Red — a red point compresses at the fingertip, then a shock blast rips toward the target.
static func gojo_red(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, hand_pos(caster), 0.45)
		var core := _sphere(n, 0.12, Color(1.0, 0.15, 0.1), 5.0)
		var halo := _billboard(n, 1.6, Color(1.0, 0.2, 0.1), DestructionVfx.spark_texture())
		var tw := n.create_tween().set_parallel(true)
		tw.tween_property(halo, "scale", Vector3.ONE * 0.3, 0.3).from(Vector3.ONE * 1.4)
		tw.tween_property(core, "scale", Vector3.ONE * 1.6, 0.3).from(Vector3.ONE * 0.4)
		_light(n, Color(1, 0.2, 0.1), 3.0, 5.0)
	elif phase == 1:
		var from := hand_pos(caster)
		var to := target.global_position + Vector3.UP * 1.1
		var n := _root(world, from, 0.7)
		var orb := _sphere(n, 0.35, Color(1.0, 0.1, 0.05), 4.0)
		var l := _light(n, Color(1, 0.15, 0.1), 5.0, 8.0)
		var tw := n.create_tween()
		tw.tween_property(n, "global_position", to, 0.16).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
		tw.tween_callback(func() -> void: _shockwave(world, to, Color(1.0, 0.15, 0.1), 5.0))
		tw.tween_property(orb, "scale", Vector3.ONE * 6.0, 0.18)
		tw.parallel().tween_property(orb.material_override, "albedo_color:a", 0.0, 0.25)
		tw.parallel().tween_property(l, "light_energy", 0.0, 0.3)

## Hollow Purple — Blue on one side, Red on the other, they collide into a purple mass that tears forward through everything.
static func gojo_purple(world: Node3D, caster: Node3D, target: Node3D, phase: int, power := 1.0) -> void:
	var fwd := -caster.global_transform.basis.z
	var side := fwd.cross(Vector3.UP).normalized()
	var center := caster.global_position + Vector3.UP * 1.5 + fwd * 1.0
	if phase == 0:
		var n := _root(world, center, 0.62)
		var blue := _sphere(n, 0.35, Color(0.15, 0.4, 1.0), 4.0)
		var red := _sphere(n, 0.35, Color(1.0, 0.12, 0.08), 4.0)
		blue.position = -side * 1.4
		red.position = side * 1.4
		_light(n, Color(0.6, 0.3, 1.0), 4.0, 9.0)
		var tw := n.create_tween().set_parallel(true)
		tw.tween_property(blue, "position", Vector3.ZERO, 0.58).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.tween_property(red, "position", Vector3.ZERO, 0.58).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	elif phase == 1:
		var n := _root(world, center, 1.4)
		var orb := _sphere(n, 1.1 * power, Color(0.6, 0.15, 1.0), 3.5)
		var core := _sphere(n, 0.6 * power, Color(1.0, 0.9, 1.0), 4.0)
		var l := _light(n, Color(0.6, 0.2, 1.0), 8.0, 16.0)
		var end := center + fwd * 40.0
		var tw := n.create_tween()
		tw.tween_property(orb, "scale", Vector3.ONE * 1.8, 0.1).from(Vector3.ONE * 0.3)
		tw.tween_property(n, "global_position", end, 0.7).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.parallel().tween_property(l, "light_energy", 2.0, 0.7)
		tw.tween_property(orb.material_override, "albedo_color:a", 0.0, 0.3)
		tw.parallel().tween_property(core.material_override, "albedo_color:a", 0.0, 0.3)
		_trench(world, caster.global_position + fwd * 1.5, fwd, 30.0, Color(0.55, 0.2, 1.0))
		if target != null:
			_shockwave(world, target.global_position + Vector3.UP * 1.0, Color(0.7, 0.3, 1.0), 9.0)

## Dismantle — invisible blades: bright slash lines across the target, a flash, then they fade.
static func sukuna_dismantle(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, hand_pos(caster), 0.3)
		var b := _billboard(n, 0.9, Color(1.0, 0.3, 0.25), DestructionVfx.spark_texture())
		n.create_tween().tween_property(b, "scale", Vector3.ONE * 0.2, 0.25).from(Vector3.ONE)
	elif phase == 1 and target != null:
		slash_burst(world, target.global_position + Vector3.UP * 1.1, 5, 3.0)

## A burst of crossing slash lines centred on `at` (also used by the shrine domain).
static func slash_burst(world: Node3D, at: Vector3, count: int, length: float) -> void:
	var n := _root(world, at, 0.5)
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	for i in count:
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(length, 0.05)
		mi.mesh = q
		var m := glow_mat(Color(1.0, 0.92, 0.9), 3.0)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.add_child(mi)
		mi.position = Vector3(rng.randf_range(-0.4, 0.4), rng.randf_range(-0.6, 0.6), rng.randf_range(-0.4, 0.4))
		mi.rotation = Vector3(rng.randf_range(-1.2, 1.2), rng.randf() * TAU, rng.randf() * TAU)
		var tw := n.create_tween().set_parallel(true)
		var d := i * 0.035
		tw.tween_property(mi, "scale", Vector3(1.0, 1.0, 1.0), 0.06).from(Vector3(0.05, 1.0, 1.0)).set_delay(d)
		tw.tween_property(m, "albedo_color:a", 0.0, 0.22).set_delay(d + 0.08)
	var l := _light(n, Color(1.0, 0.4, 0.35), 3.0, 5.0)
	n.create_tween().tween_property(l, "light_energy", 0.0, 0.35)

## Fuga — "Open": a flame gathers in Sukuna's hands and becomes an arrow of fire that explodes on impact.
static func sukuna_fuga(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, hand_pos(caster), 0.62)
		var fire := FireFx.new()
		fire.radius = 0.5
		fire.burn_time = 1.0
		n.add_child(fire)
		var core := _sphere(n, 0.2, Color(1.0, 0.55, 0.1), 4.0)
		n.create_tween().tween_property(core, "scale", Vector3.ONE * 2.0, 0.55).from(Vector3.ONE * 0.3)
	elif phase == 1 and target != null:
		var from := hand_pos(caster)
		var to := target.global_position + Vector3.UP * 1.0
		var n := _root(world, from, 1.0)
		var arrow := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.0
		c.bottom_radius = 0.28
		c.height = 2.4
		arrow.mesh = c
		arrow.material_override = glow_mat(Color(1.0, 0.5, 0.1), 3.5)
		n.add_child(arrow)
		n.look_at(to, Vector3.UP)
		arrow.rotation.x = -PI / 2
		var trail := FireFx.new()
		trail.radius = 0.6
		trail.burn_time = 0.8
		n.add_child(trail)
		var l := _light(n, Color(1.0, 0.5, 0.15), 6.0, 10.0)
		var tw := n.create_tween()
		tw.tween_property(n, "global_position", to, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.tween_callback(func() -> void:
			_shockwave(world, to, Color(1.0, 0.45, 0.1), 8.0)
			var big := FireFx.new()
			big.radius = 2.6
			big.burn_time = 9.0
			world.add_child(big)
			big.global_position = Vector3(to.x, 0.3, to.z)
			arrow.visible = false)
		tw.tween_property(l, "light_energy", 0.0, 0.4)

## Expanding glowing ring + flash at `at`.
static func _shockwave(world: Node3D, at: Vector3, c: Color, size: float) -> void:
	var n := _root(world, at, 0.8)
	var ring := MeshInstance3D.new()
	var t := TorusMesh.new()
	t.inner_radius = 0.85
	t.outer_radius = 1.0
	t.rings = 24
	t.ring_segments = 6
	ring.mesh = t
	ring.material_override = glow_mat(c, 3.0)
	n.add_child(ring)
	var flash := _sphere(n, 0.8, c, 3.0)
	var l := _light(n, c, 8.0, size * 2.0)
	var tw := n.create_tween().set_parallel(true)
	tw.tween_property(ring, "scale", Vector3.ONE * size, 0.45).from(Vector3.ONE * 0.4).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	tw.tween_property(ring.material_override, "albedo_color:a", 0.0, 0.5)
	tw.tween_property(flash, "scale", Vector3.ONE * size * 0.4, 0.2).from(Vector3.ONE * 0.5)
	tw.tween_property(flash.material_override, "albedo_color:a", 0.0, 0.3)
	tw.tween_property(l, "light_energy", 0.0, 0.6)

## A glowing scar along the ground behind a beam.
static func _trench(world: Node3D, from: Vector3, dir: Vector3, length: float, c: Color) -> void:
	var n := _root(world, Vector3(from.x, 0.04, from.z), 4.0)
	var mi := MeshInstance3D.new()
	var q := PlaneMesh.new()
	q.size = Vector2(2.2, length)
	mi.mesh = q
	var m := glow_mat(c, 1.6)
	mi.material_override = m
	n.add_child(mi)
	n.look_at(n.global_position + Vector3(dir.x, 0, dir.z), Vector3.UP)
	mi.position = Vector3(0, 0, -length * 0.5)
	var tw := n.create_tween()
	tw.tween_property(mi, "scale", Vector3(1, 1, 1), 0.5).from(Vector3(1, 1, 0.02))
	tw.tween_interval(1.5)
	tw.tween_property(m, "albedo_color:a", 0.0, 2.0)

## Lapse: Blue — a point of negative space appears at the target and drags everything (dust, debris, the enemy) into it.
static func gojo_blue(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, hand_pos(caster), 0.3)
		var b := _sphere(n, 0.15, Color(0.2, 0.5, 1.0), 4.0)
		n.create_tween().tween_property(b, "scale", Vector3.ONE * 1.8, 0.25).from(Vector3.ONE * 0.3)
		_light(n, Color(0.3, 0.5, 1.0), 2.5, 4.0)
	elif phase == 1 and target != null:
		var at := target.global_position + Vector3.UP * 1.2
		var n := _root(world, at, 1.3)
		var orb := _sphere(n, 0.5, Color(0.15, 0.4, 1.0), 4.0)
		var ring := _billboard(n, 5.0, Color(0.3, 0.55, 1.0), DestructionVfx.spark_texture())
		var p := GPUParticles3D.new()
		p.amount = 40
		p.lifetime = 0.6
		p.local_coords = true
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE_SURFACE
		pm.emission_sphere_radius = 3.5
		pm.radial_accel_min = -30.0
		pm.radial_accel_max = -20.0
		pm.gravity = Vector3.ZERO
		pm.scale_min = 0.08
		pm.scale_max = 0.2
		p.process_material = pm
		var q := QuadMesh.new()
		var qm := glow_mat(Color(0.5, 0.75, 1.0), 2.5)
		qm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		qm.albedo_texture = DestructionVfx.spark_texture()
		q.material = qm
		p.draw_pass_1 = q
		n.add_child(p)
		var l := _light(n, Color(0.3, 0.5, 1.0), 6.0, 10.0)
		var tw := n.create_tween().set_parallel(true)
		tw.tween_property(ring, "scale", Vector3.ONE * 0.1, 0.9).from(Vector3.ONE * 1.2)
		tw.tween_property(orb, "scale", Vector3.ONE * 2.2, 0.5).from(Vector3.ONE * 0.4)
		tw.chain().tween_property(orb, "scale", Vector3.ONE * 0.05, 0.25)
		tw.tween_property(l, "light_energy", 0.0, 1.2)

## Cleave — a single cut that adapts to the target's toughness: a tight net of slashes on the body and a spray of red.
static func sukuna_cleave(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, hand_pos(caster), 0.25)
		var b := _billboard(n, 0.7, Color(1.0, 0.25, 0.2), DestructionVfx.spark_texture())
		n.create_tween().tween_property(b, "scale", Vector3.ONE * 1.6, 0.18).from(Vector3.ONE * 0.4)
	elif phase == 1 and target != null:
		var at := target.global_position + Vector3.UP * 1.1
		slash_burst(world, at, 9, 1.5)
		var n := _root(world, at, 1.0)
		var p := GPUParticles3D.new()
		p.amount = 36
		p.lifetime = 0.7
		p.one_shot = true
		p.explosiveness = 0.95
		var pm := ParticleProcessMaterial.new()
		pm.direction = Vector3.UP
		pm.spread = 80.0
		pm.initial_velocity_min = 2.0
		pm.initial_velocity_max = 6.0
		pm.gravity = Vector3(0, -12, 0)
		pm.scale_min = 0.04
		pm.scale_max = 0.1
		pm.color = Color(0.6, 0.02, 0.02)
		p.process_material = pm
		var sm := SphereMesh.new()
		sm.radius = 0.5
		sm.height = 1.0
		var mm := StandardMaterial3D.new()
		mm.albedo_color = Color(0.55, 0.02, 0.02)
		mm.vertex_color_use_as_albedo = true
		sm.material = mm
		p.draw_pass_1 = sm
		n.add_child(p)
		p.emitting = true

## World-Cutting Slash — the slash that cuts space itself: a white plane through the whole world along Sukuna's aim.
static func sukuna_world_slash(world: Node3D, caster: Node3D, target: Node3D, phase: int) -> void:
	if phase == 0:
		var n := _root(world, caster.global_position + Vector3.UP * 1.3, 1.2)
		var b := _billboard(n, 3.0, Color(1.0, 0.9, 0.9), DestructionVfx.spark_texture())
		var tw := n.create_tween()
		tw.tween_property(b, "scale", Vector3.ONE * 0.2, 1.1).from(Vector3.ONE * 1.5)
		_light(n, Color(1, 0.9, 0.9), 3.0, 6.0)
	elif phase == 1:
		var fwd := -caster.global_transform.basis.z
		var n := _root(world, caster.global_position + fwd * 30.0 + Vector3.UP * 4.0, 2.2)
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(90.0, 0.12)
		mi.mesh = q
		var m := glow_mat(Color(1.0, 0.97, 0.97), 2.2)
		mi.material_override = m
		n.add_child(mi)
		n.look_at(n.global_position + fwd.cross(Vector3.UP), Vector3.UP)
		mi.rotation.z = -0.35
		var tw := n.create_tween()
		tw.tween_property(mi, "scale", Vector3(1, 2.5, 1), 0.08).from(Vector3(0.02, 1, 1))
		tw.tween_property(m, "albedo_color:a", 0.0, 1.5)
		_trench(world, caster.global_position + fwd * 1.0, fwd, 60.0, Color(1.0, 0.9, 0.9))
		if target != null:
			slash_burst(world, target.global_position + Vector3.UP * 1.0, 12, 4.0)
			_shockwave(world, target.global_position + Vector3.UP, Color(1, 0.9, 0.9), 10.0)
