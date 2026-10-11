class_name Ui
extends CanvasLayer
## Everything on the glass, and almost none of it is words. The HUD is a stick, a swipe area, a few white line-art
## buttons and a hand that appears only when you are looking at something you can use. The story is on paper
## (a quest sheet that clips its text to its own edges), the pack is a frosted-glass grid you craft in, and being hurt
## is a shaken picture with red edges. The only text outside a paper is the title.

signal start_pressed
signal continue_pressed
signal retry_pressed
signal restart_pressed

const INK := Color(0.82, 0.92, 0.96)
const PAPER_INK := Color(0.16, 0.1, 0.06)

var game: Game
var modal_open := false
var playing := false
var screen_override := Vector2.ZERO
var look_speed := 1.0

var _root: Control
var _pad: Control
var _modal: Control
var _screen: Control
var _post: ColorRect
var _flash: ColorRect
var _focus_now := false
var _emp_has := false
var _emp_charges := 0
var _health := 3
var _dread := 0.0
var _beat := 0.0
var _count := -1.0
var _hurt := 0.0
var _paper_tex: ImageTexture
var _selected := -1
var _slots: Array = []
var _dropzone: Control
var _gore: Control
var _pack_open := false
var _after_paper := Callable()

# Touch bookkeeping.
var _touches := {}
var _stick_origin := Vector2.ZERO
var _stick_pos := Vector2.ZERO
var _stick_index := -1
var _look_last := {}
var _held := {}


func _vp() -> Vector2:
	return screen_override if screen_override != Vector2.ZERO else get_viewport().get_visible_rect().size


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	layer = 5
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_post = ColorRect.new()
	_post.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_post.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/post.gdshader")
	_post.material = sm
	_root.add_child(_post)
	_pad = Control.new()
	_pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pad.draw.connect(_draw_pad)
	_pad.visible = false
	_root.add_child(_pad)
	_gore = Control.new()
	_gore.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_gore.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_gore)
	_flash = ColorRect.new()
	_flash.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.color = Color(0.6, 0.0, 0.0, 0.0)
	_root.add_child(_flash)
	_modal = Control.new()
	_modal.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_modal)
	_screen = Control.new()
	_screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_screen)
	_paper_tex = _make_paper()


func _process(delta: float) -> void:
	_rt_step()
	var sm := _post.material as ShaderMaterial
	_hurt = move_toward(_hurt, 0.0, delta * 1.2)
	var low := clampf(float(3 - _health) / 2.0, 0.0, 1.0)
	sm.set_shader_parameter("hurt", _hurt)
	sm.set_shader_parameter("low_hp", low * 0.9)
	sm.set_shader_parameter("vignette", 0.5 + low * 0.3)
	sm.set_shader_parameter("dread", _dread)
	_beat = move_toward(_beat, 0.0, delta * 3.0)
	if game and game.sfx.heart_rate > 0.0 and fmod(Time.get_ticks_msec() * 0.001 * game.sfx.heart_rate, 1.0) < delta * game.sfx.heart_rate:
		_beat = 1.0
	sm.set_shader_parameter("beat", _beat)
	_flash.color.a = move_toward(_flash.color.a, 0.0, delta * 0.8)
	if playing:
		_pad.queue_redraw()


# ── what the game tells the glass ────────────────────────────────────────────

func set_playing(on: bool) -> void:
	playing = on
	_pad.visible = on
	_touches.clear()
	_look_last.clear()
	_held.clear()
	_stick_index = -1
	if game and game.player:
		game.player.move_input = Vector2.ZERO
		game.player.sprint_held = false
	if on and not _is_touch_device():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	else:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _is_touch_device() -> bool:
	return DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")


func set_focus(on: bool) -> void:
	_focus_now = on


func set_emp(has: bool, charges: int) -> void:
	_emp_has = has
	_emp_charges = charges


func set_health(h: int) -> void:
	_health = h


func set_dread(t: float) -> void:
	_dread = t


func set_countdown(frac: float) -> void:
	_count = frac


func flash_red() -> void:
	_flash.color = Color(0.6, 0.0, 0.0, 0.5)
	_hurt = 1.0
	blood_on_screen(_health <= 1)


## Blood thrown across the glass of the screen when you are hurt: splatters, and drips that slide down and fade over a few seconds.
func blood_on_screen(heavy := false) -> void:
	if _gore == null:
		return
	var vp := _vp()
	while _gore.get_child_count() > 16:
		_gore.get_child(0).queue_free()
		_gore.remove_child(_gore.get_child(0))
	for i in range(5 if heavy else 3):
		var drip := randf() < 0.35
		var tr := TextureRect.new()
		tr.texture = Blood.texture("drip_%d" % randi_range(0, 1) if drip else "splat_%d" % randi_range(0, 5))
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_SCALE
		tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var sz := Vector2(randf_range(vp.x * 0.25, vp.x * 0.4), randf_range(vp.y * 0.35, vp.y * 0.6)) if drip else Vector2.ONE * randf_range(vp.y * 0.3, vp.y * 0.6)
		tr.size = sz
		tr.position = Vector2(randf_range(0.0, vp.x - sz.x), 0.0 if drip else randf_range(0.0, vp.y - sz.y))
		tr.pivot_offset = sz * 0.5
		if not drip:
			tr.rotation = randf() * TAU
		tr.modulate = Color(1, 1, 1, 0.0)
		_gore.add_child(tr)
		_to(tr, "modulate:a", 0.85, 0.1)
		_rt.append([tr, "modulate:a", 0.85, 0.0, Time.get_ticks_msec() + 3500, 5500, false])
		_to(tr, "position:y", tr.position.y + (vp.y * 0.18), 9.0)
		get_tree().create_timer(9.5, true, false, true).timeout.connect(tr.queue_free)


# ── the HUD ──────────────────────────────────────────────────────────────────

func _layout() -> Dictionary:
	var vp := _vp()
	return {
		"emp": {"c": Vector2(vp.x - 120, vp.y - 120), "r": 56.0},
		"torch": {"c": Vector2(vp.x - 250, vp.y - 70), "r": 38.0},
		"crouch": {"c": Vector2(vp.x - 250, vp.y - 170), "r": 38.0},
		"pack": {"c": Vector2(vp.x - 120, vp.y - 240), "r": 36.0},
		"throw": {"c": Vector2(vp.x - 390, vp.y - 100), "r": 36.0},
		"pause": {"c": Vector2(vp.x - 44, 40), "r": 26.0},
	}


func _hand_center() -> Vector2:
	var vp := _vp()
	return Vector2(vp.x * 0.5, vp.y * 0.5 + 74.0)


func _hit(pos: Vector2) -> String:
	if _focus_now and pos.distance_to(_hand_center()) < 52.0:
		return "hand"
	var l := _layout()
	for k in l:
		var d: Dictionary = l[k]
		if pos.distance_to(d.c) < d.r + 10.0:
			return k
	return ""


func _draw_pad() -> void:
	var l := _layout()
	for k in l:
		if k == "emp" and not _emp_has:
			continue
		if k == "throw" and not _scrap_count():
			continue
		var d: Dictionary = l[k]
		var down: bool = _held.get(k, false)
		var fill := Color(0.0, 0.0, 0.0, 0.34)
		var ink := Color(1, 1, 1, 0.9)
		if k == "torch" and game and game.player and not game.player.torch_on:
			ink.a = 0.45
		if down:
			fill = Color(1, 1, 1, 0.28)
		_pad.draw_circle(d.c, d.r, fill)
		_pad.draw_arc(d.c, d.r, 0, TAU, 48, ink, 2.5, true)
		_glyph(k, d.c, d.r, ink)
		if k == "throw":
			for i in range(mini(_scrap_count(), 6)):
				_pad.draw_circle(d.c + Vector2(-d.r + 6.0 + i * 11.0, d.r + 8.0), 3.5, Color(0.85, 0.88, 1.0, 0.95))
		if k == "emp":
			# The stunner's charge: a ring of segments, no numbers.
			for i in range(6):
				var a0 := -PI * 0.5 + i * TAU / 6.0 + 0.1
				_pad.draw_arc(d.c, d.r + 8.0, a0, a0 + TAU / 6.0 - 0.2, 8, Color(0.4, 0.8, 1.0, 0.95) if i < _emp_charges else Color(1, 1, 1, 0.18), 4.0, true)
	var vp := _vp()
	_draw_sound_meter(Vector2(vp.x * 0.5, vp.y - 40.0))
	# A dot to aim with; the hand under it appears only when there is something to use.
	_pad.draw_circle(vp * 0.5, 2.5 if not _focus_now else 3.5, Color(1, 1, 1, 0.5 if not _focus_now else 0.9))
	if _focus_now:
		var c := _hand_center()
		var down2: bool = _held.get("hand", false)
		_pad.draw_circle(c, 46.0, Color(1, 1, 1, 0.3) if down2 else Color(0, 0, 0, 0.4))
		_pad.draw_arc(c, 46.0, 0, TAU, 48, Color(1, 1, 1, 0.95), 3.0, true)
		_glyph("use", c, 46.0, Color(1, 1, 1, 0.95))
	if _count >= 0.0:
		var c2 := Vector2(vp.x * 0.5, 44.0)
		var pulse := 0.65 + 0.35 * sin(Time.get_ticks_msec() * (0.006 if _count > 0.2 else 0.016))
		_pad.draw_arc(c2, 24.0, 0, TAU, 40, Color(1, 1, 1, 0.18), 5.0, true)
		_pad.draw_arc(c2, 24.0, -PI * 0.5, -PI * 0.5 + TAU * _count, 40, Color(1.0, 0.2, 0.15, pulse), 5.0, true)
		_pad.draw_line(c2, c2 + Vector2(0, -13), Color(1, 1, 1, 0.8), 2.5, true)
	if _stick_index != -1:
		_pad.draw_circle(_stick_origin, 70, Color(0.0, 0.0, 0.0, 0.22))
		_pad.draw_arc(_stick_origin, 70, 0, TAU, 40, Color(1, 1, 1, 0.4), 2.0)
		_pad.draw_circle(_stick_pos, 30, Color(1, 1, 1, 0.45))
	else:
		_pad.draw_arc(Vector2(130, vp.y - 120), 70, 0, TAU, 40, Color(1, 1, 1, 0.15), 2.0)


func _scrap_count() -> int:
	return game.s.inv.count("scrap") if game != null else 0


## How loud you are: a speaker with waves. Still, it is a lone dot; as you get louder more waves light and they turn amber, then red.
func _draw_sound_meter(c: Vector2) -> void:
	var level := game.player.noise_level if game != null and game.player != null else 0.0
	var lit := 0 if level < 0.02 else (1 if level < 0.2 else (2 if level < 0.55 else 3))
	var col := Color(1, 1, 1, 0.55) if lit < 3 else Color(1.0, 0.35, 0.25, 0.95)
	if lit == 2:
		col = Color(1.0, 0.8, 0.3, 0.9)
	_pad.draw_rect(Rect2(c + Vector2(-26, -6), Vector2(6, 12)), Color(1, 1, 1, 0.55))
	_pad.draw_polyline(PackedVector2Array([c + Vector2(-20, -6), c + Vector2(-12, -13), c + Vector2(-12, 13), c + Vector2(-20, 6)]), Color(1, 1, 1, 0.55), 2.0, true)
	for i in range(3):
		var r := 10.0 + i * 8.0
		var on := i < lit
		_pad.draw_arc(c + Vector2(-10, 0), r, -0.6, 0.6, 10, col if on else Color(1, 1, 1, 0.14), 2.5, true)
	if lit == 0:
		_pad.draw_line(c + Vector2(-6, -12), c + Vector2(18, 12), Color(1, 1, 1, 0.3), 2.0, true)


## The picture on a button, drawn in white lines.
func _glyph(k: String, c: Vector2, r: float, ink: Color) -> void:
	var u := r / 40.0
	var w := maxf(2.5, 3.0 * u)
	_pad.draw_set_transform(c, 0.0, Vector2(u, u))
	match k:
		"use":
			var pts := PackedVector2Array([Vector2(-10, 4), Vector2(-10, -6), Vector2(-4, -6), Vector2(-4, -22), Vector2(4, -22), Vector2(4, -6), Vector2(10, -4), Vector2(10, 4), Vector2(14, 8), Vector2(10, 22), Vector2(-8, 22), Vector2(-14, 10), Vector2(-10, 4)])
			_pad.draw_polyline(pts, ink, w / u, true)
			_pad.draw_arc(Vector2(0, -22), 8, PI * 1.15, PI * 1.85, 10, ink, w / u * 0.7, true)
			_pad.draw_arc(Vector2(0, -22), 14, PI * 1.15, PI * 1.85, 12, ink, w / u * 0.7, true)
		"torch":
			_pad.draw_set_transform(c, deg_to_rad(40.0), Vector2(u, u))
			_pad.draw_rect(Rect2(-6, -2, 12, 26), ink, false, w / u)
			_pad.draw_polyline(PackedVector2Array([Vector2(-6, -2), Vector2(-11, -14), Vector2(11, -14), Vector2(6, -2)]), ink, w / u, true)
			_pad.draw_line(Vector2(0, -20), Vector2(0, -28), ink, w / u * 0.8, true)
			_pad.draw_line(Vector2(-9, -19), Vector2(-15, -25), ink, w / u * 0.8, true)
			_pad.draw_line(Vector2(9, -19), Vector2(15, -25), ink, w / u * 0.8, true)
		"emp":
			# A lightning bolt.
			_pad.draw_polyline(PackedVector2Array([Vector2(6, -24), Vector2(-9, 3), Vector2(-1, 3), Vector2(-6, 24), Vector2(10, -4), Vector2(2, -4), Vector2(6, -24)]), ink, w / u, true)
		"crouch":
			_pad.draw_arc(Vector2(-4, -14), 6, 0, TAU, 14, ink, w / u, true)
			_pad.draw_polyline(PackedVector2Array([Vector2(-4, -7), Vector2(-6, 6), Vector2(4, 8), Vector2(4, 20)]), ink, w / u, true)
			_pad.draw_polyline(PackedVector2Array([Vector2(-6, 6), Vector2(-14, 18)]), ink, w / u, true)
			_pad.draw_polyline(PackedVector2Array([Vector2(16, -8), Vector2(16, 8), Vector2(11, 3), Vector2(16, 8), Vector2(21, 3)]), ink, w / u * 0.9, true)
		"pack":
			# A backpack: a rounded body, a flap, a pocket, two straps.
			_pad.draw_polyline(PackedVector2Array([Vector2(-14, 20), Vector2(-14, -8), Vector2(-8, -18), Vector2(8, -18), Vector2(14, -8), Vector2(14, 20), Vector2(-14, 20)]), ink, w / u, true)
			_pad.draw_line(Vector2(-14, -2), Vector2(14, -2), ink, w / u * 0.8, true)
			_pad.draw_rect(Rect2(-8, 6, 16, 9), ink, false, w / u * 0.8)
			_pad.draw_arc(Vector2(0, -20), 5, PI, TAU, 8, ink, w / u * 0.8, true)
		"throw":
			# A hex nut thrown along a dotted arc.
			_pad.draw_polyline(PackedVector2Array([Vector2(-8, -12), Vector2(0, -16), Vector2(8, -12), Vector2(8, -4), Vector2(0, 0), Vector2(-8, -4), Vector2(-8, -12)]), ink, w / u, true)
			_pad.draw_circle(Vector2(0, -8), 3.0, ink)
			for i in range(4):
				_pad.draw_circle(Vector2(-14 + i * 9.0, 8.0 + absf(i - 1.5) * 4.0 - 6.0), 1.8, ink)
			_pad.draw_line(Vector2(12, 14), Vector2(20, 20), ink, w / u * 0.8, true)
		"pause":
			_pad.draw_rect(Rect2(-9, -12, 6, 24), ink)
			_pad.draw_rect(Rect2(3, -12, 6, 24), ink)
		"close":
			_pad.draw_line(Vector2(-12, -12), Vector2(12, 12), ink, w / u, true)
			_pad.draw_line(Vector2(12, -12), Vector2(-12, 12), ink, w / u, true)
	_pad.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


# ── input ────────────────────────────────────────────────────────────────────

func _input(event: InputEvent) -> void:
	if not playing or modal_open or game == null or game.player == null:
		return
	var p := game.player
	if event is InputEventScreenTouch:
		var vp := _vp()
		if event.pressed:
			var b := _hit(event.position)
			if b != "":
				_touches[event.index] = b
				_held[b] = true
				_press(b)
			elif event.position.x < vp.x * 0.45 and event.position.y > vp.y * 0.25 and _stick_index == -1:
				_stick_index = event.index
				_stick_origin = event.position
				_stick_pos = event.position
				_touches[event.index] = "stick"
			else:
				_touches[event.index] = "look"
				_look_last[event.index] = event.position
		else:
			var role: String = _touches.get(event.index, "")
			if role == "stick":
				_stick_index = -1
				p.move_input = Vector2.ZERO
				p.sprint_held = false
			if role != "" and role != "stick" and role != "look":
				_held[role] = false
			_touches.erase(event.index)
			_look_last.erase(event.index)
	elif event is InputEventScreenDrag:
		var role: String = _touches.get(event.index, "")
		if role == "stick":
			var off: Vector2 = event.position - _stick_origin
			var r := 70.0
			if off.length() > r:
				_stick_origin += off.normalized() * (off.length() - r)
				off = off.limit_length(r)
			_stick_pos = _stick_origin + off
			var v := off / r
			p.move_input = Vector2(v.x, v.y)
			p.sprint_held = v.length() > 0.93
		elif role == "look":
			var last: Vector2 = _look_last.get(event.index, event.position)
			var d: Vector2 = event.position - last
			_look_last[event.index] = event.position
			p.look(d.x * 0.0046 * look_speed, d.y * 0.0046 * look_speed)
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		p.look(event.relative.x * 0.0022 * look_speed, event.relative.y * 0.0022 * look_speed)
	elif event is InputEventKey and not event.echo:
		_key(event)


func _press(b: String) -> void:
	var p := game.player
	match b:
		"hand":
			p.use_edge = true
		"torch":
			p.toggle_torch()
		"emp":
			p.fire_emp()
		"crouch":
			p.crouching = not p.crouching
		"throw":
			p.throw_scrap()
		"pack":
			show_pack()
		"pause":
			show_pack()


func _key(event: InputEventKey) -> void:
	var p := game.player
	var down := event.pressed
	match event.keycode:
		KEY_E, KEY_ENTER, KEY_SPACE:
			if down:
				p.use_edge = true
		KEY_F:
			if down:
				p.toggle_torch()
		KEY_Q:
			if down:
				p.fire_emp()
		KEY_G:
			if down:
				p.throw_scrap()
		KEY_C:
			if down:
				p.crouching = not p.crouching
		KEY_SHIFT:
			p.sprint_held = down
		KEY_TAB, KEY_I:
			if down:
				show_pack()
		KEY_W, KEY_S, KEY_A, KEY_D, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT:
			p.move_input = Vector2(
				float(Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT)) - float(Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT)),
				float(Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN)) - float(Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)))


# ── modals: paper and pack ───────────────────────────────────────────────────

## Animations that keep running while the world is frozen (Engine.time_scale is 0 in the pack and on a paper), so they are
## timed by the wall clock instead of by tweens: [object, property, from, to, start ms, duration ms, back-ease?]
var _rt: Array = []


func _to(obj: Object, prop: String, to: Variant, dur: float, delay := 0.0, back := false) -> void:
	_rt.append([obj, prop, obj.get_indexed(prop), to, Time.get_ticks_msec() + int(delay * 1000.0), maxi(1, int(dur * 1000.0)), back])


func _rt_step() -> void:
	var now := Time.get_ticks_msec()
	for a in _rt.duplicate():
		if not is_instance_valid(a[0]):
			_rt.erase(a)
			continue
		var t := clampf(float(now - a[4]) / a[5], 0.0, 1.0)
		if now < a[4]:
			continue
		var k := t
		if a[6]:
			var c := 1.70158
			k = 1.0 + (c + 1.0) * pow(t - 1.0, 3.0) + c * pow(t - 1.0, 2.0)
		else:
			k = 1.0 - pow(1.0 - t, 3.0)
		a[0].set_indexed(a[1], lerp(a[2], a[3], k))
		if t >= 1.0:
			_rt.erase(a)


func _open_modal() -> void:
	_clear(_modal)
	modal_open = true
	Engine.time_scale = 0.0
	if game and game.player:
		game.player.move_input = Vector2.ZERO
		game.player.sprint_held = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_modal.mouse_filter = Control.MOUSE_FILTER_STOP


func close_modal() -> void:
	_clear(_modal)
	modal_open = false
	_pack_open = false
	_selected = -1
	_slots.clear()
	Engine.time_scale = 1.0
	_modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if playing and not _is_touch_device():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if _after_paper.is_valid():
		var cb := _after_paper
		_after_paper = Callable()
		cb.call()


func _clear(node: Control) -> void:
	for c in node.get_children():
		c.queue_free()


## A sheet of old paper: fibres, stains, darkened edges. Made once, in code.
func _make_paper() -> ImageTexture:
	var w := 256
	var h := 384
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 7
	noise.frequency = 0.03
	var fine := FastNoiseLite.new()
	fine.seed = 9
	fine.frequency = 0.5
	for y in range(h):
		for x in range(w):
			var n := noise.get_noise_2d(x, y) * 0.5 + 0.5
			var f := fine.get_noise_2d(x, y) * 0.04
			var ex := minf(float(x), float(w - 1 - x)) / 22.0
			var ey := minf(float(y), float(h - 1 - y)) / 22.0
			var edge := clampf(minf(ex, ey), 0.0, 1.0)
			var base := Color(0.86, 0.80, 0.64).lerp(Color(0.62, 0.5, 0.32), (1.0 - edge) * 0.8 + n * 0.25)
			base = Color(base.r + f, base.g + f, base.b + f, 1.0)
			# A torn, uneven edge.
			var tear := noise.get_noise_2d(x * 3.0, y * 3.0) * 4.0
			var inside := minf(float(x), float(w - 1 - x)) > 2.0 + tear and minf(float(y), float(h - 1 - y)) > 2.0 + tear
			base.a = 1.0 if inside else 0.0
			img.set_pixel(x, y, base)
	return ImageTexture.create_from_image(img)


## The quest paper. A TextureRect (the sheet) holds a MarginContainer (20 px on every side) that holds a RichTextLabel set to
## wrap by word and to clip: whatever the font size, the words stay on the paper.
func show_paper(title: String, body: String, after := Callable()) -> void:
	_open_modal()
	_after_paper = after
	var dim := ColorRect.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.color = Color(0, 0, 0, 0.55)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	_modal.add_child(dim)
	var vp := _vp()
	var sheet := TextureRect.new()
	sheet.name = "Sheet"
	sheet.texture = _paper_tex
	sheet.stretch_mode = TextureRect.STRETCH_SCALE
	sheet.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	var sw := minf(vp.x * 0.62, 640.0)
	var sh := minf(vp.y * 0.84, 520.0)
	sheet.custom_minimum_size = Vector2(sw, sh)
	sheet.size = Vector2(sw, sh)
	sheet.position = (vp - Vector2(sw, sh)) * 0.5
	sheet.rotation = deg_to_rad(-1.2)
	sheet.pivot_offset = Vector2(sw, sh) * 0.5
	_modal.add_child(sheet)
	var margin := MarginContainer.new()
	margin.name = "Margin"
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	sheet.add_child(margin)
	var rt := RichTextLabel.new()
	rt.name = "Text"
	rt.bbcode_enabled = true
	rt.autowrap_mode = TextServer.AUTOWRAP_WORD
	rt.clip_contents = true
	rt.scroll_active = true
	rt.fit_content = false
	rt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rt.size_flags_vertical = Control.SIZE_EXPAND_FILL
	rt.add_theme_color_override("default_color", PAPER_INK)
	rt.add_theme_font_size_override("normal_font_size", 20)
	rt.add_theme_font_size_override("bold_font_size", 20)
	rt.text = "[center][b]%s[/b][/center]\n\n%s" % [title, body]
	margin.add_child(rt)
	rt.visible_ratio = 0.0
	_to(rt, "visible_ratio", 1.0, clampf(body.length() * 0.012, 0.6, 3.0))
	_close_glyph(Vector2(vp.x - 56, 56))
	dim.gui_input.connect(func(e: InputEvent):
		if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed:
			close_modal())


## A round button with a white line-art picture, for the modal screens.
func _close_glyph(pos: Vector2, kind := "close", cb := Callable()) -> Control:
	var b := Control.new()
	b.size = Vector2(72, 72)
	b.position = pos - Vector2(36, 36)
	b.mouse_filter = Control.MOUSE_FILTER_STOP
	b.draw.connect(func():
		b.draw_circle(Vector2(36, 36), 32.0, Color(0, 0, 0, 0.45))
		b.draw_arc(Vector2(36, 36), 32.0, 0, TAU, 40, Color(1, 1, 1, 0.9), 2.5, true)
		b.draw_set_transform(Vector2(36, 36), 0.0, Vector2(0.8, 0.8))
		if kind == "close":
			b.draw_line(Vector2(-12, -12), Vector2(12, 12), Color.WHITE, 3.0, true)
			b.draw_line(Vector2(12, -12), Vector2(-12, 12), Color.WHITE, 3.0, true)
		elif kind == "retry":
			b.draw_arc(Vector2.ZERO, 16, PI * 0.25, PI * 1.9, 24, Color.WHITE, 3.0, true)
			b.draw_polyline(PackedVector2Array([Vector2(10, -20), Vector2(18, -10), Vector2(6, -8)]), Color.WHITE, 3.0, true)
		elif kind == "play":
			b.draw_colored_polygon(PackedVector2Array([Vector2(-8, -14), Vector2(14, 0), Vector2(-8, 14)]), Color.WHITE)
		b.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE))
	b.gui_input.connect(func(e: InputEvent):
		if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed:
			if cb.is_valid():
				cb.call()
			else:
				close_modal())
	_modal.add_child(b)
	return b


# ── the pack: twenty-five slots on frosted glass ────────────────────────────────────

func show_pack() -> void:
	if game == null or modal_open:
		return
	_open_modal()
	_pack_open = true
	var glass := ColorRect.new()
	glass.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/frost.gdshader")
	glass.material = sm
	glass.mouse_filter = Control.MOUSE_FILTER_STOP
	_modal.add_child(glass)
	var vp := _vp()
	var cols := 5
	var gap := 8.0
	var cell := minf(78.0, (minf(vp.x, vp.y) * 0.72 - gap * float(cols - 1)) / float(cols))
	var side := cell * float(cols) + gap * float(cols - 1)
	var total_h := side + 24.0 + 68.0       # the grid, a gap, and the drop button under it
	var grid := GridContainer.new()
	grid.name = "Grid"
	grid.columns = cols
	grid.add_theme_constant_override("h_separation", int(gap))
	grid.add_theme_constant_override("v_separation", int(gap))
	grid.position = Vector2((vp.x - side) * 0.5, (vp.y - total_h) * 0.5)
	grid.size = Vector2(side, side)
	_modal.add_child(grid)
	_slots.clear()
	for i in range(Data.PACK_SLOTS):
		var slot := InvSlot.new()
		slot.ui = self
		slot.index = i
		slot.custom_minimum_size = Vector2(cell, cell)
		grid.add_child(slot)
		_slots.append(slot)
	_dropzone = DropZone.new()
	_dropzone.ui = self
	_dropzone.size = Vector2(68, 68)
	_dropzone.position = Vector2(vp.x * 0.5 - 34.0, grid.position.y + side + 24.0)
	_modal.add_child(_dropzone)
	refresh_pack()
	_close_glyph(Vector2(vp.x - 56, 56))
	glass.modulate.a = 0.0
	_to(glass, "modulate:a", 1.0, 0.2)


func refresh_pack() -> void:
	for s in _slots:
		(s as InvSlot).queue_redraw()
	if _dropzone != null and is_instance_valid(_dropzone):
		_dropzone.queue_redraw()


## Put the item in slot `i` down on the floor (the button under the grid: tap it with an item picked, or drag an item onto it).
func slot_drop(i: int) -> void:
	if slot_item(i) == "":
		return
	game.drop_item(i)
	_selected = -1
	refresh_pack()


func slot_item(i: int) -> String:
	return game.s.inv[i] if i < game.s.inv.size() else ""


## Tap a slot, then another, or drag one onto another: if the two make something, they do.
func slot_tap(i: int) -> void:
	if slot_item(i) == "":
		_selected = -1
	elif _selected == -1:
		_selected = i
	elif _selected == i:
		_selected = -1
	else:
		slot_combine(_selected, i)
		_selected = -1
	refresh_pack()


func slot_combine(a: int, b: int) -> void:
	var out := Data.recipe(slot_item(a), slot_item(b))
	var ok := game.craft(a, b)
	_selected = -1
	refresh_pack()
	if ok:
		var last := _slots[game.s.inv.size() - 1] as Control
		last.scale = Vector2(1.3, 1.3)
		last.pivot_offset = last.size * 0.5
		_to(last, "scale", Vector2.ONE, 0.35, 0.0, true)
	elif out == "":
		for i in [a, b]:
			var sl := _slots[i] as Control
			var x0 := sl.position.x
			_to(sl, "position:x", x0 + 7.0, 0.05)
			_to(sl, "position:x", x0 - 7.0, 0.08, 0.05)
			_to(sl, "position:x", x0, 0.05, 0.13)


## The drop button under the pack: a tray with an arrow going down into it. Lit while something is picked.
class DropZone extends Control:
	var ui: Ui

	func _draw() -> void:
		var on := ui._selected != -1
		var c := size * 0.5
		var ink := Color(1, 1, 1, 0.95 if on else 0.4)
		draw_circle(c, 32.0, Color(0.2, 0.45, 0.55, 0.6) if on else Color(0, 0, 0, 0.4))
		draw_arc(c, 32.0, 0, TAU, 40, ink, 2.5, true)
		draw_line(c + Vector2(0, -18), c + Vector2(0, 4), ink, 3.0, true)
		draw_polyline(PackedVector2Array([c + Vector2(-8, -4), c + Vector2(0, 5), c + Vector2(8, -4)]), ink, 3.0, true)
		draw_polyline(PackedVector2Array([c + Vector2(-15, 2), c + Vector2(-15, 15), c + Vector2(15, 15), c + Vector2(15, 2)]), ink, 3.0, true)

	func _gui_input(e: InputEvent) -> void:
		if ((e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT) or e is InputEventScreenTouch) and e.pressed and ui._selected != -1:
			ui.slot_drop(ui._selected)

	func _can_drop_data(_at: Vector2, data: Variant) -> bool:
		return typeof(data) == TYPE_DICTIONARY and data.has("slot")

	func _drop_data(_at: Vector2, data: Variant) -> void:
		ui.slot_drop(data.slot)


## One cell of the pack. It draws the item as a little white-and-colour picture, and takes taps and drags.
class InvSlot extends Control:
	var ui: Ui
	var index := 0

	func _draw() -> void:
		var item := ui.slot_item(index)
		var sel := ui._selected == index
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.05, 0.1, 0.13, 0.55) if not sel else Color(0.2, 0.45, 0.55, 0.7))
		draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, 0.55 if sel else 0.25), false, 2.0)
		if item != "":
			ui.draw_item(self, item, size * 0.5, size.x * 0.34)

	func _gui_input(e: InputEvent) -> void:
		if (e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT) or (e is InputEventScreenTouch and e.pressed):
			ui.slot_tap(index)

	func _get_drag_data(_at: Vector2) -> Variant:
		if ui.slot_item(index) == "":
			return null
		var prev := Control.new()
		prev.size = Vector2(60, 60)
		prev.draw.connect(func(): ui.draw_item(prev, ui.slot_item(index), Vector2(30, 30), 24.0))
		set_drag_preview(prev)
		return {"slot": index}

	func _can_drop_data(_at: Vector2, data: Variant) -> bool:
		return typeof(data) == TYPE_DICTIONARY and data.has("slot") and data.slot != index and ui.slot_item(index) != ""

	func _drop_data(_at: Vector2, data: Variant) -> void:
		ui.slot_combine(data.slot, index)


static var _icons := {}


## An item's picture: its 3D model rendered on a transparent background (tools/render_icons.gd). Null if there is none.
static func item_icon(item: String) -> Texture2D:
	if not _icons.has(item):
		var path := "res://assets/icons/%s.png" % item
		_icons[item] = load(path) if ResourceLoader.exists(path) else null
	return _icons[item]


## Each item as a picture (its rendered model, background removed); the line drawings below are the fallback. No names anywhere.
func draw_item(c: CanvasItem, item: String, at: Vector2, r: float) -> void:
	var col: Color = Data.ITEMS.get(item, Color.WHITE)
	var tex := item_icon(item)
	if tex != null:
		var box := r * 2.9
		c.draw_texture_rect(tex, Rect2(at - Vector2(box, box) * 0.5, Vector2(box, box)), false)
		return
	var line := 2.5
	match item:
		"fuse":
			c.draw_rect(Rect2(at + Vector2(-r * 0.25, -r * 0.7), Vector2(r * 0.5, r * 1.4)), col, false, line)
			c.draw_line(at + Vector2(0, -r * 0.5), at + Vector2(0, r * 0.5), col, 1.5)
			c.draw_rect(Rect2(at + Vector2(-r * 0.32, -r * 0.82), Vector2(r * 0.64, r * 0.18)), col)
			c.draw_rect(Rect2(at + Vector2(-r * 0.32, r * 0.64), Vector2(r * 0.64, r * 0.18)), col)
		"cable":
			for i in range(3):
				c.draw_arc(at + Vector2(0, (i - 1) * r * 0.5), r * 0.55, PI * 0.1, PI * 0.9, 12, col, line, true)
			c.draw_line(at + Vector2(-r * 0.7, r * 0.9), at + Vector2(r * 0.7, r * 0.9), col, line)
		"wiring":
			c.draw_arc(at, r * 0.7, 0, TAU, 24, col, line, true)
			c.draw_arc(at, r * 0.42, 0, TAU, 20, col, line, true)
			c.draw_line(at + Vector2(r * 0.7, 0), at + Vector2(r * 1.0, r * 0.5), col, line)
		"timer":
			c.draw_arc(at, r * 0.8, 0, TAU, 28, col, line, true)
			c.draw_line(at, at + Vector2(0, -r * 0.55), col, line)
			c.draw_line(at, at + Vector2(r * 0.4, r * 0.2), col, line)
			c.draw_rect(Rect2(at + Vector2(-r * 0.15, -r * 1.0), Vector2(r * 0.3, r * 0.16)), col)
		"gel":
			c.draw_rect(Rect2(at + Vector2(-r * 0.45, -r * 0.8), Vector2(r * 0.9, r * 1.6)), col, false, line)
			c.draw_rect(Rect2(at + Vector2(-r * 0.45, -r * 0.1), Vector2(r * 0.9, r * 0.9)), Color(col.r, col.g, col.b, 0.5))
			c.draw_rect(Rect2(at + Vector2(-r * 0.25, -r * 1.0), Vector2(r * 0.5, r * 0.2)), col)
		"detonator":
			c.draw_rect(Rect2(at + Vector2(-r * 0.8, -r * 0.2), Vector2(r * 1.6, r * 0.9)), col, false, line)
			c.draw_circle(at + Vector2(0, -r * 0.5), r * 0.35, col)
			c.draw_line(at + Vector2(0, -r * 0.2), at + Vector2(0, -r * 0.1), col, line)
		"keycard":
			c.draw_rect(Rect2(at + Vector2(-r * 0.9, -r * 0.55), Vector2(r * 1.8, r * 1.1)), col, false, line)
			c.draw_rect(Rect2(at + Vector2(-r * 0.7, -r * 0.3), Vector2(r * 0.5, r * 0.4)), col)
			c.draw_line(at + Vector2(-r * 0.1, r * 0.3), at + Vector2(r * 0.7, r * 0.3), col, line)
		"scrap":
			c.draw_polyline(PackedVector2Array([at + Vector2(-r * 0.7, -r * 0.2), at + Vector2(-r * 0.2, -r * 0.8), at + Vector2(r * 0.6, -r * 0.5), at + Vector2(r * 0.8, r * 0.3), at + Vector2(0, r * 0.8), at + Vector2(-r * 0.7, r * 0.5), at + Vector2(-r * 0.7, -r * 0.2)]), col, line, true)
			c.draw_circle(at + Vector2(-r * 0.05, 0), r * 0.22, col)
		"mega_bomb":
			for i in range(3):
				c.draw_rect(Rect2(at + Vector2(-r * 0.8 + i * r * 0.55, -r * 0.2), Vector2(r * 0.4, r * 0.95)), Color(0.4, 1.0, 0.45), false, line)
			c.draw_rect(Rect2(at + Vector2(-r * 0.9, -r * 0.8), Vector2(r * 1.8, r * 0.55)), col, false, line)
			c.draw_line(at + Vector2(-r * 0.4, -r * 0.52), at + Vector2(r * 0.4, -r * 0.52), Color(1, 0.2, 0.15), line)
		_:
			c.draw_circle(at, r * 0.5, col)


# ── screens: title, death, win ───────────────────────────────────────────────

func hide_all_screens() -> void:
	_clear(_screen)
	_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if modal_open:
		close_modal()


func _dim(alpha: float) -> ColorRect:
	_clear(_screen)
	_screen.mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.color = Color(0.0, 0.01, 0.015, alpha)
	dim.modulate.a = 0.0
	_screen.add_child(dim)
	_to(dim, "modulate:a", 1.0, 0.6)
	return dim


func show_title(can_continue: bool) -> void:
	playing = false
	_pad.visible = false
	_dim(0.9)
	var box := VBoxContainer.new()
	box.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 18)
	_screen.add_child(box)
	var t := Label.new()
	t.text = "PROJECT OVERRIDE"
	t.add_theme_font_size_override("font_size", 58)
	t.add_theme_color_override("font_color", Color(0.95, 0.25, 0.2))
	t.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	t.add_theme_constant_override("outline_size", 8)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(t)
	var buttons: Array = [["NEW GAME", func(): start_pressed.emit()]]
	if can_continue:
		buttons.push_front(["CONTINUE", func(): continue_pressed.emit()])
	for bt in buttons:
		var row := HBoxContainer.new()
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		row.add_child(_button(bt[0], bt[1]))
		box.add_child(row)
	t.pivot_offset = Vector2(450, 35)
	t.scale = Vector2.ONE * 1.2
	t.modulate.a = 0.0
	_to(t, "modulate:a", 1.0, 0.5)
	_to(t, "scale", Vector2.ONE, 0.6, 0.0, true)


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(300, 60)
	b.add_theme_font_size_override("font_size", 20)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.1, 0.04, 0.04, 0.85)
	sb.border_color = Color(0.9, 0.3, 0.25)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(8)
	b.add_theme_stylebox_override("normal", sb)
	var sh := sb.duplicate() as StyleBoxFlat
	sh.bg_color = Color(0.25, 0.08, 0.07, 0.95)
	b.add_theme_stylebox_override("hover", sh)
	b.add_theme_stylebox_override("pressed", sh)
	b.add_theme_color_override("font_color", INK)
	b.pressed.connect(cb)
	return b


func show_death() -> void:
	playing = false
	_pad.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_dim(0.88)
	var b := _make_screen_glyph("retry", func(): retry_pressed.emit())
	b.modulate.a = 0.0
	_to(b, "modulate:a", 1.0, 0.8, 0.8)


func show_win() -> void:
	playing = false
	_pad.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var p: Dictionary = Data.PAPERS["p_end"]
	show_paper(p.title, p.body, func():
		_dim(0.92)
		_make_screen_glyph("play", func(): restart_pressed.emit()))


func _make_screen_glyph(kind: String, cb: Callable) -> Control:
	var vp := _vp()
	var b := Control.new()
	b.size = Vector2(120, 120)
	b.position = vp * 0.5 - Vector2(60, 60)
	b.mouse_filter = Control.MOUSE_FILTER_STOP
	b.draw.connect(func():
		b.draw_circle(Vector2(60, 60), 54.0, Color(0, 0, 0, 0.5))
		b.draw_arc(Vector2(60, 60), 54.0, 0, TAU, 48, Color(1, 1, 1, 0.9), 3.0, true)
		b.draw_set_transform(Vector2(60, 60), 0.0, Vector2(1.4, 1.4))
		if kind == "retry":
			b.draw_arc(Vector2.ZERO, 16, PI * 0.25, PI * 1.9, 24, Color.WHITE, 3.0, true)
			b.draw_polyline(PackedVector2Array([Vector2(10, -20), Vector2(18, -10), Vector2(6, -8)]), Color.WHITE, 3.0, true)
		else:
			b.draw_colored_polygon(PackedVector2Array([Vector2(-8, -14), Vector2(14, 0), Vector2(-8, 14)]), Color.WHITE)
		b.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE))
	b.gui_input.connect(func(e: InputEvent):
		if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed:
			cb.call())
	_screen.add_child(b)
	return b
