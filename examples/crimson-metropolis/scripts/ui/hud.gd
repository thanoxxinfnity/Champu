class_name Hud
extends CanvasLayer
## What you read while playing: clock and weather, cash, the wanted stars, health, the radar, the "E - use" prompt, the current
## objective and short toast messages. It only displays; the systems it watches own the numbers.

var state: GameState
var player: Player
var atmosphere: Atmosphere
var world: Node

var minimap: Minimap
var objective_text := ""
var objective_pos := Vector3.INF

var _clock: Label
var _cash: Label
var _stars: Label
var _health: ProgressBar
var _prompt: Label
var _objective: Label
var _toast: Label
var _speed: Label
var _flash: ColorRect
var _toast_t := 0.0
var _hurt_flash := 0.0


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	_flash = ColorRect.new()
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.color = Color(0.8, 0, 0, 0)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_flash)

	var tr := VBoxContainer.new()
	tr.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	tr.offset_left = -330.0
	tr.offset_right = -22.0
	tr.offset_top = 16.0
	tr.alignment = BoxContainer.ALIGNMENT_BEGIN
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(tr)
	_clock = UiKit.label("", 24)
	_clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	tr.add_child(_clock)
	_cash = UiKit.label("", 36, Color(0.55, 0.95, 0.55))
	_cash.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	tr.add_child(_cash)
	_stars = UiKit.label("", 34, Color(1.0, 0.85, 0.2))
	_stars.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	tr.add_child(_stars)

	var bl := VBoxContainer.new()
	bl.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	bl.offset_left = 22.0
	bl.offset_top = -250.0
	bl.offset_bottom = -20.0
	bl.alignment = BoxContainer.ALIGNMENT_END
	bl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bl)
	minimap = Minimap.new()
	minimap.player = player
	if world != null and world.get("island") != null:
		minimap.island = world.island
	bl.add_child(minimap)
	_health = ProgressBar.new()
	_health.custom_minimum_size = Vector2(190, 12)
	_health.show_percentage = false
	_health.max_value = Player.MAX_HEALTH
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(0.3, 0.85, 0.4)
	fill.set_corner_radius_all(5)
	var back := StyleBoxFlat.new()
	back.bg_color = Color(0, 0, 0, 0.6)
	back.set_corner_radius_all(5)
	_health.add_theme_stylebox_override("fill", fill)
	_health.add_theme_stylebox_override("background", back)
	bl.add_child(_health)

	_prompt = UiKit.label("", 26)
	_prompt.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_prompt.offset_left = -300.0
	_prompt.offset_right = 300.0
	_prompt.offset_top = -170.0
	_prompt.offset_bottom = -120.0
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_prompt)

	_objective = UiKit.label("", 22, Color(1.0, 0.9, 0.5))
	_objective.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_objective.offset_left = 24.0
	_objective.offset_top = 18.0
	_objective.offset_right = 760.0
	_objective.autowrap_mode = TextServer.AUTOWRAP_WORD
	root.add_child(_objective)

	_toast = UiKit.label("", 30)
	_toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_toast.offset_left = -420.0
	_toast.offset_right = 420.0
	_toast.offset_top = 96.0
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD
	root.add_child(_toast)

	_speed = UiKit.label("", 40)
	_speed.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_speed.offset_left = -260.0
	_speed.offset_right = -24.0
	_speed.offset_top = -90.0
	_speed.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(_speed)
	if player != null:
		player.hurt_taken.connect(func(_h): _hurt_flash = 0.5)


func toast(text: String, seconds := 3.0) -> void:
	_toast.text = text
	_toast_t = seconds


func set_objective(text: String, pos := Vector3.INF) -> void:
	objective_text = text
	objective_pos = pos


func stars_text() -> String:
	var s := ""
	for i in range(5):
		s += "★" if i < state.stars else "☆"
	return s


func _driven_vehicle() -> Vehicle:
	for v in get_tree().get_nodes_in_group("vehicles"):
		if is_instance_valid(v) and (v as Vehicle).is_player_driven:
			return v
	return null


func _process(delta: float) -> void:
	if state == null or player == null:
		return
	_clock.text = "%s   %s" % [atmosphere.clock_text(), String(atmosphere.weather).capitalize()] if atmosphere != null else ""
	_cash.text = "$%s" % _commas(state.cash)
	_stars.text = stars_text()
	_stars.visible = true
	if state.stars > 0:
		_stars.modulate.a = 0.55 + 0.45 * (0.5 + 0.5 * sin(Time.get_ticks_msec() * 0.012))
	else:
		_stars.modulate.a = 0.35
	_health.value = player.health
	var v := _driven_vehicle()
	if v != null:
		_speed.text = "%d km/h" % int(absf(v.linear_velocity.length()) * 3.6)
		_prompt.text = "F - Exit Vehicle" if not v.busy else ""
		minimap.player = v
		minimap.heading = v.rotation.y + PI
	else:
		_speed.text = ""
		var f := player.focus
		_prompt.text = String(f.get("prompt")) if f != null and f.get("prompt") != null and not player.cinematic else ""
		minimap.player = player
		minimap.heading = player.yaw
	minimap.objective = objective_pos
	_objective.text = objective_text
	if _toast_t > 0.0:
		_toast_t -= delta
		_toast.modulate.a = clampf(_toast_t, 0.0, 1.0)
	else:
		_toast.text = ""
	_hurt_flash = maxf(0.0, _hurt_flash - delta)
	_flash.color.a = _hurt_flash * 0.5


static func _commas(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	var i := 0
	for k in range(s.length() - 1, -1, -1):
		out = s[k] + out
		i += 1
		if i % 3 == 0 and k > 0:
			out = "," + out
	return out
