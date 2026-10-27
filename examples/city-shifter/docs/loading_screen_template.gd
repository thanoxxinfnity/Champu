extends CanvasLayer
## A small, copy-and-paste loading screen in the style of Free Fire / Minecraft: dark tiled backdrop, a bobbing logo, a segmented progress bar that fills
## smoothly, a percentage, and a tip that changes every few seconds. Add it as an autoload or instance it, then call set_progress(0..1) while you load.
##   var ls := preload("res://docs/loading_screen_template.gd").new(); add_child(ls); ls.set_progress(0.4)
## (City Shifter's own loading screen is scripts/loading_screen.gd: the same idea with the hero, a city and falling blocks.)

const TIPS := ["Hold JUMP in the air to fly with your jetpack.", "Hammers break trees, signs and whole towers.", "A car is faster than your legs, a horse is more fun.",
	"Every hero has 13 skills up to level 10.", "Gauntlets recharge in 60 seconds: use them freely."]
const SEGMENTS := 20

var _bar: Control
var _pct: Label
var _tip: Label
var _shown := 0.0          # what the bar shows (it eases towards the real progress)
var _want := 0.0
var _t := 0.0
var _tip_i := 0


func _ready() -> void:
	layer = 100
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.09, 0.14)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var tiles := Control.new()                       # the Minecraft-style dirt tiles: a checker of two dark greens
	tiles.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tiles.draw.connect(func() -> void:
		var s := 64
		for y in int(tiles.size.y / s) + 1:
			for x in int(tiles.size.x / s) + 1:
				var c := Color(0.12, 0.16, 0.14) if (x + y) % 2 == 0 else Color(0.1, 0.13, 0.12)
				tiles.draw_rect(Rect2(x * s, y * s, s, s), c))
	add_child(tiles)
	var logo := Label.new()
	logo.text = "MY GAME"
	logo.add_theme_font_size_override("font_size", 72)
	logo.add_theme_color_override("font_color", Color(1.0, 0.85, 0.2))
	logo.add_theme_color_override("font_outline_color", Color(0.1, 0.05, 0.15))
	logo.add_theme_constant_override("outline_size", 14)
	logo.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	logo.position.y = 120
	logo.name = "Logo"
	add_child(logo)
	_bar = Control.new()
	_bar.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_bar.offset_left = 120
	_bar.offset_right = -120
	_bar.offset_top = -120
	_bar.offset_bottom = -80
	_bar.draw.connect(_draw_bar)
	add_child(_bar)
	_pct = Label.new()
	_pct.add_theme_font_size_override("font_size", 26)
	_pct.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	_pct.offset_left = -240
	_pct.offset_top = -170
	add_child(_pct)
	_tip = Label.new()
	_tip.add_theme_font_size_override("font_size", 20)
	_tip.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_tip.offset_top = -64
	_tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_tip.text = TIPS[0]
	add_child(_tip)


func set_progress(p: float) -> void:
	_want = clampf(p, 0.0, 1.0)


func _process(delta: float) -> void:
	_t += delta
	_shown = move_toward(_shown, _want, delta * 0.6)            # never jumps: it slides to the real value
	var logo := get_node_or_null("Logo") as Label
	if logo != null:
		logo.position.y = 120.0 + sin(_t * 2.0) * 8.0
	_pct.text = "%d%%" % int(_shown * 100.0)
	if int(_t / 3.0) != _tip_i:
		_tip_i = int(_t / 3.0)
		_tip.text = TIPS[_tip_i % TIPS.size()]
	_bar.queue_redraw()
	if _shown >= 1.0 and _want >= 1.0:
		queue_free()


func _draw_bar() -> void:
	var r := Rect2(Vector2.ZERO, _bar.size)
	_bar.draw_rect(r, Color(0.02, 0.02, 0.05), true)
	_bar.draw_rect(r, Color(1, 1, 1, 0.9), false, 3.0)
	var gap := 4.0
	var w := (r.size.x - gap * (SEGMENTS + 1)) / SEGMENTS
	for i in SEGMENTS:
		var f := (float(i) + 1.0) / SEGMENTS
		if _shown >= f - 0.0001 or _shown > float(i) / SEGMENTS:
			var part := clampf((_shown - float(i) / SEGMENTS) * SEGMENTS, 0.0, 1.0)
			var c := Color(1.0, 0.55, 0.1).lerp(Color(1.0, 0.9, 0.2), float(i) / SEGMENTS)
			_bar.draw_rect(Rect2(gap + i * (w + gap), gap, w * part, r.size.y - gap * 2.0), c, true)
	var shine := (fmod(_t, 1.4) / 1.4) * r.size.x                # a light sweeping over the bar
	_bar.draw_rect(Rect2(shine, 0, 40, r.size.y), Color(1, 1, 1, 0.18), true)
