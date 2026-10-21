class_name GlyphButton
extends Control
## A round touch button with a white line-art icon instead of a text label (fist, foot, shield, dash, wings, and one glyph per technique).
## An outer ring fills with cursed energy so you can see when a technique is ready; the button flashes when pressed.

signal pressed_down
signal released

var glyph := "fist"
var radius := 40.0
var fill := 1.0            ## 0..1 energy ready ring (1 = ready)
var tint := Color(1, 1, 1)
var _down := false
var _flash := 0.0

func _ready() -> void:
	custom_minimum_size = Vector2(radius * 2.0, radius * 2.0)
	size = custom_minimum_size
	mouse_filter = Control.MOUSE_FILTER_STOP

func _gui_input(e: InputEvent) -> void:
	if (e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT) or e is InputEventScreenTouch:
		if e.pressed and not _down:
			_down = true
			_flash = 1.0
			pressed_down.emit()
			Sound.play("click", -16.0, 1.2)
		elif not e.pressed and _down:
			_down = false
			released.emit()
		accept_event()
		queue_redraw()

func _process(delta: float) -> void:
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - delta * 4.0)
		queue_redraw()

func set_fill(v: float) -> void:
	if not is_equal_approx(v, fill):
		fill = v
		queue_redraw()

func _draw() -> void:
	var c := size * 0.5
	var r := radius
	var ready := fill >= 0.999
	draw_circle(c, r, Color(0.05, 0.05, 0.07, 0.42 + 0.25 * _flash))
	draw_arc(c, r - 1.5, 0, TAU, 48, Color(1, 1, 1, 0.22), 2.0, true)
	if fill < 0.999:
		draw_arc(c, r - 1.5, -PI / 2, -PI / 2 + TAU * fill, 48, Color(tint.r, tint.g, tint.b, 0.85), 3.0, true)
	elif tint != Color(1, 1, 1):
		draw_arc(c, r - 1.5, 0, TAU, 48, Color(tint.r, tint.g, tint.b, 0.9), 3.0, true)
	var a := 0.95 if ready else 0.45
	var w := Color(1, 1, 1, a)
	var s := r * 0.42
	_icon(c, s, w)

func _l(a: Vector2, b: Vector2, col: Color, wdt := 3.0) -> void:
	draw_line(a, b, col, wdt, true)

func _icon(c: Vector2, s: float, w: Color) -> void:
	match glyph:
		"fist":
			draw_rect(Rect2(c + Vector2(-s * 0.8, -s * 0.45), Vector2(s * 1.6, s * 1.0)), w, false, 3.0)
			for i in 3:
				_l(c + Vector2(-s * 0.8 + s * 0.53 * (i + 1), -s * 0.45), c + Vector2(-s * 0.8 + s * 0.53 * (i + 1), s * 0.05), w, 2.0)
			_l(c + Vector2(-s * 0.8, s * 0.1), c + Vector2(-s * 1.15, -s * 0.2), w)
			_l(c + Vector2(-s * 0.3, s * 0.55), c + Vector2(-s * 0.3, s * 1.05), w)
			_l(c + Vector2(s * 0.4, s * 0.55), c + Vector2(s * 0.4, s * 1.05), w)
		"foot":
			draw_polyline(PackedVector2Array([c + Vector2(-s * 0.3, -s), c + Vector2(-s * 0.3, s * 0.4), c + Vector2(s * 0.9, s * 0.4), c + Vector2(s * 0.9, s * 0.8), c + Vector2(-s * 0.7, s * 0.8), c + Vector2(-s * 0.7, -s)]), w, 3.0, true)
		"shield":
			draw_polyline(PackedVector2Array([c + Vector2(0, -s), c + Vector2(s * 0.9, -s * 0.6), c + Vector2(s * 0.7, s * 0.4), c + Vector2(0, s * 1.0), c + Vector2(-s * 0.7, s * 0.4), c + Vector2(-s * 0.9, -s * 0.6), c + Vector2(0, -s)]), w, 3.0, true)
		"dash":
			for i in 2:
				var o := Vector2(-s * 0.5 + i * s * 0.7, 0)
				draw_polyline(PackedVector2Array([c + o + Vector2(-s * 0.3, -s * 0.7), c + o + Vector2(s * 0.3, 0), c + o + Vector2(-s * 0.3, s * 0.7)]), w, 3.0, true)
		"fly":
			draw_polyline(PackedVector2Array([c + Vector2(-s, s * 0.3), c + Vector2(-s * 0.3, -s * 0.5), c + Vector2(0, s * 0.1), c + Vector2(s * 0.3, -s * 0.5), c + Vector2(s, s * 0.3)]), w, 3.0, true)
			_l(c + Vector2(0, -s), c + Vector2(0, -s * 0.2), w)
			_l(c + Vector2(-s * 0.25, -s * 0.7), c + Vector2(0, -s), w)
			_l(c + Vector2(s * 0.25, -s * 0.7), c + Vector2(0, -s), w)
		"up", "down":
			var sg := -1.0 if glyph == "up" else 1.0
			for k in 2:
				var y0 := sg * (s * 0.1 - k * s * 0.55)
				draw_polyline(PackedVector2Array([c + Vector2(-s * 0.6, y0 - sg * s * 0.35), c + Vector2(0, y0 + sg * s * 0.25), c + Vector2(s * 0.6, y0 - sg * s * 0.35)]), w, 3.0, true)
		"blue":
			draw_arc(c, s * 0.45, 0, TAU, 24, w, 3.0, true)
			for i in 4:
				var d := Vector2.from_angle(i * PI / 2 + PI / 4)
				_l(c + d * s * 1.05, c + d * s * 0.6, w)
				_l(c + d * s * 0.6, c + d * s * 0.6 + d.rotated(2.5) * s * 0.25, w, 2.0)
				_l(c + d * s * 0.6, c + d * s * 0.6 + d.rotated(-2.5) * s * 0.25, w, 2.0)
		"red":
			draw_circle(c, s * 0.3, w)
			for i in 8:
				var d := Vector2.from_angle(i * PI / 4)
				_l(c + d * s * 0.5, c + d * s * 1.05, w, 2.5)
		"purple":
			draw_arc(c + Vector2(-s * 0.35, 0), s * 0.55, 0, TAU, 24, w, 3.0, true)
			draw_arc(c + Vector2(s * 0.35, 0), s * 0.55, 0, TAU, 24, w, 3.0, true)
		"void":
			draw_polyline(PackedVector2Array([c + Vector2(-s, 0), c + Vector2(-s * 0.4, -s * 0.5), c + Vector2(s * 0.4, -s * 0.5), c + Vector2(s, 0), c + Vector2(s * 0.4, s * 0.5), c + Vector2(-s * 0.4, s * 0.5), c + Vector2(-s, 0)]), w, 3.0, true)
			draw_circle(c, s * 0.28, w)
		"dismantle":
			for i in 3:
				var o := Vector2(0, (i - 1) * s * 0.55)
				_l(c + o + Vector2(-s, s * 0.25), c + o + Vector2(s, -s * 0.25), w, 2.5)
		"cleave":
			_l(c + Vector2(-s, -s), c + Vector2(s, s), w, 3.5)
			_l(c + Vector2(-s, s), c + Vector2(s, -s), w, 3.5)
		"fuga":
			draw_polyline(PackedVector2Array([c + Vector2(0, s * 1.0), c + Vector2(-s * 0.6, s * 0.1), c + Vector2(-s * 0.2, -s * 0.2), c + Vector2(-s * 0.1, -s), c + Vector2(s * 0.3, -s * 0.3), c + Vector2(s * 0.6, s * 0.1), c + Vector2(0, s * 1.0)]), w, 3.0, true)
		"shrine":
			_l(c + Vector2(-s * 1.1, -s * 0.7), c + Vector2(s * 1.1, -s * 0.7), w, 3.5)
			_l(c + Vector2(-s * 0.8, -s * 0.35), c + Vector2(s * 0.8, -s * 0.35), w, 2.5)
			_l(c + Vector2(-s * 0.55, -s * 0.7), c + Vector2(-s * 0.55, s), w, 3.0)
			_l(c + Vector2(s * 0.55, -s * 0.7), c + Vector2(s * 0.55, s), w, 3.0)
		"super":
			draw_polyline(PackedVector2Array([c + Vector2(s * 0.2, -s), c + Vector2(-s * 0.5, s * 0.1), c + Vector2(0, s * 0.1), c + Vector2(-s * 0.2, s), c + Vector2(s * 0.5, -s * 0.1), c + Vector2(0, -s * 0.1), c + Vector2(s * 0.2, -s)]), w, 3.0, true)
