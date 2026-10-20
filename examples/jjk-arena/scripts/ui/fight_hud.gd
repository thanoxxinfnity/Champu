class_name FightHud
extends CanvasLayer
## Anime-fighter HUD: slanted health bars with a white "damage trail" that drains after a hit, a glowing cursed-energy bar split into four
## segments (DOMAIN READY when full), round portraits, the round timer in the centre and the big banner (ROUND 1 / KO / WINS).

const FACES := {"gojo": "res://assets/loading/r_04_gojo_face.jpg", "sukuna": "res://assets/loading/r_05_sukuna_face.jpg"}

var a: Fighter
var b: Fighter
var match_ctl: MatchController
var _bars: Control
var _timer: Label
var _banner: Label
var _names: Array[Label] = []
var _faces: Array[TextureRect] = []
var _trail := [100.0, 100.0]
var _shown := [100.0, 100.0]
var _flash := [0.0, 0.0]
var _last := [100.0, 100.0]
var _t := 0.0
var open_world := false     ## no round timer or round pips in the open world

func _ready() -> void:
	layer = 15
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_bars = Control.new()
	_bars.set_anchors_preset(Control.PRESET_FULL_RECT)
	_bars.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bars.draw.connect(_draw_bars)
	root.add_child(_bars)
	for side in 2:
		var face := TextureRect.new()
		face.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		face.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		face.size = Vector2(74, 74)
		face.position = Vector2(12, 8) if side == 0 else Vector2(0, 8)
		face.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(face)
		_faces.append(face)
		var nm := UiKit.label("", 19)
		nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(nm)
		_names.append(nm)
	_timer = UiKit.label("60", 38)
	_timer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_timer.size = Vector2(100, 50)
	root.add_child(_timer)
	_banner = UiKit.label("", 78, UiKit.ACCENT)
	_banner.set_anchors_preset(Control.PRESET_CENTER)
	_banner.offset_left = -500.0
	_banner.offset_right = 500.0
	_banner.offset_top = -90.0
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_banner.add_theme_constant_override("outline_size", 10)
	root.add_child(_banner)

func bind(fa: Fighter, fb: Fighter, mc: MatchController, moves_a := "gojo", moves_b := "sukuna") -> void:
	a = fa
	b = fb
	match_ctl = mc
	_names[0].text = fa.fighter_name.to_upper()
	_names[1].text = fb.fighter_name.to_upper()
	_faces[0].texture = load(FACES.get(moves_a, FACES["gojo"]))
	_faces[1].texture = load(FACES.get(moves_b, FACES["sukuna"]))
	mc.round_started.connect(func(n: int): flash("ROUND %d" % n, 1.4))
	mc.round_ended.connect(func(w: Fighter): flash("K.O." if w != null and not w.opponent.is_alive() else "TIME", 1.6))
	mc.match_ended.connect(func(w: Fighter): flash("%s WINS" % w.fighter_name.to_upper(), 99.0))

func flash(text: String, secs: float) -> void:
	_banner.text = text
	_banner.modulate.a = 1.0
	_banner.scale = Vector2.ONE
	_banner.pivot_offset = _banner.size * 0.5
	var t := create_tween()
	t.tween_property(_banner, "scale", Vector2.ONE, 0.25).from(Vector2.ONE * 1.8).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	if secs < 90.0:
		t.tween_interval(secs)
		t.tween_property(_banner, "modulate:a", 0.0, 0.4)

func _process(delta: float) -> void:
	if a == null or match_ctl == null:
		return
	_t += delta
	var vw := _bars.size.x
	_faces[1].position.x = vw - 88.0
	_names[0].position = Vector2(96, 64)
	_names[1].position = Vector2(vw - 96.0 - _names[1].size.x, 64)
	_timer.position = Vector2(vw * 0.5 - 50.0, 12)
	var hp := [a.health, b.health]
	for i in 2:
		if hp[i] < _last[i]:
			_flash[i] = 0.25
		_last[i] = hp[i]
		_shown[i] = lerpf(_shown[i], hp[i], clampf(18.0 * delta, 0.0, 1.0))
		_trail[i] = hp[i] if hp[i] > _trail[i] else move_toward(_trail[i], hp[i], 22.0 * delta)
		_flash[i] = maxf(0.0, _flash[i] - delta)
	_timer.visible = not open_world
	_timer.text = str(maxi(0, int(ceil(match_ctl.time_left))))
	_bars.queue_redraw()

## A slanted bar from x0 to x1 (x1 < x0 for the right side), filled to `k` (0..1) from the outside edge inward.
func _slant(x0: float, x1: float, y: float, h: float, k: float, c: Color, outline := false) -> void:
	var dir := signf(x1 - x0)
	var w := absf(x1 - x0) * clampf(k, 0.0, 1.0)
	var sl := h * 0.6
	var xa := x0
	var xb := x0 + dir * w
	if w <= 0.5:
		return
	var pts := PackedVector2Array([Vector2(xa, y), Vector2(xb + dir * sl, y), Vector2(xb, y + h), Vector2(xa - dir * sl, y + h)])
	if outline:
		pts.append(pts[0])
		_bars.draw_polyline(pts, c, 2.0, true)
	else:
		_bars.draw_colored_polygon(pts, c)

func _draw_bars() -> void:
	if a == null:
		return
	var vw := _bars.size.x
	var mid := vw * 0.5
	var fs := [a, b]
	for i in 2:
		var left := i == 0
		var x0 := 100.0 if left else vw - 100.0
		var x1 := mid - 66.0 if left else mid + 66.0
		var dir := signf(x1 - x0)
		var y := 18.0
		var h := 22.0
		# back plate and portrait frame
		_slant(x0 - dir * 92.0, x1 + dir * 6.0, 6.0, 66.0, 1.0, Color(0.02, 0.02, 0.04, 0.55))
		var fx := 12.0 if left else vw - 88.0
		_bars.draw_rect(Rect2(fx - 2, 8, 78, 78), UiKit.ACCENT if left else Color(0.85, 0.2, 0.25), false, 3.0)
		# health: dark well, red damage trail, gradient fill, gloss, outline
		_slant(x0, x1, y, h, 1.0, Color(0.0, 0.0, 0.0, 0.7))
		_slant(x0, x1, y, h, _trail[i] / 100.0, Color(0.85, 0.12, 0.08, 0.95))
		var hk: float = _shown[i] / 100.0
		var col := Color(0.98, 0.82, 0.25).lerp(Color(1.0, 0.3, 0.15), clampf(1.0 - hk * 1.4, 0.0, 1.0))
		if hk < 0.25:
			col = col.lerp(Color(1, 0.1, 0.1), 0.5 + 0.5 * sin(_t * 9.0))
		if _flash[i] > 0.0:
			col = col.lerp(Color.WHITE, _flash[i] * 3.0)
		_slant(x0, x1, y, h, hk, col)
		_slant(x0, x1, y + h * 0.62, h * 0.38, hk, Color(0, 0, 0, 0.22))
		_slant(x0, x1, y + 2.0, h * 0.28, hk, Color(1, 1, 1, 0.35))
		_slant(x0, x1, y, h, 1.0, Color(1, 1, 1, 0.85), true)
		# cursed energy: four glowing segments
		var e: float = fs[i].energy / 100.0
		var ey := y + h + 8.0
		var seg := absf(x1 - x0) * 0.62 / 4.0
		for sgi in 4:
			var sx := x0 + dir * (sgi * seg + 4.0)
			var fill := clampf(e * 4.0 - sgi, 0.0, 1.0)
			var ex := sx + dir * (seg - 6.0)
			_slant(sx, ex, ey, 9.0, 1.0, Color(0, 0, 0, 0.6))
			var ec := Color(0.3, 0.65, 1.0) if left else Color(1.0, 0.3, 0.35)
			if e >= 1.0:
				ec = ec.lerp(Color.WHITE, 0.3 + 0.3 * sin(_t * 8.0))
			_slant(sx, ex, ey, 9.0, fill, ec)
			_slant(sx, ex, ey, 9.0, 1.0, Color(1, 1, 1, 0.35), true)
		if e >= 1.0:
			var gx := x0 + dir * (seg * 4.0 + 14.0) - (0.0 if left else 24.0)
			_bars.draw_circle(Vector2(gx + 10.0, ey + 4.5), 6.0 + 2.0 * sin(_t * 8.0), Color(1, 0.9, 0.5, 0.85))
		# round pips
		var wins: int = match_ctl.wins.get(fs[i], 0)
		for r in (0 if open_world else match_ctl.rounds_to_win):
			var px := (x1 - dir * (14.0 + r * 18.0))
			_bars.draw_circle(Vector2(px, y + h + 22.0), 6.0, UiKit.ACCENT if r < wins else Color(1, 1, 1, 0.25))
	# timer plate
	if open_world:
		return
	_bars.draw_colored_polygon(PackedVector2Array([Vector2(mid - 52, 6), Vector2(mid + 52, 6), Vector2(mid + 40, 64), Vector2(mid - 40, 64)]), Color(0.02, 0.02, 0.04, 0.75))
	_bars.draw_polyline(PackedVector2Array([Vector2(mid - 52, 6), Vector2(mid + 52, 6), Vector2(mid + 40, 64), Vector2(mid - 40, 64), Vector2(mid - 52, 6)]), Color(1, 1, 1, 0.6), 2.0, true)
