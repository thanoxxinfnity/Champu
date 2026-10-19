class_name Dismember
extends Node3D
## Cut a fighter into pieces (waist, forearms, shins) and join them again.
##
## Works on a character exported by tools/make_cuttable.py: its meshes are named cut_<piece>__<part> (pieces: upper, lower, foreL, foreR,
## shinL, shinR). Cutting a piece hides its meshes on the skinned character, spawns a rigid copy at the piece's current pose (so it keeps
## the motion it had) and sprays blood; `join_all()` restores everything. Blood is a pooled spark-style burst plus a ground splat, both
## tiny, so it costs almost nothing on a phone.

signal cut(piece: String, point: Vector3)
signal joined

const PIECES := ["upper", "lower", "foreL", "foreR", "shinL", "shinR"]
## which bone drives each piece, and where the cut is on that bone (bone-local origin = the bone head)
const DRIVER := {"upper": "spine", "lower": "hips", "foreL": "forearmL", "foreR": "forearmR", "shinL": "shinL", "shinR": "shinR"}
const BLOOD_COLOR := Color(0.55, 0.02, 0.04)

@export var skeleton: Skeleton3D
@export var blood_amount := 36
@export var piece_lifetime := 8.0

var cut_pieces := {}          # piece name -> RigidBody3D
var _blood: GPUParticles3D
var _splats: Array[MeshInstance3D] = []
var _splat_next := 0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()
	_blood = _make_blood()
	add_child(_blood)
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.orientation = PlaneMesh.FACE_Y
	for i in 4:
		var m := MeshInstance3D.new()
		m.mesh = quad
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(BLOOD_COLOR, 0.9)
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.roughness = 0.2
		m.material_override = mat
		m.visible = false
		add_child(m)
		_splats.append(m)

func _make_blood() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = blood_amount
	p.one_shot = true
	p.explosiveness = 1.0
	p.lifetime = 0.9
	p.emitting = false
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 60.0
	pm.initial_velocity_min = 2.0
	pm.initial_velocity_max = 7.0
	pm.gravity = Vector3(0, -14, 0)
	pm.scale_min = 0.05
	pm.scale_max = 0.14
	p.process_material = pm
	var q := SphereMesh.new()
	q.radius = 0.5
	q.height = 1.0
	q.radial_segments = 6
	q.rings = 3
	var mat := StandardMaterial3D.new()
	mat.albedo_color = BLOOD_COLOR
	mat.roughness = 0.15
	q.material = mat
	p.draw_pass_1 = q
	p.visibility_aabb = AABB(Vector3(-6, -3, -6), Vector3(12, 8, 12))
	return p

func _piece_meshes(piece: String) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	for m in get_parent().find_children("cut_%s__*" % piece, "MeshInstance3D", true, false):
		out.append(m)
	return out

func is_cut(piece: String) -> bool:
	return cut_pieces.has(piece)

## Cut `piece` off: returns the flying rigid body (null if it is already cut or unknown).
func cut_piece(piece: String, impulse := Vector3.ZERO) -> RigidBody3D:
	if not PIECES.has(piece) or cut_pieces.has(piece):
		return null
	var meshes := _piece_meshes(piece)
	if meshes.is_empty():
		return null
	var body := RigidBody3D.new()
	body.mass = 8.0
	body.collision_layer = 2
	body.collision_mask = 1
	var xf := _piece_transform(piece)
	var shape_pts := PackedVector3Array()
	for m in meshes:
		var copy := MeshInstance3D.new()
		copy.mesh = m.mesh
		body.add_child(copy)
		copy.transform = Transform3D.IDENTITY
		for s in m.mesh.get_surface_count():
			copy.set_surface_override_material(s, m.get_active_material(s))
		shape_pts.append_array(m.mesh.get_faces())
		m.visible = false
	var cs := CollisionShape3D.new()
	var shape := ConvexPolygonShape3D.new()
	shape.points = _thin(shape_pts, 120)
	cs.shape = shape
	body.add_child(cs)
	get_tree().current_scene.add_child(body)
	body.global_transform = xf
	body.linear_velocity = impulse + Vector3(_rng.randf_range(-2, 2), 3.0, _rng.randf_range(-2, 2))
	body.angular_velocity = Vector3(_rng.randf_range(-6, 6), _rng.randf_range(-6, 6), _rng.randf_range(-6, 6))
	cut_pieces[piece] = body
	var point := xf.origin
	_spray(point)
	cut.emit(piece, point)
	get_tree().create_timer(piece_lifetime).timeout.connect(func() -> void:
		if is_instance_valid(body):
			body.queue_free())
	return body

## The piece keeps moving the way its bone did: skeleton * bone pose * inverse rest.
func _piece_transform(piece: String) -> Transform3D:
	if skeleton == null:
		return get_parent().global_transform
	var i := skeleton.find_bone(DRIVER[piece])
	if i < 0:
		return skeleton.global_transform
	return skeleton.global_transform * skeleton.get_bone_global_pose(i) * skeleton.get_bone_global_rest(i).affine_inverse()

func _thin(pts: PackedVector3Array, n: int) -> PackedVector3Array:
	if pts.size() <= n:
		return pts
	var out := PackedVector3Array()
	var step := float(pts.size()) / n
	for i in n:
		out.append(pts[int(i * step)])
	return out

func _spray(at: Vector3) -> void:
	_blood.global_position = at
	_blood.restart()
	_blood.emitting = true
	var s := _splats[_splat_next]
	_splat_next = (_splat_next + 1) % _splats.size()
	s.global_position = Vector3(at.x, 0.03, at.z)
	s.scale = Vector3.ONE * _rng.randf_range(0.8, 1.6)
	s.rotation.y = _rng.randf() * TAU
	s.visible = true

## Put everything back (rematch, or the "join" part of the finisher).
func join_all() -> void:
	for piece in cut_pieces.keys():
		var b: RigidBody3D = cut_pieces[piece]
		if is_instance_valid(b):
			b.queue_free()
		for m in _piece_meshes(piece):
			m.visible = true
	cut_pieces.clear()
	for s in _splats:
		s.visible = false
	joined.emit()
