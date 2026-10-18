extends Control
## The first screen: slow-moving key art, the title, a real progress bar while the game scene and its models load on a thread,
## then the two ways in — Story Mode and Free Roam (and Continue when there is a save).

const GAME_SCENE := "res://scenes/game.tscn"
const ART := "res://assets/ui/loading_art.jpg"
const TIPS := [
	"Press ↑ to open your phone: missions, valet, bank, time and weather.",
	"Hold F near any car to take it. Drivers do not like that.",
	"The elevator in the Crimson Tower reaches the roof. Take the stairs? There are none.",
	"Sleep in the bed upstairs to save your game and heal.",
	"Lose the police by getting out of sight — and staying there.",
]

var _bar: ProgressBar
var _status: Label
var _buttons: HBoxContainer
var _art: TextureRect
var _paths: Array[String] = []
var _loaded_scene: PackedScene
var _done := false
var _shown_progress := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.02, 0.03)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	_art = TextureRect.new()
	_art.name = "Art"
	_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_art.set_anchors_preset(Control.PRESET_FULL_RECT)
	if ResourceLoader.exists(ART):
		_art.texture = load(ART)
	add_child(_art)
	_ken_burns()
	var shade := ColorRect.new()
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.color = Color(0, 0, 0, 0.38)
	add_child(shade)

	var title := UiKit.label("CRIMSON METROPOLIS", 78, Color(1, 1, 1))
	title.name = "Title"
	title.set_anchors_preset(Control.PRESET_CENTER_TOP)
	title.offset_left = -600.0
	title.offset_right = 600.0
	title.offset_top = 90.0
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_constant_override("outline_size", 10)
	add_child(title)
	var sub := UiKit.label("A CHOMUGIRI GAME", 22, UiKit.ACCENT)
	sub.set_anchors_preset(Control.PRESET_CENTER_TOP)
	sub.offset_left = -400.0
	sub.offset_right = 400.0
	sub.offset_top = 182.0
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(sub)

	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	box.offset_left = -380.0
	box.offset_right = 380.0
	box.offset_top = -230.0
	box.offset_bottom = -40.0
	box.add_theme_constant_override("separation", 14)
	add_child(box)
	_buttons = HBoxContainer.new()
	_buttons.name = "Buttons"
	_buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	_buttons.add_theme_constant_override("separation", 18)
	_buttons.visible = false
	box.add_child(_buttons)
	_status = UiKit.label("Loading…", 20)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_status)
	_bar = ProgressBar.new()
	_bar.name = "Progress"
	_bar.custom_minimum_size = Vector2(0, 10)
	_bar.show_percentage = false
	_bar.max_value = 1.0
	var fill := StyleBoxFlat.new()
	fill.bg_color = UiKit.ACCENT
	var back := StyleBoxFlat.new()
	back.bg_color = Color(1, 1, 1, 0.15)
	_bar.add_theme_stylebox_override("fill", fill)
	_bar.add_theme_stylebox_override("background", back)
	box.add_child(_bar)
	var tip := UiKit.label(TIPS[randi() % TIPS.size()], 17, Color(0.85, 0.85, 0.9))
	tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tip.autowrap_mode = TextServer.AUTOWRAP_WORD
	box.add_child(tip)

	# Everything the game scene needs that is slow to read: the generated models. The scene itself loads last.
	for f in DirAccess.get_files_at("res://assets/generated/lod"):
		if f.ends_with(".glb"):
			_paths.append("res://assets/generated/lod/" + f)
	_paths.append(GAME_SCENE)
	for path in _paths:
		ResourceLoader.load_threaded_request(path)


func _ken_burns() -> void:
	_art.pivot_offset = get_viewport_rect().size * 0.5
	_art.scale = Vector2.ONE * 1.04
	var t := create_tween().set_loops()
	t.tween_property(_art, "scale", Vector2.ONE * 1.16, 14.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	t.parallel().tween_property(_art, "position", Vector2(-40, -18), 14.0).set_trans(Tween.TRANS_SINE)
	t.tween_property(_art, "scale", Vector2.ONE * 1.04, 14.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	t.parallel().tween_property(_art, "position", Vector2.ZERO, 14.0).set_trans(Tween.TRANS_SINE)


func progress() -> float:
	var total := 0.0
	for path in _paths:
		var prog: Array = []
		var st := ResourceLoader.load_threaded_get_status(path, prog)
		total += 1.0 if st == ResourceLoader.THREAD_LOAD_LOADED else (prog[0] if prog.size() > 0 else 0.0)
	return total / float(_paths.size())


func _process(delta: float) -> void:
	if _done:
		return
	var p := progress()
	_shown_progress = move_toward(_shown_progress, p, delta * 0.8)
	_bar.value = _shown_progress
	_status.text = "Loading the city…  %d%%" % int(_shown_progress * 100.0)
	if p >= 1.0 and _shown_progress >= 0.999:
		_finish()


func _finish() -> void:
	_done = true
	_loaded_scene = ResourceLoader.load_threaded_get(GAME_SCENE) as PackedScene
	_bar.visible = false
	_status.text = "Ready."
	if FileAccess.file_exists(GameState.SAVE_PATH):
		_add_button("CONTINUE", func(): _go(GameBoot.Mode.STORY, true))
	_add_button("STORY MODE", func(): _go(GameBoot.Mode.STORY, false))
	_add_button("FREE ROAM", func(): _go(GameBoot.Mode.FREE_ROAM, false))
	_add_button("ISLAND", func(): _go(GameBoot.Mode.ISLAND, false))
	_buttons.visible = true


func _add_button(text: String, cb: Callable) -> void:
	var b := UiKit.button(text, Vector2(220, 64), 24)
	b.name = text.capitalize().replace(" ", "")
	b.pressed.connect(cb)
	_buttons.add_child(b)


func _go(mode: GameBoot.Mode, cont: bool) -> void:
	GameBoot.mode = mode
	GameBoot.continue_save = cont
	get_tree().change_scene_to_packed(_loaded_scene)
