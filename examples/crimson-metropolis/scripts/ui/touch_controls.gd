class_name TouchControls
extends CanvasLayer
## On-screen controls for phones: a movement stick on the left, drag-to-look on the right, and glass buttons for USE, JUMP, FIRE,
## SPRINT and the PHONE. On foot the stick moves the player; in a car it is throttle (up/down) and steering (left/right).
## Everything funnels through the same fields the keyboard path uses, so a bot (or a test) can drive it through set_stick().

const STICK_R := 110.0
const LOOK_SENS := 0.0042

var director: Director
var stick := Vector2.ZERO
var sprint := false

var _root: Control
var _stick_id := -1
var _stick_origin := Vector2.ZERO
var _look_id := -1
var _look_last := Vector2.ZERO
var _knob: Control
var _base: Control
var _buttons: Dictionary = {}


func _ready() -> void:
	layer = 20
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_base = _disc(STICK_R * 2.0, Color(1, 1, 1, 0.10))
	_base.position = Vector2(60, 0)
	_base.visible = false
	_root.add_child(_base)
	_knob = _disc(STICK_R * 0.9, Color(1, 1, 1, 0.28))
	_knob.visible = false
	_root.add_child(_knob)
	_make_button(&"use", "USE", Vector2(-190, -250), 84, func(): _use())
	_make_button(&"jump", "JUMP", Vector2(-110, -130), 78, func(): director.player.press_jump())
	_make_button(&"fire", "FIRE", Vector2(-290, -140), 78, func(): director.fire())
	_make_button(&"sprint", "RUN", Vector2(-380, -250), 72, func(): sprint = not sprint)
	_make_button(&"phone", "PHONE", Vector2(-110, 70), 70, func(): director.phone.toggle(), true)
	_root.visible = _wanted()


func _wanted() -> bool:
	return DisplayServer.is_touchscreen_available() or OS.has_environment("CM_TOUCH")


func _disc(d: float, c: Color) -> Control:
	var p := Panel.new()
	p.custom_minimum_size = Vector2(d, d)
	p.size = Vector2(d, d)
	var sb := StyleBoxFlat.new()
	sb.bg_color = c
	sb.set_corner_radius_all(int(d * 0.5))
	sb.set_border_width_all(2)
	sb.border_color = Color(1, 1, 1, 0.35)
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


## Anchored from the bottom-right (or top-right for `top`): glass discs with a white label.
func _make_button(id: StringName, text: String, off: Vector2, d: float, cb: Callable, top := false) -> void:
	var b := Button.new()
	b.name = String(id).capitalize()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(d, d)
	b.size = Vector2(d, d)
	b.add_theme_font_size_override("font_size", 17)
	var n := StyleBoxFlat.new()
	n.bg_color = Color(0.1, 0.1, 0.13, 0.55)
	n.set_corner_radius_all(int(d * 0.5))
	n.set_border_width_all(2)
	n.border_color = Color(1, 1, 1, 0.4)
	var h := n.duplicate() as StyleBoxFlat
	h.bg_color = Color(UiKit.ACCENT.r, UiKit.ACCENT.g, UiKit.ACCENT.b, 0.7)
	b.add_theme_stylebox_override("normal", n)
	b.add_theme_stylebox_override("hover", n)
	b.add_theme_stylebox_override("pressed", h)
	b.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT if not top else Control.PRESET_TOP_RIGHT)
	b.offset_left = off.x
	b.offset_top = off.y
	b.offset_right = off.x + d
	b.offset_bottom = off.y + d
	b.pressed.connect(cb)
	_root.add_child(b)
	_buttons[id] = b


func press(id: StringName) -> void:
	(_buttons[id] as Button).pressed.emit()


## USE does what E or F would: leave the car you are driving, otherwise use whatever the player is looking at.
func _use() -> void:
	var drv: Vehicle = null
	for v in get_tree().get_nodes_in_group("vehicles"):
		if (v as Vehicle).is_player_driven:
			drv = v
	if drv != null:
		drv.begin_exit()
	else:
		director.player.use_focus()


func set_stick(v: Vector2) -> void:
	stick = v.limit_length(1.0)
	_apply()


func _apply() -> void:
	var drv: Vehicle = null
	for n in get_tree().get_nodes_in_group("vehicles"):
		if (n as Vehicle).is_player_driven:
			drv = n
	if drv != null:
		drv.ext_throttle = -stick.y
		drv.ext_steer = stick.x
		director.player.ext_move = Vector2.ZERO
	else:
		director.player.ext_move = stick
		director.player.ext_sprint = sprint


func _process(_d: float) -> void:
	if director == null or not _wanted():
		return
	_apply()
	_root.visible = _wanted() and not director.phone.is_open


func _input(event: InputEvent) -> void:
	if not _wanted() or director == null:
		return
	var vp := get_viewport().get_visible_rect().size
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			if t.position.x < vp.x * 0.4 and _stick_id == -1 and t.position.y > vp.y * 0.35:
				_stick_id = t.index
				_stick_origin = t.position
				_base.position = t.position - Vector2(STICK_R, STICK_R)
				_knob.position = t.position - Vector2(STICK_R * 0.45, STICK_R * 0.45)
				_base.visible = true
				_knob.visible = true
			elif t.position.x > vp.x * 0.45 and _look_id == -1 and not _over_button(t.position):
				_look_id = t.index
				_look_last = t.position
		else:
			if t.index == _stick_id:
				_stick_id = -1
				_base.visible = false
				_knob.visible = false
				set_stick(Vector2.ZERO)
			elif t.index == _look_id:
				_look_id = -1
	elif event is InputEventScreenDrag:
		var dr := event as InputEventScreenDrag
		if dr.index == _stick_id:
			var d := (dr.position - _stick_origin) / STICK_R
			set_stick(d)
			_knob.position = _stick_origin + d.limit_length(1.0) * STICK_R - Vector2(STICK_R * 0.45, STICK_R * 0.45)
		elif dr.index == _look_id:
			var delta := dr.position - _look_last
			_look_last = dr.position
			look(delta)


func look(delta: Vector2) -> void:
	var drv: Vehicle = null
	for n in get_tree().get_nodes_in_group("vehicles"):
		if (n as Vehicle).is_player_driven:
			drv = n
	if drv != null:
		drv.add_look(delta.x * LOOK_SENS, delta.y * LOOK_SENS)
	else:
		director.player.add_look(delta.x * LOOK_SENS, delta.y * LOOK_SENS)


func _over_button(p: Vector2) -> bool:
	for b in _buttons.values():
		if (b as Control).get_global_rect().has_point(p):
			return true
	return false
