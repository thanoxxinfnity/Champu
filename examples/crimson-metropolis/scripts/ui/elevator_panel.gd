class_name ElevatorPanel
extends CanvasLayer
## The floor list shown while the player is inside the lift: one button per stop, the current floor lit, keys 1..N as
## shortcuts. It only reports a choice; ElevatorSystem does the moving.

signal chosen(stop: int)

var current := 0
var moving := false
var _buttons: Array[Button] = []
var _box: VBoxContainer
var _title: Label


func _ready() -> void:
	layer = 30
	visible = false
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	panel.offset_left = -330.0
	panel.offset_right = -24.0
	panel.offset_top = -170.0
	panel.offset_bottom = 170.0
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.06, 0.08, 0.86)
	sb.set_corner_radius_all(14)
	sb.set_border_width_all(1)
	sb.border_color = Color(1.0, 0.54, 0.24, 0.55)
	sb.content_margin_left = 20
	sb.content_margin_right = 20
	sb.content_margin_top = 16
	sb.content_margin_bottom = 16
	panel.add_theme_stylebox_override("panel", sb)
	root.add_child(panel)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 10)
	panel.add_child(_box)
	_title = Label.new()
	_title.text = "ELEVATOR"
	_title.add_theme_font_size_override("font_size", 14)
	_title.add_theme_color_override("font_color", Color(1.0, 0.54, 0.24))
	_box.add_child(_title)


func set_stops(stops: Array[Dictionary]) -> void:
	for b in _buttons:
		b.queue_free()
	_buttons.clear()
	# Highest floor first, like a real panel.
	for i in range(stops.size() - 1, -1, -1):
		var b := Button.new()
		b.text = "[%s] %s" % [stops[i].label, stops[i].name]
		b.custom_minimum_size = Vector2(250, 46)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.add_theme_font_size_override("font_size", 18)
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(func(): chosen.emit(i))
		_box.add_child(b)
		_buttons.append(b)
		b.set_meta("stop", i)
		_style(b, false)


func _style(b: Button, lit: bool) -> void:
	var base := StyleBoxFlat.new()
	base.bg_color = Color(1.0, 0.54, 0.24, 0.9) if lit else Color(0.14, 0.14, 0.17, 0.95)
	base.set_corner_radius_all(8)
	base.content_margin_left = 14
	for state in ["normal", "hover", "pressed", "focus"]:
		var sbx := base.duplicate() as StyleBoxFlat
		if state == "hover" and not lit:
			sbx.bg_color = Color(0.22, 0.22, 0.26, 0.98)
		b.add_theme_stylebox_override(state, sbx)
	b.add_theme_color_override("font_color", Color(0.06, 0.06, 0.08) if lit else Color(0.93, 0.93, 0.95))
	b.add_theme_color_override("font_hover_color", Color(0.06, 0.06, 0.08) if lit else Color(1, 1, 1))


func refresh() -> void:
	_title.text = "ELEVATOR  -  moving..." if moving else "ELEVATOR"
	for b in _buttons:
		var lit := int(b.get_meta("stop")) == current
		_style(b, lit)
		b.disabled = moving


func _unhandled_input(event: InputEvent) -> void:
	if not visible or moving:
		return
	if event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo:
		var k := (event as InputEventKey).physical_keycode
		var n := -1
		if k >= KEY_1 and k <= KEY_9:
			n = k - KEY_1
		if n >= 0 and n < _buttons.size():
			# Keys count from the bottom floor up: 1 = lowest stop.
			chosen.emit(n)
