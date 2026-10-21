class_name FightControls
extends CanvasLayer
## Touch controls for the fighter (floating stick on the left, six glass buttons on the right) plus WASD/JKL keys for a desktop. Everything ends
## up in `fighter.intent`, the same dictionary the AI fills in. Short taps are held for a few frames so one press always reaches a physics tick.

var fighter: Fighter
var moveset := "gojo":
	set(v):
		moveset = v
		_relabel()
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
	_btn("light", "fist", Vector2(-170, -150), 46)
	_btn("heavy", "foot", Vector2(-270, -80), 40)
	_btn("special", "red", Vector2(-120, -260), 40)
	_btn("skill2", "blue", Vector2(-330, -360), 36)
	_btn("ultimate", "purple", Vector2(-250, -240), 38)
	_btn("dodge", "dash", Vector2(-380, -150), 36)
	_btn("block", "shield", Vector2(-380, -250), 36, true)
	_btn("fly", "fly", Vector2(-90, -380), 34)
	_btn("up", "up", Vector2(-86, -462), 28, true)       # shown only in flight: hold to climb / dive
	_btn("down", "down", Vector2(-160, -462), 28, true)
	_btn("domain", "void", Vector2(-200, -380), 38)
	_relabel()

const GLYPHS := {
	"gojo": {"special": "red", "skill2": "blue", "ultimate": "purple", "domain": "void"},
	"sukuna": {"special": "dismantle", "skill2": "cleave", "ultimate": "fuga", "domain": "shrine"},
}
const TINTS := {"special": Color(1.0, 0.35, 0.3), "skill2": Color(0.35, 0.6, 1.0), "ultimate": Color(0.75, 0.45, 1.0), "domain": Color(1.0, 0.85, 0.4)}
const COSTS := {"special": 35.0, "skill2": 25.0, "ultimate": 100.0, "domain": 100.0}

func _relabel() -> void:
	if _root == null:
		return
	for id in GLYPHS.get(moveset, {}):
		var b := _root.get_node_or_null(id.capitalize()) as GlyphButton
		if b != null:
			b.glyph = GLYPHS[moveset][id]
			b.tint = TINTS[id]
			b.queue_redraw()

func _process_labels() -> void:
	# energy rings on the technique buttons; the ultimate becomes the low-health super (200% Purple / World-Cutting Slash)
	if fighter == null or _root == null:
		return
	for id in COSTS:
		var b := _root.get_node_or_null(id.capitalize()) as GlyphButton
		if b != null:
			b.set_fill(clampf(fighter.energy / COSTS[id], 0.0, 1.0))
	var u := _root.get_node_or_null("Ultimate") as GlyphButton
	if u != null:
		var want: String = "super" if fighter.health < Fighter.MAX_HEALTH * 0.5 else GLYPHS.get(moveset, {}).get("ultimate", "purple")
		if u.glyph != want:
			u.glyph = want
			u.queue_redraw()

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

func _btn(id: String, glyph: String, off: Vector2, r: float, hold := false) -> void:
	var b := GlyphButton.new()
	b.name = id.capitalize()
	b.glyph = glyph
	b.radius = r
	b.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	b.offset_left = off.x
	b.offset_top = off.y
	b.offset_right = off.x + r * 2.0
	b.offset_bottom = off.y + r * 2.0
	b.pressed_down.connect(func(): _press(id, hold, true))
	b.released.connect(func(): _press(id, hold, false))
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
	var climb := 0.0
	if _held.get("up", false) or Input.is_key_pressed(KEY_E): climb += 1.0
	if _held.get("down", false) or Input.is_key_pressed(KEY_Q): climb -= 1.0
	i["climb"] = climb
	for id in ["Up", "Down"]:
		var b := _root.get_node_or_null(id)
		if b != null:
			b.visible = fighter.flying
	i["domain"] = _until.get("domain", 0.0) > now or Input.is_key_pressed(KEY_U)
	i["skill2"] = _until.get("skill2", 0.0) > now or Input.is_key_pressed(KEY_O)
	_process_labels()
