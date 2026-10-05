extends Node
## Game feel: screen shake, hit-stop, slow motion, flashes, pops, floating text and haptics.
## Autoload name: Feel

var _shake_strength := 0.0
var _shake_time := 0.0
var _shake_total := 0.001
var _flash: ColorRect
var _layer: CanvasLayer
var _rng := RandomNumberGenerator.new()
var _stop_token := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_layer = CanvasLayer.new()
	_layer.layer = 60
	add_child(_layer)
	_flash = ColorRect.new()
	_flash.color = Color(1, 1, 1, 0)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_layer.add_child(_flash)
	_rng.randomize()


func _process(delta: float) -> void:
	if _shake_time <= 0.0:
		return
	_shake_time -= delta
	var k := clampf(_shake_time / _shake_total, 0.0, 1.0)
	var amount := _shake_strength * k * k
	var cam3 := get_viewport().get_camera_3d()
	if cam3:
		cam3.h_offset = _rng.randf_range(-1.0, 1.0) * amount
		cam3.v_offset = _rng.randf_range(-1.0, 1.0) * amount
	var cam2 := get_viewport().get_camera_2d()
	if cam2:
		cam2.offset = Vector2(_rng.randf_range(-1.0, 1.0), _rng.randf_range(-1.0, 1.0)) * amount * 40.0
	if _shake_time <= 0.0:
		if cam3:
			cam3.h_offset = 0.0
			cam3.v_offset = 0.0
		if cam2:
			cam2.offset = Vector2.ZERO


## Shakes whatever camera is current. 0.15 is a bump, 0.5 is a crash.
func shake(strength: float = 0.25, seconds: float = 0.3) -> void:
	_shake_strength = maxf(_shake_strength if _shake_time > 0.0 else 0.0, strength)
	_shake_total = maxf(seconds, 0.05)
	_shake_time = _shake_total


## Freezes the game for a moment on impact. Makes a hit read as heavy.
func hit_stop(seconds: float = 0.06) -> void:
	_stop_token += 1
	var token := _stop_token
	Engine.time_scale = 0.05
	await get_tree().create_timer(seconds, true, false, true).timeout
	if token == _stop_token:
		Engine.time_scale = 1.0


## Slows time, then lets it recover.
func slow_mo(scale: float = 0.3, seconds: float = 0.6) -> void:
	_stop_token += 1
	var token := _stop_token
	Engine.time_scale = scale
	await get_tree().create_timer(seconds, true, false, true).timeout
	if token == _stop_token:
		Engine.time_scale = 1.0


## A quick full-screen tint: white for a pickup, red for damage.
func flash(color: Color = Color(1, 1, 1, 0.45), seconds: float = 0.18) -> void:
	_flash.color = color
	var tween := create_tween()
	tween.tween_property(_flash, "color:a", 0.0, seconds)


## Punches a node's scale up and lets it settle. Works for 2D, 3D and UI nodes.
func pop(node: Node, amount: float = 1.25, seconds: float = 0.22) -> void:
	if not is_instance_valid(node):
		return
	if node is Control:
		node.pivot_offset = node.size * 0.5
	var rest: Variant = node.get("scale")
	if rest == null:
		return
	var tween := create_tween()
	tween.tween_property(node, "scale", rest * amount, seconds * 0.35).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(node, "scale", rest, seconds * 0.65).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## A number or word that rises from a screen position and fades: "+10", "PERFECT".
func float_text(parent: Node, text: String, screen_pos: Vector2, color: Color = Color.WHITE, size: int = 44) -> void:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	label.add_theme_constant_override("outline_size", 10)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.position = screen_pos - Vector2(label.size.x * 0.5, 0.0)
	parent.add_child(label)
	label.position = screen_pos - Vector2(60, 20)
	var tween := create_tween().set_parallel(true)
	tween.tween_property(label, "position:y", screen_pos.y - 110.0, 0.8).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(label, "modulate:a", 0.0, 0.8).set_delay(0.25)
	tween.chain().tween_callback(label.queue_free)


## A short buzz on phones; nothing elsewhere.
func vibrate(milliseconds: int = 30) -> void:
	Input.vibrate_handheld(milliseconds)
