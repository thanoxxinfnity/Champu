extends Node
## The frame every game sits in, so every game has the same finish a shipped one has:
##   title screen -> 3-2-1 countdown -> play -> pause -> results (best score, retry) -> menu.
## Your main script extends this and only writes the game:
##
##   extends "res://kit/game_shell.gd"
##   func _ready() -> void:
##       game_title = "Coin Dash"
##       tagline = "Grab every coin before time runs out"
##       score_key = "coins"
##       super()                       # builds the shell, calls _build_world(), shows the title screen
##   func _build_world() -> void:      # once: sky, ground, player, camera, props, controls
##   func _begin() -> void:            # when the run starts (after the title or retry): reset and start
##   func _update(delta: float) -> void:   # every frame while playing; call hud() and finish() from here
##
## Retry and Restart reload the scene, so a run always begins from a clean world.

signal run_started
signal run_finished(score: float)

var game_title := "My Game"
var tagline := "Tap to play"
var accent := Color("#ff9a3c")
## Best scores are stored under this name.
var score_key := "score"
var higher_is_better := true
## Shown with the score, e.g. "coins", "m", "s". Empty for none.
var score_unit := ""
var countdown := true
var state := "title"

var hud_layer: CanvasLayer
var _hud_root: Control
var _left: Label
var _center: Label
var _right: Label
var _banner: Label
var _pause_ui: Control
var _title_ui: Control
var _pause_button: Control


func _ready() -> void:
	randomize()
	process_mode = Node.PROCESS_MODE_PAUSABLE
	get_tree().paused = false
	Engine.time_scale = 1.0
	_build_hud()
	_build_world()
	if Save.session.get("autoplay", false):
		Save.session["autoplay"] = false
		_start_run()
	else:
		_show_title()


# ── override these ──────────────────────────────────────────────────────────

func _build_world() -> void:
	pass


func _begin() -> void:
	pass


func _update(_delta: float) -> void:
	pass


## Optional: called every frame on the title screen, for a camera drifting over the level and the like.
func _idle(_delta: float) -> void:
	pass


# ── what the game calls ─────────────────────────────────────────────────────

## Text for the three HUD slots: top-left, top-centre, top-right.
func hud(left: String, center: String = "", right: String = "") -> void:
	_left.text = left
	_center.text = center
	_right.text = right


## A big message in the middle of the screen that fades: "GO!", "WAVE 2", "BOOST".
func banner(text: String, seconds: float = 1.0, color: Color = Color.WHITE) -> void:
	_banner.text = text
	_banner.add_theme_color_override("font_color", color)
	_banner.modulate.a = 1.0
	_banner.pivot_offset = _banner.size * 0.5
	_banner.scale = Vector2(1.4, 1.4)
	var tween := create_tween()
	tween.tween_property(_banner, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_interval(maxf(seconds - 0.45, 0.05))
	tween.tween_property(_banner, "modulate:a", 0.0, 0.2)


## Ends the run and shows the results. `score` is stored as a best when it beats the last one.
func finish(score: float, headline: String = "TIME'S UP", lines: Array = [], won: bool = false) -> void:
	if state != "playing":
		return
	state = "results"
	_pause_button.visible = false
	var new_best := Save.submit(score_key, score, higher_is_better)
	var best_text := _fmt(Save.best(score_key))
	var all_lines: Array = lines.duplicate()
	all_lines.append("Score  %s" % _fmt(score))
	all_lines.append("Best  %s" % best_text)
	Sfx.stop_music(0.8)
	Sfx.play("win" if won else "lose")
	Feel.shake(0.3 if won else 0.4, 0.4)
	run_finished.emit(score)
	await get_tree().create_timer(0.7).timeout
	UIKit.results_screen(self, headline, all_lines, new_best, _retry, _to_menu, accent)


# ── the frame ───────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	if state == "playing":
		_update(delta)
	elif state == "title":
		_idle(delta)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and (state == "playing" or state == "paused"):
		_toggle_pause()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and (state == "playing" or state == "paused"):
		_toggle_pause()
	elif what == NOTIFICATION_APPLICATION_FOCUS_OUT and state == "playing":
		_toggle_pause()


func _fmt(value: float) -> String:
	var text := str(int(value)) if is_equal_approx(value, round(value)) else "%.1f" % value
	return text if score_unit == "" else "%s %s" % [text, score_unit]


func _show_title() -> void:
	state = "title"
	var best_line := "Best  %s" % _fmt(Save.best(score_key)) if Save.has_best(score_key) else ""
	_title_ui = UIKit.title_screen(self, game_title, tagline, best_line, _start_run, accent)
	Sfx.music()


func _start_run() -> void:
	_pause_button.visible = true
	if countdown:
		state = "countdown"
		for step in ["3", "2", "1"]:
			banner(step, 0.8, Color("#ffe27a"))
			Sfx.play("tick")
			await get_tree().create_timer(0.8).timeout
		banner("GO!", 0.8, Color("#7dff9a"))
		Sfx.play("go")
	Sfx.music()
	state = "playing"
	_begin()
	run_started.emit()


func _toggle_pause() -> void:
	if state == "playing":
		state = "paused"
		get_tree().paused = true
		_pause_ui = UIKit.pause_screen(self, _toggle_pause, _retry, _to_menu, accent)
	elif state == "paused":
		state = "playing"
		get_tree().paused = false
		UIKit.close(_pause_ui)


func _retry() -> void:
	get_tree().paused = false
	Save.session["autoplay"] = true
	get_tree().reload_current_scene()


func _to_menu() -> void:
	get_tree().paused = false
	Save.session["autoplay"] = false
	get_tree().reload_current_scene()


## Smaller text on a narrow (upright) screen, so three slots still fit.
func _fit_hud() -> void:
	var w := get_viewport().get_visible_rect().size.x
	var k := clampf(w / 1152.0, 0.62, 1.0)
	_left.add_theme_font_size_override("font_size", int(38 * k))
	_center.add_theme_font_size_override("font_size", int(44 * k))
	_right.add_theme_font_size_override("font_size", int(38 * k))


func _build_hud() -> void:
	hud_layer = CanvasLayer.new()
	hud_layer.layer = 10
	hud_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(hud_layer)
	_hud_root = Control.new()
	_hud_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_hud_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hud_root.theme = UIKit.theme(accent)
	hud_layer.add_child(_hud_root)
	# One bar across the top: three slots that share the width, so a phone held upright does not overlap them.
	var bar := HBoxContainer.new()
	bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	bar.offset_left = 28
	bar.offset_right = -128
	bar.offset_top = 20
	bar.offset_bottom = 90
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bar.add_theme_constant_override("separation", 8)
	_hud_root.add_child(bar)
	_left = UIKit.label("", 38)
	_left.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_center = UIKit.label("", 44)
	_right = UIKit.label("", 38)
	_right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	for l in [_left, _center, _right]:
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l.size_flags_stretch_ratio = 1.0
		l.clip_text = true
		bar.add_child(l)
	_center.size_flags_stretch_ratio = 0.7
	get_viewport().size_changed.connect(_fit_hud)
	_fit_hud()
	_banner = UIKit.label("", 120, Color.WHITE, 18)
	_banner.anchor_left = 0.0
	_banner.anchor_right = 1.0
	_banner.anchor_top = 0.28
	_banner.anchor_bottom = 0.28
	_banner.offset_top = -80
	_banner.offset_bottom = 80
	_banner.modulate.a = 0.0
	_hud_root.add_child(_banner)
	_pause_button = UIKit.pause_button(_hud_root, _toggle_pause)
	_pause_button.anchor_left = 1.0
	_pause_button.anchor_right = 1.0
	_pause_button.offset_left = -118
	_pause_button.offset_right = -34
	_pause_button.offset_top = 18
	_pause_button.offset_bottom = 102
	_pause_button.visible = false
