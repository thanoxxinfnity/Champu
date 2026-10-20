class_name InfiniteVoidManager
extends Node3D
## Gojo's domain, "Infinite Void": the arena is swallowed by a cosmic sphere, the floor turns into a black mirror, the enemy is stunned
## completely and the screen fills with light streaks. Everything lives in this one node; call `activate()` / `deactivate()`.
##
## Mobile cost: one sphere with a procedural shader (no textures), one plane, 60 particles and one full-screen pass that only runs while
## the domain is active.

signal activated
signal deactivated

const EXPAND_TIME := 0.5
const SHADER_SKY := preload("res://shaders/void_sky.gdshader")
const SHADER_FLOOR := preload("res://shaders/void_floor.gdshader")
const SHADER_POST := preload("res://shaders/void_post.gdshader")

@export var radius := 60.0
@export var floor_size := 140.0
@export var enemy_group := &"enemy"

var active := false
var sphere: MeshInstance3D
var floor_mesh: MeshInstance3D
var streaks: GPUParticles3D
var post_layer: CanvasLayer
var _post_mat: ShaderMaterial
var _tween: Tween
var _stunned: Array[Node] = []

func _ready() -> void:
	sphere = MeshInstance3D.new()
	sphere.name = "VoidSphere"
	sphere.mesh = make_inverted_sphere(1.0, 48, 24)
	var sky := ShaderMaterial.new()
	sky.shader = SHADER_SKY
	sphere.material_override = sky
	sphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sphere.scale = Vector3.ZERO
	sphere.visible = false
	add_child(sphere)

	floor_mesh = MeshInstance3D.new()
	floor_mesh.name = "MirrorFloor"
	var plane := PlaneMesh.new()
	plane.size = Vector2(floor_size, floor_size)
	floor_mesh.mesh = plane
	var fm := ShaderMaterial.new()
	fm.shader = SHADER_FLOOR
	floor_mesh.material_override = fm
	floor_mesh.position.y = 0.04
	floor_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	floor_mesh.visible = false
	add_child(floor_mesh)

	streaks = _make_streaks()
	add_child(streaks)

	post_layer = CanvasLayer.new()
	post_layer.layer = 10   # under the HUD (15) and the touch controls (20)
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_post_mat = ShaderMaterial.new()
	_post_mat.shader = SHADER_POST
	_post_mat.set_shader_parameter("strength", 0.0)
	rect.material = _post_mat
	post_layer.add_child(rect)
	post_layer.visible = false
	add_child(post_layer)

## A sphere whose triangles face inwards: winding reversed and normals flipped, so the inside is the visible side everywhere.
static func make_inverted_sphere(r: float, radial: int, rings: int) -> ArrayMesh:
	var src := SphereMesh.new()
	src.radius = r
	src.height = r * 2.0
	src.radial_segments = radial
	src.rings = rings
	var arrays := src.get_mesh_arrays()
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for i in range(0, idx.size(), 3):
		var t := idx[i + 1]
		idx[i + 1] = idx[i + 2]
		idx[i + 2] = t
	var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	for i in n.size():
		n[i] = -n[i]
	arrays[Mesh.ARRAY_INDEX] = idx
	arrays[Mesh.ARRAY_NORMAL] = n
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m

func _make_streaks() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 60
	p.lifetime = 4.0
	p.preprocess = 2.0
	p.emitting = false
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(18, 5, 18)
	pm.direction = Vector3.UP
	pm.spread = 12.0
	pm.initial_velocity_min = 1.5
	pm.initial_velocity_max = 4.0
	pm.gravity = Vector3.ZERO
	pm.particle_flag_align_y = true     # the streak stretches along its velocity
	pm.scale_min = 0.6
	pm.scale_max = 1.4
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.0))
	g.add_point(0.25, Color(1, 1, 1, 0.9))
	g.set_color(g.get_point_count() - 1, Color(1, 1, 1, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.05, 1.4)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.vertex_color_use_as_albedo = true
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.albedo_color = Color(0.9, 0.95, 1.0)
	q.material = mat
	p.draw_pass_1 = q
	p.visibility_aabb = AABB(Vector3(-25, -2, -25), Vector3(50, 20, 50))
	return p

# ── activation ──────────────────────────────────────────────────────────────────

## Open the domain around `center` (world position of the arena). The sphere grows 0 -> 1 in half a second.
func activate(center: Vector3 = Vector3.ZERO) -> void:
	if active:
		return
	active = true
	global_position = Vector3(center.x, 0.0, center.z)
	sphere.position = Vector3.ZERO
	sphere.visible = true
	floor_mesh.visible = true
	streaks.position = Vector3(0, 0.5, 0)
	streaks.emitting = true
	post_layer.visible = true
	_stun_enemies(true)       # immediate: no movement, no attacks
	if _tween:
		_tween.kill()
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(sphere, "scale", Vector3.ONE * radius, EXPAND_TIME).from(Vector3.ZERO).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	_tween.tween_method(_set_reveal, 0.0, 1.0, EXPAND_TIME)
	_tween.tween_method(_set_post, 0.0, 0.55, EXPAND_TIME)
	_tween.chain().tween_callback(func() -> void: activated.emit())

func deactivate() -> void:
	if not active:
		return
	active = false
	if _tween:
		_tween.kill()
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(sphere, "scale", Vector3.ZERO, EXPAND_TIME).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	_tween.tween_method(_set_reveal, 1.0, 0.0, EXPAND_TIME)
	_tween.tween_method(_set_post, 0.55, 0.0, EXPAND_TIME)
	_tween.chain().tween_callback(_finish_close)

func _finish_close() -> void:
	sphere.visible = false
	floor_mesh.visible = false
	streaks.emitting = false
	post_layer.visible = false
	_stun_enemies(false)
	deactivated.emit()

func _set_reveal(v: float) -> void:
	(sphere.material_override as ShaderMaterial).set_shader_parameter("reveal", v)
	(floor_mesh.material_override as ShaderMaterial).set_shader_parameter("reveal", v)

func _set_post(v: float) -> void:
	_post_mat.set_shader_parameter("strength", v)

# ── brain-stun ──────────────────────────────────────────────────────────────────

## Freeze every enemy completely: it calls `set_stunned(true)` when the enemy has it, and always stops the node's processing, physics,
## animation and velocity, so nothing can move or attack until the domain closes.
func _stun_enemies(on: bool) -> void:
	if on:
		_stunned.clear()
		for e in get_tree().get_nodes_in_group(enemy_group):
			_stunned.append(e)
	for e in _stunned:
		if not is_instance_valid(e):
			continue
		e.set_meta("stunned", on)
		if e.has_method("set_stunned"):
			e.call("set_stunned", on)
		e.set_process(not on)
		e.set_physics_process(not on)
		e.set_process_input(not on)
		e.set_process_unhandled_input(not on)
		if e is CharacterBody3D and on:
			(e as CharacterBody3D).velocity = Vector3.ZERO
		if e is RigidBody3D:
			(e as RigidBody3D).freeze = on
		for ap in e.find_children("*", "AnimationPlayer", true, false):
			if on:
				(ap as AnimationPlayer).pause()
			else:
				(ap as AnimationPlayer).play()
	if not on:
		_stunned.clear()

func is_enemy_stunned(e: Node) -> bool:
	return bool(e.get_meta("stunned", false))
