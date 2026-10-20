class_name Cutscene
extends CanvasLayer
## Plays a short cinematic made of shots, the way the console fighting games stage a domain or a finisher: full-screen 2D cut-ins
## (hand sign, eye close-up, the grin), 3D camera shots on the real characters, white flashes, black frames, radial speed lines and
## the "cut web" overlay. While it runs both fighters are frozen and the HUD and touch buttons are hidden.
##
## A shot is a Dictionary: {"t": seconds, "img": path, "zoom": [from, to], "pivot": Vector2 (0..1), "tint": Color,
## "cam": Callable(k) -> [position, look_at], "start": Callable(), "flash": Color, "lines": Color, "web": true, "black": true, "sparkle": Color}

signal finished

var camera: ThirdPersonCamera
var freeze: Array[Node] = []
var hide_layers: Array[CanvasLayer] = []
var playing := false
var _img: TextureRect
var _tint: ColorRect
var _flash: ColorRect
var _fx: Control
var _shots: Array = []
var _i := -1
var _t := 0.0
var _lines := Color(0, 0, 0, 0)
var _web := false
var _web_seed := 0
var _spark := Color(0, 0, 0, 0)
var _sparks: Array = []

func _ready() -> void:
	layer = 30
	_img = TextureRect.new()
	_img.set_anchors_preset(Control.PRESET_FULL_RECT)
	_img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_img.visible = false
	add_child(_img)
	_tint = ColorRect.new()
	_tint.set_anchors_preset(Control.PRESET_FULL_RECT)
	_tint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tint.color = Color(0, 0, 0, 0)
	add_child(_tint)
	_fx = Control.new()
	_fx.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fx.draw.connect(_draw_fx)
	add_child(_fx)
	_flash = ColorRect.new()
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.color = Color(1, 1, 1, 0)
	add_child(_flash)
	# letterbox bars: cinema feel
	for top in [true, false]:
		var bar := ColorRect.new()
		bar.color = Color.BLACK
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bar.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
		bar.offset_bottom = 46.0 if top else 0.0
		bar.offset_top = 0.0 if top else -46.0
		bar.name = "BarTop" if top else "BarBottom"
		add_child(bar)
	visible = false

func play(shots: Array) -> void:
	_shots = shots
	_i = -1
	playing = true
	visible = true
	for n in freeze:
		if is_instance_valid(n):
			n.set_physics_process(false)
	for l in hide_layers:
		if is_instance_valid(l):
			l.visible = false
	_next()

func _next() -> void:
	_i += 1
	if _i >= _shots.size():
		_end()
		return
	var s: Dictionary = _shots[_i]
	_t = 0.0
	_img.visible = s.has("img")
	if s.has("img"):
		_img.texture = load(s["img"])
		_img.pivot_offset = _img.size * (s.get("pivot", Vector2(0.5, 0.5)) as Vector2)
		_img.modulate = Color.WHITE
	_tint.color = s.get("tint", Color(0, 0, 0, 0))
	if s.get("black", false):
		_tint.color = Color(0, 0, 0, 1)
	_lines = s.get("lines", Color(0, 0, 0, 0))
	_web = s.get("web", false)
	_web_seed = randi()
	_spark = s.get("sparkle", Color(0, 0, 0, 0))
	_sparks.clear()
	if _spark.a > 0.0:
		for k in 90:
			_sparks.append([Vector2(randf(), randf()), randf_range(1.5, 4.5), randf() * TAU, randf_range(0.2, 0.8)])
	if s.has("flash"):
		_flash.color = s["flash"]
		create_tween().tween_property(_flash, "color:a", 0.0, 0.35)
	if s.has("start"):
		(s["start"] as Callable).call()
	_apply(0.0)

func _apply(k: float) -> void:
	var s: Dictionary = _shots[_i]
	if s.has("img"):
		var z: Array = s.get("zoom", [1.0, 1.08])
		_img.scale = Vector2.ONE * lerpf(z[0], z[1], k)
	if s.has("cam") and camera != null:
		var r: Array = (s["cam"] as Callable).call(k)
		camera.set_override(r[0], r[1])
	elif camera != null and not s.has("img") and not s.get("black", false):
		camera.clear_override()

func _process(delta: float) -> void:
	if not playing:
		return
	_t += delta
	var s: Dictionary = _shots[_i]
	var dur: float = s["t"]
	_apply(clampf(_t / dur, 0.0, 1.0))
	_fx.queue_redraw()
	if _t >= dur:
		_next()

func _end() -> void:
	playing = false
	visible = false
	_img.visible = false
	if camera != null:
		camera.clear_override()
	for n in freeze:
		if is_instance_valid(n) and not n.get_meta("stunned", false):
			n.set_physics_process(true)
	for l in hide_layers:
		if is_instance_valid(l):
			l.visible = true
	finished.emit()

func _draw_fx() -> void:
	var vs := _fx.size
	var c := vs * 0.5
	if _lines.a > 0.0:
		var rng := RandomNumberGenerator.new()
		rng.seed = int(_t * 30.0)
		for i in 70:
			var a := rng.randf() * TAU
			var d := Vector2.from_angle(a)
			var r0 := vs.length() * rng.randf_range(0.18, 0.32)
			var r1 := vs.length() * 0.75
			_fx.draw_line(c + d * r0, c + d * r1, Color(_lines.r, _lines.g, _lines.b, _lines.a * rng.randf_range(0.4, 1.0)), rng.randf_range(1.0, 4.0), true)
	if _web:
		var rng2 := RandomNumberGenerator.new()
		rng2.seed = _web_seed
		var n := int(clampf(_t * 40.0, 0.0, 26.0))
		for i in n:
			var p0 := Vector2(rng2.randf() * vs.x, rng2.randf() * vs.y)
			var dir := Vector2.from_angle(rng2.randf() * TAU)
			_fx.draw_line(p0 - dir * vs.x, p0 + dir * vs.x, Color(1, 1, 1, 0.9), rng2.randf_range(1.5, 3.5), true)
			_fx.draw_line(p0 - dir * vs.x, p0 + dir * vs.x, Color(1, 0.2, 0.2, 0.35), 7.0, true)
	if _spark.a > 0.0:
		for sp in _sparks:
			var p: Vector2 = sp[0]
			var q := Vector2(fposmod(p.x + sin(_t * 1.5 + sp[2]) * 0.03, 1.0), fposmod(p.y - _t * sp[3] * 0.15, 1.0)) * vs
			var tw := 0.5 + 0.5 * sin(_t * 9.0 + sp[2])
			_fx.draw_circle(q, sp[1] * (0.6 + tw), Color(_spark.r, _spark.g, _spark.b, _spark.a * tw))
