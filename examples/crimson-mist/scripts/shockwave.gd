class_name Shockwave
extends Node3D
## The Bellkeeper's toll: a ring that races outward along the ground. Jump-dodge (roll) through it or take the hit.

var game: Game
var radius := 0.6
var speed := 11.0
var max_radius := 30.0
var damage := 22.0
var _hit := false
var _mi: MeshInstance3D


func _ready() -> void:
	_mi = MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.92
	tm.outer_radius = 1.0
	tm.rings = 32
	tm.ring_segments = 6
	_mi.mesh = tm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(1.0, 0.3, 0.4)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.25, 0.35)
	m.emission_energy_multiplier = 3.0
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mi.material_override = m
	_mi.position.y = 0.15
	_mi.scale = Vector3(radius, 1.0, radius)
	_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mi)


func _physics_process(delta: float) -> void:
	radius += speed * delta
	_mi.scale = Vector3(radius, 1.0, radius)
	var p := game.player
	if p != null and not _hit and not p.dead:
		var d := Vector2(p.global_position.x - global_position.x, p.global_position.z - global_position.z).length()
		if absf(d - radius) < 0.9 and p.iframes <= 0.0:
			_hit = true
			p.take_damage(damage, global_position)
			p.velocity += (p.global_position - global_position).normalized() * 3.0
	if radius > max_radius:
		queue_free()
