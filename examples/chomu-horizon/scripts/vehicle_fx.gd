class_name VehicleFX
extends Node3D
## Tyre smoke, skid marks and nitro flames for one VehicleController.
##
## Smoke and skid marks live in world space (this node sits at the world
## root, not under the car) so a drift leaves its trail behind instead of
## dragging it along. Skid marks are one MultiMesh ring buffer: a thousand
## segments cost a single draw call.

const SKID_CAPACITY := 900
const SKID_Y := 0.03

var vehicle: VehicleController
var _smoke: Array[CPUParticles3D] = []
var _last_mark: Array = [null, null]
var _skid_mm: MultiMesh
var _skid_next := 0
var _flames: Array[CPUParticles3D] = []
var _flame_light: OmniLight3D

static var _soft_tex: GradientTexture2D


func setup(v: VehicleController) -> void:
	vehicle = v
	_build_skids()
	for i in 2:
		var p := _make_smoke()
		add_child(p)
		_smoke.append(p)
	_build_flames()


static func _soft() -> GradientTexture2D:
	if _soft_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		g.add_point(0.45, Color(1, 1, 1, 0.55))
		g.interpolation_mode = Gradient.GRADIENT_INTERPOLATE_CUBIC
		_soft_tex = GradientTexture2D.new()
		_soft_tex.gradient = g
		_soft_tex.fill = GradientTexture2D.FILL_RADIAL
		_soft_tex.fill_from = Vector2(0.5, 0.5)
		_soft_tex.fill_to = Vector2(1.0, 0.5)
		_soft_tex.width = 64
		_soft_tex.height = 64
	return _soft_tex


func _make_smoke() -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = 42
	p.lifetime = 1.7
	p.emitting = false
	p.local_coords = false
	p.direction = Vector3(0, 1, 0)
	p.spread = 70.0
	p.initial_velocity_min = 0.8
	p.initial_velocity_max = 2.6
	p.gravity = Vector3(0, 0.7, 0)
	p.damping_min = 1.2
	p.damping_max = 2.0
	p.angle_max = 180.0
	var scale_curve := Curve.new()
	scale_curve.add_point(Vector2(0, 0.35))
	scale_curve.add_point(Vector2(1, 1.0))
	p.scale_amount_min = 1.6
	p.scale_amount_max = 2.6
	p.scale_amount_curve = scale_curve
	var ramp := Gradient.new()
	ramp.set_color(0, Color(0.92, 0.92, 0.94, 0.38))
	ramp.set_color(1, Color(0.85, 0.85, 0.88, 0.0))
	p.color_ramp = ramp
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = _soft()
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	quad.material = mat
	p.mesh = quad
	return p


func _build_skids() -> void:
	_skid_mm = MultiMesh.new()
	_skid_mm.transform_format = MultiMesh.TRANSFORM_3D
	var pm := PlaneMesh.new()
	pm.size = Vector2(1, 1)
	_skid_mm.mesh = pm
	_skid_mm.instance_count = SKID_CAPACITY
	var zero := Transform3D(Basis.from_scale(Vector3(0.0001, 1, 0.0001)), Vector3(0, -50, 0))
	for i in SKID_CAPACITY:
		_skid_mm.set_instance_transform(i, zero)
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "SkidMarks"
	mmi.multimesh = _skid_mm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.02, 0.02, 0.02, 0.55)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.roughness = 1.0
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Skid marks share one huge MultiMesh whose AABB would otherwise be
	# computed from wherever the first marks happened to land.
	mmi.custom_aabb = AABB(Vector3(-2000, -10, -2000), Vector3(4000, 20, 4000))
	add_child(mmi)


func _add_mark(a: Vector3, b: Vector3, width: float) -> void:
	var seg := b - a
	seg.y = 0.0
	var length := seg.length()
	if length < 0.05:
		return
	var z := seg / length
	var x := Vector3.UP.cross(z).normalized()
	var basis := Basis(x * width, Vector3.UP, z * (length + 0.04))
	var mid := (a + b) * 0.5
	mid.y = SKID_Y
	_skid_mm.set_instance_transform(_skid_next, Transform3D(basis, mid))
	_skid_next = (_skid_next + 1) % SKID_CAPACITY


func _build_flames() -> void:
	var zmin: float = vehicle.car.body[0][0]
	var ramp := Gradient.new()
	ramp.set_color(0, Color(0.5, 0.75, 1.0, 1.0))
	ramp.add_point(0.35, Color(1.0, 0.55, 0.15, 0.9))
	ramp.set_color(ramp.get_point_count() - 1, Color(1.0, 0.25, 0.05, 0.0))
	for sx in [-0.35, 0.35]:
		var p := CPUParticles3D.new()
		p.amount = 24
		p.lifetime = 0.16
		p.emitting = false
		p.local_coords = true
		p.position = Vector3(sx, 0.36, zmin - 0.08)
		p.direction = Vector3(0, 0, -1)
		p.spread = 8.0
		p.initial_velocity_min = 7.0
		p.initial_velocity_max = 10.0
		p.gravity = Vector3.ZERO
		p.scale_amount_min = 0.35
		p.scale_amount_max = 0.55
		var sc := Curve.new()
		sc.add_point(Vector2(0, 1))
		sc.add_point(Vector2(1, 0.2))
		p.scale_amount_curve = sc
		p.color_ramp = ramp
		var quad := QuadMesh.new()
		quad.size = Vector2(0.5, 0.5)
		var mat := StandardMaterial3D.new()
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		mat.vertex_color_use_as_albedo = true
		mat.albedo_texture = _soft()
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		quad.material = mat
		p.mesh = quad
		vehicle.add_child(p)
		_flames.append(p)
	_flame_light = OmniLight3D.new()
	_flame_light.position = Vector3(0, 0.5, zmin - 0.6)
	_flame_light.light_color = Color(1.0, 0.5, 0.2)
	_flame_light.omni_range = 4.0
	_flame_light.light_energy = 0.0
	vehicle.add_child(_flame_light)


func _process(_delta: float) -> void:
	if vehicle == null or not is_instance_valid(vehicle):
		return
	var slides := vehicle.rear_wheel_slides()
	for i in 2:
		var contact: Vector3 = slides[i][0]
		var slide: float = slides[i][1]
		var active := slide > 0.4 and vehicle.speed_kmh > 12.0
		_smoke[i].global_position = contact + Vector3.UP * 0.45
		_smoke[i].emitting = active and slide > 0.55
		if active:
			if _last_mark[i] != null:
				var prev: Vector3 = _last_mark[i]
				if prev.distance_to(contact) > 0.35:
					_add_mark(prev, contact, vehicle.car.wheel_width_rear * 0.9)
					_last_mark[i] = contact
			else:
				_last_mark[i] = contact
		else:
			_last_mark[i] = null
	var n := vehicle.nitro_active
	for f in _flames:
		f.emitting = n
	_flame_light.light_energy = randf_range(1.5, 3.0) if n else 0.0


func clear() -> void:
	var zero := Transform3D(Basis.from_scale(Vector3(0.0001, 1, 0.0001)), Vector3(0, -50, 0))
	for i in SKID_CAPACITY:
		_skid_mm.set_instance_transform(i, zero)
	_last_mark = [null, null]
