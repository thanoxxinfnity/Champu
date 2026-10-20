class_name BuildingCollapse
extends RefCounted
## A tower comes down: it shakes, tilts and sinks into its own footprint with dust on the way, then a mound of rubble is left with a fire burning
## on it that later dies down to ash. Works on any Node3D built by ArenaBuilder.prop (it reads the stored "height").

static func run(building: Node3D, dm: DestructionManager, parent: Node3D, fire_scale := 1.0, rng := RandomNumberGenerator.new()) -> void:
	if building == null or not building.is_inside_tree() or building.has_meta("collapsed"):
		return
	building.set_meta("collapsed", true)
	var h: float = building.get_meta("height", 20.0)
	var base := building.global_position
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
	tw.tween_property(building, "position:y", building.position.y - h * 0.9, 2.4).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(building, "rotation:z", building.rotation.z + axis.x * 0.35, 2.4).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(building, "rotation:x", building.rotation.x + axis.z * 0.35, 2.4).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(func() -> void:
		building.visible = false
		if dm != null:
			dm.blast(base, 8.0, 1.2)
		_leave_ruin(parent, base, fire_scale, rng))
	# dust along the way
	for k in 4:
		var timer := building.get_tree().create_timer(0.6 + k * 0.5)
		timer.timeout.connect(func() -> void:
			if dm != null and is_instance_valid(building):
				dm.blast(base + Vector3(rng.randf_range(-3, 3), rng.randf_range(0, h * 0.4), rng.randf_range(-3, 3)), 3.0, 0.4))

static func _leave_ruin(parent: Node3D, at: Vector3, fire_scale: float, rng: RandomNumberGenerator) -> void:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.22, 0.21, 0.2)
	mat.roughness = 1.0
	for i in 9:
		var m := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(rng.randf_range(1.0, 3.2), rng.randf_range(0.6, 1.8), rng.randf_range(1.0, 3.2))
		m.mesh = b
		m.material_override = mat
		m.position = at + Vector3(rng.randf_range(-4, 4), b.size.y * 0.4, rng.randf_range(-4, 4))
		m.rotation = Vector3(rng.randf_range(-0.4, 0.4), rng.randf() * TAU, rng.randf_range(-0.4, 0.4))
		parent.add_child(m)
	var fire := FireFx.new()
	fire.radius = 3.4 * fire_scale
	fire.burn_time = 16.0
	fire.intensity = fire_scale
	fire.position = at + Vector3(0, 0.8, 0)
	parent.add_child(fire)
