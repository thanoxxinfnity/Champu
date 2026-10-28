class_name LoadingScreen
extends CanvasLayer
## The loading animation, on the game's own topic: the hero you picked (the real 3D model, with the real jetpack and flame) flies over an anime sunset city with a
## contrail behind it, pastel blocks fall out of the sky, and the hero's gauntlet shoots them to sparkles. The progress bar is the jetpack's fuel gauge.
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
const BLOCK_COLORS := [Color(0.62, 0.7, 0.8), Color(0.2, 0.9, 0.55), Color(0.5, 0.85, 1.0), Color(1.0, 0.6, 0.15), Color(1.0, 0.45, 0.62), Color(0.8, 0.6, 1.0)]

var progress := 0.0
var shown := 0.0
var label := "Building the world"
var hero_id := "outlaw"
var _root: Control
var _t := 0.0
var _tip := 0
var _tip_t := 0.0
var _active := false
var _vp: SubViewport
var _avatar: Avatar
var _blocks: Array = []             # [x 0..1, y 0..1, speed, size, spin, colour index, depth]
var _sparks: Array = []             # [pos, vel, life, colour]
var _trail: Array = []              # [pos, life]
var _beam_t := 0.0
var _beam_to := Vector2.ZERO
var _shoot_t := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	layer = 60
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.draw.connect(_draw_all)
	add_child(_root)
	_rng.seed = 5
	for i in 16:
		_blocks.append([_rng.randf_range(0.02, 0.86), _rng.randf(), _rng.randf_range(0.12, 0.3), _rng.randf_range(0.5, 1.0), _rng.randf() * TAU, _rng.randi() % BLOCK_COLORS.size(), _rng.randf()])
	_build_stage()
	visible = false
	set_process(false)


## The hero's own little 3D world: a sun-coloured light, the avatar in its jet pose seen from the side, rendered into a transparent viewport.
func _build_stage() -> void:
	_vp = SubViewport.new()
	_vp.size = Vector2i(720, 540)
	_vp.transparent_bg = true
	_vp.own_world_3d = true
	_vp.msaa_3d = Viewport.MSAA_2X
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(_vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.85, 0.8, 0.95)
	env.ambient_light_energy = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	_vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, 60, 0)
	sun.light_color = Color(1.0, 0.9, 0.78)
	sun.light_energy = 1.4
	_vp.add_child(sun)
	var rim := OmniLight3D.new()
	rim.position = Vector3(-2.0, 2.0, 2.0)
	rim.light_color = Color(1.0, 0.55, 0.8)
	rim.light_energy = 2.0
	rim.omni_range = 8.0
	_vp.add_child(rim)
	var cam := Camera3D.new()
	cam.fov = 32.0
	cam.position = Vector3(5.2, 1.0, 0.0)
	_vp.add_child(cam)
	cam.look_at(Vector3(0, 0.95, 0))
	cam.make_current()


func open(hero: String) -> void:
	hero_id = hero
	if _avatar != null:
		_avatar.queue_free()
	_avatar = Avatar.new()
	_avatar.outline = false
	_vp.add_child(_avatar)
	_avatar.setup(hero)
	# upright, hovering on the jetpack's flame (the flat "superman" flight pose stretched the generated heroes' meshes)
	_avatar.jetting = false
	_avatar.airborne = false
	_avatar.thrust = 1.0
	_avatar.ground_speed = 0.0
	_avatar.show_blob = false
	progress = 0.0
	shown = 0.0
	_tip = randi() % TIPS.size()
	_tip_t = 0.0
	_trail.clear()
	_sparks.clear()
	_beam_t = 0.0
	_shoot_t = 1.2
	_active = true
	visible = true
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	set_process(true)
	_root.queue_redraw()


func set_progress(p: float, text := "") -> void:
	progress = clampf(p, 0.0, 1.0)
	if text != "":
		label = text


func close() -> void:
	_active = false
	visible = false
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
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
	_fall(delta)
	if _avatar != null:
		_avatar.position.y = sin(_t * 2.1) * 0.1
		_avatar.rotation.z = sin(_t * 1.3) * 0.06
	_root.queue_redraw()


func _block_pos(b: Array, w: float, h: float) -> Vector2:
	# b[1] is how far down the block is (0 = just above the top, 1 = gone at the bottom); it drifts a little sideways as it falls.
	# (It used to be a looping function of time: blocks jumped from one edge to the other and a shot block reappeared mid-air.)
	var y := float(b[1])
	var x := float(b[0]) + y * 0.12
	return Vector2(x * w, -60.0 + y * (h * 0.86 + 120.0))


## Blocks fall (a little faster as they go, like real weight) and come back from above the screen at a new place.
func _fall(delta: float) -> void:
	for b in _blocks:
		b[2] = minf(float(b[2]) + delta * 0.12, 0.75)
		b[1] = float(b[1]) + float(b[2]) * delta
		if float(b[1]) > 1.05:
			_respawn_block(b)


func _respawn_block(b: Array) -> void:
	b[0] = _rng.randf_range(0.02, 0.86)
	b[1] = -_rng.randf_range(0.0, 0.35)
	b[2] = _rng.randf_range(0.12, 0.3)


func _draw_cube(c: CanvasItem, p: Vector2, s: float, rot: float, col: Color) -> void:
	var h := s * 0.5
	var pts := PackedVector2Array()
	for k in 4:
		var a := rot + float(k) * PI * 0.5 + PI * 0.25
		pts.append(p + Vector2(cos(a), sin(a)) * h * 1.414)
	c.draw_colored_polygon(pts, col)
	var inner := PackedVector2Array()
	for k in 4:
		var a2 := rot + float(k) * PI * 0.5 + PI * 0.25
		inner.append(p + Vector2(cos(a2), sin(a2)) * h * 0.8)
	c.draw_colored_polygon(inner, col.lightened(0.28))
	pts.append(pts[0])
	c.draw_polyline(pts, UIKit.INK, maxf(2.0, s * 0.09))


func _draw_all() -> void:
	var w := _root.size.x
	var h := _root.size.y
	var s := h / 720.0
	var c := _root
	# the sky and the sun
	c.draw_polygon(PackedVector2Array([Vector2(0, 0), Vector2(w, 0), Vector2(w, h), Vector2(0, h)]),
		PackedColorArray([Color(0.2, 0.25, 0.7), Color(0.28, 0.3, 0.78), Color(1.0, 0.7, 0.62), Color(1.0, 0.82, 0.62)]))
	var sun := Vector2(w * 0.8, h * 0.58)
	for k in 5:
		c.draw_circle(sun, h * (0.34 - float(k) * 0.045), Color(1.0, 0.92, 0.7, 0.12 + 0.07 * float(k)))
	for i in 12:
		var a := float(i) / 12.0 * TAU + _t * 0.06
		c.draw_colored_polygon(PackedVector2Array([sun, sun + Vector2(cos(a), sin(a)) * w, sun + Vector2(cos(a + 0.09), sin(a + 0.09)) * w]), Color(1, 0.95, 0.8, 0.07))
	# soft clouds
	for i in 7:
		var cx := fmod(float(i) * 0.19 * w - _t * (10.0 + 5.0 * float(i % 3)) + w * 2.0, w + 360.0) - 180.0
		var cy := h * (0.1 + 0.12 * float(i % 4))
		for j in 5:
			c.draw_circle(Vector2(cx + float(j) * 40.0 * s, cy + sin(float(j) * 1.3) * 9.0 * s), (34.0 - float(j % 3) * 7.0) * s, Color(1, 1, 1, 0.5))
	# three layers of city, scrolling left at different speeds (the hero flies right)
	var layers := [[0.62, 0.32, 18.0, Color(0.5, 0.42, 0.8, 0.8), 7], [0.72, 0.28, 42.0, Color(0.38, 0.3, 0.66, 0.92), 11], [0.86, 0.3, 90.0, Color(0.22, 0.17, 0.45, 1.0), 17]]
	for li in layers.size():
		var L: Array = layers[li]
		var base: float = h * float(L[0]) + h * 0.2
		var bw := 74.0 * s * (1.0 + 0.4 * float(li))
		var off := fmod(_t * float(L[2]) * s, bw * 20.0)
		for i in 26:
			var idx := i + int(floor(off / bw))
			var bx := float(idx) * bw - off
			var seed_v := fmod(float(idx * int(L[4]) % 23) * 0.6180339 + float(li), 1.0)
			var bh := h * (0.12 + float(L[1]) * seed_v) * (1.0 if li < 2 else 1.2)
			var col: Color = L[3]
			c.draw_rect(Rect2(bx, base - bh, bw - 3.0, bh + h), col)
			if li == 2:
				for ky in int(bh / (24.0 * s)):
					for kx in 3:
						if fmod(float(idx * 7 + ky * 5 + kx * 3), 5.0) < 2.0:
							c.draw_rect(Rect2(bx + 8.0 * s + float(kx) * 20.0 * s, base - bh + 8.0 * s + float(ky) * 24.0 * s, 9.0 * s, 12.0 * s), Color(1.0, 0.9, 0.5, 0.9))
				if idx % 5 == 0:
					c.draw_rect(Rect2(bx + 6.0 * s, base - bh - 4.0 * s, bw - 15.0 * s, 4.0 * s), [UIKit.PINK, UIKit.SKY, UIKit.YELLOW][idx % 3])
			elif idx % 3 == 0:
				c.draw_rect(Rect2(bx + bw * 0.45, base - bh - 18.0 * s, 2.5 * s, 18.0 * s), col)
	# falling blocks, far ones small and pale
	for b in _blocks:
		var p := _block_pos(b, w, h)
		var sz := (22.0 + 40.0 * float(b[3])) * s
		var dep := float(b[6])
		var colb: Color = BLOCK_COLORS[int(b[5])]
		c.draw_line(p + Vector2(-0.18, -1.0) * sz * 2.4, p, Color(1, 1, 1, 0.18 + 0.1 * dep), sz * 0.22)
		_draw_cube(c, p, sz, float(b[4]) + _t * (0.6 + float(b[3])), colb)
	# the hero: contrail, then the 3D model, then the gauntlet beam
	var hr := Rect2(w * 0.34 - w * 0.2, h * 0.4 - h * 0.34, w * 0.4, h * 0.68)
	var hc := hr.get_center() + Vector2(0, sin(_t * 2.1) * 6.0 * s)
	_trail.append([hc + Vector2(-hr.size.x * 0.2, hr.size.y * 0.1 + sin(_t * 2.1) * 6.0 * s), 1.0])
	for tr in _trail:
		tr[0] = (tr[0] as Vector2) + Vector2(-170.0 * s * get_process_delta_time(), 0.0)
		tr[1] = float(tr[1]) - get_process_delta_time() * 0.9
	while not _trail.is_empty() and float(_trail[0][1]) <= 0.0:
		_trail.pop_front()
	for tr in _trail:
		var k := float(tr[1])
		c.draw_circle(tr[0], (6.0 + 22.0 * (1.0 - k)) * s, Color(1, 0.93, 0.9, 0.5 * k))
	c.draw_texture_rect(_vp.get_texture(), hr, false)
	# every 2.4 s the gauntlet shoots the nearest block: a beam, then sparkles
	_shoot_t -= get_process_delta_time()
	if _shoot_t <= 0.0:
		_shoot_t = 2.4
		var best := -1
		var bd := 1.0e9
		for i in _blocks.size():
			var bp := _block_pos(_blocks[i], w, h)
			var d := bp.distance_to(hc + Vector2(hr.size.x * 0.2, 0))
			if bp.x > hc.x and d < bd and bp.y > 0.0 and bp.y < h * 0.8:
				bd = d
				best = i
		if best >= 0:
			_beam_to = _block_pos(_blocks[best], w, h)
			_beam_t = 0.22
			var colb2: Color = BLOCK_COLORS[int(_blocks[best][5])]
			for k in 14:
				_sparks.append([_beam_to, Vector2.from_angle(_rng.randf() * TAU) * _rng.randf_range(60.0, 260.0) * s, 0.7, colb2])
			_respawn_block(_blocks[best])            # it comes back from above the screen
	if _beam_t > 0.0:
		_beam_t -= get_process_delta_time()
		var from := hc + Vector2(hr.size.x * 0.17, -hr.size.y * 0.02)
		c.draw_line(from, _beam_to, UIKit.INK, 14.0 * s)
		c.draw_line(from, _beam_to, Color(0.5, 0.95, 1.0), 8.0 * s)
		c.draw_line(from, _beam_to, Color(1, 1, 1), 3.0 * s)
		c.draw_circle(_beam_to, 26.0 * s * (_beam_t / 0.22 + 0.4), Color(1, 1, 1, 0.8))
	for sp in _sparks:
		sp[0] = (sp[0] as Vector2) + (sp[1] as Vector2) * get_process_delta_time()
		sp[1] = (sp[1] as Vector2) + Vector2(0, 380.0 * s) * get_process_delta_time()
		sp[2] = float(sp[2]) - get_process_delta_time()
		if float(sp[2]) > 0.0:
			var sc: Color = sp[3]
			c.draw_rect(Rect2((sp[0] as Vector2) - Vector2(5, 5) * s, Vector2(10, 10) * s), Color(sc.r, sc.g, sc.b, float(sp[2]) * 1.4))
	while not _sparks.is_empty() and float(_sparks[0][2]) <= 0.0:
		_sparks.pop_front()
	# the logo, top-left
	UIKit.draw_text(c, "CITY SHIFTER", Vector2(28, 56), int(50 * s), UIKit.YELLOW, true, HORIZONTAL_ALIGNMENT_LEFT, w * 0.4)
	UIKit.draw_text(c, "SKY SIEGE", Vector2(30, 92 * s), int(26 * s), UIKit.PINK, true, HORIZONTAL_ALIGNMENT_LEFT, w * 0.3)
	# the hero's name tag, bottom-left
	var info: Dictionary = Data.CAST.get(hero_id, Data.CAST["outlaw"])
	var tag := Rect2(24, h - 150 * s, 330 * s, 74 * s)
	c.draw_style_box(UIKit.box(Color(0.99, 0.95, 0.88, 0.95), UIKit.INK, 18, 4, 0), tag)
	HeroCard.draw_art(c, hero_id, Rect2(tag.position + Vector2(6, 6) * s, Vector2(62, 62) * s), 12.0 * s, Color.WHITE, Rect2(0.12, 0.02, 0.76, 0.57))
	UIKit.draw_text(c, String(info.name), tag.position + Vector2(80, 30) * s, int(24 * s), UIKit.PINK, true, HORIZONTAL_ALIGNMENT_LEFT, tag.size.x - 90.0 * s)
	UIKit.draw_text(c, String(info.get("title", "")), tag.position + Vector2(80, 56) * s, int(18 * s), UIKit.INK, false, HORIZONTAL_ALIGNMENT_LEFT, tag.size.x - 90.0 * s)
	# the fuel gauge = the progress bar
	var bw2 := minf(w * 0.56, 760.0)
	var bar := Rect2(w * 0.5 - bw2 * 0.5 + 60.0 * s, h - 138.0 * s, bw2, 34.0 * s)
	c.draw_style_box(UIKit.box(Color(0.08, 0.05, 0.2, 0.92), UIKit.INK, 17, 5, 0), bar)
	var fw := maxf(0.0, (bar.size.x - 10.0) * shown)
	if fw > 2.0:
		var fr := Rect2(bar.position + Vector2(5, 5), Vector2(maxf(fw, 24.0), bar.size.y - 10.0))
		c.draw_style_box(UIKit.box(Color(1.0, 0.62, 0.15), Color(1.0, 0.62, 0.15), 12, 0, 0), fr)
		c.draw_rect(Rect2(fr.position + Vector2(8, 3), Vector2(maxf(fr.size.x - 16.0, 0.0), 5)), Color(1, 1, 1, 0.45))
		for i in int(fr.size.x / 38.0):
			var sx := fr.position.x + fmod(float(i) * 38.0 + _t * 60.0, maxf(fr.size.x - 14.0, 1.0))
			c.draw_line(Vector2(sx, fr.end.y - 3.0), Vector2(sx + 12.0, fr.position.y + 3.0), Color(1, 1, 1, 0.25), 6.0)
		UIKit.draw_icon(c, "flame", Vector2(fr.end.x + 2.0, bar.get_center().y + sin(_t * 14.0) * 2.0), 40.0 * s, Color(1.0, 0.85, 0.3))
	UIKit.draw_icon(c, "bolt", bar.position + Vector2(-26.0 * s, bar.size.y * 0.5), 38.0 * s, UIKit.YELLOW)
	UIKit.draw_text(c, "%d%%" % int(round(shown * 100.0)), Vector2(bar.position.x, bar.end.y + 30.0 * s), int(26 * s), UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_RIGHT, bar.size.x)
	UIKit.draw_text(c, "JETPACK FUEL  ·  " + label + ".".repeat(int(_t * 3.0) % 4), Vector2(bar.position.x, bar.end.y + 30.0 * s), int(20 * s), UIKit.CREAM, false, HORIZONTAL_ALIGNMENT_LEFT, bar.size.x * 0.7)
	# the tip
	var tw := minf(w * 0.84, 980.0)
	var tip_r := Rect2(w * 0.5 - tw * 0.5, h - 70.0 * s, tw, 54.0 * s)
	c.draw_style_box(UIKit.box(Color(0.99, 0.95, 0.88, 0.95), UIKit.INK, 16, 4, 0), tip_r)
	UIKit.draw_icon(c, "star", tip_r.position + Vector2(28, 27 * s), 26.0 * s, UIKit.ORANGE)
	UIKit.draw_wrapped(c, String(TIPS[_tip]), tip_r.position + Vector2(54, 22 * s), int(17 * s), UIKit.INK, tw - 72.0, 2)
