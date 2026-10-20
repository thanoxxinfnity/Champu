class_name FightControls
extends CanvasLayer
## Touch controls for the fighter (floating stick on the left, six glass buttons on the right) plus WASD/JKL keys for a desktop. Everything ends
## up in `fighter.intent`, the same dictionary the AI fills in. Short taps are held for a few frames so one press always reaches a physics tick.

var fighter: Fighter
var camera: Node3D   ## FightCamera or ThirdPersonCamera (anything with world_dir / orbit)
var _look_id := -1
var _look_last := Vector2.ZERO
var stick := Vector2.ZERO
var _root: Control
var _base: Control
var _knob: Control
var _stick_id := -1
var _origin := Vector2.ZERO
var _until := {}
var _held := {}
const STICK_R := 100.0
const HOLD := 0.12

func _ready() -> void:
	layer = 20
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_base = _disc(STICK_R * 2.0, Color(1, 1, 1, 0.10))
	_base.visible = false
	_root.add_child(_base)
	_knob = _disc(STICK_R * 0.85, Color(1, 1, 1, 0.30))
	_knob.visible = false
	_root.add_child(_knob)
	_btn("light", "PUNCH", Vector2(-170, -150), 86)
	_btn("heavy", "KICK", Vector2(-270, -80), 78)
	_btn("special", "SKILL", Vector2(-120, -260), 78)
	_btn("ultimate", "ULT", Vector2(-250, -240), 72)
	_btn("dodge", "DODGE", Vector2(-380, -150), 70)
	_btn("block", "GUARD", Vector2(-380, -250), 70, true)
	_btn("fly", "FLY", Vector2(-90, -380), 66)
	_btn("domain", "DOMAIN", Vector2(-200, -380), 74)

func _disc(d: float, c: Color) -> Control:
	var p := Panel.new()
	p.size = Vector2(d, d)
	var sb := StyleBoxFlat.new()
	sb.bg_color = c
	sb.set_corner_radius_all(int(d * 0.5))
	sb.set_border_width_all(2)
	sb.border_color = Color(1, 1, 1, 0.35)
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

func _btn(id: String, text: String, off: Vector2, d: float, hold := false) -> void:
	var b := Button.new()
	b.name = id.capitalize()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.size = Vector2(d, d)
	b.add_theme_font_size_override("font_size", 15)
	var n := StyleBoxFlat.new()
	n.bg_color = Color(0.1, 0.1, 0.13, 0.55)
	n.set_corner_radius_all(int(d * 0.5))
	n.set_border_width_all(2)
	n.border_color = Color(1, 1, 1, 0.4)
	var h := n.duplicate() as StyleBoxFlat
	h.bg_color = Color(UiKit.ACCENT.r, UiKit.ACCENT.g, UiKit.ACCENT.b, 0.75)
	for s in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(s, h if s == "pressed" else n)
	b.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	b.offset_left = off.x
	b.offset_top = off.y
	b.offset_right = off.x + d
	b.offset_bottom = off.y + d
	b.button_down.connect(func(): _press(id, hold, true))
	b.button_up.connect(func(): _press(id, hold, false))
	_root.add_child(b)

func _press(id: String, hold: bool, down: bool) -> void:
	if hold:
		_held[id] = down
	elif down:
		_until[id] = Time.get_ticks_msec() / 1000.0 + HOLD

func _input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		if e.pressed and _stick_id == -1 and e.position.x < get_viewport().get_visible_rect().size.x * 0.45:
			_stick_id = e.index
			_origin = e.position
			_base.position = _origin - _base.size * 0.5
			_knob.position = _origin - _knob.size * 0.5
			_base.visible = true
			_knob.visible = true
		elif e.pressed and _look_id == -1 and e.position.x >= get_viewport().get_visible_rect().size.x * 0.45 and e.position.y < get_viewport().get_visible_rect().size.y * 0.5:
			_look_id = e.index
			_look_last = e.position
		elif not e.pressed and e.index == _look_id:
			_look_id = -1
		elif not e.pressed and e.index == _stick_id:
			_stick_id = -1
			stick = Vector2.ZERO
			_base.visible = false
			_knob.visible = false
	elif e is InputEventScreenDrag and e.index == _look_id:
		var dl: Vector2 = e.position - _look_last
		_look_last = e.position
		if camera != null and camera.has_method("orbit"):
			camera.call("orbit", dl.x * 0.006, dl.y * 0.004)
	elif e is InputEventScreenDrag and e.index == _stick_id:
		var d: Vector2 = (e.position - _origin).limit_length(STICK_R)
		stick = d / STICK_R
		_knob.position = _origin + d - _knob.size * 0.5

func tap(id: String) -> void:
	_until[id] = Time.get_ticks_msec() / 1000.0 + HOLD

func _process(_delta: float) -> void:
	if fighter == null:
		return
	var now := Time.get_ticks_msec() / 1000.0
	var s := stick
	var kb := Vector2(Input.get_axis("ui_left", "ui_right"), Input.get_axis("ui_down", "ui_up"))
	if Input.is_key_pressed(KEY_A): kb.x -= 1.0
	if Input.is_key_pressed(KEY_D): kb.x += 1.0
	if Input.is_key_pressed(KEY_W): kb.y += 1.0
	if Input.is_key_pressed(KEY_S): kb.y -= 1.0
	if kb.length() > 0.1:
		s = kb.limit_length(1.0)
	var mv: Vector2 = camera.call("world_dir", s) if camera != null else Vector2(s.x, -s.y)
	var i := fighter.intent
	i["move"] = mv
	i["light"] = _until.get("light", 0.0) > now or Input.is_key_pressed(KEY_J)
	i["heavy"] = _until.get("heavy", 0.0) > now or Input.is_key_pressed(KEY_K)
	i["special"] = _until.get("special", 0.0) > now or Input.is_key_pressed(KEY_L)
	i["ultimate"] = _until.get("ultimate", 0.0) > now or Input.is_key_pressed(KEY_I)
	i["dodge"] = _until.get("dodge", 0.0) > now or Input.is_key_pressed(KEY_SPACE)
	i["block"] = _held.get("block", false) or Input.is_key_pressed(KEY_SHIFT)
	i["fly"] = _until.get("fly", 0.0) > now or Input.is_key_pressed(KEY_F)
	i["domain"] = _until.get("domain", 0.0) > now or Input.is_key_pressed(KEY_U)
