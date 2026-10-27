class_name GameHUD
extends CanvasLayer
## The whole touch interface. In play it is one Control that draws everything and follows every finger by its index (so the left thumb can steer while the
## right one jets, fires and looks — buttons made of Controls only answer to one touch):
##   · left side, anywhere: a floating virtual joystick (appears under the thumb);
##   · right: JUMP/JET (hold in the air to fly), SHATTER WAVE (fire the gauntlet), BRIDGE PLACE, SELECT BLOCK, and drag anywhere else to look;
##   · top: stability + fuel bars, distance, round, coins, the PING readout (green < 100 ms, orange 100–200, red above);
##   · bottom: the inventory strip — owned weapons (tap one to equip) and the selected block type.
## The NET panel (room codes: copy/paste, host/join) is made of real Controls because it needs a keyboard and the clipboard.

signal jump_down
signal jump_up
signal fire_down
signal bridge_pressed
signal block_pressed
signal weapon_chosen(id: String)
signal pause_pressed
signal net_pressed
signal ride_pressed

var move := Vector2.ZERO
var look := Vector2.ZERO                 # radians since last read
var playing := false
var stability := 1.0
var fuel := 1.0
var distance := 0.0
var round_no := 1
var coins := 0
var ping_ms := -1                        # -1 = offline
var block_name := "STEEL"
var block_color := Color.WHITE
var weapon_id := "shift_gauntlet"
var owned: Array = ["shift_gauntlet"]
var cooldown := 0.0                      # 0..1 of the weapon cooldown left
var toast_text := ""
var toast_t := 0.0
var banner_text := ""
var banner_t := 0.0
var net_text := ""
var ride_label := ""                    # "" = no mount near; else the RIDE button's text (RIDE / DRIVE / GET OFF)
var world_mode := false                  # the open world: no bridge/block buttons or weapon strip, SHATTER WAVE becomes BOOST
var round_label := "ROUND"
var strip := true                        # the train strip at the top (off in the open world)
var minimap: Array = []                  # [[z, x, color], ...] players on the train, for the strip at the top

var _canvas: Control
var _stick_id := -1
var _stick_origin := Vector2.ZERO
var _stick_pos := Vector2.ZERO
var _look_id := -1
var _look_last := Vector2.ZERO
var _btn: Dictionary = {}                # name -> {rect: Rect2, id: int(finger), held: bool}
var _weapon_rects: Array = []            # [Rect2, id]
var _size := Vector2(1280, 720)
var _t := 0.0
var _font: Font
var look_sens := 0.0042
# the NET panel
var net_panel: PanelContainer
var code_out: TextEdit
var code_in: TextEdit
var net_status: Label
var host_btn: Button
var join_btn: Button
var accept_btn: Button
var finish_btn: Button


func _ready() -> void:
	layer = 10
	_font = ThemeDB.fallback_font
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.draw.connect(_draw_all)
	add_child(_canvas)
	_layout()
	_canvas.resized.connect(_layout)
	_build_net_panel()


func _layout() -> void:
	_size = _canvas.size if _canvas.size.x > 10 else Vector2(1280, 720)
	var w := _size.x
	var h := _size.y
	_btn = {
		"jet": {"rect": Rect2(w - 190, h - 190, 150, 150), "id": -1, "held": false, "label": "JUMP\nJET"},
		"fire": {"rect": Rect2(w - 360, h - 150, 120, 120), "id": -1, "held": false, "label": "SHATTER\nWAVE"},
		"bridge": {"rect": Rect2(w - 330, h - 290, 110, 110), "id": -1, "held": false, "label": "BRIDGE\nPLACE"},
		"block": {"rect": Rect2(w - 205, h - 330, 90, 90), "id": -1, "held": false, "label": "SELECT\nBLOCK"},
		"ride": {"rect": Rect2(w - 500, h - 250, 120, 120), "id": -1, "held": false, "label": "RIDE"},
		"pause": {"rect": Rect2(w - 74, 16, 56, 56), "id": -1, "held": false, "label": "II"},
		"net": {"rect": Rect2(w - 140, 16, 56, 56), "id": -1, "held": false, "label": "NET"},
	}


func set_playing(on: bool) -> void:
	playing = on
	move = Vector2.ZERO
	_stick_id = -1
	_look_id = -1
	for k in _btn:
		_btn[k].id = -1
		_btn[k].held = false
	_canvas.queue_redraw()


func take_look() -> Vector2:
	var l := look
	look = Vector2.ZERO
	return l


func toast(text: String, secs := 2.2) -> void:
	toast_text = text
	toast_t = secs


func banner(text: String, secs := 2.8) -> void:
	banner_text = text
	banner_t = secs


# ── input: every finger on its own ───────────────────────────────────────────

func _input(e: InputEvent) -> void:
	if not playing or (net_panel != null and net_panel.visible):
		return
	if e is InputEventScreenTouch:
		_touch(e.index, e.position, e.pressed)
	elif e is InputEventScreenDrag:
		_drag(e.index, e.position, e.relative)
	elif e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		_touch(99, e.position, e.pressed)         # mouse stands in for one finger (desktop tests)
	elif e is InputEventMouseMotion and (e.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
		_drag(99, e.position, e.relative)


func _canvas_pos(p: Vector2) -> Vector2:
	return p       # canvas_items stretch already hands viewport-space positions to _input


func _touch(idx: int, pos: Vector2, down: bool) -> void:
	pos = _canvas_pos(pos)
	if not down:
		if idx == _stick_id:
			_stick_id = -1
			move = Vector2.ZERO
		if idx == _look_id:
			_look_id = -1
		for k in _btn:
			if _btn[k].id == idx:
				_btn[k].id = -1
				if _btn[k].held:
					_btn[k].held = false
					if k == "jet":
						jump_up.emit()
		return
	# a button?
	for k in _btn:
		if (k == "ride" and ride_label == "") or (world_mode and (k == "bridge" or k == "block")):
			continue
		if (_btn[k].rect as Rect2).grow(10).has_point(pos):
			_btn[k].id = idx
			_btn[k].held = true
			match k:
				"jet":
					jump_down.emit()
				"fire":
					fire_down.emit()
				"bridge":
					bridge_pressed.emit()
				"block":
					block_pressed.emit()
				"pause":
					pause_pressed.emit()
				"net":
					net_pressed.emit()
			return
	# the inventory strip
	for wr in _weapon_rects:
		if (wr[0] as Rect2).has_point(pos):
			weapon_chosen.emit(String(wr[1]))
			return
	if pos.x < _size.x * 0.45 and pos.y > 90.0 and _stick_id == -1:
		_stick_id = idx
		_stick_origin = pos
		_stick_pos = pos
		move = Vector2.ZERO
	elif pos.x >= _size.x * 0.45 and _look_id == -1:
		_look_id = idx
		_look_last = pos


func _drag(idx: int, pos: Vector2, rel: Vector2) -> void:
	pos = _canvas_pos(pos)
	if idx == _stick_id:
		_stick_pos = pos
		var off := (pos - _stick_origin)
		var r := 90.0
		if off.length() > r:
			_stick_origin += off.normalized() * (off.length() - r)       # the stick follows the thumb
			off = pos - _stick_origin
		var v := off / r
		move = Vector2(v.x, -v.y) if v.length() > 0.12 else Vector2.ZERO
	elif idx == _look_id:
		look += rel * look_sens


# keyboard stand-ins so the game can be tried on a desktop and driven by tests
func _process(delta: float) -> void:
	_t += delta
	toast_t = maxf(0.0, toast_t - delta)
	banner_t = maxf(0.0, banner_t - delta)
	if playing:
		_canvas.queue_redraw()


func is_held(name: String) -> bool:
	return _btn.has(name) and _btn[name].held


## Test hook: press and release a button by name as a finger would.
func tap(name: String) -> void:
	if not _btn.has(name):
		return
	var r: Rect2 = _btn[name].rect
	_touch(50 + _btn.keys().find(name), r.get_center(), true)


func release(name: String) -> void:
	if _btn.has(name):
		_touch(50 + _btn.keys().find(name), (_btn[name].rect as Rect2).get_center(), false)


# ── drawing ──────────────────────────────────────────────────────────────────

func _glass(r: Rect2, held := false, accent := Color.WHITE) -> void:
	var c := _canvas
	var center := r.get_center()
	var rad := minf(r.size.x, r.size.y) * 0.5
	c.draw_circle(center, rad, Color(1, 1, 1, 0.22 if held else 0.12))
	c.draw_arc(center, rad - 1.5, 0.0, TAU, 40, Color(accent.r, accent.g, accent.b, 0.9 if held else 0.65), 3.0, true)
	c.draw_arc(center, rad - 6.0, PI * 1.1, PI * 1.9, 14, Color(1, 1, 1, 0.35), 2.0, true)


func _text(s: String, pos: Vector2, size: int, col := Color.WHITE, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	_canvas.draw_string(_font, pos + Vector2(1.5, 1.5), s, align, width, size, Color(0, 0, 0, 0.6))
	_canvas.draw_string(_font, pos, s, align, width, size, col)


func _bar(r: Rect2, frac: float, col: Color) -> void:
	_canvas.draw_rect(r, Color(1, 1, 1, 0.14))
	_canvas.draw_rect(Rect2(r.position, Vector2(r.size.x * clampf(frac, 0.0, 1.0), r.size.y)), col)
	_canvas.draw_rect(r, Color(1, 1, 1, 0.5), false, 1.5)


func _draw_all() -> void:
	if not playing:
		return
	var w := _size.x
	var h := _size.y
	# top-left: stability and fuel
	_text("STABILITY", Vector2(24, 30), 14, Color(1, 1, 1, 0.8))
	_bar(Rect2(24, 36, 220, 14), stability, Color(1.0, 0.4, 0.4) if stability < 0.35 else Color(0.5, 1.0, 0.6))
	_text("JET FUEL", Vector2(24, 76), 14, Color(1, 1, 1, 0.8))
	_bar(Rect2(24, 82, 220, 14), fuel, Color(1.0, 0.65, 0.15) if fuel > 0.25 else Color(1.0, 0.3, 0.2))
	# top-centre: distance and round
	_text("%d m" % int(distance), Vector2(0, 40), 28, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, w)
	_text("%s %d   ·   $%d" % [round_label, round_no, coins], Vector2(0, 66), 17, Color(1, 0.88, 0.5), HORIZONTAL_ALIGNMENT_CENTER, w)
	# the train strip: where everyone is on the roof
	var sx := w * 0.5 - 130.0
	if strip:
		_canvas.draw_rect(Rect2(sx, 78, 260, 8), Color(1, 1, 1, 0.14))
		for m in minimap:
			_canvas.draw_circle(Vector2(sx + clampf(1.0 - (float(m[0]) / -90.0), 0.0, 1.0) * 260.0, 82), 5.0, m[2])
	# PING
	if ping_ms >= 0:
		_text("PING: %d ms" % ping_ms, Vector2(w - 330, 30), 18, MultiplayerController.ping_color(ping_ms))
	elif net_text != "":
		_text(net_text, Vector2(w - 330, 30), 15, Color(1, 1, 1, 0.7))
	# buttons
	for k in _btn:
		if (k == "ride" and ride_label == "") or (world_mode and (k == "bridge" or k == "block")):
			continue
		var b: Dictionary = _btn[k]
		var r: Rect2 = b.rect
		var accent := Color.WHITE
		if k == "fire":
			accent = Data.WEAPONS[weapon_id].color
		elif k == "block":
			accent = block_color
		_glass(r, b.held, accent)
		if k == "fire" and cooldown > 0.02:
			_canvas.draw_arc(r.get_center(), r.size.x * 0.5 - 8.0, -PI * 0.5, -PI * 0.5 + TAU * cooldown, 30, Color(1, 1, 1, 0.8), 4.0, true)
		var lines := (ride_label if k == "ride" else ("BOOST" if (world_mode and k == "fire") else String(b.label))).split("\n")
		var fs := 20 if k == "jet" else (13 if k != "pause" and k != "net" else 16)
		for i in lines.size():
			var yy := r.get_center().y + (float(i) - float(lines.size() - 1) * 0.5) * (fs + 3.0) + fs * 0.35
			_text(lines[i], Vector2(r.position.x, yy), fs, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, r.size.x)
	if not world_mode:
		_text(block_name, Vector2(_btn["block"].rect.position.x, _btn["block"].rect.position.y - 8), 13, block_color, HORIZONTAL_ALIGNMENT_CENTER, _btn["block"].rect.size.x)
	# the joystick, under the thumb
	if _stick_id != -1:
		_canvas.draw_circle(_stick_origin, 90.0, Color(1, 1, 1, 0.08))
		_canvas.draw_arc(_stick_origin, 90.0, 0.0, TAU, 40, Color(1, 1, 1, 0.5), 2.5, true)
		var knob := _stick_origin + Vector2(move.x, -move.y) * 90.0
		_canvas.draw_circle(knob, 34.0, Color(1, 1, 1, 0.3))
		_canvas.draw_arc(knob, 34.0, 0.0, TAU, 24, Color(1, 1, 1, 0.8), 3.0, true)
	else:
		_canvas.draw_arc(Vector2(150, h - 150), 80.0, 0.0, TAU, 40, Color(1, 1, 1, 0.14), 2.0, true)
		_text("MOVE", Vector2(110, h - 144), 15, Color(1, 1, 1, 0.3), HORIZONTAL_ALIGNMENT_CENTER, 80.0)
	# inventory strip
	_weapon_rects.clear()
	var n := owned.size()
	var cell := 54.0
	var x0 := w * 0.5 - float(n) * (cell + 6.0) * 0.5
	for i in n:
		var id: String = owned[i]
		var rr := Rect2(x0 + float(i) * (cell + 6.0), h - cell - 14.0, cell, cell)
		_weapon_rects.append([rr, id])
		var col: Color = Data.WEAPONS[id].color
		_canvas.draw_rect(rr, Color(1, 1, 1, 0.22 if id == weapon_id else 0.08))
		_canvas.draw_rect(rr, Color(col.r, col.g, col.b, 0.95 if id == weapon_id else 0.45), false, 2.5 if id == weapon_id else 1.5)
		_canvas.draw_circle(rr.get_center(), 12.0, Color(col.r, col.g, col.b, 0.9))
		var nm: String = String(Data.WEAPONS[id].name)
		_text(nm.substr(0, 1) + nm.get_slice(" ", 1).substr(0, 1), rr.get_center() + Vector2(-9, 5), 13, Color.BLACK)
	# toast and banner
	if toast_t > 0.0:
		_text(toast_text, Vector2(0, h * 0.72), 20, Color(1, 1, 1, clampf(toast_t * 2.0, 0.0, 1.0)), HORIZONTAL_ALIGNMENT_CENTER, w)
	if banner_t > 0.0:
		_text(banner_text, Vector2(0, h * 0.3), 40, Color(1, 0.9, 0.5, clampf(banner_t * 1.5, 0.0, 1.0)), HORIZONTAL_ALIGNMENT_CENTER, w)
	# crosshair
	_canvas.draw_circle(Vector2(w * 0.5 + 0.0, h * 0.5 - 20.0), 3.0, Color(1, 1, 1, 0.8))
	_canvas.draw_arc(Vector2(w * 0.5, h * 0.5 - 20.0), 11.0, 0.0, TAU, 20, Color(1, 1, 1, 0.45), 1.5, true)


# ── the NET panel: room codes ────────────────────────────────────────────────

func _build_net_panel() -> void:
	net_panel = PanelContainer.new()
	net_panel.set_anchors_preset(Control.PRESET_CENTER)
	net_panel.custom_minimum_size = Vector2(760, 470)
	net_panel.position = Vector2(260, 100)
	net_panel.visible = false
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.09, 0.2, 0.96)
	sb.set_corner_radius_all(18)
	sb.border_color = Color(1.0, 0.62, 0.25)
	sb.set_border_width_all(2)
	sb.set_content_margin_all(18)
	net_panel.add_theme_stylebox_override("panel", sb)
	add_child(net_panel)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 8)
	net_panel.add_child(vb)
	var title := Label.new()
	title.text = "PLAY TOGETHER  —  room codes"
	title.add_theme_font_size_override("font_size", 26)
	vb.add_child(title)
	var how := Label.new()
	how.text = "HOST makes the room.  A friend taps JOIN and sends you their code; paste it under ADD PLAYER and send back the answer; they paste it under FINISH."
	how.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	how.add_theme_font_size_override("font_size", 15)
	how.modulate = Color(1, 1, 1, 0.75)
	vb.add_child(how)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	vb.add_child(row)
	host_btn = _mk_button("HOST A ROOM", row)
	join_btn = _mk_button("JOIN A ROOM", row)
	var close := _mk_button("CLOSE", row)
	close.pressed.connect(func() -> void: net_panel.visible = false)
	var l1 := Label.new()
	l1.text = "YOUR CODE (send this)"
	l1.add_theme_font_size_override("font_size", 14)
	vb.add_child(l1)
	code_out = TextEdit.new()
	code_out.custom_minimum_size = Vector2(0, 90)
	code_out.editable = false
	code_out.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	vb.add_child(code_out)
	var r2 := HBoxContainer.new()
	vb.add_child(r2)
	var copy := _mk_button("COPY", r2)
	copy.pressed.connect(func() -> void: DisplayServer.clipboard_set(code_out.text))
	var l2 := Label.new()
	l2.text = "THEIR CODE (paste here)"
	l2.add_theme_font_size_override("font_size", 14)
	vb.add_child(l2)
	code_in = TextEdit.new()
	code_in.custom_minimum_size = Vector2(0, 90)
	code_in.placeholder_text = "CS1-…"
	code_in.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	vb.add_child(code_in)
	var r3 := HBoxContainer.new()
	r3.add_theme_constant_override("separation", 10)
	vb.add_child(r3)
	var paste := _mk_button("PASTE", r3)
	paste.pressed.connect(func() -> void: code_in.text = DisplayServer.clipboard_get())
	accept_btn = _mk_button("ADD PLAYER (host)", r3)
	finish_btn = _mk_button("FINISH (joiner)", r3)
	net_status = Label.new()
	net_status.add_theme_font_size_override("font_size", 16)
	net_status.modulate = Color(1.0, 0.85, 0.5)
	vb.add_child(net_status)


func _mk_button(text: String, parent: Control) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(160, 48)
	b.add_theme_font_size_override("font_size", 17)
	var n := StyleBoxFlat.new()
	n.bg_color = Color(1, 1, 1, 0.12)
	n.set_corner_radius_all(12)
	n.border_color = Color(1, 1, 1, 0.6)
	n.set_border_width_all(2)
	b.add_theme_stylebox_override("normal", n)
	var p := n.duplicate() as StyleBoxFlat
	p.bg_color = Color(1.0, 0.62, 0.25, 0.4)
	b.add_theme_stylebox_override("pressed", p)
	b.add_theme_stylebox_override("hover", p)
	parent.add_child(b)
	return b


func show_net(on: bool) -> void:
	net_panel.visible = on


func set_status(text: String) -> void:
	net_status.text = text
	net_text = text


func show_code(code: String) -> void:
	code_out.text = code
