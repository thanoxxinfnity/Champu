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
		face.position = Vector2(14, 10) if side == 0 else Vector2(0, 10)
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
func _slant(x0: float, x1: float, y: float, h: float, k: float, c: Color) -> void:
	var dir := signf(x1 - x0)
	var w := absf(x1 - x0) * clampf(k, 0.0, 1.0)
	var sl := h * 0.6
	var xa := x0
	var xb := x0 + dir * w
	if w <= 0.5:
		return
	_bars.draw_colored_polygon(PackedVector2Array([Vector2(xa, y), Vector2(xb + dir * sl, y), Vector2(xb, y + h), Vector2(xa - dir * sl, y + h)]), c)

func _draw_bars() -> void:
	if a == null:
		return
	var vw := _bars.size.x
	var mid := vw * 0.5
	var fs := [a, b]
	for i in 2:
		var x0 := 92.0 if i == 0 else vw - 92.0
		var x1 := mid - 70.0 if i == 0 else mid + 70.0
		var y := 20.0
		var h := 24.0
		_slant(x0, x1, y - 3, h + 6, 1.0, Color(0, 0, 0, 0.6))
		_slant(x0, x1, y, h, _trail[i] / 100.0, Color(1, 1, 1, 0.85))
		var hk: float = _shown[i] / 100.0
		var col := Color(0.95, 0.75, 0.15).lerp(Color(0.95, 0.15, 0.12), clampf(1.0 - hk * 1.6, 0.0, 1.0))
		if _flash[i] > 0.0:
			col = col.lerp(Color.WHITE, _flash[i] * 3.0)
		_slant(x0, x1, y, h, hk, col)
		_slant(x0, x1, y, h * 0.35, hk, Color(1, 1, 1, 0.25))
		# cursed energy: four segments
		var e: float = fs[i].energy / 100.0
		var ey := y + h + 8.0
		var seg := absf(x1 - x0) * 0.62 / 4.0
		var dir := signf(x1 - x0)
		for s in 4:
			var sx := x0 + dir * (s * seg + 4.0)
			var fill := clampf(e * 4.0 - s, 0.0, 1.0)
			var ex := sx + dir * (seg - 6.0)
			_slant(sx, ex, ey, 10.0, 1.0, Color(0, 0, 0, 0.55))
			var ec := Color(0.3, 0.6, 1.0) if i == 0 else Color(1.0, 0.3, 0.3)
			if e >= 1.0:
				ec = ec.lerp(Color.WHITE, 0.35 + 0.35 * sin(_t * 8.0))
			_slant(sx, ex, ey, 10.0, fill, ec)
		if e >= 1.0:
			var txt := "DOMAIN READY"
			var fx := x0 + dir * (seg * 4.0 + 14.0) - (0.0 if i == 0 else 120.0)
			_bars.draw_string(ThemeDB.fallback_font, Vector2(fx, ey + 10.0), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(1, 1, 1, 0.6 + 0.4 * sin(_t * 8.0)))
		# round pips
		var wins: int = match_ctl.wins.get(fs[i], 0)
		for r in (0 if open_world else match_ctl.rounds_to_win):
			var px := (x1 - dir * (14.0 + r * 18.0))
			_bars.draw_circle(Vector2(px, y + h + 18.0), 6.0, UiKit.ACCENT if r < wins else Color(1, 1, 1, 0.25))
	# timer plate
	if open_world:
		return
	_bars.draw_colored_polygon(PackedVector2Array([Vector2(mid - 50, 8), Vector2(mid + 50, 8), Vector2(mid + 38, 62), Vector2(mid - 38, 62)]), Color(0, 0, 0, 0.6))
