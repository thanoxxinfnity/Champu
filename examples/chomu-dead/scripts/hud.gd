class_name Hud
extends CanvasLayer
## Everything on the glass: health, ammo, objective marker, radio subtitles,
## chapter cards, the crosshair, the touch controls (a floating stick on the
## left, free-look on the right, FIRE / RELOAD / SWAP / TORCH) and the title,
## pause, death and ending screens.

signal start_pressed
signal retry_pressed
signal restart_pressed
signal resume_pressed
signal pause_pressed
signal reload_pressed
signal swap_pressed
signal torch_pressed

const RED := Color(0.78, 0.08, 0.06)
const BONE := Color(0.88, 0.86, 0.78)

# Resolved touch state, read by Game every frame.
var move := Vector2.ZERO
var look := Vector2.ZERO        # accumulated drag, drained by Game
var fire := false
var sprint := false
var show_touch := false

var _pad: Control
var _post: ColorRect
var _post_mat: ShaderMaterial
var _hp_bar: ColorProgressBar
var _hp_label: Label
var _ammo_name: Label
var _ammo: Label
var _objective: Label
var _sub_box: PanelContainer
var _sub_speaker: Label
var _sub_text: Label
var _card: Label
var _toast: Label
var _note_box: PanelContainer
var _note_text: Label
var _boss_box: Control
var _boss_bar: ColorProgressBar
var _boss_title: Label
var _title_screen: Control
var _pause_screen: Control
var _death_screen: Control
var _win_screen: Control
var _win_stats: Label
var _loading: Label

var _goal = null                 # Vector3 or null
var _cam: Camera3D
var _say_queue: Array = []
var _say_t := 0.0
var _crosshair := 0.0
var _hit := 0.0
var _hit_kill := false
var _hit_head := false
var _hurt := 0.0
var _low := 0.0
var _flash := 0.0
var _toast_t := 0.0
var _card_t := 0.0
var _note_t := 0.0
var _last_hp := 100.0
var _goal_dist := 0.0

# Touch bookkeeping.
var _fingers := {}               # index -> {"role": String, "origin": Vector2, "pos": Vector2}
var _btn := {}                   # name -> {"c": Vector2, "r": float}


func _ready() -> void:
	layer = 10
	_pad = Control.new()
	_pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_pad.draw.connect(_draw_pad)
	add_child(_pad)
	show_touch = DisplayServer.is_touchscreen_available()
	_build_hud()
	_build_post()
	_build_screens()
	get_viewport().size_changed.connect(_layout)
	_layout()


# ── building the pieces ──────────────────────────────────────────────────────

func _label(text: String, size: int, color := BONE, align := HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.95))
	l.add_theme_constant_override("outline_size", maxi(3, size / 6))
	l.horizontal_alignment = align
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _build_hud() -> void:
	var root := Control.new()
	root.name = "Overlay"
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(root)

	# Health, top-left.
	var hp_box := Control.new()
	hp_box.position = Vector2(24, 18)
	hp_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(hp_box)
	_hp_label = _label("HEALTH", 15, Color(0.85, 0.5, 0.45))
	hp_box.add_child(_hp_label)
	_hp_bar = ColorProgressBar.new()
	_hp_bar.position = Vector2(0, 24)
	_hp_bar.size = Vector2(260, 16)
	hp_box.add_child(_hp_bar)

	# Objective, top-centre.
	_objective = _label("", 20, BONE, HORIZONTAL_ALIGNMENT_CENTER)
	_objective.name = "Objective"
	_objective.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_objective.custom_minimum_size = Vector2(700, 0)
	_objective.position = Vector2(-350, 14)
	_objective.size = Vector2(700, 30)
	root.add_child(_objective)

	# Ammo, bottom-right (above the fire button when on touch).
	_ammo_name = _label("", 15, Color(0.7, 0.7, 0.66), HORIZONTAL_ALIGNMENT_RIGHT)
	_ammo_name.name = "AmmoName"
	root.add_child(_ammo_name)
	_ammo = _label("", 40, BONE, HORIZONTAL_ALIGNMENT_RIGHT)
	_ammo.name = "Ammo"
	root.add_child(_ammo)

	# Radio / subtitle panel, bottom-centre.
	_sub_box = PanelContainer.new()
	_sub_box.name = "Subtitles"
	_sub_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.02, 0.025, 0.72)
	sb.border_color = Color(0.5, 0.08, 0.06, 0.9)
	sb.set_border_width_all(0)
	sb.border_width_left = 4
	sb.set_content_margin_all(12)
	sb.content_margin_left = 16
	_sub_box.add_theme_stylebox_override("panel", sb)
	var vb := VBoxContainer.new()
	vb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sub_box.add_child(vb)
	_sub_speaker = _label("", 14, Color(0.9, 0.35, 0.25))
	vb.add_child(_sub_speaker)
	_sub_text = _label("", 19)
	_sub_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub_text.custom_minimum_size = Vector2(620, 0)
	vb.add_child(_sub_text)
	_sub_box.visible = false
	root.add_child(_sub_box)

	# Note panel (found documents), centre-left.
	_note_box = PanelContainer.new()
	_note_box.name = "Note"
	_note_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var nb := StyleBoxFlat.new()
	nb.bg_color = Color(0.82, 0.78, 0.62, 0.94)
	nb.set_content_margin_all(16)
	nb.set_corner_radius_all(3)
	_note_box.add_theme_stylebox_override("panel", nb)
	_note_text = _label("", 18, Color(0.12, 0.09, 0.06))
	_note_text.remove_theme_color_override("font_outline_color")
	_note_text.add_theme_constant_override("outline_size", 0)
	_note_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note_text.custom_minimum_size = Vector2(430, 0)
	_note_box.add_child(_note_text)
	_note_box.visible = false
	root.add_child(_note_box)

	# Chapter card and toast, centre.
	_card = _label("", 46, Color(0.9, 0.2, 0.15), HORIZONTAL_ALIGNMENT_CENTER)
	_card.name = "Card"
	_card.modulate.a = 0.0
	root.add_child(_card)
	_toast = _label("", 22, BONE, HORIZONTAL_ALIGNMENT_CENTER)
	_toast.name = "Toast"
	_toast.modulate.a = 0.0
	root.add_child(_toast)

	# Boss bar.
	_boss_box = Control.new()
	_boss_box.name = "Boss"
	_boss_box.visible = false
	_boss_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_boss_box)
	_boss_title = _label("THE WARDEN", 20, Color(0.9, 0.3, 0.2), HORIZONTAL_ALIGNMENT_CENTER)
	_boss_box.add_child(_boss_title)
	_boss_bar = ColorProgressBar.new()
	_boss_bar.size = Vector2(520, 14)
	_boss_bar.position = Vector2(0, 30)
	_boss_box.add_child(_boss_bar)

	_loading = _label("", 16, Color(0.6, 0.6, 0.55), HORIZONTAL_ALIGNMENT_CENTER)
	_loading.name = "Loading"
	root.add_child(_loading)


func _build_post() -> void:
	_post = ColorRect.new()
	_post.name = "Post"
	_post.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_post.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_post_mat = ShaderMaterial.new()
	_post_mat.shader = preload("res://shaders/post.gdshader")
	_post.material = _post_mat
	add_child(_post)
	move_child(_post, 0)


func _screen(title: String, sub: String, buttons: Array, title_color := BONE) -> Control:
	var s := Control.new()
	s.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.visible = false
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.78)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.add_child(dim)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	box.add_theme_constant_override("separation", 14)
	s.add_child(box)
	var t := _label(title, 72, title_color, HORIZONTAL_ALIGNMENT_CENTER)
	t.add_theme_constant_override("outline_size", 10)
	box.add_child(t)
	var st := _label(sub, 20, Color(0.75, 0.72, 0.66), HORIZONTAL_ALIGNMENT_CENTER)
	st.name = "Sub"
	st.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	st.custom_minimum_size = Vector2(700, 0)
	box.add_child(st)
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 16)
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(spacer)
	for b in buttons:
		var btn := Button.new()
		btn.text = b[0]
		btn.custom_minimum_size = Vector2(320, 62)
		btn.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		btn.add_theme_font_size_override("font_size", 24)
		var sn := StyleBoxFlat.new()
		sn.bg_color = Color(0.45, 0.05, 0.04, 0.95)
		sn.set_corner_radius_all(4)
		sn.set_content_margin_all(10)
		var sh := sn.duplicate() as StyleBoxFlat
		sh.bg_color = Color(0.7, 0.1, 0.07, 1.0)
		btn.add_theme_stylebox_override("normal", sn)
		btn.add_theme_stylebox_override("hover", sh)
		btn.add_theme_stylebox_override("pressed", sh)
		btn.add_theme_stylebox_override("focus", sn)
		btn.pressed.connect(b[1])
		box.add_child(btn)
	add_child(s)
	return s


func _build_screens() -> void:
	_title_screen = _screen("CHOMU DEAD",
		"SAINT ASTER  ·  02:14 AM\nThe town went dark an hour ago. You woke up in the clinic. Find a gun, find the others, and get out alive.",
		[["START", func() -> void: start_pressed.emit()]], Color(0.85, 0.12, 0.08))
	_pause_screen = _screen("PAUSED", "", [["RESUME", func() -> void: resume_pressed.emit()], ["RESTART CHAPTER", func() -> void: restart_pressed.emit()]])
	_death_screen = _screen("YOU DIED", "They always get you in the end.", [["RETRY CHAPTER", func() -> void: retry_pressed.emit()]], Color(0.8, 0.05, 0.04))
	_win_screen = _screen("ESCAPED", "", [["PLAY AGAIN", func() -> void: restart_pressed.emit()]], Color(0.9, 0.85, 0.6))
	_win_stats = _win_screen.find_child("Sub", true, false) as Label


# ── layout ───────────────────────────────────────────────────────────────────

func _layout() -> void:
	var vp := get_viewport().get_visible_rect().size
	_btn = {
		"fire": {"c": Vector2(vp.x - 130, vp.y - 150), "r": 74.0},
		"reload": {"c": Vector2(vp.x - 272, vp.y - 82), "r": 44.0},
		"swap": {"c": Vector2(vp.x - 292, vp.y - 196), "r": 42.0},
		"torch": {"c": Vector2(vp.x - 110, vp.y - 300), "r": 38.0},
		"pause": {"c": Vector2(vp.x - 52, 52), "r": 30.0},
	}
	_ammo.position = Vector2(vp.x - 440, vp.y - 380 if show_touch else vp.y - 80)
	_ammo.size = Vector2(300, 50)
	_ammo_name.position = Vector2(vp.x - 440, _ammo.position.y - 22)
	_ammo_name.size = Vector2(300, 22)
	if not show_touch:
		_ammo.position.x = vp.x - 340
		_ammo_name.position.x = vp.x - 340
	_sub_box.position = Vector2(vp.x * 0.5 - 330, vp.y - 190 if not show_touch else vp.y - 150)
	_sub_box.size = Vector2(660, 80)
	_note_box.position = Vector2(vp.x * 0.5 - 245, vp.y * 0.28)
	_card.position = Vector2(0, vp.y * 0.30)
	_card.size = Vector2(vp.x, 70)
	_toast.position = Vector2(0, vp.y * 0.62)
	_toast.size = Vector2(vp.x, 36)
	_boss_box.position = Vector2(vp.x * 0.5 - 260, 56)
	_boss_title.size = Vector2(520, 28)
	_loading.position = Vector2(0, vp.y - 30)
	_loading.size = Vector2(vp.x, 24)
	_pad.queue_redraw()


# ── the API the game calls ───────────────────────────────────────────────────

func set_camera(c: Camera3D) -> void:
	_cam = c


func set_objective(text: String) -> void:
	_objective.text = text.to_upper()


func set_goal(g) -> void:
	_goal = g


func toast(text: String) -> void:
	_toast.text = text
	_toast_t = 2.6


func chapter_card(text: String) -> void:
	_card.text = text
	_card_t = 3.6


func say(lines: Array) -> void:
	for l in lines:
		_say_queue.append(l)


func read_note(text: String) -> void:
	_note_text.text = text
	_note_t = maxf(6.0, text.length() * 0.06)


func boss_hp(frac: float) -> void:
	_boss_box.visible = frac >= 0.0
	if frac >= 0.0:
		_boss_bar.value = frac


func pulse_crosshair() -> void:
	_crosshair = 1.0


func hit_marker(head: bool, kill: bool) -> void:
	_hit = 1.0
	_hit_head = head
	_hit_kill = kill


func set_heart(frac: float) -> void:
	_low = clampf(1.0 - frac * 2.2, 0.0, 1.0)


func set_flash(v: float) -> void:
	_flash = v


func set_loading(text: String) -> void:
	_loading.text = text


func show_title() -> void:
	_title_screen.visible = true
	set_playing(false)


func show_pause(on: bool) -> void:
	_pause_screen.visible = on


func show_death() -> void:
	_card_t = 0.0
	_toast_t = 0.0
	_death_screen.visible = true


func hide_death() -> void:
	_death_screen.visible = false


func show_win(stats: String) -> void:
	hide_all_screens()
	_win_stats.text = stats
	_win_screen.visible = true


func hide_all_screens() -> void:
	for s in [_title_screen, _pause_screen, _death_screen, _win_screen]:
		(s as Control).visible = false


## Whether the HUD for play (not menus) is shown.
func set_playing(on: bool) -> void:
	get_node("Overlay").visible = on
	_pad.visible = on
	if not on:
		_fingers.clear()
		move = Vector2.ZERO
		fire = false


func update_frame(p: Player, delta: float) -> void:
	_hp_bar.value = p.hp / p.max_hp
	_hp_label.text = "HEALTH  %d" % int(ceilf(p.hp))
	var w: Dictionary = p.ammo()
	var d: Dictionary = Data.WEAPONS.get(p.cur, {})
	_ammo_name.text = String(d.get("name", ""))
	if p.reloading > 0.0:
		_ammo.text = "RELOADING"
		_ammo.add_theme_font_size_override("font_size", 28)
	else:
		_ammo.text = "%d / %d" % [w.mag, w.reserve]
		_ammo.add_theme_font_size_override("font_size", 40)
		_ammo.add_theme_color_override("font_color", BONE if w.mag > 0 else RED)
	if p.hp < _last_hp - 0.5:
		_hurt = minf(1.0, _hurt + (_last_hp - p.hp) / 30.0)
	_last_hp = p.hp
	_hurt = maxf(0.0, _hurt - delta * 1.8)

	# Subtitles run one line at a time.
	if _say_t > 0.0:
		_say_t -= delta
		if _say_t <= 0.0:
			_sub_box.visible = false
	if _say_t <= 0.0 and not _say_queue.is_empty():
		var l: Array = _say_queue.pop_front()
		_sub_speaker.text = String(l[0])
		_sub_speaker.visible = String(l[0]) != ""
		_sub_text.text = String(l[1])
		_sub_box.visible = true
		_say_t = 2.4 + String(l[1]).length() * 0.045
		if String(l[0]) in ["RADIO", "IYER"]:
			(get_parent() as Game).sfx.play("static", -10.0)

	_toast_t = maxf(0.0, _toast_t - delta)
	_toast.modulate.a = clampf(_toast_t * 2.0, 0.0, 1.0)
	_card_t = maxf(0.0, _card_t - delta)
	_card.modulate.a = clampf(minf(_card_t, 3.6 - _card_t) * 1.5, 0.0, 1.0)
	_note_t = maxf(0.0, _note_t - delta)
	_note_box.visible = _note_t > 0.0
	_crosshair = maxf(0.0, _crosshair - delta * 7.0)
	_hit = maxf(0.0, _hit - delta * 4.0)
	_post_mat.set_shader_parameter("hurt", _hurt * 0.8)
	_post_mat.set_shader_parameter("low_hp", _low)
	_post_mat.set_shader_parameter("flash", _flash)

	if _goal != null and p != null:
		_goal_dist = Vector2(p.global_position.x - _goal.x, p.global_position.z - _goal.z).length()
	_pad.queue_redraw()


# ── touch input ──────────────────────────────────────────────────────────────

func _hit_button(pos: Vector2) -> String:
	for k in _btn:
		var b: Dictionary = _btn[k]
		if pos.distance_to(b.c) <= float(b.r) * 1.15:
			return k
	return ""


func _input(event: InputEvent) -> void:
	if not _pad.visible or not show_touch:
		return
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			var b := _hit_button(t.position)
			if b != "":
				_fingers[t.index] = {"role": b, "origin": t.position, "pos": t.position}
				match b:
					"fire": fire = true
					"reload": reload_pressed.emit()
					"swap": swap_pressed.emit()
					"torch": torch_pressed.emit()
					"pause": pause_pressed.emit()
			else:
				var vp := get_viewport().get_visible_rect().size
				var role := "move" if t.position.x < vp.x * 0.42 else "look"
				_fingers[t.index] = {"role": role, "origin": t.position, "pos": t.position}
		else:
			if _fingers.has(t.index):
				var f: Dictionary = _fingers[t.index]
				if f.role == "fire":
					fire = false
				elif f.role == "move":
					move = Vector2.ZERO
					sprint = false
				_fingers.erase(t.index)
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		if not _fingers.has(d.index):
			return
		var f: Dictionary = _fingers[d.index]
		f.pos = d.position
		if f.role == "move":
			var off: Vector2 = f.pos - f.origin
			var r := 90.0
			move = (off / r).limit_length(1.0)
			sprint = move.length() > 0.92
		elif f.role == "look" or f.role == "fire":
			# Dragging off the fire button keeps firing and aims, like a real trigger thumb.
			look += d.relative * 1.0


func _draw_pad() -> void:
	var vp := get_viewport().get_visible_rect().size
	var c := vp * 0.5
	# Crosshair.
	var spread := 7.0 + _crosshair * 9.0
	var col := Color(0.95, 0.95, 0.9, 0.85)
	for dir in [Vector2.LEFT, Vector2.RIGHT, Vector2.UP, Vector2.DOWN]:
		_pad.draw_line(c + dir * spread, c + dir * (spread + 9.0), col, 2.0)
	_pad.draw_circle(c, 1.6, col)
	if _hit > 0.0:
		var hc := Color(1, 0.15, 0.1, _hit) if _hit_kill else (Color(1, 0.85, 0.2, _hit) if _hit_head else Color(1, 1, 1, _hit))
		var k := 11.0 + (1.0 - _hit) * 6.0
		for s in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			_pad.draw_line(c + s * k * 0.55, c + s * k * 1.15, hc, 3.0)

	# Objective marker.
	if _goal != null and _cam != null:
		var pos: Vector3 = _goal + Vector3(0, 2.0, 0)
		var behind := _cam.is_position_behind(pos)
		var sp := _cam.unproject_position(pos)
		if behind:
			sp = Vector2(vp.x - sp.x, vp.y - 60.0)
		var m := 54.0
		var clamped := Vector2(clampf(sp.x, m, vp.x - m), clampf(sp.y, m + 20.0, vp.y - m - 40.0))
		var mc := Color(1.0, 0.75, 0.2, 0.95)
		var on_screen := not behind and clamped.is_equal_approx(sp)
		var d := 9.0
		var pts := PackedVector2Array([clamped + Vector2(0, -d), clamped + Vector2(d, 0), clamped + Vector2(0, d), clamped + Vector2(-d, 0), clamped + Vector2(0, -d)])
		_pad.draw_polyline(pts, mc, 2.5)
		if not on_screen:
			var dir := (clamped - c).normalized()
			_pad.draw_colored_polygon(PackedVector2Array([clamped + dir * 22.0, clamped + dir.rotated(2.5) * 12.0, clamped + dir.rotated(-2.5) * 12.0]), mc)
		_pad.draw_string(ThemeDB.fallback_font, clamped + Vector2(-26, 32), "%d m" % int(_goal_dist), HORIZONTAL_ALIGNMENT_CENTER, 52, 16, mc)

	if not show_touch:
		return
	# Touch controls.
	var glass := Color(1, 1, 1, 0.1)
	var edge := Color(1, 1, 1, 0.38)
	for k in _btn:
		var b: Dictionary = _btn[k]
		var down := false
		for f in _fingers.values():
			if f.role == k:
				down = true
		var fill := Color(0.75, 0.1, 0.07, 0.55) if down else glass
		_pad.draw_circle(b.c, b.r, fill)
		_pad.draw_arc(b.c, b.r, 0, TAU, 40, edge, 2.0)
		var label: String = {"fire": "FIRE", "reload": "R", "swap": "SWAP", "torch": "LIGHT", "pause": "II"}[k]
		var fs := 22 if k == "fire" else 16
		_pad.draw_string(ThemeDB.fallback_font, b.c + Vector2(-b.r, fs * 0.35), label, HORIZONTAL_ALIGNMENT_CENTER, b.r * 2.0, fs, Color(1, 1, 1, 0.8))
	# Floating stick.
	for f in _fingers.values():
		if f.role == "move":
			_pad.draw_circle(f.origin, 90.0, Color(1, 1, 1, 0.07))
			_pad.draw_arc(f.origin, 90.0, 0, TAU, 40, edge, 2.0)
			_pad.draw_circle(f.origin + (f.pos - f.origin).limit_length(90.0), 34.0, Color(1, 1, 1, 0.3))


## A flat progress bar that takes its colour from how full it is.
class ColorProgressBar extends Control:
	var value := 1.0:
		set(v):
			value = clampf(v, 0.0, 1.0)
			queue_redraw()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.6))
		var c := Color(0.75, 0.1, 0.08).lerp(Color(0.85, 0.2, 0.12), value)
		draw_rect(Rect2(Vector2(2, 2), Vector2((size.x - 4.0) * value, size.y - 4.0)), c)
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.9, 0.85, 0.75, 0.35), false, 1.0)
