class_name ShrineDomain
extends Node3D
## Sukuna's domain, "Malevolent Shrine": the shrine rises behind him, the world turns blood red, and Cleave/Dismantle cut everything inside the
## radius over and over for the duration. Uses the user-supplied shrine model (assets/characters/malevolent_shrine.glb).

signal finished

@export var duration := 6.0
@export var tick := 0.3
@export var damage_per_tick := 1.8
var active := false
var owner_fighter: Fighter
var _shrine: Node3D
var _tint: ColorRect
var _layer: CanvasLayer
var _floor: MeshInstance3D
var _t := 0.0
var _next := 0.0
var _env: Environment
var _env_fog := Color()
var _env_fog_d := 0.0

func _ready() -> void:
	_shrine = ArenaBuilder.prop("res://assets/characters/malevolent_shrine.glb", 16.0, false)
	if _shrine != null:
		_shrine.visible = false
		add_child(_shrine)
	_layer = CanvasLayer.new()
	_layer.layer = 80
	_tint = ColorRect.new()
	_tint.set_anchors_preset(Control.PRESET_FULL_RECT)
	_tint.color = Color(0.7, 0.0, 0.02, 0.0)
	_tint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_tint)
	add_child(_layer)
	_floor = MeshInstance3D.new()
	var p := PlaneMesh.new()
	p.size = Vector2(60, 60)
	_floor.mesh = p
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.25, 0.0, 0.0, 0.0)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_floor.material_override = m
	_floor.position.y = 0.05
	_floor.visible = false
	add_child(_floor)

## `far_side`: true puts the shrine beyond the opponent (seen from behind the user, e.g. the player's camera); false puts it behind the user.
func activate(user: Fighter, env: Environment = null, far_side := true) -> void:
	if active or user == null:
		return
	active = true
	owner_fighter = user
	_t = 0.0
	_next = 0.5
	_env = env
	var to_opp := -user.global_transform.basis.z.normalized()
	if user.opponent != null:
		to_opp = (user.opponent.global_position - user.global_position)
		to_opp.y = 0.0
		to_opp = to_opp.normalized() if to_opp.length() > 0.1 else Vector3.FORWARD
	global_position = Vector3(user.global_position.x, 0, user.global_position.z)
	if _shrine != null:
		_shrine.visible = true
		var spot := global_position + (to_opp * 20.0 if far_side else -to_opp * 16.0)
		_shrine.global_position = spot + Vector3(0, -18, 0)
		_shrine.look_at(Vector3(global_position.x, -18, global_position.z), Vector3.UP)
		create_tween().tween_property(_shrine, "global_position:y", 0.0, 1.1).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_floor.visible = true
	var fm := _floor.material_override as StandardMaterial3D
	create_tween().tween_property(fm, "albedo_color:a", 0.55, 0.8)
	create_tween().tween_property(_tint, "color:a", 0.12, 0.6)
	if _env != null:
		_env_fog = _env.fog_light_color
		_env_fog_d = _env.fog_density
		_env.fog_enabled = true
		_env.fog_light_color = Color(0.5, 0.02, 0.02)
		_env.fog_density = 0.007

func _process(delta: float) -> void:
	if not active:
		return
	_t += delta
	if _t >= _next and _t < duration:
		_next += tick
		var o := owner_fighter.opponent if owner_fighter != null else null
		if o != null and o.is_alive() and o.global_position.distance_to(global_position) < 30.0:
			MoveVfx.slash_burst(get_parent(), o.global_position + Vector3.UP * 1.0, 3, 2.6)
			o.take_damage(owner_fighter, damage_per_tick, 0.12, 0.6)
		# random cuts through the scenery around the shrine
		var r := Vector3(randf_range(-14, 14), randf_range(0.5, 5.0), randf_range(-14, 14))
		MoveVfx.slash_burst(get_parent(), global_position + r, 2, 4.0)
	if _t >= duration:
		deactivate()

func deactivate() -> void:
	if not active:
		return
	active = false
	if _shrine != null:
		var tw := create_tween()
		tw.tween_property(_shrine, "global_position:y", -20.0, 1.0).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.tween_callback(func() -> void: _shrine.visible = false)
	create_tween().tween_property(_tint, "color:a", 0.0, 0.6)
	var fm := _floor.material_override as StandardMaterial3D
	var t2 := create_tween()
	t2.tween_property(fm, "albedo_color:a", 0.0, 0.8)
	t2.tween_callback(func() -> void: _floor.visible = false)
	if _env != null:
		_env.fog_light_color = _env_fog
		_env.fog_density = _env_fog_d
	finished.emit()
