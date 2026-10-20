class_name FightHud
extends CanvasLayer
## Health and cursed-energy bars for both fighters, round timer, round pips and the big centre banner.

var a: Fighter
var b: Fighter
var match_ctl: MatchController
var _hp: Array[ProgressBar] = []
var _en: Array[ProgressBar] = []
var _timer: Label
var _banner: Label
var _pips: Array[Label] = []
var _names: Array[Label] = []

func _ready() -> void:
	layer = 15
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	for side in 2:
		var left := side == 0
		var box := VBoxContainer.new()
		box.set_anchors_preset(Control.PRESET_TOP_LEFT if left else Control.PRESET_TOP_RIGHT)
		box.offset_left = 24.0 if left else -24.0 - 420.0
		box.offset_right = 24.0 + 420.0 if left else -24.0
		box.offset_top = 16.0
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(box)
		var nm := UiKit.label("", 20)
		nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if left else HORIZONTAL_ALIGNMENT_RIGHT
		box.add_child(nm)
		_names.append(nm)
		var hp := _bar(Color(0.9, 0.2, 0.2), 22, not left)
		box.add_child(hp)
		_hp.append(hp)
		var en := _bar(Color(0.3, 0.6, 1.0), 10, not left)
		box.add_child(en)
		_en.append(en)
		var pip := UiKit.label("", 18, UiKit.ACCENT)
		pip.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if left else HORIZONTAL_ALIGNMENT_RIGHT
		box.add_child(pip)
		_pips.append(pip)
	_timer = UiKit.label("60", 40)
	_timer.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_timer.offset_left = -50.0
	_timer.offset_right = 50.0
	_timer.offset_top = 12.0
	_timer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_timer)
	_banner = UiKit.label("", 72, UiKit.ACCENT)
	_banner.set_anchors_preset(Control.PRESET_CENTER)
	_banner.offset_left = -400.0
	_banner.offset_right = 400.0
	_banner.offset_top = -80.0
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_banner)

func _bar(c: Color, h: int, flip: bool) -> ProgressBar:
	var p := ProgressBar.new()
	p.custom_minimum_size = Vector2(420, h)
	p.show_percentage = false
	p.max_value = 100.0
	p.value = 100.0
	p.fill_mode = ProgressBar.FILL_END_TO_BEGIN if flip else ProgressBar.FILL_BEGIN_TO_END
	var fg := StyleBoxFlat.new()
	fg.bg_color = c
	fg.set_corner_radius_all(4)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.55)
	bg.set_corner_radius_all(4)
	bg.set_border_width_all(2)
	bg.border_color = Color(1, 1, 1, 0.5)
	p.add_theme_stylebox_override("fill", fg)
	p.add_theme_stylebox_override("background", bg)
	return p

func bind(fa: Fighter, fb: Fighter, mc: MatchController) -> void:
	a = fa
	b = fb
	match_ctl = mc
	_names[0].text = fa.fighter_name
	_names[1].text = fb.fighter_name
	mc.round_started.connect(func(n: int): flash("ROUND %d" % n, 1.4))
	mc.round_ended.connect(func(w: Fighter): flash("KO!" if w != null and not w.opponent.is_alive() else "TIME", 1.6))
	mc.match_ended.connect(func(w: Fighter): flash("%s WINS" % w.fighter_name, 99.0))

func flash(text: String, secs: float) -> void:
	_banner.text = text
	_banner.modulate.a = 1.0
	if secs < 90.0:
		var t := create_tween()
		t.tween_interval(secs)
		t.tween_property(_banner, "modulate:a", 0.0, 0.4)

func _process(_d: float) -> void:
	if a == null or match_ctl == null:
		return
	_hp[0].value = a.health
	_hp[1].value = b.health
	_en[0].value = a.energy
	_en[1].value = b.energy
	_timer.text = str(maxi(0, int(ceil(match_ctl.time_left))))
	_pips[0].text = "●".repeat(match_ctl.wins.get(a, 0)) + "○".repeat(maxi(0, match_ctl.rounds_to_win - match_ctl.wins.get(a, 0)))
	_pips[1].text = "●".repeat(match_ctl.wins.get(b, 0)) + "○".repeat(maxi(0, match_ctl.rounds_to_win - match_ctl.wins.get(b, 0)))
