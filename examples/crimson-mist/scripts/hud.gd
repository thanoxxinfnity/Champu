class_name Hud
extends CanvasLayer
## All screens and the touch HUD. Custom-drawn on one Control: virtual stick, action buttons, bars, waypoint, enemy marks. Text lives in Labels
## (auto-wrapped, clipped) so it never leaves its box. Touch and mouse both work; the stick floats wherever the left thumb lands.

signal screen_pressed(id: String)

const INK := Color(0.03, 0.04, 0.06)
const PINK := Color(0.92, 0.95, 1.0)
const CREAM := Color(1.0, 1.0, 1.0)
const GOLD := Color(0.93, 0.8, 0.5)
const UI := 0.72

enum Screen { NONE, LOBBY, PAUSE, DEATH, WIN, CRAFT, NOTE, LOADING, BESTIARY }

var game: Game
var cam: Camera3D
var screen := Screen.NONE
var playing := false
var move := Vector2.ZERO
var look := Vector2.ZERO
var held := {}                     # button id -> bool
var pressed := {}                  # button id -> bool (one-shot, cleared by consume)
var lobby := {}                    # filled by Game: name, role, perk, hp, speed, stamina, carry, index, count, model_ok
var _canvas: Control
var _post: ColorRect
var _post_mat: ShaderMaterial
var _size := Vector2(1280, 720)
var _stick_id := -99
var _stick_origin := Vector2.ZERO
var _stick_pos := Vector2.ZERO
var _look_id := -99
var _look_last := Vector2.ZERO
var _btn_touch := {}               # touch id -> button id
var _buttons := {}                 # id -> {"c": Vector2, "r": float, "label": String, "show": bool}
var _screen_buttons: Array = []    # {"id", "rect", "label", "enabled"}
var _hurt := 0.0
var _fear := 0.0
var _t := 0.0
var gfx_low := false
var _load_frac := 0.0
var _load_text := ""
var _play_t := 0.0                 # seconds since this run started (drives the first-seconds control hints)
var _toast_t := 0.0
var _hit_t := 0.0
var _hit_head := false
var _card_t := 0.0
var _dialog: Array = []
var _dialog_t := 0.0
var _dialog_per := 3.6
var _boss_frac := 1.0
var _boss_on := false
var _boss_name := ""
var _use_label := ""
var _use_on := false
var _marker := Vector3.ZERO
var _marker_on := false
var _goal_flash := 0.0

var lbl_title: Label
var lbl_goal: Label
var lbl_toast: Label
var lbl_dlg_name: Label
var lbl_dlg: Label
var lbl_card_t: Label
var lbl_card_s: Label
var lbl_panel_title: Label
var lbl_panel_body: Label
var lbl_name: Label
var lbl_role: Label
var lbl_perk: Label
var lbl_stats: Label
var lbl_logo: Label
var lbl_sub: Label
var lbl_use: Label
var lbl_items: Label
var lbl_ammo: Label
var lbl_boss: Label
var lbl_hint: Label
var _labels: Array[Label] = []


func _ready() -> void:
	layer = 5
	process_mode = Node.PROCESS_MODE_ALWAYS
	var fx_layer := CanvasLayer.new()
	fx_layer.layer = 1
	add_child(fx_layer)
	_post = ColorRect.new()
	_post.set_anchors_preset(Control.PRESET_FULL_RECT)
	_post.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_post_mat = ShaderMaterial.new()
	_post_mat.shader = preload("res://shaders/post.gdshader")
	_post.material = _post_mat
	fx_layer.add_child(_post)
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.draw.connect(_draw_ui)
	add_child(_canvas)
	lbl_title = _label(22, GOLD)
	lbl_goal = _label(20, CREAM)
	lbl_toast = _label(26, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_dlg_name = _label(22, PINK)
	lbl_dlg = _label(24, CREAM)
	lbl_card_t = _label(46, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_card_s = _label(26, PINK, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_panel_title = _label(40, GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_panel_body = _label(25, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_name = _label(44, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_role = _label(26, PINK, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_perk = _label(22, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_stats = _label(21, CREAM)
	lbl_logo = _label(78, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_sub = _label(26, PINK, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_use = _label(22, GOLD, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_items = _label(20, CREAM)
	lbl_ammo = _label(26, GOLD, HORIZONTAL_ALIGNMENT_RIGHT)
	lbl_boss = _label(22, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_hint = _label(20, CREAM, HORIZONTAL_ALIGNMENT_CENTER)
	lbl_logo.text = "CRIMSON MIST"
	lbl_sub.text = "Chapter 1 · The Red Bell"
	get_viewport().size_changed.connect(_layout)
	_layout()
	_refresh()


func _label(size: int, color: Color, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	size = maxi(12, int(size * UI))
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", INK)
	l.add_theme_constant_override("outline_size", maxi(4, size / 5))
	l.horizontal_alignment = align
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.clip_text = true
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.visible = false
	_canvas.add_child(l)
	_labels.append(l)
	return l


func _place(l: Label, r: Rect2) -> void:
	l.position = r.position
	l.size = r.size
	l.custom_minimum_size = r.size


# ── layout ───────────────────────────────────────────────────────────────────

func _layout() -> void:
	_size = get_viewport().get_visible_rect().size
	var w := _size.x
	var h := _size.y
	_place(lbl_title, Rect2(16, 68, minf(420.0, w * 0.4), 28))
	_place(lbl_goal, Rect2(16, 96, minf(420.0, w * 0.4), 48))
	_place(lbl_toast, Rect2(w * 0.5 - 240, h * 0.2, 480, 34))
	_place(lbl_dlg_name, Rect2(w * 0.5 - 274, h - 130, 548, 28))
	_place(lbl_dlg, Rect2(w * 0.5 - 274, h - 102, 548, 76))
	_place(lbl_card_t, Rect2(w * 0.5 - 400, h * 0.3, 800, 54))
	_place(lbl_card_s, Rect2(w * 0.5 - 400, h * 0.3 + 58, 800, 56))
	_place(lbl_panel_title, Rect2(w * 0.5 - 420, h * 0.16, 840, 56))
	_place(lbl_panel_body, Rect2(w * 0.5 - 400, h * 0.16 + 64, 800, h * 0.4))
	_place(lbl_logo, Rect2(w * 0.5 - 520, 18, 1040, 90))
	_place(lbl_sub, Rect2(w * 0.5 - 400, 104, 800, 34))
	_place(lbl_name, Rect2(w * 0.5 - 300, h - 270, 600, 54))
	_place(lbl_role, Rect2(w * 0.5 - 300, h - 218, 600, 34))
	_place(lbl_perk, Rect2(w * 0.5 - 300, h - 182, 600, 56))
	_place(lbl_stats, Rect2(24, h * 0.34, 250, 170))
	_place(lbl_use, Rect2(w - 290, h - 262, 150, 40))
	_place(lbl_items, Rect2(16, 42, minf(520.0, w * 0.45), 28))
	_place(lbl_ammo, Rect2(w - 250, 48, 190, 32))
	_place(lbl_boss, Rect2(w * 0.5 - 220, 8, 440, 30))
	_place(lbl_hint, Rect2(w * 0.5 - 360, h - 60, 720, 30))
	_buttons = {
		"attack": {"c": Vector2(w - 92, h - 92), "r": 58.0, "label": "ATTACK", "show": true},
		"dodge": {"c": Vector2(w - 208, h - 56), "r": 38.0, "label": "DODGE", "show": true},
		"shoot": {"c": Vector2(w - 208, h - 138), "r": 40.0, "label": "SHOOT", "show": false},
		"use": {"c": Vector2(w - 102, h - 204), "r": 46.0, "label": "USE", "show": false},
		"reload": {"c": Vector2(w - 208, h - 208), "r": 28.0, "label": "RELOAD", "show": false},
		"bandage": {"c": Vector2(w - 44, h - 272), "r": 28.0, "label": "HEAL", "show": true},
		"flare": {"c": Vector2(w - 44, h - 332), "r": 28.0, "label": "FLARE", "show": true},
		"sprint": {"c": Vector2(w - 306, h - 56), "r": 32.0, "label": "RUN", "show": true},
		"pause": {"c": Vector2(w - 34, 34), "r": 22.0, "label": "II", "show": true},
		"light": {"c": Vector2(w - 82, 34), "r": 22.0, "label": "LAMP", "show": true},
		"bag": {"c": Vector2(w - 130, 34), "r": 22.0, "label": "BAG", "show": true},
	}
	_rebuild_screen_buttons()
	_canvas.queue_redraw()


func _rebuild_screen_buttons() -> void:
	var w := _size.x
	var h := _size.y
	_screen_buttons.clear()
	match screen:
		Screen.LOBBY:
			_screen_buttons.append({"id": "prev", "rect": Rect2(w * 0.5 - 300, h * 0.42, 90, 90), "label": "<", "enabled": true})
			_screen_buttons.append({"id": "next", "rect": Rect2(w * 0.5 + 210, h * 0.42, 90, 90), "label": ">", "enabled": true})
			_screen_buttons.append({"id": "start", "rect": Rect2(w * 0.5 - 220, h - 112, 440, 74), "label": "START CHAPTER 1", "enabled": true})
			if lobby.get("can_continue", false):
				_screen_buttons.append({"id": "continue", "rect": Rect2(w - 290, h - 112, 250, 74), "label": "CONTINUE", "enabled": true})
		Screen.PAUSE:
			_screen_buttons.append({"id": "resume", "rect": Rect2(w * 0.5 - 200, h * 0.38, 400, 70), "label": "RESUME", "enabled": true})
			_screen_buttons.append({"id": "bag", "rect": Rect2(w * 0.5 - 200, h * 0.38 + 84, 400, 70), "label": "CRAFT / BAG", "enabled": true})
			_screen_buttons.append({"id": "bestiary", "rect": Rect2(w * 0.5 - 200, h * 0.38 + 168, 400, 70), "label": "BESTIARY", "enabled": true})
			_screen_buttons.append({"id": "gfx", "rect": Rect2(w * 0.5 - 200, h * 0.38 + 252, 400, 70), "label": "GRAPHICS: LOW (FAST)" if gfx_low else "GRAPHICS: HIGH", "enabled": true})
			_screen_buttons.append({"id": "lobby", "rect": Rect2(w * 0.5 - 200, h * 0.38 + 336, 400, 70), "label": "BACK TO LOBBY", "enabled": true})
		Screen.DEATH:
			_screen_buttons.append({"id": "retry", "rect": Rect2(w * 0.5 - 200, h * 0.5, 400, 74), "label": "TRY AGAIN", "enabled": true})
			_screen_buttons.append({"id": "lobby", "rect": Rect2(w * 0.5 - 200, h * 0.5 + 90, 400, 70), "label": "BACK TO LOBBY", "enabled": true})
		Screen.WIN:
			_screen_buttons.append({"id": "lobby", "rect": Rect2(w * 0.5 - 220, h * 0.62, 440, 74), "label": "BACK TO LOBBY", "enabled": true})
		Screen.NOTE:
			_screen_buttons.append({"id": "close", "rect": Rect2(w * 0.5 - 130, h * 0.62, 260, 66), "label": "CLOSE", "enabled": true})
		Screen.BESTIARY:
			_screen_buttons.append({"id": "close", "rect": Rect2(w * 0.5 - 130, h - 82, 260, 62), "label": "CLOSE", "enabled": true})
		Screen.CRAFT:
			var y := h * 0.3
			for id in Data.RECIPES:
				var r: Dictionary = Data.RECIPES[id]
				var can: bool = game != null and game.player != null and game.player.can_afford(r.needs)
				_screen_buttons.append({"id": "craft_" + id, "rect": Rect2(w * 0.5 + 120, y, 220, 62), "label": "CRAFT", "enabled": can, "recipe": id})
				y += 84.0
			_screen_buttons.append({"id": "close", "rect": Rect2(w * 0.5 - 130, h * 0.3 + 3 * 84.0 + 10, 260, 62), "label": "CLOSE", "enabled": true})


func _refresh() -> void:
	for l in _labels:
		l.visible = false
	match screen:
		Screen.NONE:
			if playing:
				for l in [lbl_title, lbl_goal, lbl_items]:
					l.visible = true
		Screen.LOBBY:
			for l in [lbl_logo, lbl_sub, lbl_name, lbl_role, lbl_perk]:
				l.visible = true
		Screen.PAUSE, Screen.DEATH, Screen.WIN, Screen.NOTE, Screen.CRAFT, Screen.LOADING, Screen.BESTIARY:
			lbl_panel_title.visible = true
			lbl_panel_body.visible = screen != Screen.BESTIARY
	if playing and screen == Screen.NONE:
		lbl_ammo.visible = game != null and game.player != null and game.player.has_pistol
		lbl_toast.visible = _toast_t > 0.0
		lbl_dlg.visible = not _dialog.is_empty()
		lbl_dlg_name.visible = not _dialog.is_empty()
		lbl_card_t.visible = _card_t > 0.0
		lbl_card_s.visible = _card_t > 0.0
		lbl_use.visible = _use_on
		lbl_boss.visible = _boss_on
	_rebuild_screen_buttons()
	_canvas.queue_redraw()


# ── API used by the game ─────────────────────────────────────────────────────

func set_camera(c: Camera3D) -> void:
	cam = c


func set_gfx_low(on: bool) -> void:
	gfx_low = on
	_post.visible = not on
	_rebuild_screen_buttons()


func set_playing(on: bool) -> void:
	playing = on
	if on:
		_play_t = 0.0
	move = Vector2.ZERO
	look = Vector2.ZERO
	held.clear()
	_stick_id = -99
	_look_id = -99
	_btn_touch.clear()
	_refresh()


func set_objective(title: String, goal: String) -> void:
	lbl_title.text = title
	lbl_goal.text = goal
	_goal_flash = 1.0


func set_marker(pos: Vector3, on: bool) -> void:
	_marker = pos
	_marker_on = on


func toast(text: String) -> void:
	lbl_toast.text = text
	_toast_t = 2.2
	_refresh()


func chapter_card(title: String, sub: String) -> void:
	lbl_card_t.text = title
	lbl_card_s.text = sub
	_card_t = 3.6
	_refresh()


func say(lines: Array, per_line := 3.6) -> void:
	_dialog = lines.duplicate()
	_dialog_per = per_line
	_dialog_t = per_line
	_show_dialog_line()
	_refresh()


func dialog_active() -> bool:
	return not _dialog.is_empty()


func _show_dialog_line() -> void:
	if _dialog.is_empty():
		return
	lbl_dlg_name.text = String(_dialog[0][0])
	lbl_dlg.text = String(_dialog[0][1])


func hit_marker(head: bool) -> void:
	_hit_t = 0.25
	_hit_head = head


func boss_show(name: String) -> void:
	_boss_on = true
	_boss_frac = 1.0
	lbl_boss.text = name.to_upper()
	_refresh()


func boss_hp(frac: float) -> void:
	_boss_frac = clampf(frac, 0.0, 1.0)


func boss_hide() -> void:
	_boss_on = false
	_refresh()


func hurt_flash(amount: float) -> void:
	_hurt = minf(1.0, _hurt + 0.4 + amount / 40.0)


func show_loading_free() -> void:
	pass


func show_loading(title: String, frac: float) -> void:
	playing = false
	_load_frac = frac
	_load_text = ""
	_open(Screen.LOADING, title.to_upper(), "")
	_canvas.queue_redraw()


func set_loading(text: String, frac: float) -> void:
	_load_frac = frac
	lbl_panel_body.text = text
	_canvas.queue_redraw()


func hide_all_screens() -> void:
	screen = Screen.NONE
	_refresh()


func _open(s: Screen, title: String, body: String) -> void:
	screen = s
	move = Vector2.ZERO
	held.clear()
	lbl_panel_title.text = title
	lbl_panel_body.text = body
	_refresh()


func show_lobby() -> void:
	screen = Screen.LOBBY
	playing = false
	_refresh()
	update_lobby()


func update_lobby() -> void:
	if screen != Screen.LOBBY:
		return
	lbl_name.text = String(lobby.get("name", ""))
	lbl_role.text = String(lobby.get("role", "")) + ("" if lobby.get("model_ok", true) else "  (stand-in model)")
	lbl_perk.text = String(lobby.get("perk", ""))
	lbl_stats.text = "HEALTH\n\nSPEED\n\nSTAMINA\n\nCARRY"
	_rebuild_screen_buttons()
	_canvas.queue_redraw()


func show_pause(on: bool) -> void:
	if on:
		_open(Screen.PAUSE, "PAUSED", "")
	else:
		hide_all_screens()


func show_death() -> void:
	_open(Screen.DEATH, "YOU FELL", "The mist takes another one.")


func show_win(text: String) -> void:
	_open(Screen.WIN, "CHAPTER 1 COMPLETE", text)


func show_craft(on: bool) -> void:
	if on:
		_open(Screen.CRAFT, "WORKBENCH", "")
		lbl_panel_body.visible = false
	else:
		hide_all_screens()


func show_bestiary() -> void:
	_open(Screen.BESTIARY, "BESTIARY", "")
	lbl_panel_body.visible = false
	lbl_panel_title.position.y = 6.0


func read_note(text: String) -> void:
	_open(Screen.NOTE, "NOTE", text)


func consume(id: String) -> bool:
	if pressed.get(id, false):
		pressed[id] = false
		return true
	return false


func is_modal() -> bool:
	return screen != Screen.NONE


# ── per-frame ────────────────────────────────────────────────────────────────

func update_frame(p: Player, delta: float) -> void:
	_t += delta
	_play_t += delta if playing else 0.0
	_post_mat.set_shader_parameter("t", _t)
	_hurt = maxf(0.0, _hurt - delta * 1.4)
	_post_mat.set_shader_parameter("hurt", _hurt)
	var danger := 0.0
	if p != null and playing:
		danger = clampf(1.0 - p.hp / p.max_hp, 0.0, 1.0)
		var e := game.nearest_enemy_to(p.global_position, 14.0)
		if e != null:
			danger = maxf(danger, clampf(1.0 - e.global_position.distance_to(p.global_position) / 14.0, 0.0, 1.0) * 0.8)
	_fear = lerpf(_fear, danger, minf(1.0, delta * 3.0))
	_post_mat.set_shader_parameter("fear", _fear)
	if _toast_t > 0.0:
		_toast_t -= delta
		if _toast_t <= 0.0:
			lbl_toast.visible = false
	if _card_t > 0.0:
		_card_t -= delta
		if _card_t <= 0.0:
			lbl_card_t.visible = false
			lbl_card_s.visible = false
	if not _dialog.is_empty():
		_dialog_t -= delta
		if _dialog_t <= 0.0:
			_dialog.pop_front()
			if _dialog.is_empty():
				lbl_dlg.visible = false
				lbl_dlg_name.visible = false
			else:
				_dialog_t = _dialog_per
				_show_dialog_line()
	_hit_t = maxf(0.0, _hit_t - delta)
	_goal_flash = maxf(0.0, _goal_flash - delta)
	if p != null and playing and screen == Screen.NONE:
		_buttons["shoot"].show = p.has_pistol
		_buttons["reload"].show = p.has_pistol and p.mag < int(Data.WEAPONS.pistol.mag) and p.count("ammo") > 0
		var it := game.nearest_interactable()
		_use_on = it != null
		_use_label = it.label if it != null else ""
		_buttons["use"].show = it != null
		lbl_use.text = _use_label
		lbl_use.visible = _use_on
		lbl_items.text = _items_text(p)
		lbl_ammo.text = "%d / %d" % [p.mag, p.count("ammo")] if p.has_pistol else ""
		lbl_ammo.visible = p.has_pistol
		lbl_boss.visible = _boss_on
	_canvas.queue_redraw()


func _items_text(p: Player) -> String:
	var parts: Array[String] = []
	for k in ["scrap", "cloth", "alcohol", "fuel", "fuse", "bandage", "flare"]:
		if p.count(k) > 0:
			parts.append("%s %d" % [String(Data.ITEMS[k].name), p.count(k)])
	return "  ·  ".join(parts) if not parts.is_empty() else ""


# ── input ────────────────────────────────────────────────────────────────────

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_down(st.index, st.position)
		else:
			_up(st.index, st.position)
	elif event is InputEventScreenDrag:
		var sd := event as InputEventScreenDrag
		_drag(sd.index, sd.position, sd.relative)
	elif event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		var mb := event as InputEventMouseButton
		if mb.pressed:
			_down(-1, mb.position)
		else:
			_up(-1, mb.position)
	elif event is InputEventMouseMotion and (event as InputEventMouseMotion).button_mask & MOUSE_BUTTON_MASK_LEFT:
		var mm := event as InputEventMouseMotion
		_drag(-1, mm.position, mm.relative)


func _button_at(pos: Vector2) -> String:
	for id in _buttons:
		var b: Dictionary = _buttons[id]
		if b.show and pos.distance_to(b.c) <= float(b.r) * 1.15:
			return id
	return ""


func _screen_button_at(pos: Vector2) -> int:
	for i in _screen_buttons.size():
		if (_screen_buttons[i].rect as Rect2).has_point(pos):
			return i
	return -1


func _down(idx: int, pos: Vector2) -> void:
	if screen != Screen.NONE:
		var i := _screen_button_at(pos)
		if i >= 0 and _screen_buttons[i].enabled:
			screen_pressed.emit(String(_screen_buttons[i].id))
		return
	if not playing:
		return
	var b := _button_at(pos)
	if b != "":
		_btn_touch[idx] = b
		held[b] = true
		pressed[b] = true
		return
	if pos.x < _size.x * 0.42 and _stick_id == -99:
		_stick_id = idx
		_stick_origin = pos
		_stick_pos = pos
	elif _look_id == -99:
		_look_id = idx
		_look_last = pos


func _drag(idx: int, pos: Vector2, rel: Vector2) -> void:
	if idx == _stick_id:
		_stick_pos = pos
		var d := (pos - _stick_origin)
		var maxr := 66.0
		if d.length() > maxr:
			_stick_origin += d.normalized() * (d.length() - maxr)
			d = pos - _stick_origin
		move = (d / maxr).limit_length(1.0)
		if move.length() < 0.12:
			move = Vector2.ZERO
	elif idx == _look_id:
		look += rel


func _up(idx: int, _pos: Vector2) -> void:
	if idx == _stick_id:
		_stick_id = -99
		move = Vector2.ZERO
	if idx == _look_id:
		_look_id = -99
	if _btn_touch.has(idx):
		held[_btn_touch[idx]] = false
		_btn_touch.erase(idx)


# ── drawing ──────────────────────────────────────────────────────────────────

func _draw_ui() -> void:
	var w := _size.x
	var h := _size.y
	var font := ThemeDB.fallback_font
	if screen == Screen.LOBBY:
		_draw_lobby(font, w, h)
		return
	if screen == Screen.LOADING:
		_canvas.draw_rect(Rect2(0, 0, w, h), Color(0.02, 0.03, 0.05, 1.0))
		_bar(Rect2(w * 0.5 - 220, h * 0.62, 440, 18), _load_frac, Color(0.78, 0.84, 0.9))
		return
	if screen == Screen.PAUSE or screen == Screen.DEATH or screen == Screen.WIN or screen == Screen.NOTE or screen == Screen.CRAFT or screen == Screen.BESTIARY:
		_canvas.draw_rect(Rect2(0, 0, w, h), Color(0.03, 0.04, 0.06, 0.78))
		if screen == Screen.CRAFT:
			_draw_craft(font, w, h)
		elif screen == Screen.BESTIARY:
			_draw_bestiary(font, w, h)
		_draw_screen_buttons(font)
		return
	if not playing:
		return
	_draw_playing(font, w, h)
	if screen == Screen.NONE:
		pass


func _bar(r: Rect2, frac: float, col: Color) -> void:
	var bg := UiArt.box("bar_bg", 11)
	if bg != null:
		_canvas.draw_style_box(bg, r.grow_individual(2, 3, 2, 3))
		var fb := UiArt.box("bar_fill", 11)
		var fw := (r.size.x - 4) * clampf(frac, 0.0, 1.0)
		if fw > 2.0:
			fb.modulate_color = Color(col.r, col.g, col.b, 0.95)
			_canvas.draw_style_box(fb, Rect2(r.position + Vector2(2, 1), Vector2(maxf(fw, 10.0), r.size.y - 2)))
		return
	_canvas.draw_rect(r, Color(0, 0, 0, 0.55))
	_canvas.draw_rect(Rect2(r.position + Vector2(2, 2), Vector2((r.size.x - 4) * clampf(frac, 0.0, 1.0), r.size.y - 4)), col)
	_canvas.draw_rect(r, INK, false, 2.0)


func _draw_playing(font: Font, w: float, h: float) -> void:
	var p := game.player
	if p == null:
		return
	# portrait ring + bars
	if UiArt.tex("btn_round") != null:
		_canvas.draw_texture_rect(UiArt.tex("btn_round"), Rect2(8, 6, 44, 44), false)
		_canvas.draw_texture_rect(UiArt.tex("ic_heart"), Rect2(17, 14, 26, 26), false, Color(1, 1, 1, 0.95))
	else:
		_canvas.draw_circle(Vector2(30, 28), 20, Color(0, 0, 0, 0.55))
		_canvas.draw_arc(Vector2(30, 28), 20, 0, TAU, 28, PINK, 2.0)
		_canvas.draw_string(font, Vector2(22, 36), String(p.info.name).substr(0, 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 22, CREAM)
	_bar(Rect2(60, 12, 190, 14), p.hp / p.max_hp, Color(1.0, 0.42, 0.45) if p.hp / p.max_hp > 0.3 else Color(1.0, 0.16, 0.18))
	_bar(Rect2(60, 30, 140, 8), p.stamina / p.max_stamina, Color(0.96, 0.93, 0.76))
	# goal flash
	if _goal_flash > 0.0:
		_canvas.draw_rect(Rect2(10, 66, minf(420.0, w * 0.4) + 12, 76), Color(1, 0.85, 0.5, 0.25 * _goal_flash), false, 2.0)
	# waypoint + enemy marks
	if cam != null and is_instance_valid(cam) and cam.is_inside_tree():
		if _marker_on:
			_draw_waypoint(font, w, h)
		for e in get_tree().get_nodes_in_group("enemies"):
			var en := e as Enemy
			if en.marked > 0.0 and not cam.is_position_behind(en.global_position):
				var sp := cam.unproject_position(en.global_position + Vector3(0, en.height + 0.5, 0))
				_diamond(sp, 12.0, Color(1.0, 0.25, 0.35))
		if p.torch_on and false:
			pass
	# crosshair (when the pistol is out)
	if p.has_pistol and _hit_t >= 0.0:
		var c := Vector2(w * 0.5 + 0.0, h * 0.5 - 20)
		_canvas.draw_arc(c, 10, 0, TAU, 20, Color(1, 1, 1, 0.5), 2.0)
		if _hit_t > 0.0:
			_canvas.draw_arc(c, 18, 0, TAU, 20, Color(1.0, 0.3 if _hit_head else 0.8, 0.3), 3.0)
	# boss bar
	if _boss_on:
		_bar(Rect2(w * 0.5 - 220, 40, 440, 14), _boss_frac, Color(0.75, 0.15, 0.35))
	# dialogue banner
	if not _dialog.is_empty():
		var dbox := UiArt.box("panel_dark", 30)
		if dbox != null:
			_canvas.draw_style_box(dbox, Rect2(w * 0.5 - 290, h - 136, 580, 118))
		else:
			_canvas.draw_rect(Rect2(w * 0.5 - 290, h - 136, 580, 118), Color(0.04, 0.05, 0.08, 0.78))
			_canvas.draw_rect(Rect2(w * 0.5 - 290, h - 136, 580, 118), PINK, false, 1.5)
	# frame rate, small, so a slow phone is easy to report
	_canvas.draw_string(font, Vector2(w - 96, 70), "%d fps" % int(Engine.get_frames_per_second()), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.8, 0.9, 1.0, 0.55))
	# virtual stick
	var sb := UiArt.tex("stick_base")
	var sk := UiArt.tex("stick_knob")
	if _stick_id != -99 and sb != null:
		_canvas.draw_texture_rect(sb, Rect2(_stick_origin - Vector2(84, 84), Vector2(168, 168)), false)
		_canvas.draw_texture_rect(sk, Rect2(_stick_origin + move * 66.0 - Vector2(34, 34), Vector2(68, 68)), false)
	elif _stick_id != -99:
		_canvas.draw_circle(_stick_origin, 66, Color(1, 1, 1, 0.08))
		_canvas.draw_arc(_stick_origin, 66, 0, TAU, 40, Color(1, 1, 1, 0.4), 2.0)
		_canvas.draw_circle(_stick_origin + move * 66.0, 26, Color(0.85, 0.9, 1.0, 0.5))
	elif sb != null:
		var rc0 := Vector2(132, h - 132)
		var pulse0 := 0.75 + 0.25 * sin(_t * 2.4)
		_canvas.draw_texture_rect(sb, Rect2(rc0 - Vector2(84, 84), Vector2(168, 168)), false, Color(1, 1, 1, pulse0))
		_canvas.draw_texture_rect(sk, Rect2(rc0 - Vector2(30, 30), Vector2(60, 60)), false, Color(1, 1, 1, 0.8))
		for ang in 4:
			var dir0 := Vector2.from_angle(ang * TAU / 4.0 - PI * 0.5)
			var ar := UiArt.tex("ic_arrow")
			var xf := Transform2D(dir0.angle() + PI * 0.5, rc0 + dir0 * 64.0)
			_canvas.draw_set_transform_matrix(xf)
			_canvas.draw_texture_rect(ar, Rect2(Vector2(-7, -7), Vector2(14, 14)), false, Color(1, 1, 1, 0.65))
			_canvas.draw_set_transform_matrix(Transform2D.IDENTITY)
	if _stick_id == -99 and UiArt.tex("stick_base") == null:
		# an always-visible resting stick so a new player sees where the left thumb goes
		var rc := Vector2(132, h - 132)
		var pulse := 0.5 + 0.5 * sin(_t * 2.4)
		_canvas.draw_circle(rc, 72, Color(0.05, 0.07, 0.1, 0.34))
		_canvas.draw_arc(rc, 72, 0, TAU, 44, Color(0.8, 0.88, 1.0, 0.45 + 0.2 * pulse), 3.0)
		_canvas.draw_circle(rc, 28, Color(0.85, 0.9, 1.0, 0.32))
		for a in 4:
			var dir := Vector2.from_angle(a * TAU / 4.0 - PI * 0.5)
			var tip := rc + dir * 56.0
			_canvas.draw_colored_polygon(PackedVector2Array([tip + dir * 8.0, tip + dir.rotated(2.5) * 7.0, tip + dir.rotated(-2.5) * 7.0]), Color(0.85, 0.92, 1.0, 0.5))
		_canvas.draw_string(font, rc + Vector2(-22, 98), "MOVE", HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.85, 0.92, 1.0, 0.7))
	if _play_t < 14.0 and _stick_id == -99 and _look_id == -99:
		var lc := Vector2(w * 0.62, h * 0.5)
		var f := clampf(1.0 - (_play_t - 10.0) / 4.0, 0.0, 1.0)
		_canvas.draw_arc(lc, 54, 0, TAU, 32, Color(1, 1, 1, 0.3 * f), 2.0)
		_canvas.draw_string(font, lc + Vector2(-36, 6), "LOOK", HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.85, 0.92, 1.0, 0.85 * f))
		_canvas.draw_string(font, lc + Vector2(-60, 32), "drag here", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.85, 0.92, 1.0, 0.6 * f))
	# buttons
	for id in _buttons:
		var b: Dictionary = _buttons[id]
		if not b.show:
			continue
		var on: bool = held.get(id, false)
		var enabled := true
		if id == "flare":
			enabled = p.count("flare") > 0
		elif id == "bandage":
			enabled = p.count("bandage") > 0 and p.hp < p.max_hp - 1.0
		elif id == "shoot":
			enabled = p.has_pistol
		var disc := UiArt.tex("btn_round_down" if on else "btn_round")
		var glyph := UiArt.tex("ic_" + String(UiArt.GLYPH.get(id, "")))
		var dim := 1.0 if enabled else 0.4
		if disc != null:
			var pulse := 1.0
			var tint := Color(1, 1, 1, dim)
			if id == "use":
				pulse = 1.0 + 0.06 * sin(_t * 6.0)
				tint = Color(1.0, 0.92, 0.7, 1.0)
			var rr: float = float(b.r) * pulse
			_canvas.draw_texture_rect(disc, Rect2(b.c - Vector2(rr, rr), Vector2(rr, rr) * 2.0), false, tint)
			if glyph != null:
				var gs: float = float(b.r) * (1.25 if id == "attack" else 1.1)
				_canvas.draw_texture_rect(glyph, Rect2(b.c - Vector2(gs, gs) * 0.5, Vector2(gs, gs)), false, Color(1, 1, 1, dim))
		else:
			var base := Color(0.05, 0.07, 0.1, 0.55) if enabled else Color(0.05, 0.07, 0.1, 0.3)
			if id == "use":
				base = Color(0.55, 0.3, 0.05, 0.7 + 0.2 * sin(_t * 6.0))
			_canvas.draw_circle(b.c, b.r, base if not on else Color(0.85, 0.9, 1.0, 0.8))
			_canvas.draw_arc(b.c, b.r, 0, TAU, 36, PINK if enabled else Color(0.6, 0.5, 0.55, 0.5), 3.0)
			var fs := int(clampf(float(b.r) * 0.3, 10.0, 18.0))
			var ts: Vector2 = font.get_string_size(String(b.label), HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
			_canvas.draw_string(font, b.c + Vector2(-ts.x * 0.5, fs * 0.35), String(b.label), HORIZONTAL_ALIGNMENT_LEFT, -1, fs, CREAM if enabled else Color(0.7, 0.65, 0.7))
		if id == "flare" or id == "bandage":
			var n := p.count(String(id).replace("bandage", "bandage"))
			_canvas.draw_string(font, b.c + Vector2(b.r * 0.5, -b.r * 0.55), str(n), HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(1, 1, 1, 0.95))
	if _dialog.is_empty() and _toast_t <= 0.0 and false:
		pass


func _diamond(c: Vector2, r: float, col: Color) -> void:
	var mk := UiArt.tex("ic_marker")
	if mk != null:
		_canvas.draw_texture_rect(mk, Rect2(c - Vector2(r, r) * 1.2, Vector2(r, r) * 2.4), false, col)
		return
	_canvas.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)]), col)
	_canvas.draw_polyline(PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0), c + Vector2(0, -r)]), INK, 2.0)


func _draw_waypoint(font: Font, w: float, h: float) -> void:
	var pos := _marker + Vector3(0, 1.4, 0)
	var behind := cam.is_position_behind(pos)
	var sp := cam.unproject_position(pos)
	var margin := 56.0
	var inside := not behind and sp.x > margin and sp.x < w - margin and sp.y > margin + 60 and sp.y < h - margin - 80
	if not inside:
		var c := Vector2(w * 0.5, h * 0.5)
		var d := sp - c
		if behind:
			d = -d
		if d.length() < 1.0:
			d = Vector2(0, 1)
		var k := minf((w * 0.5 - margin) / maxf(absf(d.x), 0.01), (h * 0.5 - margin - 70) / maxf(absf(d.y), 0.01))
		sp = c + d * k
	_diamond(sp, 14.0, GOLD)
	var dist := int(cam.global_position.distance_to(_marker))
	var txt := "%d m" % dist
	var ts := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 20)
	_canvas.draw_string(font, sp + Vector2(-ts.x * 0.5, 36), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, CREAM)


func _draw_screen_buttons(font: Font) -> void:
	for b in _screen_buttons:
		var r: Rect2 = b.rect
		var en: bool = b.enabled
		var label := String(b.label)
		var wide := UiArt.box("btn_wide", 40)
		var glyph_name := "left" if label == "<" else ("right" if label == ">" else "")
		if wide != null and glyph_name == "":
			_canvas.draw_style_box(wide, r)
			if not en:
				_canvas.draw_rect(r, Color(0, 0, 0, 0.35))
		elif UiArt.tex("btn_round") != null and glyph_name != "":
			_canvas.draw_texture_rect(UiArt.tex("btn_round"), r, false)
			var gt := UiArt.tex("ic_" + glyph_name)
			_canvas.draw_texture_rect(gt, Rect2(r.position + r.size * 0.2, r.size * 0.6), false)
			continue
		else:
			_canvas.draw_rect(r, Color(0.08, 0.1, 0.14, 0.92) if en else Color(0.07, 0.08, 0.1, 0.7))
			_canvas.draw_rect(r, PINK if en else Color(0.5, 0.4, 0.45), false, 3.0)
		var fs := 30 if r.size.y > 60 else 24
		var ts: Vector2 = font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		_canvas.draw_string(font, r.position + Vector2((r.size.x - ts.x) * 0.5, r.size.y * 0.5 + fs * 0.35), label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.98) if en else Color(0.75, 0.75, 0.78))


## Every kind of creature in a grid: the ones met show their name, sex and what they do; the rest stay hidden until the player meets them.
func _draw_bestiary(font: Font, w: float, h: float) -> void:
	var ids := Bestiary.ids()
	ids.append("bellkeeper")
	var cols := 6
	var cw := (w - 48.0) / cols
	var rows := int(ceil(float(ids.size()) / cols))
	var ch := minf(86.0, (h - 160.0) / rows)
	var met: Dictionary = game.met if game != null else {}
	var seen := 0
	for i in ids.size():
		var id: String = ids[i]
		var r := Rect2(24 + (i % cols) * cw + 3, 70 + (i / cols) * ch + 3, cw - 6, ch - 6)
		var known: bool = met.has(id)
		seen += 1 if known else 0
		var box := UiArt.box("panel_dark" if known else "panel", 20)
		if box != null:
			_canvas.draw_style_box(box, r)
		else:
			_canvas.draw_rect(r, Color(0.05, 0.07, 0.1, 0.8))
		var d := Bestiary.def(id)
		var name_txt: String = String(d.name) if known else "? ? ?"
		_canvas.draw_string(font, r.position + Vector2(10, 22), name_txt, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 20, 15, Color(1, 1, 1, 0.95 if known else 0.4))
		if known:
			var sex := Bestiary.sex_of(id)
			var tr := String(Bestiary.trait_of(id))
			_canvas.draw_string(font, r.position + Vector2(10, 42), "%s · %s" % ["woman" if sex == "F" else "man", tr], HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 20, 12, Color(0.85, 0.92, 1.0, 0.8))
	_canvas.draw_string(font, Vector2(24, h - 96), "Met %d of %d" % [seen, ids.size()], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(1, 1, 1, 0.8))


func _draw_craft(font: Font, w: float, h: float) -> void:
	var y := h * 0.3
	var p := game.player
	for id in Data.RECIPES:
		var r: Dictionary = Data.RECIPES[id]
		var needs: Dictionary = r.needs
		var parts: Array[String] = []
		for k in needs:
			parts.append("%s %d/%d" % [String(Data.ITEMS[k].name), p.count(k), int(needs[k])])
		_canvas.draw_rect(Rect2(w * 0.5 - 360, y - 6, 720, 74), Color(0.07, 0.09, 0.12, 0.9))
		_canvas.draw_rect(Rect2(w * 0.5 - 360, y - 6, 720, 74), Color(0.8, 0.86, 0.95, 0.5), false, 2.0)
		_canvas.draw_string(font, Vector2(w * 0.5 - 344, y + 24), String(r.name).to_upper(), HORIZONTAL_ALIGNMENT_LEFT, 280, 26, CREAM)
		_canvas.draw_string(font, Vector2(w * 0.5 - 344, y + 54), "  ·  ".join(parts), HORIZONTAL_ALIGNMENT_LEFT, 440, 19, GOLD)
		y += 84.0


func _draw_lobby(font: Font, w: float, h: float) -> void:
	_canvas.draw_rect(Rect2(0, 0, w, h * 0.0 + 150), Color(0.03, 0.04, 0.06, 0.6))
	_canvas.draw_rect(Rect2(0, h - 280, w, 280), Color(0.03, 0.04, 0.06, 0.6))
	var lp := UiArt.box("panel", 30)
	if lp != null:
		_canvas.draw_style_box(lp, Rect2(24, h * 0.32, 300, 200))
	else:
		_canvas.draw_rect(Rect2(24, h * 0.32, 300, 200), Color(0.04, 0.05, 0.08, 0.78))
		_canvas.draw_rect(Rect2(24, h * 0.32, 300, 200), PINK, false, 2.0)
	var vals := [float(lobby.get("hp", 0.0)) / 120.0, float(lobby.get("speed", 0.0)) / 5.5, float(lobby.get("stamina", 0.0)) / 140.0, float(lobby.get("carry", 0.0)) / 14.0]
	var by := h * 0.32 + 38.0
	var names := ["HEALTH", "SPEED", "STAMINA", "CARRY"]
	for i in 4:
		_bar(Rect2(150, by + i * 40.0, 160, 14), vals[i], PINK)
		_canvas.draw_string(font, Vector2(40, by + i * 40.0 + 13.0), names[i], HORIZONTAL_ALIGNMENT_LEFT, 120, 20, CREAM)
	var idx := int(lobby.get("index", 0))
	var cnt := int(lobby.get("count", 1))
	for i in cnt:
		var c := Vector2(w * 0.5 + (i - (cnt - 1) * 0.5) * 34.0, h - 296)
		_canvas.draw_circle(c, 8, PINK if i == idx else Color(1, 1, 1, 0.25))
	_draw_screen_buttons(font)


func _process(_delta: float) -> void:
	pass
