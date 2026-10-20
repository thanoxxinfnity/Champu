class_name LoadingScreen
extends Control
## GTA-style loading screen: key-art images crossfade with a slow zoom and drift (Ken Burns), a progress bar fills while the next scene loads
## in the background, and a tip rotates underneath. Pure code, so it runs on any device and needs no video decoder.

signal finished

const IMAGES := [
	"res://assets/ui/poster_1.jpg", "res://assets/loading/01_versus.jpg", "res://assets/ui/poster_2.jpg", "res://assets/loading/02_clash_a.jpg",
	"res://assets/ui/poster_3.jpg", "res://assets/ui/poster_4.jpg", "res://assets/loading/03_clash_b.jpg", "res://assets/ui/poster_5.jpg",
]
const TIPS := [
	"Block cuts damage by 80%, but an ultimate breaks through it.",
	"Dodge has invincibility frames: time it just before the hit lands.",
	"Land hits to fill your cursed energy, then spend it on a special.",
	"Gojo's Infinite Void freezes the enemy completely while it lasts.",
	"Ultimates tear the arena apart. Fight on the broken ground.",
	"Low on battery? Pick Low graphics: 6k characters and no shadows.",
]
const SLIDE_TIME := 3.2
const FADE_TIME := 0.9

@export var next_scene := ""
@export var min_show_time := 2.0

var _layers: Array[TextureRect] = []
var _bar: ProgressBar
var _tip: Label
var _title: Label
var _idx := 0
var _clock := 0.0
var _elapsed := 0.0
var _loading := false
var _loaded := false
var _done := false
var _tween: Tween

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	clip_contents = true
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(black)
	for i in 2:
		var t := TextureRect.new()
		t.set_anchors_preset(Control.PRESET_FULL_RECT)
		t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		t.modulate.a = 0.0
		t.pivot_offset = size * 0.5
		add_child(t)
		_layers.append(t)
	_build_hud()
	_show_slide(0, true)
	if next_scene != "":
		start_loading()

func _build_hud() -> void:
	var shade := ColorRect.new()
	shade.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	shade.anchor_top = 0.72
	shade.color = Color(0, 0, 0, 0.55)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(shade)
	_title = Label.new()
	_title.text = "JJK ARENA"
	_title.add_theme_font_size_override("font_size", 54)
	_title.add_theme_color_override("font_color", Color(1, 1, 1))
	_title.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_title.add_theme_constant_override("outline_size", 10)
	_title.position = Vector2(64, 28)
	add_child(_title)
	_tip = Label.new()
	_tip.add_theme_font_size_override("font_size", 24)
	_tip.add_theme_color_override("font_color", Color(0.95, 0.95, 0.9))
	_tip.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_tip.add_theme_constant_override("outline_size", 6)
	_tip.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_tip.anchor_top = 0.84
	_tip.offset_left = 64
	_tip.offset_right = -64
	_tip.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_tip.text = TIPS[0]
	add_child(_tip)
	_bar = ProgressBar.new()
	_bar.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_bar.anchor_top = 0.94
	_bar.offset_left = 64
	_bar.offset_right = -64
	_bar.offset_top = 0
	_bar.offset_bottom = -22
	_bar.show_percentage = false
	_bar.min_value = 0.0
	_bar.max_value = 1.0
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(0.95, 0.2, 0.25)
	var back := StyleBoxFlat.new()
	back.bg_color = Color(1, 1, 1, 0.18)
	_bar.add_theme_stylebox_override("fill", fill)
	_bar.add_theme_stylebox_override("background", back)
	add_child(_bar)

func _show_slide(i: int, instant := false) -> void:
	var top := _layers[i % 2]
	var bottom := _layers[(i + 1) % 2]
	var path: String = IMAGES[i % IMAGES.size()]
	if ResourceLoader.exists(path):
		top.texture = load(path)
	top.scale = Vector2.ONE * 1.0
	top.pivot_offset = size * 0.5
	var drift := Vector2([-1.0, 1.0][i % 2] * 36.0, [1.0, -1.0][(i / 2) % 2] * 18.0)
	top.position = Vector2.ZERO
	top.move_to_front()
	for n in [_title, _tip, _bar]:
		if n != null:
			(n as Control).move_to_front()
	if _tween:
		_tween.kill()
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(top, "modulate:a", 1.0, 0.01 if instant else FADE_TIME)
	_tween.tween_property(top, "scale", Vector2.ONE * 1.12, SLIDE_TIME + FADE_TIME)
	_tween.tween_property(top, "position", drift, SLIDE_TIME + FADE_TIME)
	if not instant:
		_tween.tween_property(bottom, "modulate:a", 0.0, FADE_TIME)
	_tip.text = TIPS[i % TIPS.size()]

func _process(delta: float) -> void:
	if _done:
		return
	_elapsed += delta
	_clock += delta
	if _clock >= SLIDE_TIME:
		_clock = 0.0
		_idx += 1
		_show_slide(_idx)
	if _loading and not _loaded:
		var status := ResourceLoader.load_threaded_get_status(next_scene)
		match status:
			ResourceLoader.THREAD_LOAD_LOADED:
				_loaded = true
				_bar.value = 1.0
			ResourceLoader.THREAD_LOAD_IN_PROGRESS:
				var p := []
				ResourceLoader.load_threaded_get_status(next_scene, p)
				_bar.value = maxf(_bar.value, float(p[0]) if p.size() > 0 else 0.0)
			_:
				_loaded = true
	elif not _loading:
		_bar.value = minf(1.0, _elapsed / maxf(0.1, min_show_time))
	if (_loaded or not _loading) and _elapsed >= min_show_time and _bar.value >= 1.0:
		_done = true
		set_process(false)
		finished.emit()
		if next_scene != "" and _loaded:
			var packed := ResourceLoader.load_threaded_get(next_scene) as PackedScene
			if packed != null:
				get_tree().change_scene_to_packed(packed)

func start_loading() -> void:
	_loading = true
	ResourceLoader.load_threaded_request(next_scene)
