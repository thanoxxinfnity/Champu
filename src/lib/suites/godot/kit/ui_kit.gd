extends Node
## Menus and HUD pieces that look finished: theme, buttons, labels, title screen, results screen, pause menu.
## Everything is built in code and sized for thumbs (buttons are at least 88px tall on the 1152x648 design size).
## Autoload name: UIKit

const BG := Color(0.07, 0.08, 0.11, 0.86)
const TEXT := Color("#f6f1ea")


func theme(accent: Color = Color("#ff9a3c")) -> Theme:
	var t := Theme.new()
	t.default_font_size = 30
	t.set_color("font_color", "Label", TEXT)
	t.set_color("font_outline_color", "Label", Color(0, 0, 0, 0.8))
	t.set_constant("outline_size", "Label", 6)
	for state in ["normal", "hover", "pressed", "focus", "disabled"]:
		var sb := StyleBoxFlat.new()
		sb.set_corner_radius_all(26)
		sb.set_border_width_all(3)
		sb.content_margin_left = 34
		sb.content_margin_right = 34
		sb.content_margin_top = 16
		sb.content_margin_bottom = 16
		match state:
			"pressed":
				sb.bg_color = accent.darkened(0.2)
				sb.border_color = accent.lightened(0.3)
			"hover", "focus":
				sb.bg_color = accent.lightened(0.08)
				sb.border_color = Color.WHITE
			"disabled":
				sb.bg_color = Color(0.3, 0.3, 0.33)
				sb.border_color = Color(0.4, 0.4, 0.44)
			_:
				sb.bg_color = accent
				sb.border_color = accent.lightened(0.35)
		sb.shadow_color = Color(0, 0, 0, 0.35)
		sb.shadow_size = 8
		sb.shadow_offset = Vector2(0, 4)
		t.set_stylebox(state, "Button", sb)
	t.set_color("font_color", "Button", Color("#1b1209"))
	t.set_color("font_hover_color", "Button", Color("#1b1209"))
	t.set_color("font_pressed_color", "Button", Color("#1b1209"))
	t.set_color("font_focus_color", "Button", Color("#1b1209"))
	t.set_font_size("font_size", "Button", 36)
	var panel := StyleBoxFlat.new()
	panel.bg_color = BG
	panel.set_corner_radius_all(32)
	panel.set_border_width_all(3)
	panel.border_color = accent.darkened(0.2)
	panel.content_margin_left = 48
	panel.content_margin_right = 48
	panel.content_margin_top = 36
	panel.content_margin_bottom = 36
	panel.shadow_color = Color(0, 0, 0, 0.5)
	panel.shadow_size = 24
	t.set_stylebox("panel", "PanelContainer", panel)
	return t


func label(text: String, size: int = 30, color: Color = TEXT, outline: int = 8) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", outline)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## A big thumb-sized button that pops when pressed.
func button(text: String, on_press: Callable, wide: bool = true) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(360 if wide else 200, 96)
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(func() -> void:
		Feel.pop(b, 1.12, 0.18)
		Sfx.play("ui", -4.0, 0.03)
		on_press.call())
	return b


func _overlay(parent: Node, accent: Color, layer: int = 30) -> Control:
	var canvas := CanvasLayer.new()
	canvas.layer = layer
	canvas.process_mode = Node.PROCESS_MODE_ALWAYS
	parent.add_child(canvas)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = theme(accent)
	root.process_mode = Node.PROCESS_MODE_ALWAYS
	canvas.add_child(root)
	root.set_meta("canvas", canvas)
	return root


func close(overlay: Control) -> void:
	if is_instance_valid(overlay):
		var canvas: Node = overlay.get_meta("canvas") if overlay.has_meta("canvas") else overlay
		canvas.queue_free()


func _dim(root: Control, alpha: float = 0.55) -> ColorRect:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.06, 0.0)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)
	create_tween().tween_property(dim, "color:a", alpha, 0.35)
	return dim


## The first thing a player sees: the title, the best score, one big Play button and sound switches.
func title_screen(parent: Node, title: String, tagline: String, best_line: String, on_play: Callable, accent: Color = Color("#ff9a3c")) -> Control:
	var root := _overlay(parent, accent)
	_dim(root, 0.5)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 22)
	root.add_child(box)
	var title_label := label(title.to_upper(), 92, accent.lightened(0.15), 16)
	box.add_child(title_label)
	box.add_child(label(tagline, 32, Color(1, 1, 1, 0.85), 6))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 30)
	box.add_child(spacer)
	var play := button("PLAY", func() -> void:
		var tween := create_tween()
		tween.tween_property(root, "modulate:a", 0.0, 0.25)
		tween.tween_callback(func() -> void:
			close(root)
			on_play.call()), true)
	play.custom_minimum_size = Vector2(440, 120)
	play.add_theme_font_size_override("font_size", 52)
	var center := CenterContainer.new()
	center.add_child(play)
	box.add_child(center)
	if best_line != "":
		box.add_child(label(best_line, 30, Color("#ffe27a"), 6))
	var toggles := HBoxContainer.new()
	toggles.alignment = BoxContainer.ALIGNMENT_CENTER
	toggles.add_theme_constant_override("separation", 20)
	var sound := _toggle("SOUND", Sfx.sfx_on, func(on: bool) -> void: Sfx.set_sfx(on))
	var music := _toggle("MUSIC", Sfx.music_on, func(on: bool) -> void: Sfx.set_music(on))
	toggles.add_child(sound)
	toggles.add_child(music)
	box.add_child(toggles)
	title_label.pivot_offset = title_label.size * 0.5
	title_label.scale = Vector2(0.6, 0.6)
	title_label.modulate.a = 0.0
	var intro := create_tween().set_parallel(true)
	intro.tween_property(title_label, "scale", Vector2.ONE, 0.6).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	intro.tween_property(title_label, "modulate:a", 1.0, 0.4)
	var pulse := play.create_tween().set_loops()
	pulse.tween_property(play, "scale", Vector2(1.05, 1.05), 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	pulse.tween_property(play, "scale", Vector2.ONE, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	play.pivot_offset = play.custom_minimum_size * 0.5
	return root


func _toggle(text: String, initial: bool, on_change: Callable) -> Button:
	var b := Button.new()
	b.toggle_mode = true
	b.button_pressed = initial
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(200, 72)
	b.add_theme_font_size_override("font_size", 26)
	var refresh := func() -> void: b.text = "%s  %s" % [text, "ON" if b.button_pressed else "OFF"]
	refresh.call()
	b.toggled.connect(func(on: bool) -> void:
		refresh.call()
		on_change.call(on))
	return b


## The end of a run: headline, a few lines of stats, a "NEW BEST" badge, Retry and Menu.
func results_screen(parent: Node, headline: String, lines: Array, new_best: bool, on_retry: Callable, on_menu: Callable, accent: Color = Color("#ff9a3c")) -> Control:
	var root := _overlay(parent, accent)
	_dim(root, 0.6)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)
	var card := PanelContainer.new()
	center.add_child(card)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 16)
	card.add_child(box)
	box.add_child(label(headline, 64, accent.lightened(0.15), 12))
	if new_best:
		var badge := label("NEW BEST!", 40, Color("#ffe27a"), 8)
		box.add_child(badge)
		var blink := badge.create_tween().set_loops()
		blink.tween_property(badge, "modulate:a", 0.45, 0.45)
		blink.tween_property(badge, "modulate:a", 1.0, 0.45)
		Fx.confetti(root)
	for line in lines:
		box.add_child(label(str(line), 34, TEXT, 6))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 24)
	row.add_child(button("RETRY", func() -> void:
		close(root)
		on_retry.call(), false))
	row.add_child(button("MENU", func() -> void:
		close(root)
		on_menu.call(), false))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 14)
	box.add_child(spacer)
	box.add_child(row)
	card.pivot_offset = card.size * 0.5
	card.scale = Vector2(0.85, 0.85)
	card.modulate.a = 0.0
	var tween := create_tween().set_parallel(true)
	tween.tween_property(card, "scale", Vector2.ONE, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(card, "modulate:a", 1.0, 0.25)
	return root


## Pause menu: Resume, Restart, Menu.
func pause_screen(parent: Node, on_resume: Callable, on_restart: Callable, on_menu: Callable, accent: Color = Color("#ff9a3c")) -> Control:
	var root := _overlay(parent, accent, 40)
	_dim(root, 0.65)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)
	var card := PanelContainer.new()
	center.add_child(card)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 18)
	card.add_child(box)
	box.add_child(label("PAUSED", 66, accent.lightened(0.15), 12))
	box.add_child(button("RESUME", func() -> void:
		close(root)
		on_resume.call()))
	box.add_child(button("RESTART", func() -> void:
		close(root)
		on_restart.call()))
	box.add_child(button("MENU", func() -> void:
		close(root)
		on_menu.call()))
	var toggles := HBoxContainer.new()
	toggles.alignment = BoxContainer.ALIGNMENT_CENTER
	toggles.add_theme_constant_override("separation", 16)
	toggles.add_child(_toggle("SOUND", Sfx.sfx_on, func(on: bool) -> void: Sfx.set_sfx(on)))
	toggles.add_child(_toggle("MUSIC", Sfx.music_on, func(on: bool) -> void: Sfx.set_music(on)))
	box.add_child(toggles)
	return root


## The round pause button for a corner of the HUD (two drawn bars, no font glyph).
func pause_button(parent: Control, on_press: Callable) -> Control:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(84, 84)
	b.size = Vector2(84, 84)
	b.theme = theme(Color("#2a2f3a"))
	b.pressed.connect(func() -> void:
		Sfx.play("ui", -4.0, 0.03)
		on_press.call())
	var bars := Control.new()
	bars.set_anchors_preset(Control.PRESET_FULL_RECT)
	bars.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bars.draw.connect(func() -> void:
		var s := b.size
		bars.draw_rect(Rect2(s.x * 0.33, s.y * 0.28, s.x * 0.1, s.y * 0.44), Color.WHITE)
		bars.draw_rect(Rect2(s.x * 0.57, s.y * 0.28, s.x * 0.1, s.y * 0.44), Color.WHITE))
	b.add_child(bars)
	parent.add_child(b)
	return b
