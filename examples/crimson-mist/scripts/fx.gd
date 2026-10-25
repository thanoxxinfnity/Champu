class_name Fx
extends Node3D
## Short-lived effects: muzzle flash, tracers, blood, sparks, explosions.
## Everything frees itself, and nothing here is shared state.

var _tracer_mat: StandardMaterial3D
var _blood_mat: StandardMaterial3D
var _spark_mat: StandardMaterial3D
var _fire_mat: StandardMaterial3D
var _decals := 0


func _ready() -> void:
	_tracer_mat = _emissive(Color(1.0, 0.85, 0.5), 3.0)
	_spark_mat = _emissive(Color(1.0, 0.7, 0.25), 3.0)
	_fire_mat = _emissive(Color(1.0, 0.45, 0.1), 3.5)
	_blood_mat = StandardMaterial3D.new()
	_blood_mat.albedo_color = Color(0.38, 0.02, 0.02)
	_blood_mat.roughness = 0.3


func _emissive(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return m


func muzzle(pos: Vector3, scale_up := 1.0) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.75, 0.4)
	l.light_energy = 3.5 * scale_up
	l.omni_range = 9.0
	l.shadow_enabled = false
	add_child(l)
	l.global_position = pos
	get_tree().create_timer(0.05).timeout.connect(l.queue_free)
	_burst(pos, Vector3.ZERO, 5, 0.12, 3.5, 0.012, _spark_mat, 180.0, 0.0)


func tracer(from: Vector3, to: Vector3) -> void:
	var d := to - from
	var len := d.length()
	if len < 1.0:
		return
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.012, 0.012, minf(len, 4.0))
	mi.mesh = bm
	mi.material_override = _tracer_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# A short streak that runs from the muzzle to the impact in a few frames.
	var dir := d / len
	mi.global_position = from + dir * 1.5
	if absf(dir.y) < 0.99:
		mi.look_at(to, Vector3.UP)
	var tw := create_tween()
	tw.tween_property(mi, "global_position", to - dir * 0.5, minf(0.07, len / 400.0 + 0.02))
	tw.tween_callback(mi.queue_free)


func blood(pos: Vector3, dir: Vector3, big := false) -> void:
	_burst(pos, -dir, 22 if big else 9, 0.55, 3.2 if big else 2.2, 0.03, _blood_mat, 60.0, 1.0)


func spark(pos: Vector3, normal: Vector3) -> void:
	_burst(pos + normal * 0.03, normal, 6, 0.25, 3.0, 0.012, _spark_mat, 50.0, 0.5)


func explosion(pos: Vector3, radius: float) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.55, 0.2)
	l.light_energy = 8.0
	l.omni_range = radius * 3.0
	add_child(l)
	l.global_position = pos + Vector3(0, 1, 0)
	var tw := create_tween()
	tw.tween_property(l, "light_energy", 0.0, 0.6)
	tw.tween_callback(l.queue_free)
	_burst(pos + Vector3(0, 0.8, 0), Vector3.UP, 36, 0.8, radius * 1.6, 0.18, _fire_mat, 180.0, 0.4)
	_burst(pos + Vector3(0, 0.5, 0), Vector3.UP, 20, 0.9, radius, 0.12, _blood_mat, 180.0, 1.5)


func _burst(pos: Vector3, dir: Vector3, count: int, life: float, speed: float, size: float, mat: Material, spread: float, gravity: float) -> void:
	var p := CPUParticles3D.new()
	p.emitting = false
	p.one_shot = true
	p.amount = count
	p.lifetime = life
	p.explosiveness = 1.0
	p.direction = dir if dir != Vector3.ZERO else Vector3.UP
	p.spread = spread
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.gravity = Vector3(0, -9.8 * gravity, 0)
	var sm := SphereMesh.new()
	sm.radius = size
	sm.height = size * 2.0
	sm.radial_segments = 6
	sm.rings = 3
	sm.material = mat
	p.mesh = sm
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	p.global_position = pos
	p.emitting = true
	get_tree().create_timer(life + 0.3).timeout.connect(p.queue_free)


## A dark splat on the ground where something died.
func splat(pos: Vector3, size: float) -> void:
	if _decals > 40:
		return
	_decals += 1
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(size, size)
	mi.mesh = pm
	mi.material_override = _blood_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	mi.global_position = Vector3(pos.x, 0.025, pos.z)
	mi.rotation = Vector3(0.0, randf() * TAU, 0.0)
