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
signal results_closed

var move := Vector2.ZERO
var look := Vector2.ZERO                 # radians since last read
var playing := false
var stability := 1.0
var fuel := 1.0
var heat := 0.0                          # jetpack heat 0..1 (OVERHEAT at 1)
var overheated := false
var distance := 0.0
var round_no := 1
var coins := 0
var ping_ms := -1                        # -1 = offline
var debug_overlay := false               # Settings → DEBUG: frame rate, draw calls, objects, falls caught by the safety floor
var falls_caught := 0
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
# the match (open world)
var match_on := false
var time_left := 0.0
var my_kills := 0
var team_kills := 0
var team_mode := false
var charges := {}                        # weapon id -> [charge 0..1, locked]
var feed: Array = []                     # [text, ttl, Color]
var board: Array = []                    # scoreboard rows
var show_board := false
var results := {}                        # not empty: the match is over, tap to leave
var death_t := 0.0                       # seconds until I respawn (0 = alive)
var fire_label := "FIRE"
var hit_t := 0.0                         # my shot landed: the cross-hair flickers (seconds left)
var hit_dmg := 0.0
var gate_angle := 0.0                    # radians, + = the next gate is to the left of where the camera looks
var gate_dist := -1.0                    # metres to the next gate (open world), -1 = none
var map_path := PackedVector2Array()     # the open world map: the road loop, the gates, the river, the places; you and the others (world x, z)
var map_gates := PackedVector2Array()
var map_next := 0
var map_river: Array = []
var map_places: Array = []               # [Vector2, name]
var map_half := 330.0
var map_you := Vector2.ZERO
var map_yaw := 0.0
var map_others := PackedVector2Array()
var map_big := false                     # tap the little map to open it
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
		"score": {"rect": Rect2(w - 208, 16, 56, 56), "id": -1, "held": false, "label": "TOP"},
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
	elif e.device == InputEvent.DEVICE_ID_EMULATION:
		return                                     # the mouse events a phone makes up from a finger (menus need them): the finger was handled above
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
	if not results.is_empty():
		results_closed.emit()
		return
	if world_mode and not map_path.is_empty():
		if map_big:
			map_big = false                  # any tap closes the big map
			return
		if _map_rect().grow(8).has_point(pos):
			map_big = true
			return
	# a button?
	for k in _btn:
		if (k == "ride" and ride_label == "") or (k == "score" and not match_on):
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
	hit_t = maxf(0.0, hit_t - delta)
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


func _map_rect() -> Rect2:
	var w := _size.x
	return Rect2(w - 196, 86, 172, 172)


## One map drawing for both sizes: `r` is the square it fills.
func _draw_map(r: Rect2, big: bool) -> void:
	var c := _canvas
	var k := r.size.x / (map_half * 2.0)
	var o := r.position + r.size * 0.5
	var tf := func(p: Vector2) -> Vector2:
		return o + p * k
	c.draw_style_box(_box(Color(0.1, 0.2, 0.3, 0.86 if big else 0.7), UIKit.INK, 16, 4), r)
	c.draw_rect(r.grow(-4), Color(0.2, 0.42, 0.34, 0.5 if big else 0.35))
	if map_river.size() == 2:
		c.draw_line(tf.call(map_river[0]), tf.call(map_river[1]), Color(0.35, 0.8, 1.0, 0.85), 5.0 if big else 3.0)
	for i in map_path.size():
		c.draw_line(tf.call(map_path[i]), tf.call(map_path[(i + 1) % map_path.size()]), Color(0.95, 0.9, 0.8, 0.95), 4.0 if big else 2.5)
	for i in map_gates.size():
		var g: Vector2 = tf.call(map_gates[i])
		c.draw_circle(g, 7.0 if big else 4.0, Color(1.0, 0.85, 0.3) if i == map_next else Color(0.7, 0.6, 0.9, 0.8))
	for pl in map_places:
		var pp: Vector2 = tf.call(pl[0])
		c.draw_rect(Rect2(pp - Vector2(3, 3), Vector2(6, 6)), Color(1.0, 0.55, 0.7))
		if big:
			_text(String(pl[1]), pp + Vector2(8, 5), 16, Color(1, 0.8, 0.9))
	for q in map_others:
		c.draw_circle(tf.call(q), 6.0 if big else 3.5, Color(0.5, 0.9, 1.0))
	var me: Vector2 = tf.call(map_you)
	c.draw_set_transform(me, -map_yaw, Vector2.ONE)
	c.draw_colored_polygon(PackedVector2Array([Vector2(0, -10), Vector2(7, 8), Vector2(0, 4), Vector2(-7, 8)]) if big else PackedVector2Array([Vector2(0, -7), Vector2(5, 6), Vector2(0, 3), Vector2(-5, 6)]), Color(1, 1, 1))
	c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if big:
		_text("N", Vector2(o.x - 6, r.position.y + 22), 20, Color(1, 1, 1, 0.9))
		_text("tap to close", Vector2(r.position.x, r.end.y + 22), 15, Color(1, 1, 1, 0.7), HORIZONTAL_ALIGNMENT_CENTER, r.size.x)


# ── drawing ──────────────────────────────────────────────────────────────────
# Everything is drawn in the comic/anime style of UIKit: ink outlines, flat bright fills, the title font, little icons; the weapon strip shows the real weapon models.

var _icons := {}                         # weapon id -> Texture2D (baked by tests/icon_baker.gd)
var _boxes := {}


func _icon_of(id: String) -> Texture2D:
	if not _icons.has(id):
		var path := "res://assets/ui/weapons/%s.png" % id
		_icons[id] = load(path) as Texture2D if ResourceLoader.exists(path) else null
	return _icons[id]


func _box(fill: Color, border: Color, radius: int, bw: int) -> StyleBoxFlat:
	var key := "%s%s%d%d" % [fill, border, radius, bw]
	if not _boxes.has(key):
		_boxes[key] = UIKit.box(fill, border, radius, bw, 0)
	return _boxes[key]


func _plate(r: Rect2, fill := Color(0.1, 0.07, 0.22, 0.8), border := Color(1, 1, 1, 0.92), radius := 14, bw := 3) -> void:
	_canvas.draw_style_box(_box(fill, border, radius, bw), r)


func _text(s: String, pos: Vector2, size: int, col := UIKit.CREAM, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0, title := false) -> void:
	UIKit.draw_text(_canvas, s, pos, size, col, title, align, width)


## A comic round button: ink ring, bright fill, shine, an icon and a title-font label.
func _comic_btn(r: Rect2, held: bool, accent: Color, icon: String, label := "", label_px := 20) -> void:
	var c := _canvas
	var ctr := r.get_center()
	var rad := minf(r.size.x, r.size.y) * 0.5 * (0.93 if held else 1.0)
	c.draw_circle(ctr + Vector2(0, 5), rad, Color(0, 0, 0, 0.28))
	c.draw_circle(ctr, rad, Color(accent.r * 0.85, accent.g * 0.85, accent.b * 0.85, 0.96 if held else 0.78))
	c.draw_arc(ctr, rad - 2.0, 0.0, TAU, 44, UIKit.INK, 5.0, true)
	c.draw_arc(ctr, rad - 9.0, PI * 1.1, PI * 1.85, 14, Color(1, 1, 1, 0.55), 3.0, true)
	var up := 0.1 if label != "" else 0.0
	UIKit.draw_icon(c, icon, ctr + Vector2(0, -rad * up * 2.0 - (rad * 0.12 if label != "" else 0.0)), rad * (0.95 if label != "" else 1.15), Color.WHITE)
	if label != "":
		UIKit.draw_text(c, label, Vector2(r.position.x, ctr.y + rad * 0.74), label_px, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, r.size.x)


## A rounded bar with an icon on its left end.
func _bar(r: Rect2, frac: float, col: Color, icon: String) -> void:
	_plate(r, Color(0.07, 0.05, 0.16, 0.92), UIKit.INK, int(r.size.y * 0.5), 3)
	var f := clampf(frac, 0.0, 1.0)
	if f > 0.01:
		var fr := Rect2(r.position + Vector2(3, 3), Vector2(maxf((r.size.x - 6.0) * f, r.size.y - 6.0), r.size.y - 6.0))
		_canvas.draw_style_box(_box(col, col, int(fr.size.y * 0.5), 0), fr)
		_canvas.draw_rect(Rect2(fr.position + Vector2(6, 2), Vector2(maxf(fr.size.x - 12.0, 0.0), maxf(2.0, fr.size.y * 0.22))), Color(1, 1, 1, 0.4))
	UIKit.draw_icon(_canvas, icon, Vector2(r.position.x - 6.0, r.get_center().y), r.size.y * 1.7, col)


func _draw_all() -> void:
	if not playing:
		return
	var w := _size.x
	var h := _size.y
	# top-left card: stability, jet fuel, heat
	_plate(Rect2(10, 8, 276, 100), Color(0.1, 0.07, 0.22, 0.55), Color(1, 1, 1, 0.5), 18, 2)
	_bar(Rect2(52, 18, 222, 22), stability, Color(1.0, 0.35, 0.4) if stability < 0.35 else Color(1.0, 0.45, 0.62), "heart")
	_bar(Rect2(52, 50, 222, 22), fuel, Color(1.0, 0.62, 0.15) if fuel > 0.25 else Color(1.0, 0.3, 0.2), "bolt")
	_bar(Rect2(52, 82, 222, 14), heat, Color(1.0, 0.25, 0.2) if (overheated or heat > 0.8) else Color(1.0, 0.82, 0.3), "flame")
	if overheated:
		_text("OVERHEAT!", Vector2(60, 95), 18, Color(1.0, 0.85, 0.3, 0.6 + 0.4 * sin(_t * 12.0)), HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
	# top-centre: the match clock (or distance and round on the train)
	if match_on:
		var tl := int(ceil(time_left))
		_plate(Rect2(w * 0.5 - 70, 6, 140, 50), Color(0.1, 0.07, 0.22, 0.9), Color(1, 1, 1, 0.95), 24, 3)
		_text("%d:%02d" % [tl / 60, tl % 60], Vector2(0, 46), 38, Color(1, 1, 1) if time_left > 30.0 else Color(1.0, 0.45, 0.4), HORIZONTAL_ALIGNMENT_CENTER, w, true)
		_plate(Rect2(w * 0.5 - 130, 60, 260, 28), Color(0.1, 0.07, 0.22, 0.7), Color(1, 1, 1, 0.6), 14, 2)
		UIKit.draw_icon(_canvas, "skull", Vector2(w * 0.5 - 108, 74), 20, UIKit.CREAM)
		_text("%d" % my_kills, Vector2(w * 0.5 - 92, 82), 20, UIKit.YELLOW, HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
		UIKit.draw_icon(_canvas, "people" if team_mode else "crown", Vector2(w * 0.5 - 28, 74), 20, UIKit.SKY)
		_text("%d" % team_kills, Vector2(w * 0.5 - 12, 82), 20, UIKit.SKY, HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
		UIKit.draw_icon(_canvas, "coin", Vector2(w * 0.5 + 40, 74), 20, UIKit.YELLOW)
		_text("%d" % coins, Vector2(w * 0.5 + 56, 82), 20, UIKit.YELLOW, HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
	else:
		_text("%d m" % int(distance), Vector2(0, 44), 36, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, w, true)
		_text("%s %d   ·   $%d" % [round_label, round_no, coins], Vector2(0, 70), 18, Color(1, 0.88, 0.5), HORIZONTAL_ALIGNMENT_CENTER, w, true)
	if world_mode and gate_dist >= 0.0 and not match_on:
		var ctr := Vector2(w * 0.5, 112.0)
		_canvas.draw_set_transform(ctr, -gate_angle, Vector2.ONE)
		_canvas.draw_colored_polygon(PackedVector2Array([Vector2(0, -24), Vector2(17, 14), Vector2(0, 6), Vector2(-17, 14)]), Color(1.0, 0.85, 0.3, 0.95))
		_canvas.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		_text("%d m" % int(gate_dist), Vector2(0, 148), 18, Color(1, 0.9, 0.5), HORIZONTAL_ALIGNMENT_CENTER, w, true)
	# the train strip: where everyone is on the roof
	var sx := w * 0.5 - 130.0
	if strip:
		_canvas.draw_rect(Rect2(sx, 78, 260, 8), Color(1, 1, 1, 0.14))
		for m in minimap:
			_canvas.draw_circle(Vector2(sx + clampf(1.0 - (float(m[0]) / -90.0), 0.0, 1.0) * 260.0, 82), 5.0, m[2])
	if debug_overlay:
		var dbg := "FPS %d   DRAW %d   OBJ %d   TRIS %dk   MEM %d MB   FALLS %d" % [Engine.get_frames_per_second(),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)), int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0), int(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0), falls_caught]
		_plate(Rect2(16, h - 40, 640, 28), Color(0.05, 0.04, 0.12, 0.8), Color(1, 1, 1, 0.4), 10, 2)
		_text(dbg, Vector2(26, h - 20), 15, Color(0.6, 1.0, 0.7), HORIZONTAL_ALIGNMENT_LEFT, 620.0)
	# PING
	if ping_ms >= 0:
		_plate(Rect2(w - 366, 14, 110, 30), Color(0.1, 0.07, 0.22, 0.75), Color(1, 1, 1, 0.5), 14, 2)
		_text("%d ms" % ping_ms, Vector2(w - 366, 37), 20, MultiplayerController.ping_color(ping_ms), HORIZONTAL_ALIGNMENT_CENTER, 110.0, true)
	elif net_text != "":
		_text(net_text, Vector2(w - 330, 30), 15, Color(1, 1, 1, 0.7))
	if world_mode and not map_path.is_empty():
		if map_big:
			var side := minf(h - 90.0, w - 40.0)
			_draw_map(Rect2((w - side) * 0.5, 30, side, side), true)
		else:
			_draw_map(_map_rect(), false)
	# buttons
	var icons := {"jet": "jet", "fire": "burst", "bridge": "bridge", "block": "cube", "ride": "wheel", "pause": "pause", "score": "trophy", "net": "globe"}
	for k in _btn:
		if (k == "ride" and ride_label == "") or (k == "score" and not match_on) or (k == "net" and match_on):
			continue
		var b: Dictionary = _btn[k]
		var r: Rect2 = b.rect
		var accent := Color(0.62, 0.55, 0.95)
		var label := ""
		match k:
			"jet":
				accent = Color(1.0, 0.6, 0.25)
				label = "JUMP / JET"
			"fire":
				accent = Data.info_of(weapon_id).color
				label = fire_label if world_mode else "SHATTER"
			"bridge":
				accent = Color(0.4, 0.85, 1.0)
				label = "BRIDGE"
			"block":
				accent = block_color
				label = block_name
			"ride":
				accent = Color(0.45, 0.9, 0.6)
				label = ride_label
			"pause", "score", "net":
				accent = Color(0.5, 0.5, 0.8)
		_comic_btn(r, b.held, accent, String(icons[k]), label, 22 if k == "jet" else (17 if k == "block" else 18))
		if k == "fire" and cooldown > 0.02:
			_canvas.draw_arc(r.get_center(), r.size.x * 0.5 + 5.0, -PI * 0.5, -PI * 0.5 + TAU * cooldown, 30, Color(1, 1, 1, 0.9), 4.0, true)
	# the joystick, under the thumb
	if _stick_id != -1:
		_canvas.draw_circle(_stick_origin, 90.0, Color(1, 1, 1, 0.1))
		_canvas.draw_arc(_stick_origin, 90.0, 0.0, TAU, 40, UIKit.INK, 6.0, true)
		_canvas.draw_arc(_stick_origin, 90.0, 0.0, TAU, 40, Color(1, 1, 1, 0.75), 3.0, true)
		var knob := _stick_origin + Vector2(move.x, -move.y) * 90.0
		_canvas.draw_circle(knob, 36.0, Color(1.0, 0.5, 0.65, 0.85))
		_canvas.draw_arc(knob, 36.0, 0.0, TAU, 24, UIKit.INK, 5.0, true)
	else:
		_canvas.draw_arc(Vector2(150, h - 150), 80.0, 0.0, TAU, 40, Color(UIKit.INK.r, UIKit.INK.g, UIKit.INK.b, 0.5), 5.0, true)
		_canvas.draw_arc(Vector2(150, h - 150), 80.0, 0.0, TAU, 40, Color(1, 1, 1, 0.45), 2.5, true)
		UIKit.draw_icon(_canvas, "play", Vector2(150, h - 150), 30, Color(1, 1, 1, 0.35))
		_text("MOVE", Vector2(110, h - 105), 17, Color(1, 1, 1, 0.55), HORIZONTAL_ALIGNMENT_CENTER, 80.0, true)
	# inventory strip: every weapon I carry (its real model), its charge as a rising fill, the one in my hand lit
	_weapon_rects.clear()
	var n := owned.size()
	var cell := 64.0
	var x0 := w * 0.5 - float(n) * (cell + 8.0) * 0.5
	for i in n:
		var id: String = owned[i]
		var rr := Rect2(x0 + float(i) * (cell + 8.0), h - cell - 12.0, cell, cell)
		_weapon_rects.append([rr, id])
		var info: Dictionary = Data.info_of(id)
		var col: Color = info.color
		var ch: Array = charges.get(id, [1.0, false])
		var sel := id == weapon_id
		if sel:
			rr = rr.grow_individual(3, 3, 3, 3)
		_plate(rr, Color(0.1, 0.07, 0.22, 0.82), col if sel else Color(1, 1, 1, 0.45), 12, 4 if sel else 2)
		var fh := (rr.size.y - 8.0) * float(ch[0])
		_canvas.draw_rect(Rect2(rr.position.x + 4.0, rr.end.y - 4.0 - fh, rr.size.x - 8.0, fh), Color(col.r, col.g, col.b, 0.35 if not bool(ch[1]) else 0.18))
		var tex := _icon_of(id)
		if tex != null:
			_canvas.draw_texture_rect(tex, Rect2(rr.position + Vector2(5, 5), rr.size - Vector2(10, 10)), false, Color(1, 1, 1, 1.0 if not bool(ch[1]) else 0.4))
		else:
			_text(String(Data.ABBR.get(id, String(info.name).substr(0, 3))), rr.position + Vector2(0, rr.size.y * 0.62), 18, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, true)
		if Data.MELEE.has(id):
			UIKit.draw_icon(_canvas, "sword", rr.position + Vector2(rr.size.x - 11, 11), 14, UIKit.YELLOW)
		if bool(ch[1]):
			_text("%ds" % int(ceil((1.0 - float(ch[0])) * Data.CHARGE_SECONDS)), rr.position + Vector2(0, rr.size.y * 0.66), 22, Color(1.0, 0.75, 0.4), HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, true)
		elif float(ch[0]) < 0.999 and not Data.MELEE.has(id):
			_text("%d%%" % int(float(ch[0]) * 100.0), rr.position + Vector2(0, rr.size.y - 3), 12, Color(1, 1, 1, 0.9), HORIZONTAL_ALIGNMENT_CENTER, rr.size.x, true)
	if match_on:
		# the kill feed (left, under the bars) and the scoreboard
		var fy := 134.0
		for f in feed:
			var fc: Color = f[2]
			_text(String(f[0]), Vector2(18, fy), 17, Color(fc.r, fc.g, fc.b, clampf(float(f[1]), 0.0, 1.0)))
			fy += 22.0
		if show_board:
			_draw_board(Rect2(w * 0.5 - 250, 96, 500, h - 190))
		if death_t > 0.0:
			_canvas.draw_rect(Rect2(0, 0, w, h), Color(0.3, 0.0, 0.1, 0.35))
			_text("KNOCKED OUT", Vector2(0, h * 0.4), 64, Color(1, 0.6, 0.7), HORIZONTAL_ALIGNMENT_CENTER, w, true)
			_text("back in %d" % int(ceil(death_t)), Vector2(0, h * 0.4 + 52), 34, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, w, true)
	if not results.is_empty():
		_draw_results(w, h)
	# toast and banner
	if toast_t > 0.0:
		var a := clampf(toast_t * 2.0, 0.0, 1.0)
		var tw := minf(w - 60.0, 11.0 * toast_text.length() + 40.0)
		_plate(Rect2((w - tw) * 0.5, h * 0.72 - 28, tw, 40), Color(0.1, 0.07, 0.22, 0.78 * a), Color(1, 1, 1, 0.6 * a), 20, 2)
		_text(toast_text, Vector2(0, h * 0.72), 21, Color(1, 1, 1, a), HORIZONTAL_ALIGNMENT_CENTER, w)
	if banner_t > 0.0:
		_text(banner_text, Vector2(0, h * 0.3), 58, Color(1, 0.9, 0.5, clampf(banner_t * 1.5, 0.0, 1.0)), HORIZONTAL_ALIGNMENT_CENTER, w, true)
	# crosshair (an X when my shot landed)
	var hc := Vector2(w * 0.5, h * 0.5 - 20.0)
	if hit_t > 0.0:
		var a2 := clampf(hit_t * 5.0, 0.0, 1.0)
		for sgn in [[-1, -1], [1, -1], [-1, 1], [1, 1]]:
			_canvas.draw_line(hc + Vector2(sgn[0], sgn[1]) * 8.0, hc + Vector2(sgn[0], sgn[1]) * 20.0, UIKit.INK, 6.0)
			_canvas.draw_line(hc + Vector2(sgn[0], sgn[1]) * 8.0, hc + Vector2(sgn[0], sgn[1]) * 20.0, Color(1.0, 0.4, 0.4, a2), 3.0)
		_text("-%d" % int(hit_dmg), hc + Vector2(16, -24 - (0.25 - hit_t) * 60.0), 28, Color(1.0, 0.85, 0.4, a2), HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
	_canvas.draw_circle(hc, 3.5, UIKit.INK)
	_canvas.draw_circle(hc, 2.2, Color(1, 1, 1, 0.95))
	_canvas.draw_arc(hc, 12.0, 0.0, TAU, 22, UIKit.INK, 3.5, true)
	_canvas.draw_arc(hc, 12.0, 0.0, TAU, 22, Color(1, 1, 1, 0.6), 1.6, true)


func _draw_board(r: Rect2) -> void:
	_plate(r, Color(0.98, 0.94, 0.88, 0.95), UIKit.INK, 22, 4)
	UIKit.draw_icon(_canvas, "trophy", r.position + Vector2(34, 32), 34, UIKit.YELLOW)
	_text("SCOREBOARD", r.position + Vector2(62, 42), 34, UIKit.PINK, HORIZONTAL_ALIGNMENT_LEFT, -1.0, true)
	UIKit.draw_icon(_canvas, "skull", r.position + Vector2(r.size.x - 106, 30), 22, UIKit.INK)
	UIKit.draw_icon(_canvas, "heart", r.position + Vector2(r.size.x - 56, 30), 22, UIKit.PINK)
	var y := r.position.y + 78.0
	var rows := mini(board.size(), int((r.size.y - 84.0) / 26.0))
	for i in rows:
		var b: Dictionary = board[i]
		var c: Color = b.color
		if bool(b.you):
			_canvas.draw_style_box(_box(Color(1, 0.85, 0.3, 0.55), Color(1, 0.85, 0.3, 0.0), 8, 0), Rect2(r.position.x + 8, y - 20, r.size.x - 16, 26))
		_canvas.draw_circle(Vector2(r.position.x + 28, y - 7), 8.0, c if bool(b.alive) else Color(c.r, c.g, c.b, 0.3))
		_canvas.draw_arc(Vector2(r.position.x + 28, y - 7), 8.0, 0.0, TAU, 16, UIKit.INK, 2.5)
		_canvas.draw_string(UIKit.body_font(), Vector2(r.position.x + 46, y), "%d  %s" % [i + 1, String(b.name)], HORIZONTAL_ALIGNMENT_LEFT, -1.0, 17, UIKit.INK)
		_canvas.draw_string(UIKit.body_font(), Vector2(r.position.x + r.size.x - 112, y), str(int(b.kills)), HORIZONTAL_ALIGNMENT_LEFT, -1.0, 17, UIKit.INK)
		_canvas.draw_string(UIKit.body_font(), Vector2(r.position.x + r.size.x - 62, y), str(int(b.deaths)), HORIZONTAL_ALIGNMENT_LEFT, -1.0, 17, Color(UIKit.INK.r, UIKit.INK.g, UIKit.INK.b, 0.7))
		y += 26.0


func _draw_results(w: float, h: float) -> void:
	_canvas.draw_rect(Rect2(0, 0, w, h), Color(0.03, 0.02, 0.1, 0.82))
	var won: bool = bool(results.get("won", false))
	UIKit.draw_icon(_canvas, "crown" if won else "flag", Vector2(w * 0.5 - 190, 76), 64, UIKit.YELLOW if won else UIKit.SKY)
	_text("VICTORY!" if won else "MATCH OVER", Vector2(0, 100), 76, Color(1, 0.9, 0.4) if won else Color(1, 0.75, 0.85), HORIZONTAL_ALIGNMENT_CENTER, w, true)
	_text("%d kills  ·  %d knock-outs  ·  +$%d" % [int(results.get("kills", 0)), int(results.get("deaths", 0)), int(results.get("coins", 0))], Vector2(0, 142), 24, Color(1, 0.88, 0.5), HORIZONTAL_ALIGNMENT_CENTER, w, true)
	_draw_board(Rect2(w * 0.5 - 250, 160, 500, h - 250))
	_text("tap to continue", Vector2(0, h - 36), 28, Color(1, 1, 1, 0.55 + 0.4 * sin(_t * 4.0)), HORIZONTAL_ALIGNMENT_CENTER, w, true)


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
