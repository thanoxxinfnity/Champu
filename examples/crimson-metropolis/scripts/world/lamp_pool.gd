class_name LampPool
extends Node3D
## A few real OmniLight3Ds that hop to the lamp posts nearest `follow`, so night streets are lit around the player without a
## light per post across the whole city (the GL Compatibility renderer pays for every light that touches an object).

const COUNT := 6
const RANGE := 17.0
const ENERGY := 2.6
const REFRESH := 0.4

var follow: Node3D
var _lights: Array[OmniLight3D] = []
var _t := 0.0
var _on := false


func _ready() -> void:
	for i in range(COUNT):
		var l := OmniLight3D.new()
		l.omni_range = RANGE
		l.light_energy = ENERGY
		l.light_color = Color(1.0, 0.82, 0.55)
		l.omni_attenuation = 1.3
		l.shadow_enabled = false
		l.visible = false
		add_child(l)
		_lights.append(l)
	add_to_group("streetlight")


func set_lit(on: bool) -> void:
	_on = on
	for l in _lights:
		l.visible = on
	_t = REFRESH


func _process(delta: float) -> void:
	if not _on or follow == null or not is_instance_valid(follow):
		return
	_t += delta
	if _t < REFRESH:
		return
	_t = 0.0
	var from := follow.global_position
	var posts: Array = get_tree().get_nodes_in_group("streetlight")
	var near: Array = []
	for p in posts:
		if p is Streetlight:
			near.append([(p as Streetlight).global_position.distance_squared_to(from), p])
	near.sort_custom(func(a, b): return a[0] < b[0])
	for i in range(mini(COUNT, near.size())):
		_lights[i].global_position = (near[i][1] as Streetlight).light_position()
