class_name DestructionManager
extends Node3D
## Arena destruction: mesh swap for ultimates, plane slicing for slashes, and the dust / rubble / spark effects that go with both.
##
## State A (intact) and State B (heavy destruction, a separate Triverse-generated mesh) live side by side under the arena; an ultimate hides A
## and shows B on the exact same transform. Small attacks slice a concrete piece with a plane and drop the halves as rigid bodies.
## Everything that spawns comes from a fixed pool (no allocation during a fight) and an automatic quality guard lowers the amount of
## debris and particles when the frame time rises, so a phone keeps its frame rate.

signal swapped(origin: Vector3)
signal sliced(point: Vector3, normal: Vector3)

enum Quality { LOW, MEDIUM, HIGH }

const DEBRIS_POOL := 40
const SPARK_DECALS := 6
const DUST_EMITTERS := 3
const SLICE_PIECES_MAX := 8

@export var intact: Node3D            ## State A
@export var heavy: Node3D             ## State B (hidden until the ultimate)
@export var quality: Quality = Quality.MEDIUM
@export var debris_lifetime := 6.0
@export var target_fps := 45.0

var swapped_to_heavy := false
var _debris: Array[RigidBody3D] = []
var _debris_free: Array[RigidBody3D] = []
var _debris_mesh: BoxMesh
var _debris_shape: BoxShape3D
var _debris_mat: StandardMaterial3D
var _decals: Array[MeshInstance3D] = []
var _decal_next := 0
var _dust: Array[GPUParticles3D] = []
var _dust_next := 0
var _sparks: GPUParticles3D
var _slice_pieces: Array[RigidBody3D] = []
var _frame_ms := 16.0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()
	_build_pools()
	if heavy != null:
		heavy.visible = false
		_set_collision(heavy, false)

func _build_pools() -> void:
	_debris_mesh = BoxMesh.new()
	_debris_mesh.size = Vector3(0.28, 0.2, 0.24)
	_debris_shape = BoxShape3D.new()
	_debris_shape.size = _debris_mesh.size
	_debris_mat = StandardMaterial3D.new()
	_debris_mat.albedo_color = Color(0.46, 0.46, 0.48)
	_debris_mat.roughness = 0.95
	for i in DEBRIS_POOL:
		var b := RigidBody3D.new()
		b.mass = 1.2
		b.linear_damp = 0.15
		b.angular_damp = 0.4
		b.collision_layer = 2
		b.collision_mask = 1 | 2
		b.can_sleep = true
		var mi := MeshInstance3D.new()
		mi.mesh = _debris_mesh
		mi.material_override = _debris_mat
		b.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.shape = _debris_shape
		b.add_child(cs)
		_park(b)
		add_child(b)
		_debris.append(b)
		_debris_free.append(b)
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.orientation = PlaneMesh.FACE_Y
	for i in SPARK_DECALS:
		var d := MeshInstance3D.new()
		d.mesh = quad
		d.material_override = DestructionVfx.spark_decal_material()
		d.visible = false
		d.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(d)
		_decals.append(d)
	for i in DUST_EMITTERS:
		var p := DestructionVfx.dust_particles(48)
		add_child(p)
		_dust.append(p)
	_sparks = DestructionVfx.spark_particles(40)
	add_child(_sparks)

func _park(b: RigidBody3D) -> void:
	b.freeze = true
	b.visible = false
	b.set_meta("age", -1.0)
	b.position = Vector3(0, -500, 0)

# ── quality guard ───────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	_frame_ms = lerpf(_frame_ms, delta * 1000.0, 0.05)
	var budget := 1000.0 / target_fps
	if _frame_ms > budget * 1.25 and quality > Quality.LOW:
		quality = (quality - 1) as Quality
		_frame_ms = budget  # give the lower setting a moment before judging it
	elif _frame_ms < budget * 0.6 and quality < Quality.HIGH and _debris_free.size() == _debris.size():
		quality = (quality + 1) as Quality
	for b in _debris:
		var age: float = b.get_meta("age")
		if age < 0.0:
			continue
		age += delta
		b.set_meta("age", age)
		if age > debris_lifetime:
			var s := clampf(1.0 - (age - debris_lifetime) / 0.6, 0.0, 1.0)
			b.scale = Vector3.ONE * s
			if s <= 0.0:
				_recycle(b)
	for p in _slice_pieces.duplicate():
		var age: float = p.get_meta("age")
		age += delta
		p.set_meta("age", age)
		if age > debris_lifetime + 2.0:
			_slice_pieces.erase(p)
			p.queue_free()

func _recycle(b: RigidBody3D) -> void:
	_park(b)
	b.scale = Vector3.ONE
	_debris_free.append(b)

func _debris_count() -> int:
	return [6, 14, 28][quality]

func _dust_amount() -> float:
	return [0.35, 0.65, 1.0][quality]

# ── 1. mesh swap (ultimate) ─────────────────────────────────────────────────────

## Hide State A, show State B at the same transform, then fire the effects at `origin`.
func on_ultimate_hit(origin: Vector3, radius := 6.0) -> void:
	if swapped_to_heavy or intact == null or heavy == null:
		return
	swapped_to_heavy = true
	heavy.global_transform = intact.global_transform
	intact.visible = false
	_set_collision(intact, false)
	heavy.visible = true
	_set_collision(heavy, true)
	_burst(origin, radius, 1.0)
	swapped.emit(origin)

## Public effect burst (dust, rubble, sparks, ground mark) without any mesh swap: specials and landed ultimates use this.
func blast(origin: Vector3, radius := 3.0, power := 0.6) -> void:
	_burst(origin, radius, power)

func reset_arena() -> void:
	swapped_to_heavy = false
	if intact != null:
		intact.visible = true
		_set_collision(intact, true)
	if heavy != null:
		heavy.visible = false
		_set_collision(heavy, false)

func _set_collision(root: Node, on: bool) -> void:
	for c in root.find_children("*", "CollisionObject3D", true, false):
		(c as CollisionObject3D).collision_layer = 1 if on else 0
		(c as CollisionObject3D).collision_mask = 0

# ── 2. plane slicing (small attacks) ────────────────────────────────────────────

## Slice `target` (a MeshInstance3D) with the plane through `point` whose normal is `slash_normal`; both halves become rigid bodies.
## Returns the two bodies (empty when the plane misses the mesh).
func on_cleave_hit(point: Vector3, slash_normal: Vector3, target: MeshInstance3D) -> Array[RigidBody3D]:
	var out: Array[RigidBody3D] = []
	if target == null or target.mesh == null or _slice_pieces.size() + 2 > SLICE_PIECES_MAX:
		_burst(point, 2.0, 0.4)
		return out
	var inv := target.global_transform.affine_inverse()
	var local_n := (inv.basis.transposed() * slash_normal).normalized()
	var plane := Plane(local_n, local_n.dot(inv * point))
	var halves := MeshSlicer.slice(target.mesh, plane)
	if halves[0] == null or halves[1] == null:
		return out
	var parent := target.get_parent()
	for side in 2:
		var piece := RigidBody3D.new()
		piece.mass = 25.0
		piece.collision_layer = 2
		piece.collision_mask = 1 | 2
		piece.set_meta("age", 0.0)
		var mi := MeshInstance3D.new()
		mi.mesh = halves[side]
		piece.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.shape = (halves[side] as ArrayMesh).create_convex_shape(true, true)
		piece.add_child(cs)
		parent.add_child(piece)
		piece.global_transform = target.global_transform
		var away := slash_normal * (1.0 if side == 0 else -1.0)
		piece.apply_central_impulse(away * 40.0 + Vector3.UP * 25.0)
		piece.apply_torque_impulse(Vector3(_rng.randf_range(-1, 1), _rng.randf_range(-1, 1), _rng.randf_range(-1, 1)) * 30.0)
		_slice_pieces.append(piece)
		out.append(piece)
	target.get_parent().remove_child(target)
	target.queue_free()
	_burst(point, 3.0, 0.5)
	sliced.emit(point, slash_normal)
	return out

# ── 3. effects ──────────────────────────────────────────────────────────────────

## Dust, rubble thrown outward with radial velocity and a cursed-energy mark on the ground — all on the same frame.
func _burst(origin: Vector3, radius: float, power: float) -> void:
	_emit_dust(origin, radius)
	_throw_rubble(origin, radius, power)
	_mark_ground(origin, radius)

func _emit_dust(origin: Vector3, radius: float) -> void:
	var p := _dust[_dust_next]
	_dust_next = (_dust_next + 1) % _dust.size()
	p.global_position = origin + Vector3.UP * 0.3
	p.amount_ratio = _dust_amount()
	(p.process_material as ParticleProcessMaterial).emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	(p.process_material as ParticleProcessMaterial).emission_sphere_radius = maxf(0.3, radius * 0.3)
	p.restart()
	p.emitting = true
	_sparks.global_position = origin + Vector3.UP * 0.2
	_sparks.amount_ratio = _dust_amount()
	_sparks.restart()
	_sparks.emitting = true

func _throw_rubble(origin: Vector3, radius: float, power: float) -> void:
	var n := mini(_debris_count(), _debris_free.size())
	for i in n:
		var b: RigidBody3D = _debris_free.pop_back()
		var ang := _rng.randf() * TAU
		var dir := Vector3(cos(ang), 0.0, sin(ang))
		b.visible = true
		b.freeze = false
		b.scale = Vector3.ONE * _rng.randf_range(0.5, 1.5)
		b.set_meta("age", 0.0)
		b.global_position = origin + dir * _rng.randf_range(0.0, radius * 0.3) + Vector3.UP * 0.3
		b.global_rotation = Vector3(_rng.randf() * TAU, _rng.randf() * TAU, _rng.randf() * TAU)
		b.linear_velocity = (dir * _rng.randf_range(3.0, 9.0) + Vector3.UP * _rng.randf_range(3.0, 9.0)) * power
		b.angular_velocity = Vector3(_rng.randf_range(-8, 8), _rng.randf_range(-8, 8), _rng.randf_range(-8, 8))

func _mark_ground(origin: Vector3, radius: float) -> void:
	var d := _decals[_decal_next]
	_decal_next = (_decal_next + 1) % _decals.size()
	d.global_position = Vector3(origin.x, origin.y + 0.03, origin.z)
	d.scale = Vector3.ONE * maxf(1.5, radius * 1.6)
	d.rotation.y = _rng.randf() * TAU
	d.visible = true
	var mat := d.material_override as StandardMaterial3D
	mat.albedo_color = Color(1, 1, 1, 1)
	var tw := create_tween()
	tw.tween_interval(1.2)
	tw.tween_property(mat, "albedo_color:a", 0.0, 2.0)
	tw.tween_callback(func() -> void: d.visible = false)

## Number of pooled debris bodies currently flying (for tests / the HUD debug line).
func active_debris() -> int:
	return _debris.size() - _debris_free.size()
