class_name BuildingCollapse
extends RefCounted
## A tower comes down: it shakes, tilts and sinks into its own footprint while chunks of concrete break off and tumble to the street, a dust
## cloud rolls out at the base, and when it is gone a real mound of rubble is left (slabs, blocks, bent rebar, smaller debris) with a fire on
## it that later burns down to ash. Works on any Node3D that stores its "height" meta (ArenaBuilder.prop, WorldMap buildings).

const CONCRETE := [Color(0.42, 0.41, 0.4), Color(0.32, 0.31, 0.3), Color(0.5, 0.48, 0.45), Color(0.18, 0.17, 0.16)]

static func _mats() -> Array:
	var out := []
	for c in CONCRETE:
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 1.0
		out.append(m)
	return out

static func _footprint(building: Node3D) -> float:
	if building.has_meta("width"):
		return building.get_meta("width")
	var b := ArenaBuilder._aabb(building)
	return clampf(maxf(b.size.x, b.size.z), 6.0, 40.0)

static func run(building: Node3D, dm: DestructionManager, parent: Node3D, fire_scale := 1.0, rng := RandomNumberGenerator.new()) -> void:
	if building == null or not building.is_inside_tree() or building.has_meta("collapsed"):
		return
	building.set_meta("collapsed", true)
	if building.has_meta("materialize"):
		(building.get_meta("materialize") as Callable).call()     # swap the batched copy for a real node so it can fall
	var h: float = building.get_meta("height", 20.0)
	var w := _footprint(building)
	var base := building.global_position
	var mats := _mats()
	# an invisible floor under the falling chunks so they pile up on the street, removed after the dust settles
	var floor_body := StaticBody3D.new()
	var fs := CollisionShape3D.new()
	fs.shape = WorldBoundaryShape3D.new()
	floor_body.add_child(fs)
	floor_body.collision_layer = 4
	parent.add_child(floor_body)
	floor_body.global_position = base
	var axis := Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)).normalized()
	var tw := building.create_tween()
	for i in 8:
		var j := Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)) * 0.25
		tw.tween_property(building, "position", building.position + j, 0.06)
		tw.tween_property(building, "position", building.position, 0.06)
	tw.tween_callback(func() -> void:
		if dm != null:
			dm.blast(base + Vector3.UP * h * 0.5, 4.0, 0.8))
	tw.set_parallel(true)
	tw.tween_property(building, "position:y", building.position.y - h * 0.95, 2.6).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(building, "rotation:z", building.rotation.z + axis.x * 0.35, 2.6).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(building, "rotation:x", building.rotation.x + axis.z * 0.35, 2.6).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(func() -> void:
		building.visible = false
		if dm != null:
			dm.blast(base, 8.0, 1.2)
		_leave_ruin(parent, base, w, fire_scale, rng, mats))
	# chunks breaking off the falling tower and dust bursts along the way
	var tree := building.get_tree()
	for k in 12:
		var t := tree.create_timer(0.5 + k * 0.2)
		t.timeout.connect(func() -> void:
			if not is_instance_valid(building) or not is_instance_valid(parent):
				return
			var top := building.global_position.y + h
			for c in 2:
				_chunk(parent, base + Vector3(rng.randf_range(-w, w) * 0.5, clampf(top - rng.randf_range(0.0, h * 0.4), 1.0, 999.0), rng.randf_range(-w, w) * 0.5), w, rng, mats)
			if dm != null and k % 3 == 0:
				dm.blast(base + Vector3(rng.randf_range(-w, w) * 0.4, rng.randf_range(0, h * 0.3), rng.randf_range(-w, w) * 0.4), 3.0, 0.5))
	_dust_cloud(parent, base, w)
	tree.create_timer(14.0).timeout.connect(func() -> void:
		if is_instance_valid(floor_body):
			floor_body.queue_free())

## One concrete chunk that breaks off and falls (a real rigid body; it settles on the street and freezes later to save CPU).
static func _chunk(parent: Node3D, at: Vector3, w: float, rng: RandomNumberGenerator, mats: Array) -> void:
	var b := RigidBody3D.new()
	b.collision_layer = 2
	b.collision_mask = 4 | 2
	var size := Vector3(rng.randf_range(0.8, 2.4), rng.randf_range(0.5, 1.6), rng.randf_range(0.8, 2.4)) * clampf(w / 14.0, 0.6, 1.6)
	b.mass = size.x * size.y * size.z * 4.0
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mats[rng.randi() % mats.size()]
	b.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	b.add_child(cs)
	parent.add_child(b)
	b.global_position = at
	b.rotation = Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU)
	b.linear_velocity = Vector3(rng.randf_range(-6, 6), rng.randf_range(-2, 3), rng.randf_range(-6, 6))
	b.angular_velocity = Vector3(rng.randf_range(-4, 4), rng.randf_range(-4, 4), rng.randf_range(-4, 4))
	parent.get_tree().create_timer(9.0).timeout.connect(func() -> void:
		if is_instance_valid(b):
			b.freeze = true)

## Thick grey dust rolling out from the base for several seconds.
static func _dust_cloud(parent: Node3D, at: Vector3, w: float) -> void:
	var p := GPUParticles3D.new()
	p.amount = 60
	p.lifetime = 5.0
	p.local_coords = false
	p.visibility_aabb = AABB(Vector3(-w * 2, -2, -w * 2), Vector3(w * 4, w * 2, w * 4))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(w * 0.5, 1.0, w * 0.5)
	pm.direction = Vector3.UP
	pm.spread = 80.0
	pm.initial_velocity_min = 2.0
	pm.initial_velocity_max = 6.0
	pm.radial_accel_min = 1.0
	pm.radial_accel_max = 3.0
	pm.gravity = Vector3(0, 0.4, 0)
	pm.damping_min = 0.6
	pm.damping_max = 1.2
	pm.scale_min = w * 0.25
	pm.scale_max = w * 0.5
	var g := Gradient.new()
	g.set_color(0, Color(0.55, 0.52, 0.48, 0.0))
	g.add_point(0.15, Color(0.6, 0.57, 0.52, 0.9))
	g.set_color(g.get_point_count() - 1, Color(0.5, 0.48, 0.45, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	p.process_material = pm
	var q := QuadMesh.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = DestructionVfx.dust_texture()
	q.material = m
	p.draw_pass_1 = q
	parent.add_child(p)
	p.global_position = at + Vector3.UP * 1.0
	p.emitting = true
	parent.get_tree().create_timer(3.2).timeout.connect(func() -> void:
		if is_instance_valid(p):
			p.emitting = false)
	parent.get_tree().create_timer(9.0).timeout.connect(func() -> void:
		if is_instance_valid(p):
			p.queue_free())

## The mound left behind: a pile of blocks rising to the middle, a few tilted floor slabs, bent rebar poking out, and a fire on top.
static func _leave_ruin(parent: Node3D, at: Vector3, w: float, fire_scale: float, rng: RandomNumberGenerator, mats: Array) -> void:
	var root := Node3D.new()
	root.name = "Rubble"
	parent.add_child(root)
	root.global_position = at
	var n := 34
	for i in n:
		var r := sqrt(rng.randf()) * w * 0.55
		var a := rng.randf() * TAU
		var hmax := (1.0 - r / (w * 0.6)) * w * 0.28 + 0.6
		var m := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(rng.randf_range(1.0, 3.6), rng.randf_range(0.5, 1.8), rng.randf_range(1.0, 3.6)) * clampf(w / 16.0, 0.6, 1.6)
		m.mesh = b
		m.material_override = mats[rng.randi() % mats.size()]
		m.position = Vector3(cos(a) * r, rng.randf_range(0.2, hmax), sin(a) * r)
		m.rotation = Vector3(rng.randf_range(-0.6, 0.6), rng.randf() * TAU, rng.randf_range(-0.6, 0.6))
		root.add_child(m)
	for i in 5:
		var slab := MeshInstance3D.new()
		var sb := BoxMesh.new()
		sb.size = Vector3(w * rng.randf_range(0.35, 0.6), 0.35, w * rng.randf_range(0.25, 0.4))
		slab.mesh = sb
		slab.material_override = mats[i % 3]
		var a2 := rng.randf() * TAU
		slab.position = Vector3(cos(a2), 0, sin(a2)) * w * 0.25 + Vector3(0, rng.randf_range(0.8, w * 0.18), 0)
		slab.rotation = Vector3(rng.randf_range(-0.7, 0.7), rng.randf() * TAU, rng.randf_range(-0.7, 0.7))
		root.add_child(slab)
	var rebar_mat := StandardMaterial3D.new()
	rebar_mat.albedo_color = Color(0.25, 0.14, 0.08)
	rebar_mat.metallic = 0.6
	for i in 10:
		var rb := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.04
		cm.bottom_radius = 0.04
		cm.height = rng.randf_range(1.5, 3.5)
		cm.radial_segments = 4
		rb.mesh = cm
		rb.material_override = rebar_mat
		var a3 := rng.randf() * TAU
		rb.position = Vector3(cos(a3), 0, sin(a3)) * rng.randf_range(0.0, w * 0.4) + Vector3(0, w * 0.15, 0)
		rb.rotation = Vector3(rng.randf_range(-1.0, 1.0), 0, rng.randf_range(-1.0, 1.0))
		root.add_child(rb)
	var fire := FireFx.new()
	fire.radius = clampf(w * 0.2, 2.0, 5.0) * fire_scale
	fire.burn_time = 18.0
	fire.intensity = fire_scale
	root.add_child(fire)
	fire.position = Vector3(0, w * 0.18, 0)
