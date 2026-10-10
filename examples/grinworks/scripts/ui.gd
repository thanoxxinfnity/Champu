class_name Ui
extends CanvasLayer
## Everything on the glass: the HUD, the touch controls (a floating stick, a look area and buttons,
## all multi-touch), the note / journal / code-dial / breaker panels, and the title, pause, death and
## win screens.

signal start_pressed
signal continue_pressed
signal retry_pressed
signal restart_pressed
signal resume_pressed
signal pause_pressed

const INK := Color(0.78, 0.92, 0.96)
const DIM := Color(0.5, 0.65, 0.7)
const AMBER := Color(1.0, 0.8, 0.35)
const RED := Color(1.0, 0.25, 0.2)
const PANEL := Color(0.03, 0.07, 0.09, 0.93)

var game: Game
var modal_open := false
var playing := false

var _root: Control
var _hud: Control
var _pad: Control
var _modal: Control
var _screen: Control
var _post: ColorRect
var _flash: ColorRect
var _slats: Control
var _objective: Label
var _toast: Label
var _prompt: Label
var _count: Label
var _items: Label
var _bars: Control
var _battery := 1.0
var _torch_on := true
var _stamina := 1.0
var _noise := 0.0
var _toast_t := 0.0
var _fear := 0.0
var _hurt := 0.0
var _focus_now := false
var _card: Label
var _card_sub: Label
var _card_tw: Tween
var _toast_tw: Tween

# Touch bookkeeping.
var _touches := {}          # index -> role
var _stick_origin := Vector2.ZERO
var _stick_pos := Vector2.ZERO
var _stick_index := -1
var _look_last := {}        # index -> last position
var _held := {}             # button name -> bool
var _dial_values: Array = []
var _dial_labels: Array = []
var _dial_charset := "digits"
var _dial_cb := Callable()
var _breaker_buttons: Array = []
var _breaker_cb := Callable()
var _pad_alpha := 1.0
var look_speed := 1.0       # touch / mouse look multiplier, kept in user://settings.cfg


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load("user://settings.cfg") == OK:
		look_speed = clampf(float(cfg.get_value("look", "speed", 1.0)), 0.4, 2.5)
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 5
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	_post = ColorRect.new()
	_post.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_post.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/post.gdshader")
	_post.material = sm
	_root.add_child(_post)

	_slats = Control.new()
	_slats.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_slats.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_slats.draw.connect(_draw_slats)
	_slats.visible = false
	_root.add_child(_slats)

	_hud = Control.new()
	_hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hud.visible = false
	_root.add_child(_hud)
	_build_hud()

	_pad = Control.new()
	_pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pad.draw.connect(_draw_pad)
	_pad.visible = false
	_root.add_child(_pad)

	_flash = ColorRect.new()
	_flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.color = Color(0.6, 0.0, 0.0, 0.0)
	_root.add_child(_flash)

	_modal = Control.new()
	_modal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_modal)

	_screen = Control.new()
	_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_screen)


func _lbl(text: String, size: int, color := INK, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", maxi(2, size / 8))
	l.horizontal_alignment = align
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _build_hud() -> void:
	_objective = _lbl("", 15, INK)
	_objective.position = Vector2(18, 14)
	_objective.custom_minimum_size = Vector2(420, 0)
	_objective.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_objective.size = Vector2(420, 60)
	_hud.add_child(_objective)

	_toast = _lbl("", 20, AMBER, HORIZONTAL_ALIGNMENT_CENTER)
	_toast.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_toast.position.y = 84
	_toast.custom_minimum_size = Vector2(760, 0)
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_toast.size = Vector2(760, 40)
	_toast.position.x = -380
	_toast.modulate.a = 0.0
	_hud.add_child(_toast)

	_card = _lbl("", 48, AMBER, HORIZONTAL_ALIGNMENT_CENTER)
	_card.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_card.size = Vector2(900, 70)
	_card.position = Vector2(-450, 190)
	_card.pivot_offset = Vector2(450, 35)
	_card.modulate.a = 0.0
	_hud.add_child(_card)
	_card_sub = _lbl("", 20, DIM, HORIZONTAL_ALIGNMENT_CENTER)
	_card_sub.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_card_sub.size = Vector2(900, 30)
	_card_sub.position = Vector2(-450, 258)
	_card_sub.modulate.a = 0.0
	_hud.add_child(_card_sub)

	_prompt = _lbl("", 22, Color(1, 0.95, 0.6), HORIZONTAL_ALIGNMENT_CENTER)
	_prompt.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_prompt.size = Vector2(600, 30)
	_prompt.position = Vector2(-300, 40)
	_hud.add_child(_prompt)

	_count = _lbl("", 44, RED, HORIZONTAL_ALIGNMENT_CENTER)
	_count.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_count.size = Vector2(600, 60)
	_count.position = Vector2(-300, 120)
	_hud.add_child(_count)

	_items = _lbl("", 16, AMBER, HORIZONTAL_ALIGNMENT_RIGHT)
	_items.size = Vector2(300, 60)
	_hud.add_child(_items)

	_bars = Control.new()
	_bars.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bars.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_bars.draw.connect(_draw_bars)
	_hud.add_child(_bars)


func _process(delta: float) -> void:
	var vp := get_viewport().get_visible_rect().size
	_items.position = Vector2(vp.x - 330, 76)
	if _toast_t > 0.0:
		_toast_t -= delta
		_toast.modulate.a = clampf(_toast_t * 2.0, 0.0, 1.0)
	_hurt = move_toward(_hurt, 0.0, delta * 1.2)
	var sm := _post.material as ShaderMaterial
	sm.set_shader_parameter("hurt", maxf(_hurt, 0.0))
	sm.set_shader_parameter("low_hp", clampf(_fear * 0.9, 0.0, 1.0))
	sm.set_shader_parameter("vignette", 0.5 + _fear * 0.3)
	_flash.color.a = move_toward(_flash.color.a, 0.0, delta * 0.7)
	if playing:
		_bars.queue_redraw()
		_pad.queue_redraw()
	_slats.queue_redraw() if _slats.visible else null


# ── what the game tells the HUD ──────────────────────────────────────────────

func set_playing(on: bool) -> void:
	playing = on
	_hud.visible = on
	_pad.visible = on
	_touches.clear()
	_held.clear()
	_stick_index = -1
	if game and game.player:
		game.player.move_input = Vector2.ZERO
		game.player.sprint_held = false
		game.player.crank_held = false
	if on and not _is_touch_device():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	else:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _is_touch_device() -> bool:
	return DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")


func toast(text: String, seconds := 4.0) -> void:
	_toast.text = text
	_toast_t = seconds
	_toast.modulate.a = 1.0
	if _toast_tw:
		_toast_tw.kill()
	_toast.position.y = 98.0
	_toast_tw = _toast.create_tween().set_parallel(true)
	_toast_tw.tween_property(_toast, "position:y", 84.0, 0.25).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_toast.visible_ratio = 0.0
	_toast_tw.tween_property(_toast, "visible_ratio", 1.0, clampf(text.length() * 0.02, 0.2, 1.4))


## Text that is typed out rather than dropped on the screen.
func _type(l: Label, seconds := -1.0) -> void:
	l.visible_ratio = 0.0
	var secs := seconds if seconds > 0.0 else clampf(l.text.length() * 0.03, 0.4, 3.5)
	l.create_tween().tween_property(l, "visible_ratio", 1.0, secs)


## A big title that flickers in like a failing neon sign.
func _glitch_in(l: Label, pop := 1.2) -> void:
	l.pivot_offset = l.custom_minimum_size * 0.5 + Vector2(0, 30)
	l.scale = Vector2.ONE * pop
	var tw := l.create_tween()
	tw.set_parallel(false)
	for a in [0.0, 1.0, 0.15, 1.0, 0.5, 1.0]:
		tw.tween_property(l, "modulate:a", a, 0.06)
	l.create_tween().tween_property(l, "scale", Vector2.ONE, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## A place name over the screen: typed in, held, faded.
func card(title: String, sub := "") -> void:
	if _card_tw:
		_card_tw.kill()
	_card.text = title
	_card_sub.text = sub
	_card.visible_ratio = 0.0
	_card_sub.visible_ratio = 0.0
	_card.modulate.a = 0.0
	_card_sub.modulate.a = 0.0
	_card.scale = Vector2.ONE * 1.15
	_card_tw = create_tween().set_parallel(true)
	_card_tw.tween_property(_card, "modulate:a", 1.0, 0.25)
	_card_tw.tween_property(_card, "visible_ratio", 1.0, clampf(title.length() * 0.08, 0.5, 1.3))
	_card_tw.tween_property(_card, "scale", Vector2.ONE, 0.9).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_card_tw.tween_property(_card_sub, "modulate:a", 1.0, 0.4).set_delay(0.5)
	_card_tw.tween_property(_card_sub, "visible_ratio", 1.0, clampf(sub.length() * 0.04, 0.3, 1.6)).set_delay(0.5)
	_card_tw.chain().tween_interval(2.0)
	_card_tw.chain().set_parallel(true)
	_card_tw.tween_property(_card, "modulate:a", 0.0, 1.2)
	_card_tw.tween_property(_card_sub, "modulate:a", 0.0, 1.2)


func set_prompt(text: String, has_focus: bool) -> void:
	_focus_now = has_focus
	_prompt.text = ("USE  -  " + text) if text != "" else ""


func set_objective(text: String) -> void:
	if text == _objective.text:
		return
	_objective.text = text
	_type(_objective, 0.7)
	_objective.modulate = Color(1.0, 0.9, 0.4)
	_objective.create_tween().tween_property(_objective, "modulate", Color.WHITE, 1.2)


func set_countdown(text: String) -> void:
	if text == _count.text:
		return
	_count.text = text
	if text != "":
		_count.pivot_offset = Vector2(300, 30)
		_count.scale = Vector2.ONE * 1.3
		_count.create_tween().tween_property(_count, "scale", Vector2.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func set_battery(f: float, torch_on: bool) -> void:
	_battery = f
	_torch_on = torch_on


func set_stamina(f: float) -> void:
	_stamina = f


func set_noise(f: float) -> void:
	_noise = f


func set_items(fuse: bool, keycard: bool, cells: int, cells_in: int) -> void:
	var parts: Array[String] = []
	if fuse:
		parts.append("FUSE")
	if keycard:
		parts.append("KEYCARD")
	if cells + cells_in > 0:
		parts.append("CELLS %d/3" % (cells + cells_in))
	_items.text = "   ".join(parts)


func set_fear(f: float, hunted: bool) -> void:
	_fear = f if not hunted else maxf(f, 0.5)


func set_hidden(on: bool) -> void:
	_slats.visible = on


func flash_red() -> void:
	_flash.color.a = 0.85
	_hurt = 1.0


func fade_to_black(on: bool) -> void:
	_flash.color = Color(0, 0, 0, 1.0 if on else 0.0)


func _draw_bars() -> void:
	var x := 18.0
	var y := 88.0
	# Torch battery.
	_bars.draw_string(ThemeDB.fallback_font, Vector2(x, y), "TORCH" if _torch_on else "TORCH (off)", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, DIM)
	_bars.draw_rect(Rect2(x, y + 4, 150, 8), Color(0, 0, 0, 0.55))
	var bc := Color(0.4, 0.9, 0.55) if _battery > 0.3 else (AMBER if _battery > 0.12 else RED)
	_bars.draw_rect(Rect2(x, y + 4, 150 * _battery, 8), bc)
	# Stamina.
	_bars.draw_string(ThemeDB.fallback_font, Vector2(x, y + 28), "STAMINA", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, DIM)
	_bars.draw_rect(Rect2(x, y + 32, 150, 6), Color(0, 0, 0, 0.55))
	_bars.draw_rect(Rect2(x, y + 32, 150 * _stamina, 6), Color(0.45, 0.75, 0.95))
	# How loud you are right now: what the Hollow can hear.
	_bars.draw_string(ThemeDB.fallback_font, Vector2(x, y + 56), "NOISE", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, DIM)
	_bars.draw_rect(Rect2(x, y + 60, 150, 6), Color(0, 0, 0, 0.55))
	_bars.draw_rect(Rect2(x, y + 60, 150 * _noise, 6), Color(1.0, 0.45, 0.25) if _noise > 0.5 else Color(0.9, 0.8, 0.4))
	# Crosshair.
	var c := get_viewport().get_visible_rect().size * 0.5
	_bars.draw_circle(c, 2.5 if not _focus_now else 4.5, Color(1, 1, 1, 0.55 if not _focus_now else 0.95))


func _draw_slats() -> void:
	var vp := get_viewport().get_visible_rect().size
	_slats.draw_rect(Rect2(0, 0, vp.x, vp.y), Color(0, 0, 0, 0.55))
	var n := 9
	var gap := vp.x * 0.5 / n
	for i in range(n):
		var x := vp.x * 0.25 + gap * i
		_slats.draw_rect(Rect2(x, vp.y * 0.18, gap * 0.45, vp.y * 0.64), Color(0, 0, 0, 0.0), true)
	# Dark bars with thin gaps: a locker door's vents.
	for i in range(n + 1):
		var x := vp.x * 0.25 + gap * i
		_slats.draw_rect(Rect2(x - gap * 0.28, 0, gap * 0.56, vp.y), Color(0, 0, 0, 0.78))
	_slats.draw_string(ThemeDB.fallback_font, Vector2(vp.x * 0.5 - 150, vp.y - 40), "Hiding. Tap USE or move to come out.", HORIZONTAL_ALIGNMENT_CENTER, 300, 15, DIM)


# ── touch controls ───────────────────────────────────────────────────────────

func _layout() -> Dictionary:
	var vp := get_viewport().get_visible_rect().size
	return {
		"use": {"c": Vector2(vp.x - 120, vp.y - 120), "r": 58.0, "t": "USE"},
		"torch": {"c": Vector2(vp.x - 250, vp.y - 70), "r": 38.0, "t": "TORCH"},
		"crank": {"c": Vector2(vp.x - 250, vp.y - 170), "r": 38.0, "t": "CRANK"},
		"crouch": {"c": Vector2(vp.x - 120, vp.y - 240), "r": 34.0, "t": "CROUCH"},
		"pause": {"c": Vector2(vp.x - 44, 40), "r": 26.0, "t": "II"},
		"journal": {"c": Vector2(vp.x - 116, 40), "r": 30.0, "t": "NOTES"},
	}


func _hit(pos: Vector2) -> String:
	var l := _layout()
	for k in l:
		if pos.distance_to(l[k].c) <= l[k].r + 10.0:
			return k
	return ""


func _draw_pad() -> void:
	if _is_touch_device() == false and not OS.has_feature("editor") and false:
		return
	var l := _layout()
	for k in l:
		var d: Dictionary = l[k]
		var down: bool = _held.get(k, false)
		var col := Color(0.2, 0.5, 0.6, 0.35 if not down else 0.7)
		if k == "use":
			col = Color(0.95, 0.75, 0.25, 0.5 if _focus_now else 0.28)
			if down:
				col.a = 0.8
		_pad.draw_circle(d.c, d.r, col)
		_pad.draw_arc(d.c, d.r, 0, TAU, 40, Color(0.7, 0.9, 1.0, 0.5), 2.0)
		var fs := 14 if d.r > 30 else 11
		_pad.draw_string(ThemeDB.fallback_font, d.c + Vector2(-d.r, fs * 0.35), d.t, HORIZONTAL_ALIGNMENT_CENTER, d.r * 2, fs, Color(1, 1, 1, 0.9))
	if _stick_index != -1:
		_pad.draw_circle(_stick_origin, 70, Color(0.2, 0.5, 0.6, 0.22))
		_pad.draw_arc(_stick_origin, 70, 0, TAU, 40, Color(0.7, 0.9, 1.0, 0.45), 2.0)
		_pad.draw_circle(_stick_pos, 30, Color(0.7, 0.9, 1.0, 0.5))
	else:
		var vp := get_viewport().get_visible_rect().size
		_pad.draw_arc(Vector2(130, vp.y - 120), 70, 0, TAU, 40, Color(0.7, 0.9, 1.0, 0.18), 2.0)


func _input(event: InputEvent) -> void:
	if not playing or modal_open or game == null or game.player == null:
		return
	var p := game.player
	if event is InputEventScreenTouch:
		var vp := get_viewport().get_visible_rect().size
		if event.pressed:
			var b := _hit(event.position)
			if b != "":
				_touches[event.index] = b
				_held[b] = true
				_press(b)
			elif event.position.x < vp.x * 0.45 and event.position.y > vp.y * 0.25 and _stick_index == -1:
				_stick_index = event.index
				_stick_origin = event.position
				_stick_pos = event.position
				_touches[event.index] = "stick"
			else:
				_touches[event.index] = "look"
				_look_last[event.index] = event.position
		else:
			var role: String = _touches.get(event.index, "")
			if role == "stick":
				_stick_index = -1
				p.move_input = Vector2.ZERO
				p.sprint_held = false
			elif role in ["crank"]:
				p.crank_held = false
			if role != "" and role != "stick" and role != "look":
				_held[role] = false
			_touches.erase(event.index)
			_look_last.erase(event.index)
	elif event is InputEventScreenDrag:
		var role: String = _touches.get(event.index, "")
		if role == "stick":
			var off: Vector2 = event.position - _stick_origin
			var r := 70.0
			if off.length() > r:
				_stick_origin += off.normalized() * (off.length() - r)
				off = off.limit_length(r)
			_stick_pos = _stick_origin + off
			var v := off / r
			p.move_input = Vector2(v.x, v.y)
			p.sprint_held = v.length() > 0.93
		elif role == "look":
			var last: Vector2 = _look_last.get(event.index, event.position)
			var d: Vector2 = event.position - last
			_look_last[event.index] = event.position
			p.look(d.x * 0.0046 * look_speed, d.y * 0.0046 * look_speed)
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		p.look(event.relative.x * 0.0022 * look_speed, event.relative.y * 0.0022 * look_speed)
	elif event is InputEventKey and not event.echo:
		_key(event)


func _press(b: String) -> void:
	var p := game.player
	match b:
		"use":
			p.use_edge = true
		"torch":
			p.toggle_torch()
		"crank":
			p.crank_held = true
		"crouch":
			p.crouching = not p.crouching
		"pause":
			pause_pressed.emit()
		"journal":
			show_journal()


func _key(event: InputEventKey) -> void:
	var p := game.player
	var down := event.pressed
	match event.keycode:
		KEY_E, KEY_ENTER, KEY_SPACE:
			if down:
				p.use_edge = true
		KEY_F:
			if down:
				p.toggle_torch()
		KEY_C:
			if down:
				p.crouching = not p.crouching
		KEY_R:
			p.crank_held = down
		KEY_SHIFT:
			p.sprint_held = down
		KEY_TAB:
			if down:
				show_journal()
		KEY_W, KEY_S, KEY_A, KEY_D, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT:
			var v := Vector2(
				float(Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT)) - float(Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT)),
				float(Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN)) - float(Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)))
			p.move_input = v


# ── panels ───────────────────────────────────────────────────────────────────

func _clear(node: Control) -> void:
	for c in node.get_children():
		c.queue_free()


func _panel(width: float, height: float) -> VBoxContainer:
	_clear(_modal)
	modal_open = true
	if game and game.player:
		game.player.move_input = Vector2.ZERO
		game.player.crank_held = false
		game.player.sprint_held = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_modal.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.color = Color(0, 0, 0, 0.6)
	_modal.add_child(dim)
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL
	sb.border_color = Color(0.2, 0.55, 0.65)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(18)
	pc.add_theme_stylebox_override("panel", sb)
	pc.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	pc.custom_minimum_size = Vector2(width, 0)
	pc.grow_horizontal = Control.GROW_DIRECTION_BOTH
	pc.grow_vertical = Control.GROW_DIRECTION_BOTH
	_modal.add_child(pc)
	pc.modulate.a = 0.0
	dim.modulate.a = 0.0
	var fade := pc.create_tween().set_parallel(true)
	fade.tween_property(pc, "modulate:a", 1.0, 0.18)
	fade.tween_property(dim, "modulate:a", 1.0, 0.18)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	pc.add_child(box)
	return box


func _button(text: String, size := Vector2(150, 52), cb := Callable()) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = size
	b.add_theme_font_size_override("font_size", 18)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.2, 0.26)
	sb.border_color = Color(0.3, 0.7, 0.8)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(8)
	b.add_theme_stylebox_override("normal", sb)
	var sh := sb.duplicate() as StyleBoxFlat
	sh.bg_color = Color(0.14, 0.32, 0.4)
	b.add_theme_stylebox_override("hover", sh)
	b.add_theme_stylebox_override("pressed", sh)
	b.add_theme_color_override("font_color", INK)
	if cb.is_valid():
		b.pressed.connect(cb)
	return b


func close_modal() -> void:
	_clear(_modal)
	modal_open = false
	_modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if playing and not _is_touch_device():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func show_note(title: String, body: String) -> void:
	var box := _panel(620, 0)
	var t := _lbl(title, 22, AMBER)
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(t)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(580, 230)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(scroll)
	var b := _lbl(body, 18, INK)
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.custom_minimum_size = Vector2(570, 0)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(b)
	_type(b, clampf(body.length() * 0.012, 0.5, 2.6))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(row)
	row.add_child(_button("CLOSE", Vector2(180, 54), close_modal))


func show_journal() -> void:
	if game == null or modal_open:
		return
	var box := _panel(560, 0)
	box.add_child(_lbl("JOURNAL", 22, AMBER))
	if game.s.notes.is_empty():
		box.add_child(_lbl("Nothing yet. Notes you read are kept here.", 17, DIM))
	for id in game.s.notes:
		var n: Dictionary = Data.NOTES[id]
		var b := _button(n.title, Vector2(520, 46), func(): show_note(n.title, Data.note_body(id)))
		box.add_child(b)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(row)
	row.add_child(_button("CLOSE", Vector2(180, 54), close_modal))


## A row of wheels: digits or letters. `on_submit(value) -> bool` says whether the answer was right.
func show_dial(title: String, hint: String, slots: int, charset: String, on_submit: Callable) -> void:
	var box := _panel(maxf(420.0, slots * 84.0 + 60.0), 0)
	box.add_child(_lbl(title, 22, AMBER))
	var h := _lbl(hint, 15, DIM)
	h.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	h.custom_minimum_size = Vector2(maxf(380.0, slots * 84.0), 0)
	box.add_child(h)
	_dial_charset = charset
	_dial_cb = on_submit
	_dial_values = []
	_dial_labels = []
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 10)
	box.add_child(row)
	for i in range(slots):
		_dial_values.append(0)
		var col := VBoxContainer.new()
		col.add_theme_constant_override("separation", 6)
		row.add_child(col)
		col.add_child(_button("+", Vector2(68, 54), _dial_step.bind(i, 1)))
		var l := _lbl("0" if charset == "digits" else "A", 38, Color(1, 1, 0.8), HORIZONTAL_ALIGNMENT_CENTER)
		l.custom_minimum_size = Vector2(68, 56)
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(l)
		_dial_labels.append(l)
		col.add_child(_button("-", Vector2(68, 54), _dial_step.bind(i, -1)))
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 14)
	box.add_child(actions)
	actions.add_child(_button("ENTER", Vector2(170, 56), _dial_submit))
	actions.add_child(_button("CANCEL", Vector2(150, 56), close_modal))


func _dial_char(i: int) -> String:
	var v: int = _dial_values[i]
	return str(v) if _dial_charset == "digits" else char(65 + v)


func _dial_step(i: int, d: int) -> void:
	var n := 10 if _dial_charset == "digits" else 26
	_dial_values[i] = (_dial_values[i] + d + n) % n
	(_dial_labels[i] as Label).text = _dial_char(i)
	game.sfx.play("click", -8.0)


func dial_value() -> String:
	var out := ""
	for i in range(_dial_values.size()):
		out += _dial_char(i)
	return out


func _dial_submit() -> void:
	if _dial_cb.is_valid():
		var ok: Variant = _dial_cb.call(dial_value())
		if ok == false:
			for l in _dial_labels:
				(l as Label).add_theme_color_override("font_color", RED)


func show_breaker(board: Array, on_press: Callable) -> void:
	var box := _panel(430, 0)
	box.add_child(_lbl("BREAKER PANEL", 22, AMBER))
	var h := _lbl("Each switch flips itself and the ones touching it. Get all nine ON.", 15, DIM)
	h.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	h.custom_minimum_size = Vector2(390, 0)
	box.add_child(h)
	_breaker_cb = on_press
	_breaker_buttons = []
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	var wrap := CenterContainer.new()
	wrap.add_child(grid)
	box.add_child(wrap)
	for i in range(9):
		var b := _button("", Vector2(96, 80), _breaker_press.bind(i))
		grid.add_child(b)
		_breaker_buttons.append(b)
	_breaker_paint(board)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(row)
	row.add_child(_button("CLOSE", Vector2(180, 54), close_modal))


func _breaker_paint(board: Array) -> void:
	for i in range(9):
		var b: Button = _breaker_buttons[i]
		var on: bool = board[i]
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.15, 0.62, 0.35) if on else Color(0.08, 0.09, 0.1)
		sb.border_color = Color(0.5, 0.95, 0.7) if on else Color(0.3, 0.35, 0.38)
		sb.set_border_width_all(3)
		sb.set_corner_radius_all(8)
		b.add_theme_stylebox_override("normal", sb)
		b.add_theme_stylebox_override("hover", sb)
		b.add_theme_stylebox_override("pressed", sb)
		b.text = "ON" if on else "OFF"


func _breaker_press(cell: int) -> void:
	if not _breaker_cb.is_valid():
		return
	var board: Variant = _breaker_cb.call(cell)
	if typeof(board) == TYPE_ARRAY and modal_open and _breaker_buttons.size() == 9:
		_breaker_paint(board)


# ── screens ──────────────────────────────────────────────────────────────────

func _screen_box(title: String, sub: String, buttons: Array, title_color := INK, fx := "title") -> void:
	_clear(_screen)
	_screen.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.color = Color(0.0, 0.01, 0.015, 0.88)
	_screen.add_child(dim)
	dim.modulate.a = 0.0
	dim.create_tween().tween_property(dim, "modulate:a", 1.0, 0.6)
	var box := VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.add_theme_constant_override("separation", 16)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	_screen.add_child(box)
	var t := _lbl(title, 54, title_color, HORIZONTAL_ALIGNMENT_CENTER)
	t.custom_minimum_size = Vector2(900, 0)
	box.add_child(t)
	var s := _lbl(sub, 18, DIM, HORIZONTAL_ALIGNMENT_CENTER)
	s.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	s.custom_minimum_size = Vector2(760, 0)
	box.add_child(s)
	var n := 0
	for b in buttons:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.add_child(_button(b[0], Vector2(300, 60), b[1]))
		box.add_child(row)
		row.modulate.a = 0.0
		row.create_tween().tween_property(row, "modulate:a", 1.0, 0.4).set_delay(0.9 + 0.15 * n)
		n += 1
	# Each screen arrives its own way: the title flickers on and breathes, death shakes, the win rises slowly.
	if fx == "title":
		_glitch_in(t)
		_type(s, 3.0)
		var glow := t.create_tween().set_loops()
		glow.tween_interval(1.6)
		glow.tween_property(t, "modulate", Color(1, 1, 1, 0.7), 0.12)
		glow.tween_property(t, "modulate", Color.WHITE, 0.2)
	elif fx == "death":
		_glitch_in(t, 1.6)
		_type(s, 1.2)
		t.pivot_offset = Vector2(450, 35)
		var shake := t.create_tween().set_loops()
		shake.tween_property(t, "rotation", 0.012, 0.05)
		shake.tween_property(t, "rotation", -0.012, 0.05)
	else:
		t.modulate.a = 0.0
		t.scale = Vector2.ONE * 0.8
		t.pivot_offset = Vector2(450, 35)
		var rise := t.create_tween().set_parallel(true)
		rise.tween_property(t, "modulate:a", 1.0, 1.4)
		rise.tween_property(t, "scale", Vector2.ONE, 1.4).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		_type(s, 4.5)


func hide_all_screens() -> void:
	_clear(_screen)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_clear(_modal)
	modal_open = false
	_modal.mouse_filter = Control.MOUSE_FILTER_IGNORE


func show_title(can_continue: bool) -> void:
	playing = false
	_hud.visible = false
	_pad.visible = false
	var buttons: Array = [["NEW GAME", func(): start_pressed.emit()]]
	if can_continue:
		buttons.push_front(["CONTINUE", func(): continue_pressed.emit()])
	_screen_box("GRINWORKS", "The toy factory closed eleven years ago. Its mascot, Mr. Grin, never stopped smiling.\nHe hunts by sound and cannot stand bright light.\nSolve four puzzles, turn the power back on, open the gate.", buttons, Color(1.0, 0.82, 0.25))


func show_pause() -> void:
	playing = false
	_pad.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_screen_box("PAUSED", "", [["RESUME", func(): resume_pressed.emit()], ["LOOK SPEED  -", func(): _look_step(-0.2)], ["LOOK SPEED  +", func(): _look_step(0.2)], ["RESTART", func(): restart_pressed.emit()]])
	toast("Look speed %d%%" % int(look_speed * 100.0), 1.5)


func _look_step(d: float) -> void:
	look_speed = clampf(snappedf(look_speed + d, 0.1), 0.4, 2.5)
	var cfg := ConfigFile.new()
	cfg.set_value("look", "speed", look_speed)
	cfg.save("user://settings.cfg")
	toast("Look speed %d%%" % int(look_speed * 100.0), 2.0)
	_hud.visible = true


func show_death(deaths: int) -> void:
	playing = false
	_pad.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_screen_box("IT FOUND YOU", "Deaths: %d. Your progress is kept — you wake at the last lit room." % deaths, [["TRY AGAIN", func(): retry_pressed.emit()]], RED, "death")


func show_win(stats: String) -> void:
	playing = false
	_hud.visible = false
	_pad.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_screen_box("YOU ESCAPED", "The gate groans open. Morning light on the street, and no one is smiling behind you.\n\n" + stats, [["PLAY AGAIN", func(): restart_pressed.emit()]], Color(0.6, 1.0, 0.7), "win")
