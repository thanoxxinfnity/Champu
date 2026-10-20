class_name ImpactFx
extends CanvasLayer
## Screen-space punch for big moments: anime impact frames (two inverted B/W flashes), radial speed lines, a diagonal "cut" across the screen
## for the World-Cutting Slash, and hit-stop (time slows to a crawl for a few frames on heavy hits).

var _rect: ColorRect
var _mat: ShaderMaterial
var _cut: ColorRect

func _ready() -> void:
	layer = 12
	_rect = ColorRect.new()
	_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/impact.gdshader")
	_rect.material = _mat
	_rect.visible = false
	add_child(_rect)
	_cut = ColorRect.new()
	_cut.color = Color(1, 1, 1, 0)
	_cut.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_cut)

func _real_timer(t: float) -> SceneTreeTimer:
	return get_tree().create_timer(t, true, false, true)

func impact_frame(flashes := 2) -> void:
	_rect.visible = true
	for i in flashes:
		_mat.set_shader_parameter("invert", 1.0)
		await _real_timer(0.05).timeout
		_mat.set_shader_parameter("invert", 0.0)
		await _real_timer(0.04).timeout
	if float(_mat.get_shader_parameter("lines")) <= 0.0:
		_rect.visible = false

func speed_lines(secs: float) -> void:
	_rect.visible = true
	_mat.set_shader_parameter("lines", 1.0)
	await _real_timer(secs).timeout
	_mat.set_shader_parameter("lines", 0.0)
	_rect.visible = false

func hitstop(secs := 0.06, scale := 0.05) -> void:
	Engine.time_scale = scale
	await _real_timer(secs).timeout
	Engine.time_scale = 1.0

## A white line that slices diagonally across the whole screen, then the two halves "slide".
func screen_cut() -> void:
	var vs := get_viewport().get_visible_rect().size
	var len := vs.length() * 1.2
	_cut.size = Vector2(len, 6)
	_cut.pivot_offset = Vector2(len * 0.5, 3)
	_cut.position = vs * 0.5 - _cut.pivot_offset
	_cut.rotation = -0.5
	_cut.color = Color(1, 1, 1, 1)
	var tw := create_tween()
	tw.tween_property(_cut, "size:y", 26.0, 0.08).from(2.0)
	tw.tween_property(_cut, "color:a", 0.0, 0.35)
