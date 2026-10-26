class_name Fx
extends Node3D
## Effects for a phone: no particle simulations. Impact shards are 96 tiny boxes in ONE multimesh integrated on the CPU for under a second; rings and beams are
## a few pooled flat meshes that grow and fade. Everything is created once and reused.

const N := 96
var _mm: MultiMesh
var _mmi: MultiMeshInstance3D
var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _life := PackedFloat32Array()
var _col := PackedColorArray()
var _next := 0
var _rings: Array[MeshInstance3D] = []
var _ring_t := PackedFloat32Array()
var _ring_r := PackedFloat32Array()
var _ring_i := 0
var _beams: Array[MeshInstance3D] = []
var _beam_t := PackedFloat32Array()
var _beam_i := 0
var level := 2                 # 0 = no effects (LOW), 1 = fewer, 2 = all


func _ready() -> void:
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_colors = true
	_mm.mesh = Mat.box_mesh(Vector3(0.14, 0.14, 0.14))
	_mm.instance_count = N
	_mmi = MultiMeshInstance3D.new()
	_mmi.multimesh = _mm
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mmi.material_override = m
	_mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mmi.extra_cull_margin = 4000.0
	add_child(_mmi)
	_pos.resize(N)
	_vel.resize(N)
	_life.resize(N)
	_col.resize(N)
	for i in N:
		_life[i] = 0.0
		_mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -500, 0)))
		_mm.set_instance_color(i, Color.WHITE)
	for i in 8:
		var r := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 1.0
		cm.bottom_radius = 1.0
		cm.height = 0.06
		cm.radial_segments = 20
		cm.rings = 1
		r.mesh = cm
		r.visible = false
		r.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(r)
		_rings.append(r)
	_ring_t.resize(8)
	_ring_r.resize(8)
	for i in 6:
		var b := MeshInstance3D.new()
		b.mesh = Mat.box_mesh(Vector3(1, 1, 1))
		b.visible = false
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(b)
		_beams.append(b)
	_beam_t.resize(6)


func shards(at: Vector3, c: Color, count := 10, speed := 6.0) -> void:
	if level == 0:
		return
	var n := count if level == 2 else maxi(2, count / 2)
	for k in n:
		var i := _next
		_next = (_next + 1) % N
		_pos[i] = at
		_vel[i] = Vector3(randf_range(-1, 1), randf_range(0.2, 1.4), randf_range(-1, 1)).normalized() * speed * randf_range(0.4, 1.0)
		_life[i] = randf_range(0.35, 0.8)
		_col[i] = c.lightened(randf_range(-0.2, 0.3))


func ring(at: Vector3, c: Color, radius := 3.0) -> void:
	if level == 0:
		return
	var i := _ring_i
	_ring_i = (_ring_i + 1) % _rings.size()
	var r := _rings[i]
	r.global_position = at
	r.material_override = Mat.unlit(c, 0.6)
	r.scale = Vector3(0.2, 1, 0.2)
	r.visible = true
	_ring_t[i] = 0.45
	_ring_r[i] = radius


func beam(a: Vector3, b: Vector3, c: Color, width := 0.18, dur := 0.18) -> void:
	if level == 0:
		return
	var i := _beam_i
	_beam_i = (_beam_i + 1) % _beams.size()
	var m := _beams[i]
	var d := b - a
	var len := d.length()
	if len < 0.01:
		return
	m.visible = true
	m.material_override = Mat.unlit(c, 0.85)
	m.global_transform = Transform3D(Basis.looking_at(d.normalized(), Vector3.UP if absf(d.normalized().y) < 0.95 else Vector3.RIGHT).scaled(Vector3(width, width, len)), (a + b) * 0.5)
	_beam_t[i] = dur


func _process(delta: float) -> void:
	var any := false
	for i in N:
		if _life[i] > 0.0:
			_life[i] -= delta
			_vel[i].y -= 14.0 * delta
			_pos[i] += _vel[i] * delta
			var s := clampf(_life[i] * 2.5, 0.0, 1.0)
			_mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ONE * s), _pos[i]))
			_mm.set_instance_color(i, _col[i])
			any = true
			if _life[i] <= 0.0:
				_mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -500, 0)))
	_mmi.visible = any
	for i in _rings.size():
		if _ring_t[i] > 0.0:
			_ring_t[i] -= delta
			var k := 1.0 - _ring_t[i] / 0.45
			var s2 := lerpf(0.2, _ring_r[i], clampf(k, 0.0, 1.0))
			_rings[i].scale = Vector3(s2, 1, s2)
			if _ring_t[i] <= 0.0:
				_rings[i].visible = false
	for i in _beams.size():
		if _beam_t[i] > 0.0:
			_beam_t[i] -= delta
			if _beam_t[i] <= 0.0:
				_beams[i].visible = false
