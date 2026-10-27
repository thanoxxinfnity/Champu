class_name Fx
extends Node3D
## Effects for a phone: no particle simulations. Impact shards are 96 tiny boxes in ONE multimesh integrated on the CPU for under a second; rings and beams are
## a few pooled flat meshes that grow and fade. Everything is created once and reused.

const N := 160
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
var _orbs: Array[MeshInstance3D] = []
var _orb_t := PackedFloat32Array()
var _orb_r := PackedFloat32Array()
var _orb_i := 0
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
	for i in 16:
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
	_ring_t.resize(16)
	_ring_r.resize(16)
	for i in 14:
		var b := MeshInstance3D.new()
		b.mesh = Mat.box_mesh(Vector3(1, 1, 1))
		b.visible = false
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(b)
		_beams.append(b)
	_beam_t.resize(14)
	for i in 10:                         # glow balls: muzzle flashes and impact flares
		var o := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.5
		sm.height = 1.0
		sm.radial_segments = 8
		sm.rings = 4
		o.mesh = sm
		o.visible = false
		o.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(o)
		_orbs.append(o)
	_orb_t.resize(10)
	_orb_r.resize(10)


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


## A glow ball that swells and fades in 0.25 s: muzzle flash, impact flare.
func flash(at: Vector3, c: Color, size := 1.0) -> void:
	if level == 0:
		return
	var i := _orb_i
	_orb_i = (_orb_i + 1) % _orbs.size()
	var o := _orbs[i]
	o.global_position = at
	o.material_override = Mat.unlit(c, 0.8)
	o.scale = Vector3.ONE * 0.2
	o.visible = true
	_orb_t[i] = 0.25
	_orb_r[i] = size


## A melee swing: a fan of short beams across the arc.
func slash(at: Vector3, dir: Vector3, c: Color, reach: float, half_deg: float) -> void:
	if level == 0:
		return
	var n := 5
	for k in n:
		var a := deg_to_rad(lerpf(-half_deg, half_deg, float(k) / float(n - 1)))
		var d := dir.rotated(Vector3.UP, a)
		beam(at + d * reach * 0.35, at + d * reach, c, 0.07 + 0.05 * (1.0 - absf(float(k) - 2.0) / 2.0), 0.14)
	flash(at + dir * reach * 0.7, c, 0.9)


func _process(delta: float) -> void:
	for i in _orbs.size():
		if _orb_t[i] > 0.0:
			_orb_t[i] -= delta
			var k := clampf(1.0 - _orb_t[i] / 0.25, 0.0, 1.0)
			_orbs[i].scale = Vector3.ONE * _orb_r[i] * lerpf(0.4, 1.4, k) * (1.0 - k * 0.5)
			if _orb_t[i] <= 0.0:
				_orbs[i].visible = false
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
