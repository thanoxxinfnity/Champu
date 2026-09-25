class_name GarageUI
extends Control
## The car-shop overlay: car identity and stats on the left, live
## customisation on the right, settings along the top, DRIVE bottom-right.
## Built in code so every size scales from one number with the screen.

signal prev_car
signal next_car
signal drive
signal config_changed(config: Dictionary)
signal time_changed(mode: String)
signal quality_changed(level: int)
signal steer_mode_changed(mode: int)

const ACCENT := Color(1.0, 0.45, 0.08)
const TIMES := ["golden", "day", "night"]
const TIME_NAMES := ["GOLDEN HOUR", "DAY", "NIGHT"]
const QUALITY_NAMES := ["HIGH", "BALANCED", "BATTERY"]
const STEER_NAMES := ["STEER: BUTTONS", "STEER: JOYSTICK"]

var config: Dictionary = {}
var time_index := 0
var quality := 0
var steer_mode := 0

var _maker: Label
var _name: Label
var _badge: Label
var _counter: Label
var _bars := {}
var _swatches: Array[Button] = []
var _finish_btns: Array[Button] = []
var _rim_btns: Array[Button] = []
var _glow_btn: Button
var _glow_swatches: Array[Button] = []
var _time_btn: Button
var _quality_btn: Button
var _steer_btn: Button


class StatBar:
	extends Control
	var value := 0.0
	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var bg := StyleBoxFlat.new()
		bg.bg_color = Color(1, 1, 1, 0.08)
		bg.set_corner_radius_all(int(size.y * 0.5))
		draw_style_box(bg, r)
		var fill := StyleBoxFlat.new()
		fill.bg_color = Color(1.0, 0.45, 0.08)
		fill.set_corner_radius_all(int(size.y * 0.5))
		var w := maxf(size.x * clampf(value / 10.0, 0.0, 1.0), size.y)
		draw_style_box(fill, Rect2(Vector2.ZERO, Vector2(w, size.y)))
	func set_value(v: float) -> void:
		value = v
		queue_redraw()


func _ready() -> void:
	# set_anchors_preset() alone keeps the current (zero) rect; this fills.
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme = _make_theme()
	_build()


func _glass_box(radius: int = 16, alpha: float = 0.62) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.045, 0.06, alpha)
	sb.border_color = Color(1, 1, 1, 0.12)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 14
	sb.content_margin_bottom = 14
	return sb


func _make_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 17
	var normal := _glass_box(12, 0.55)
	normal.content_margin_top = 8
	normal.content_margin_bottom = 8
	normal.content_margin_left = 12
	normal.content_margin_right = 12
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color(0.12, 0.13, 0.16, 0.7)
	var pressed := normal.duplicate() as StyleBoxFlat
	pressed.bg_color = Color(ACCENT, 0.85)
	pressed.border_color = Color(1, 1, 1, 0.5)
	t.set_stylebox("normal", "Button", normal)
	t.set_stylebox("hover", "Button", hover)
	t.set_stylebox("pressed", "Button", pressed)
	t.set_stylebox("hover_pressed", "Button", pressed)
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", Color(1, 1, 1, 0.9))
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_color", "Label", Color(1, 1, 1, 0.92))
	t.set_stylebox("panel", "PanelContainer", _glass_box())
	return t


func _label(text: String, size_px: int, color: Color = Color(1, 1, 1, 0.92)) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size_px)
	l.add_theme_color_override("font_color", color)
	return l


func _section(text: String) -> Label:
	return _label(text, 13, Color(1, 1, 1, 0.5))


func _build() -> void:
	# ── top bar ──
	var logo := _label("CHOMU  HORIZON", 30, ACCENT)
	logo.add_theme_constant_override("outline_size", 0)
	logo.position = Vector2(28, 18)
	add_child(logo)
	var sub := _label("GARAGE  ·  CAR SHOP", 14, Color(1, 1, 1, 0.55))
	sub.position = Vector2(30, 58)
	add_child(sub)

	var top := HBoxContainer.new()
	top.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	top.offset_left = -640
	top.offset_right = -24
	top.offset_top = 22
	top.alignment = BoxContainer.ALIGNMENT_END
	top.add_theme_constant_override("separation", 10)
	add_child(top)
	_time_btn = _pill(TIME_NAMES[0], func() -> void:
		time_index = (time_index + 1) % TIMES.size()
		_time_btn.text = TIME_NAMES[time_index]
		time_changed.emit(TIMES[time_index]))
	_quality_btn = _pill("GFX: " + QUALITY_NAMES[0], func() -> void:
		quality = (quality + 1) % QUALITY_NAMES.size()
		_quality_btn.text = "GFX: " + QUALITY_NAMES[quality]
		quality_changed.emit(quality))
	_steer_btn = _pill(STEER_NAMES[0], func() -> void:
		steer_mode = (steer_mode + 1) % 2
		_steer_btn.text = STEER_NAMES[steer_mode]
		steer_mode_changed.emit(steer_mode))
	for b in [_time_btn, _quality_btn, _steer_btn]:
		top.add_child(b)

	# ── left: identity + stats ──
	var left := PanelContainer.new()
	left.position = Vector2(24, 96)
	left.custom_minimum_size = Vector2(320, 0)
	add_child(left)
	var lv := VBoxContainer.new()
	lv.add_theme_constant_override("separation", 6)
	left.add_child(lv)
	_maker = _label("", 14, Color(1, 1, 1, 0.55))
	_name = _label("", 30)
	_badge = _label("", 13, ACCENT)
	lv.add_child(_maker)
	lv.add_child(_name)
	lv.add_child(_badge)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 8)
	lv.add_child(gap)
	for key in ["speed", "acceleration", "handling", "drift"]:
		var row := VBoxContainer.new()
		row.add_theme_constant_override("separation", 3)
		var head := HBoxContainer.new()
		var nm := _label(key.to_upper() if key != "speed" else "TOP SPEED", 13, Color(1, 1, 1, 0.6))
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var val := _label("0.0", 13)
		head.add_child(nm)
		head.add_child(val)
		var bar := StatBar.new()
		bar.custom_minimum_size = Vector2(280, 8)
		row.add_child(head)
		row.add_child(bar)
		lv.add_child(row)
		_bars[key] = [bar, val]
	_counter = _label("", 13, Color(1, 1, 1, 0.45))
	lv.add_child(_counter)

	# ── right: customisation ──
	var right := PanelContainer.new()
	right.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	right.offset_left = -372
	right.offset_right = -24
	right.offset_top = 96
	add_child(right)
	var rv := VBoxContainer.new()
	rv.add_theme_constant_override("separation", 8)
	right.add_child(rv)

	rv.add_child(_section("PAINT"))
	var grid := GridContainer.new()
	grid.columns = 5
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	rv.add_child(grid)
	for i in PaintCustomizer.PALETTE.size():
		var sw := _swatch(PaintCustomizer.PALETTE[i], 44)
		var idx := i
		sw.pressed.connect(func() -> void:
			config.color = PaintCustomizer.PALETTE[idx]
			_emit())
		grid.add_child(sw)
		_swatches.append(sw)

	rv.add_child(_section("FINISH"))
	var fin := HBoxContainer.new()
	fin.add_theme_constant_override("separation", 8)
	rv.add_child(fin)
	for i in PaintCustomizer.FINISHES.size():
		var idx2 := i
		var b := _pill(PaintCustomizer.FINISHES[i], func() -> void:
			config.finish = idx2
			_emit())
		b.toggle_mode = true
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fin.add_child(b)
		_finish_btns.append(b)

	rv.add_child(_section("RIMS"))
	var rims := HBoxContainer.new()
	rims.add_theme_constant_override("separation", 6)
	rv.add_child(rims)
	for i in PaintCustomizer.RIMS.size():
		var idx3 := i
		var b2 := _pill(PaintCustomizer.RIMS[i], func() -> void:
			config.rim = idx3
			_emit())
		b2.toggle_mode = true
		b2.add_theme_font_size_override("font_size", 13)
		b2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rims.add_child(b2)
		_rim_btns.append(b2)

	rv.add_child(_section("NEON UNDERGLOW"))
	var glow := HBoxContainer.new()
	glow.add_theme_constant_override("separation", 8)
	rv.add_child(glow)
	_glow_btn = _pill("OFF", func() -> void:
		config.underglow = not config.underglow
		_emit())
	_glow_btn.toggle_mode = true
	_glow_btn.custom_minimum_size = Vector2(70, 40)
	glow.add_child(_glow_btn)
	for i in PaintCustomizer.GLOW_COLORS.size():
		var idx4 := i
		var gs := _swatch(PaintCustomizer.GLOW_COLORS[i], 38)
		gs.pressed.connect(func() -> void:
			config.glow = idx4
			config.underglow = true
			_emit())
		glow.add_child(gs)
		_glow_swatches.append(gs)

	# ── car switching arrows ──
	var prev := _arrow("<", func() -> void: prev_car.emit())
	prev.set_anchors_and_offsets_preset(Control.PRESET_CENTER_LEFT)
	prev.offset_left = 362
	prev.offset_right = 420
	prev.offset_top = -30
	prev.offset_bottom = 30
	add_child(prev)
	var nxt := _arrow(">", func() -> void: next_car.emit())
	nxt.set_anchors_and_offsets_preset(Control.PRESET_CENTER_RIGHT)
	nxt.offset_left = -448
	nxt.offset_right = -390
	nxt.offset_top = -30
	nxt.offset_bottom = 30
	add_child(nxt)

	# ── drive ──
	var go := Button.new()
	go.text = "DRIVE"
	go.add_theme_font_size_override("font_size", 26)
	var gs2 := StyleBoxFlat.new()
	gs2.bg_color = ACCENT
	gs2.set_corner_radius_all(16)
	gs2.shadow_color = Color(1.0, 0.4, 0.05, 0.45)
	gs2.shadow_size = 14
	go.add_theme_stylebox_override("normal", gs2)
	var gs3 := gs2.duplicate() as StyleBoxFlat
	gs3.bg_color = ACCENT.lightened(0.15)
	go.add_theme_stylebox_override("hover", gs3)
	go.add_theme_stylebox_override("pressed", gs3)
	go.add_theme_color_override("font_color", Color.WHITE)
	go.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	go.offset_left = -372
	go.offset_right = -24
	go.offset_top = -92
	go.offset_bottom = -24
	go.pressed.connect(func() -> void: drive.emit())
	add_child(go)

	var hint := _label("Swipe to change car  ·  Drag to orbit  ·  Tap the car to open the doors", 13, Color(1, 1, 1, 0.42))
	hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.offset_left = -300
	hint.offset_right = 300
	hint.offset_top = -44
	hint.offset_bottom = -20
	add_child(hint)


func _pill(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 40)
	b.pressed.connect(on_press)
	return b


func _arrow(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", 30)
	var sb := _glass_box(29, 0.45)
	sb.content_margin_left = 0
	sb.content_margin_right = 0
	b.add_theme_stylebox_override("normal", sb)
	b.pressed.connect(on_press)
	return b


func _swatch(color: Color, px: int) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(px, px)
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(px / 2)
	sb.border_color = Color(1, 1, 1, 0.25)
	sb.set_border_width_all(2)
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", sb)
	var sel := sb.duplicate() as StyleBoxFlat
	sel.border_color = Color.WHITE
	sel.set_border_width_all(4)
	b.add_theme_stylebox_override("pressed", sel)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.toggle_mode = true
	return b


func _emit() -> void:
	_refresh_selection()
	config_changed.emit(config)


func _refresh_selection() -> void:
	for i in _swatches.size():
		_swatches[i].set_pressed_no_signal(PaintCustomizer.PALETTE[i].is_equal_approx(config.color))
	for i in _finish_btns.size():
		_finish_btns[i].set_pressed_no_signal(i == config.finish)
	for i in _rim_btns.size():
		_rim_btns[i].set_pressed_no_signal(i == config.rim)
	_glow_btn.set_pressed_no_signal(config.underglow)
	_glow_btn.text = "ON" if config.underglow else "OFF"
	for i in _glow_swatches.size():
		_glow_swatches[i].set_pressed_no_signal(config.underglow and i == config.glow)


func set_car(car: Dictionary, cfg: Dictionary, index: int, total: int) -> void:
	config = cfg
	_maker.text = car.maker.to_upper()
	_name.text = car.name
	_badge.text = "%s  ·  %s  ·  %d KG" % [car["class"], car.drivetrain, int(car.mass)]
	_counter.text = "CAR %d / %d" % [index + 1, total]
	var st := CarCatalog.stats(car)
	for key in _bars.keys():
		var bar: StatBar = _bars[key][0]
		var val: Label = _bars[key][1]
		var target: float = st[key]
		var tw := create_tween()
		tw.tween_method(bar.set_value, bar.value, target, 0.5).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		val.text = "%.1f" % target
	_refresh_selection()
