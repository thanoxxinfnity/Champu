class_name LoadingScreen
extends CanvasLayer
## The loading animation, drawn in the comic anime style while the world is built: a sunset sky with drifting clouds and falling petals, speed lines, the hero's portrait
## floating in a spinning dashed ring, a chunky progress bar with a little rocket running along it, a rotating tip and the LOADING title with bouncing letters.
## Main builds the world a step at a time and calls `set_progress`, so the animation never freezes.

const TIPS := [
	"Your gauntlets recharge in 60 seconds once empty. Switch to another weapon in the meantime.",
	"Everybody sees exactly 50 m around them. Nobody can see farther, so use cover.",
	"Hammers and axes break trees, signs and even whole towers.",
	"Press RIDE next to a horse or a car. Cars have rolling wheels and a nitro boost.",
	"Blocks fall from the sky everywhere. Stand under a roof or build a bridge.",
	"Level up your hero's skills in the SKILLS screen: driving, jetpack, damage and more.",
	"Teams are 4 players each. Squad mates cannot hurt each other.",
	"Over 200 weapons lie around the map. Every gauntlet and melee weapon can be picked up.",
	"The jetpack overheats if you hold it too long. Let it cool before the next flight.",
]

var progress := 0.0
var shown := 0.0
var label := "Building the world"
var hero_id := "outlaw"
var _root: Control
var _t := 0.0
var _tip := 0
var _tip_t := 0.0
var _tex: Texture2D
var _petals: Array = []
var _active := false


func _ready() -> void:
	layer = 60
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.draw.connect(_draw_all)
	add_child(_root)
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	for i in 40:
		_petals.append([rng.randf(), rng.randf(), rng.randf_range(0.04, 0.12), rng.randf_range(4.0, 11.0), rng.randf() * TAU])
	visible = false
	set_process(false)


func open(hero: String) -> void:
	hero_id = hero
	var p := "res://assets/ui/cards/%s.png" % hero
	_tex = load(p) as Texture2D if ResourceLoader.exists(p) else null
	progress = 0.0
	shown = 0.0
	_tip = randi() % TIPS.size()
	_tip_t = 0.0
	_active = true
	visible = true
	set_process(true)
	_root.queue_redraw()


func set_progress(p: float, text := "") -> void:
	progress = clampf(p, 0.0, 1.0)
	if text != "":
		label = text


func close() -> void:
	_active = false
	visible = false
	set_process(false)


func is_open() -> bool:
	return _active


func _process(delta: float) -> void:
	_t += delta
	_tip_t += delta
	if _tip_t > 3.2:
		_tip_t = 0.0
		_tip = (_tip + 1) % TIPS.size()
	shown = move_toward(shown, progress, delta * 0.7)
	_root.queue_redraw()


func _draw_all() -> void:
	var w := _root.size.x
	var h := _root.size.y
	var c := _root
	# the sky: a vertical gradient from deep blue to peach, with a big sun
	c.draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(w, 0), Vector2(w, h), Vector2(0, h)]),
		PackedColorArray([Color(0.25, 0.35, 0.8), Color(0.3, 0.4, 0.85), Color(1.0, 0.72, 0.62), Color(1.0, 0.8, 0.6)]))
	var sun := Vector2(w * 0.78, h * 0.62)
	c.draw_circle(sun, h * 0.2, Color(1.0, 0.92, 0.7, 0.55))
	c.draw_circle(sun, h * 0.14, Color(1.0, 0.97, 0.82, 0.9))
	# speed lines
	for i in 14:
		var a := float(i) / 14.0 * TAU + _t * 0.1
		var ctr := Vector2(w * 0.5, h * 0.44)
		c.draw_colored_polygon(PackedVector2Array([ctr + Vector2(cos(a), sin(a)) * h * 0.3, ctr + Vector2(cos(a - 0.05), sin(a - 0.05)) * w, ctr + Vector2(cos(a + 0.05), sin(a + 0.05)) * w]), Color(1, 1, 1, 0.07))
	# clouds
	for i in 6:
		var cx := fmod(float(i) * 0.23 * w + _t * (14.0 + 6.0 * float(i % 3)), w + 300.0) - 150.0
		var cy := h * (0.12 + 0.11 * float(i % 4))
		for j in 4:
			c.draw_circle(Vector2(cx + float(j) * 38.0, cy + sin(float(j) * 1.4) * 10.0), 32.0 - float(j % 2) * 8.0, Color(1, 1, 1, 0.55))
	# city silhouette along the bottom
	var base := h * 0.82
	for i in 22:
		var bx := float(i) * w / 21.0 - 20.0
		var bh := 60.0 + 120.0 * fmod(float(i) * 0.6180339, 1.0)
		c.draw_rect(Rect2(bx, base - bh, w / 21.0 + 2.0, bh + h), Color(0.22, 0.17, 0.45, 0.85))
		for k in int(bh / 26.0):
			if fmod(float(i * 7 + k * 3), 5.0) < 2.0:
				c.draw_rect(Rect2(bx + 8.0, base - bh + 10.0 + float(k) * 26.0, 8.0, 10.0), Color(1.0, 0.9, 0.5, 0.85))
	# petals
	for p in _petals:
		var px := fmod(float(p[0]) * w + _t * 30.0 * float(p[2]) * 10.0 + sin(_t * 1.2 + float(p[4])) * 40.0, w)
		var py := fmod(float(p[1]) * h + _t * 38.0 * float(p[2]) * 10.0, h)
		c.draw_set_transform(Vector2(px, py), _t * 2.0 + float(p[4]), Vector2(1.0, 0.6))
		c.draw_circle(Vector2.ZERO, float(p[3]), Color(1.0, 0.7, 0.82, 0.85))
		c.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# the hero in a ring
	var hc := Vector2(w * 0.5, h * 0.4)
	var bob := sin(_t * 2.2) * 8.0
	var rad := minf(w, h) * 0.2
	c.draw_circle(hc + Vector2(0, bob), rad, Color(1, 1, 1, 0.25))
	c.draw_circle(hc + Vector2(0, bob), rad * 0.86, Color(0.45, 0.35, 0.9, 0.55))
	for i in 24:
		var a2 := float(i) / 24.0 * TAU + _t * 1.6
		c.draw_arc(hc + Vector2(0, bob), rad * 1.12, a2, a2 + 0.16, 5, UIKit.INK, 9.0, true)
		c.draw_arc(hc + Vector2(0, bob), rad * 1.12, a2, a2 + 0.16, 5, Color(1.0, 0.85, 0.35), 5.0, true)
	if _tex != null:
		var ts := _tex.get_size()
		var k := rad * 2.5 / ts.y
		c.draw_texture_rect(_tex, Rect2(hc + Vector2(-ts.x * k * 0.5, -rad * 1.45 + bob), ts * k), false)
	# the title with bouncing letters
	var word := "LOADING"
	var fs := int(minf(w, h) * 0.1)
	var f := UIKit.title_font()
	var total := f.get_string_size(word, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var x := w * 0.5 - total * 0.5
	var ty := h * 0.68
	for i in word.length():
		var ch := word.substr(i, 1)
		var yy := ty - maxf(0.0, sin(_t * 5.0 - float(i) * 0.6)) * 14.0
		UIKit.draw_text(c, ch, Vector2(x, yy), fs, Color(1.0, 0.9, 0.4) if i % 2 == 0 else Color(1.0, 0.55, 0.75), true)
		x += f.get_string_size(ch, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	# the progress bar
	var bw := minf(w * 0.62, 820.0)
	var bar := Rect2(w * 0.5 - bw * 0.5, h * 0.73, bw, 34.0)
	c.draw_style_box(UIKit.box(Color(0.08, 0.05, 0.2, 0.9), UIKit.INK, 17, 5, 0), bar)
	var fw := maxf(0.0, (bar.size.x - 10.0) * shown)
	if fw > 2.0:
		var fr := Rect2(bar.position + Vector2(5, 5), Vector2(maxf(fw, 24.0), bar.size.y - 10.0))
		c.draw_style_box(UIKit.box(UIKit.PINK, UIKit.PINK, 12, 0, 0), fr)
		c.draw_rect(Rect2(fr.position + Vector2(8, 3), Vector2(maxf(fr.size.x - 16.0, 0.0), 5)), Color(1, 1, 1, 0.45))
		for i in int(fr.size.x / 36.0):             # moving stripes
			var sx := fr.position.x + fmod(float(i) * 36.0 + _t * 40.0, maxf(fr.size.x - 14.0, 1.0))
			c.draw_line(Vector2(sx, fr.end.y - 3.0), Vector2(sx + 12.0, fr.position.y + 3.0), Color(1, 1, 1, 0.22), 6.0)
		UIKit.draw_icon(c, "jet", Vector2(fr.end.x, bar.position.y - 6.0 + sin(_t * 12.0) * 3.0), 38.0, UIKit.YELLOW)
	UIKit.draw_text(c, "%d%%" % int(round(shown * 100.0)), Vector2(bar.position.x, bar.end.y + 30.0), 26, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_RIGHT, bar.size.x)
	UIKit.draw_text(c, label + ".".repeat(int(_t * 3.0) % 4), Vector2(bar.position.x, bar.end.y + 30.0), 20, UIKit.CREAM, false, HORIZONTAL_ALIGNMENT_LEFT, bar.size.x * 0.6)
	# the tip
	var tw := minf(w * 0.7, 900.0)
	var tip_r := Rect2(w * 0.5 - tw * 0.5, h * 0.89, tw, 54.0)
	c.draw_style_box(UIKit.box(Color(0.99, 0.95, 0.88, 0.94), UIKit.INK, 16, 4, 0), tip_r)
	UIKit.draw_icon(c, "star", tip_r.position + Vector2(28, 27), 26.0, UIKit.ORANGE)
	UIKit.draw_wrapped(c, String(TIPS[_tip]), tip_r.position + Vector2(54, 22), 17, UIKit.INK, tw - 72.0, 2)
	# the logo, top-left
	UIKit.draw_text(c, "CITY SHIFTER", Vector2(28, 52), 44, UIKit.YELLOW, true, HORIZONTAL_ALIGNMENT_LEFT, w * 0.4)
	UIKit.draw_text(c, "SKY SIEGE", Vector2(30, 86), 24, UIKit.PINK, true, HORIZONTAL_ALIGNMENT_LEFT, w * 0.3)
