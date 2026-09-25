class_name MobileInputManager
extends Control
## On-screen driving controls with true multitouch.
##
## One Control owns every touch: each finger (by its touch index) is bound to
## at most one button, so steering with the left thumb while holding gas and
## tapping nitro with the right never steal each other's events, and a finger
## sliding from GAS onto BRAKE hands over without lifting. The overlay itself
## ignores the mouse so it never blocks anything underneath.
##
## Every frame the resolved state is written to `vehicle` as plain floats.

signal camera_pressed
signal reset_pressed
signal garage_pressed

enum Steer { BUTTONS, JOYSTICK }

const ACCENT := Color(1.0, 0.45, 0.08)
const GLASS := Color(1.0, 1.0, 1.0, 0.1)
const GLASS_EDGE := Color(1.0, 1.0, 1.0, 0.38)

var vehicle: VehicleController
var steer_mode: Steer = Steer.BUTTONS
var haptics := true

# Resolved state (also read by tests).
var steer := 0.0
var throttle := 0.0
var brake := 0.0
var handbrake := false
var nitro := false

var _buttons := {}           # id -> {center, radius, group, hold}
var _fingers := {}           # touch index -> button id (or "joy")
var _joy_center := Vector2.ZERO
var _joy_offset := Vector2.ZERO
var _joy_radius := 110.0
var _steer_smooth := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	resized.connect(_layout)
	_layout()


func _layout() -> void:
	var w := size.x
	var h := size.y
	var s := clampf(h / 720.0, 0.75, 1.6)
	_buttons = {
		"left": {"center": Vector2(130 * s, h - 140 * s), "radius": 76 * s, "group": "steer", "hold": true},
		"right": {"center": Vector2(320 * s, h - 140 * s), "radius": 76 * s, "group": "steer", "hold": true},
		"gas": {"center": Vector2(w - 140 * s, h - 150 * s), "radius": 98 * s, "group": "pedal", "hold": true},
		"brake": {"center": Vector2(w - 340 * s, h - 105 * s), "radius": 70 * s, "group": "pedal", "hold": true},
		"handbrake": {"center": Vector2(w - 345 * s, h - 285 * s), "radius": 64 * s, "group": "hb", "hold": true},
		"nitro": {"center": Vector2(w - 140 * s, h - 355 * s), "radius": 62 * s, "group": "nitro", "hold": true},
		"garage": {"center": Vector2(58, 52) * s, "radius": 34 * s, "group": "ui", "hold": false},
		"camera": {"center": Vector2(142, 52) * s, "radius": 34 * s, "group": "ui", "hold": false},
		"reset": {"center": Vector2(226, 52) * s, "radius": 34 * s, "group": "ui", "hold": false},
	}
	_joy_center = Vector2(225 * s, h - 170 * s)
	_joy_radius = 110.0 * s
	queue_redraw()


func is_pressed(id: String) -> bool:
	return _fingers.values().has(id)


func release_all() -> void:
	_fingers.clear()
	_joy_offset = Vector2.ZERO
	queue_redraw()


func _hit(pos: Vector2, group: String = "") -> String:
	var best := ""
	var best_d := INF
	for id in _buttons.keys():
		var b: Dictionary = _buttons[id]
		if steer_mode == Steer.JOYSTICK and b.group == "steer":
			continue
		if group != "" and b.group != group:
			continue
		var d := pos.distance_to(b.center)
		if d < b.radius * 1.18 and d < best_d:
			best = id
			best_d = d
	return best


func _input(event: InputEvent) -> void:
	if not visible:
		return
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			if steer_mode == Steer.JOYSTICK and t.position.distance_to(_joy_center) < _joy_radius * 1.4 and not _fingers.values().has("joy"):
				_fingers[t.index] = "joy"
				_joy_offset = (t.position - _joy_center).limit_length(_joy_radius)
			else:
				var id := _hit(t.position)
				if id != "":
					_fingers[t.index] = id
					_on_press(id)
		else:
			if _fingers.get(t.index, "") == "joy":
				_joy_offset = Vector2.ZERO
			_fingers.erase(t.index)
		queue_redraw()
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		if not _fingers.has(d.index):
			return
		var cur: String = _fingers[d.index]
		if cur == "joy":
			_joy_offset = (d.position - _joy_center).limit_length(_joy_radius)
		else:
			# Slide between buttons of the same group without lifting.
			var group: String = _buttons[cur].group
			if group in ["steer", "pedal"]:
				var id2 := _hit(d.position, group)
				if id2 != "" and id2 != cur:
					_fingers[d.index] = id2
					_buzz()
		queue_redraw()
		get_viewport().set_input_as_handled()


func _on_press(id: String) -> void:
	_buzz()
	match id:
		"camera":
			camera_pressed.emit()
		"reset":
			reset_pressed.emit()
		"garage":
			garage_pressed.emit()


func _buzz() -> void:
	if haptics and OS.has_feature("mobile"):
		Input.vibrate_handheld(12)


func _unhandled_key_input(event: InputEvent) -> void:
	if not visible or not (event is InputEventKey) or not event.pressed or event.echo:
		return
	match (event as InputEventKey).keycode:
		KEY_C:
			camera_pressed.emit()
		KEY_R:
			reset_pressed.emit()
		KEY_ESCAPE:
			garage_pressed.emit()


func _process(delta: float) -> void:
	if not visible:
		return
	var held := _fingers.values()
	var kb_left := Input.is_key_pressed(KEY_LEFT) or Input.is_key_pressed(KEY_A)
	var kb_right := Input.is_key_pressed(KEY_RIGHT) or Input.is_key_pressed(KEY_D)
	var target := 0.0
	if steer_mode == Steer.JOYSTICK and held.has("joy"):
		var x := _joy_offset.x / _joy_radius
		target = signf(x) * pow(absf(x), 1.3)
	else:
		if held.has("left") or kb_left:
			target -= 1.0
		if held.has("right") or kb_right:
			target += 1.0
	# Digital buttons ramp in (a tap is a nudge, a hold is full lock) but
	# release instantly, like letting go of a wheel.
	var rate := 7.0 if absf(target) > absf(_steer_smooth) else 14.0
	_steer_smooth = move_toward(_steer_smooth, target, rate * delta)
	steer = _steer_smooth
	throttle = 1.0 if (held.has("gas") or Input.is_key_pressed(KEY_UP) or Input.is_key_pressed(KEY_W)) else 0.0
	brake = 1.0 if (held.has("brake") or Input.is_key_pressed(KEY_DOWN) or Input.is_key_pressed(KEY_S)) else 0.0
	handbrake = held.has("handbrake") or Input.is_key_pressed(KEY_SPACE)
	nitro = held.has("nitro") or Input.is_key_pressed(KEY_SHIFT)
	if vehicle:
		vehicle.in_steer = steer
		vehicle.in_throttle = throttle
		vehicle.in_brake = brake
		vehicle.in_handbrake = handbrake
		vehicle.in_nitro = nitro
	queue_redraw()


# ─────────────────────────────── drawing ───────────────────────────────────


func _draw() -> void:
	for id in _buttons.keys():
		var b: Dictionary = _buttons[id]
		if steer_mode == Steer.JOYSTICK and b.group == "steer":
			continue
		var on := is_pressed(id)
		_glass(b.center, b.radius, on, id == "nitro" or id == "gas")
		_icon(id, b.center, b.radius, on)
	if steer_mode == Steer.JOYSTICK:
		draw_circle(_joy_center, _joy_radius, Color(1, 1, 1, 0.07))
		draw_arc(_joy_center, _joy_radius, 0, TAU, 64, GLASS_EDGE, 2.0, true)
		var knob := _joy_center + _joy_offset
		draw_circle(knob, _joy_radius * 0.42, Color(1, 1, 1, 0.28 if is_pressed("joy") else 0.16))
		draw_arc(knob, _joy_radius * 0.42, 0, TAU, 48, Color(1, 1, 1, 0.6), 2.0, true)


func _glass(c: Vector2, r: float, on: bool, accent: bool) -> void:
	draw_circle(c + Vector2(0, 3), r, Color(0, 0, 0, 0.18))
	draw_circle(c, r, Color(ACCENT, 0.42) if on and accent else Color(1, 1, 1, 0.26 if on else 0.1))
	# Soft top highlight for the glass look.
	draw_arc(c, r * 0.86, PI * 1.12, PI * 1.88, 24, Color(1, 1, 1, 0.16), r * 0.12, true)
	draw_arc(c, r, 0, TAU, 64, Color(1, 1, 1, 0.75) if on else GLASS_EDGE, 2.5 if on else 1.6, true)


func _icon(id: String, c: Vector2, r: float, on: bool) -> void:
	var col := Color(1, 1, 1, 0.95 if on else 0.8)
	var font := get_theme_default_font()
	var fs := int(r * 0.26)
	match id:
		"left":
			draw_colored_polygon(PackedVector2Array([c + Vector2(-r * 0.42, 0), c + Vector2(r * 0.28, -r * 0.4), c + Vector2(r * 0.28, r * 0.4)]), col)
		"right":
			draw_colored_polygon(PackedVector2Array([c + Vector2(r * 0.42, 0), c + Vector2(-r * 0.28, -r * 0.4), c + Vector2(-r * 0.28, r * 0.4)]), col)
		"gas":
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r * 0.46), c + Vector2(r * 0.36, r * 0.05), c + Vector2(-r * 0.36, r * 0.05)]), col)
			_text(font, "GAS", c + Vector2(0, r * 0.45), fs, col)
		"brake":
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, r * 0.3), c + Vector2(r * 0.36, -r * 0.2), c + Vector2(-r * 0.36, -r * 0.2)]), col)
			_text(font, "BRAKE", c + Vector2(0, r * 0.62), fs, col)
		"handbrake":
			draw_arc(c + Vector2(0, -r * 0.08), r * 0.34, 0, TAU, 32, col, 3.0, true)
			_text(font, "(!)", c + Vector2(0, -r * 0.08 + fs * 0.35), fs, col)
			_text(font, "DRIFT", c + Vector2(0, r * 0.55), fs, col)
		"nitro":
			var level := vehicle.nitro if vehicle else 1.0
			draw_arc(c, r * 0.84, -PI * 0.5, -PI * 0.5 + TAU * level, 48, Color(0.3, 0.8, 1.0, 0.9), r * 0.09, true)
			var f := r * 0.5
			var flame := PackedVector2Array([
				c + Vector2(0, -f), c + Vector2(f * 0.45, -f * 0.1), c + Vector2(f * 0.5, f * 0.35),
				c + Vector2(f * 0.2, f * 0.7), c + Vector2(-f * 0.2, f * 0.7), c + Vector2(-f * 0.5, f * 0.35),
				c + Vector2(-f * 0.3, -f * 0.2), c + Vector2(-f * 0.1, f * 0.05),
			])
			draw_colored_polygon(flame, Color(1.0, 0.55, 0.1) if level > 0.05 else Color(0.6, 0.6, 0.6))
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -f * 0.2), c + Vector2(f * 0.25, f * 0.35), c + Vector2(0, f * 0.6), c + Vector2(-f * 0.25, f * 0.35)]), Color(1.0, 0.9, 0.4))
		"camera":
			draw_rect(Rect2(c + Vector2(-r * 0.45, -r * 0.25), Vector2(r * 0.7, r * 0.5)), col, false, 2.0)
			draw_colored_polygon(PackedVector2Array([c + Vector2(r * 0.25, 0), c + Vector2(r * 0.5, -r * 0.22), c + Vector2(r * 0.5, r * 0.22)]), col)
		"reset":
			draw_arc(c, r * 0.4, -PI * 0.2, PI * 1.45, 24, col, 3.0, true)
			var tip := c + Vector2(cos(-PI * 0.2), sin(-PI * 0.2)) * r * 0.4
			draw_colored_polygon(PackedVector2Array([tip + Vector2(-r * 0.2, -r * 0.05), tip + Vector2(r * 0.12, -r * 0.2), tip + Vector2(r * 0.1, r * 0.15)]), col)
		"garage":
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r * 0.48), c + Vector2(r * 0.48, -r * 0.05), c + Vector2(-r * 0.48, -r * 0.05)]), col)
			draw_rect(Rect2(c + Vector2(-r * 0.32, -r * 0.05), Vector2(r * 0.64, r * 0.48)), col)


func _text(font: Font, text: String, at: Vector2, fs: int, col: Color) -> void:
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
	draw_string(font, at - Vector2(w * 0.5, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
