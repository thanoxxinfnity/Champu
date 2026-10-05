extends Node
## Particles in one call: pickup bursts, dust, confetti. CPU particles, so they work on every phone.
## Autoload name: Fx


func _glow(color: Color, size: float) -> Mesh:
	var mesh := SphereMesh.new()
	mesh.radius = size
	mesh.height = size * 2.0
	mesh.radial_segments = 6
	mesh.rings = 3
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color
	mat.emission_energy_multiplier = 2.5
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.material = mat
	return mesh


## A one-shot burst of sparks at a world position. Frees itself.
func burst(parent: Node, position: Vector3, color: Color = Color("#ffd24a"), amount: int = 18, speed: float = 5.0, size: float = 0.09) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = amount
	p.lifetime = 0.7
	p.explosiveness = 1.0
	p.direction = Vector3.UP
	p.spread = 180.0
	p.gravity = Vector3(0, -9.0, 0)
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	p.mesh = _glow(color, size)
	p.position = position
	parent.add_child(p)
	p.emitting = true
	get_tree().create_timer(1.2).timeout.connect(p.queue_free)


## A continuous dust or smoke trail. Parent it to the thing that makes it; returns the emitter so you can set `emitting`.
func dust(parent: Node3D, color: Color = Color(0.85, 0.8, 0.7, 0.55), position: Vector3 = Vector3.ZERO) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = 28
	p.lifetime = 0.9
	p.direction = Vector3(0, 1, 0.4)
	p.spread = 35.0
	p.gravity = Vector3(0, 0.6, 0)
	p.initial_velocity_min = 0.6
	p.initial_velocity_max = 1.6
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.4
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(1, 1.6))
	p.scale_amount_curve = curve
	var sphere := SphereMesh.new()
	sphere.radius = 0.18
	sphere.height = 0.36
	sphere.radial_segments = 6
	sphere.rings = 3
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sphere.material = mat
	p.mesh = sphere
	p.position = position
	p.emitting = false
	parent.add_child(p)
	return p


## Confetti falling from the top of the screen. `ui_parent` is a CanvasLayer or Control.
func confetti(ui_parent: Node) -> void:
	var size := ui_parent.get_viewport().get_visible_rect().size
	var p := CPUParticles2D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = 90
	p.lifetime = 2.6
	p.explosiveness = 0.85
	p.position = Vector2(size.x * 0.5, -20.0)
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	p.emission_rect_extents = Vector2(size.x * 0.5, 4.0)
	p.direction = Vector2(0, 1)
	p.spread = 25.0
	p.gravity = Vector2(0, 520)
	p.initial_velocity_min = 120.0
	p.initial_velocity_max = 380.0
	p.angular_velocity_min = -260.0
	p.angular_velocity_max = 260.0
	p.scale_amount_min = 6.0
	p.scale_amount_max = 14.0
	var ramp := Gradient.new()
	ramp.set_color(0, Color("#ff9a3c"))
	ramp.add_point(0.33, Color("#ffd24a"))
	ramp.add_point(0.66, Color("#4ad0ff"))
	ramp.set_color(ramp.get_point_count() - 1, Color("#ff5a8a"))
	p.color_initial_ramp = ramp
	ui_parent.add_child(p)
	p.emitting = true
	get_tree().create_timer(3.4).timeout.connect(p.queue_free)
