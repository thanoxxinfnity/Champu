class_name Flare
extends Node3D
## A thrown road flare: arcs, lands, burns red for half a minute, pulls nearby enemies toward it and can light the barricade.

var game: Game
var velocity := Vector3.ZERO
var landed := false
var burn := 30.0
var _light: OmniLight3D
var _t := 0.0
var _pulse := 0.0
var _mi: MeshInstance3D
var _particles: CPUParticles3D


func _ready() -> void:
	_mi = MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.025
	cm.bottom_radius = 0.025
	cm.height = 0.3
	_mi.mesh = cm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(1.0, 0.3, 0.25)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.25, 0.2)
	m.emission_energy_multiplier = 3.0
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mi.material_override = m
	add_child(_mi)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.25, 0.2)
	_light.light_energy = 3.0
	_light.omni_range = 11.0
	_light.shadow_enabled = false
	add_child(_light)
	_particles = CPUParticles3D.new()
	_particles.amount = 14
	_particles.lifetime = 0.9
	_particles.direction = Vector3.UP
	_particles.spread = 25.0
	_particles.initial_velocity_min = 0.6
	_particles.initial_velocity_max = 1.6
	_particles.gravity = Vector3(0, 0.5, 0)
	var sm := SphereMesh.new()
	sm.radius = 0.05
	sm.height = 0.1
	sm.radial_segments = 6
	sm.rings = 3
	sm.material = m
	_particles.mesh = sm
	_particles.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_particles)
	add_to_group("flares")
	game.noise(global_position, 12.0)


func _physics_process(delta: float) -> void:
	_t += delta
	if not landed:
		velocity.y -= 19.0 * delta
		var next := global_position + velocity * delta
		if next.y <= 0.08:
			next.y = 0.08
			landed = true
			_mi.rotation = Vector3(0, 0, PI * 0.5)
			game.sfx.play_at("clank", global_position, -8.0, 1.6)
		global_position = next
		_mi.rotation.x += delta * 14.0
	else:
		burn -= delta
		_pulse -= delta
		if _pulse <= 0.0:
			_pulse = 0.6
			for e in get_tree().get_nodes_in_group("enemies"):
				var en := e as Enemy
				if en.global_position.distance_to(global_position) < 12.0:
					en.distract(global_position)
		_light.light_energy = 2.6 + sin(_t * 31.0) * 0.5 + sin(_t * 17.0) * 0.4
		if burn < 4.0:
			_light.light_energy *= burn / 4.0
		if burn <= 0.0:
			remove_from_group("flares")
			queue_free()
