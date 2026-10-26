class_name Intro
extends Node3D
## "The Last Bus": the opening cut-scene. The player's whole group rides the last night bus into Harrow Cove; the lighthouse bell rings by itself, a car is
## thrown across the road and the bus goes over. It is built from boxes and the real characters, filmed with a wide-lens camera: letterbox bars, a soft
## focus away from the subject (the post shader's `dof`), slow dollies, rain and street lamps streaking past the windows. Any tap skips it.
## `await Intro.play(game, char_id)` returns when it is over (or skipped); the scene is freed.

var game: Game
var cam: Camera3D
var _skipped := false
var _t := 0.0
var _speed := 14.0                 # how fast the world slides past the windows (m/s)
var _lamps: Array[Node3D] = []
var _streaks: Array[MeshInstance3D] = []
var _flick := 0.0
var _red := 0.0
var _shake := 0.0
var _cabin_light: OmniLight3D
var _people: Array[CharacterView] = []
var _layer: CanvasLayer
var _caption: Label
var _bar_top: ColorRect
var _bar_bot: ColorRect
var _fade: ColorRect
var _flash: ColorRect
var _hint: Label
var _car: Node3D
var _skip_ready := 0.0


static func play(g: Game, char_id: String) -> void:
	var it := Intro.new()
	it.game = g
	g.add_child(it)
	await it._run(char_id)
	it.queue_free()


func _run(char_id: String) -> void:
	position = Vector3(600, 0, 600)
	_build_ui()
	_build_bus()
	_seat_people(char_id)
	cam = Camera3D.new()
	cam.fov = 52.0
	cam.near = 0.05
	cam.far = 120.0
	add_child(cam)
	cam.make_current()
	var low := game.low_gfx
	game.hud.set_cinema(0.0 if low else 1.0)
	game.sfx.start_ambience()
	game.sfx.set_rain(0.7)
	await _fade_to(0.0, 1.0)

	# 1 — the window: a face in the glass, lamps streaking by
	_say("11:40 PM.  The last bus to Harrow Cove.")
	_cam_move(Vector3(0.45, 1.6, -0.6), Vector3(-0.95, 1.2, 1.0), Vector3(0.05, 1.55, -0.45), Vector3(-0.95, 1.2, 1.0), 5.0, 48.0)
	await _wait(2.8)
	_say("Eight strangers.  One road in.")
	await _wait(2.4)

	# 2 — over the driver's shoulder: the road, the fog, the sign
	_say("")
	_cam_move(Vector3(-0.2, 1.45, -3.2), Vector3(0.3, 1.2, -9.0), Vector3(-0.35, 1.4, -3.5), Vector3(0.6, 1.1, -10.0), 5.5, 60.0)
	_spawn_sign()
	await _wait(1.2)
	_say("DRIVER:  …all lines are down. Don't ask me why.")
	await _wait(2.9)
	_say("DRIVER:  The lighthouse bell has been ringing since dusk. Nobody rings that bell.")
	await _wait(2.6)

	# 3 — dolly down the aisle through the passengers
	_say("")
	_cam_move(Vector3(0.0, 1.35, 3.9), Vector3(0.0, 1.1, -3.0), Vector3(0.0, 1.3, -1.2), Vector3(0.0, 1.1, -4.0), 5.0, 56.0)
	await _wait(2.4)
	_say("Something is wrong with the mist.")
	await _wait(2.4)

	# 4 — the bell: the lights go red, everyone looks up
	game.sfx.play("bell", -2.0, 0.7)
	_red = 1.0
	_say("")
	_cam_move(Vector3(0.3, 1.55, -0.3), Vector3(-0.95, 1.2, 1.0), Vector3(0.2, 1.5, -0.2), Vector3(-0.95, 1.2, 1.0), 4.2, 44.0)
	await _wait(2.6)
	_say("DRIVER:  What is that…  Hold on —  HOLD ON!")
	await _wait(1.8)

	# 5 — the windshield: a car is thrown out of the fog
	_say("")
	_throw_car()
	_cam_move(Vector3(0.0, 1.5, -2.6), Vector3(0.0, 1.5, -12.0), Vector3(0.0, 1.45, -2.9), Vector3(0.0, 1.9, -6.0), 3.4, 64.0)
	await _wait(3.1)
	_flash.color.a = 1.0
	game.sfx.play("thunder", 2.0, 0.9)
	game.sfx.play("hit", 2.0, 0.6)
	_shake = 1.0
	await _wait(0.35)
	await _fade_to(1.0, 0.5)
	game.hud.set_cinema(0.0)
	game.sfx.set_rain(0.0)
	_layer.queue_free()


# ── timing helpers ───────────────────────────────────────────────────────────

func _wait(sec: float) -> void:
	var t := 0.0
	while t < sec and not _skipped:
		await get_tree().process_frame
		t += get_process_delta_time()


func _fade_to(a: float, sec: float) -> void:
	var from := _fade.color.a
	var t := 0.0
	while t < sec and not _skipped:
		await get_tree().process_frame
		t += get_process_delta_time()
		_fade.color.a = lerpf(from, a, clampf(t / sec, 0.0, 1.0))
	_fade.color.a = a


func _say(text: String) -> void:
	_caption.text = text


var _cam_a := Vector3.ZERO
var _cam_b := Vector3.ZERO
var _look_a := Vector3.ZERO
var _look_b := Vector3.ZERO
var _cam_dur := 1.0
var _cam_t := 0.0
var _fov_to := 55.0


## A slow camera move: from `pa` looking at `la` to `pb` looking at `lb` over `dur` seconds (positions are in the bus' own space).
func _cam_move(pa: Vector3, la: Vector3, pb: Vector3, lb: Vector3, dur: float, fov: float) -> void:
	_cam_a = pa
	_look_a = la
	_cam_b = pb
	_look_b = lb
	_cam_dur = dur
	_cam_t = 0.0
	_fov_to = fov


func _process(delta: float) -> void:
	_t += delta
	_skip_ready += delta
	# camera
	if cam != null:
		_cam_t = minf(_cam_t + delta, _cam_dur)
		var k := smoothstep(0.0, 1.0, _cam_t / _cam_dur)
		var p := _cam_a.lerp(_cam_b, k) + position
		var look := _look_a.lerp(_look_b, k) + position
		_shake = maxf(0.0, _shake - delta * 1.2)
		p += Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * (0.012 + _shake * 0.12)    # the road
		cam.global_position = p
		cam.look_at(look)
		cam.fov = lerpf(cam.fov, _fov_to, minf(1.0, delta * 2.0))
	# the world slides past
	for l in _lamps:
		l.position.z += _speed * delta
		if l.position.z > 14.0:
			l.position.z -= 56.0
	for s in _streaks:
		s.position.z += (_speed * 1.9) * delta
		s.position.y -= 3.0 * delta
		if s.position.z > 8.0 or s.position.y < 0.2:
			s.position = Vector3(s.position.x, randf_range(1.0, 2.4), randf_range(-14.0, -4.0))
	# the cabin light: a tired flicker, red after the bell
	if _cabin_light != null:
		_flick = maxf(0.0, _flick - delta)
		if randf() < delta * 0.7:
			_flick = 0.12
		_red = maxf(0.0, _red - delta * 0.18)
		_cabin_light.light_color = Color(0.85, 0.95, 1.0).lerp(Color(1.0, 0.15, 0.12), clampf(_red * 1.4, 0.0, 1.0))
		_cabin_light.light_energy = (0.35 if _flick > 0.0 else 1.1) * (0.8 + 0.4 * sin(_t * 31.0) * _red)
	if _flash != null:
		_flash.color.a = maxf(0.0, _flash.color.a - delta * 2.5) if _fade.color.a < 0.99 else _flash.color.a


func _input(e: InputEvent) -> void:
	if _skip_ready < 1.0:
		return
	if (e is InputEventScreenTouch and e.pressed) or (e is InputEventMouseButton and e.pressed) or (e is InputEventKey and e.pressed):
		_skipped = true
		get_viewport().set_input_as_handled()


# ── the set ──────────────────────────────────────────────────────────────────

func _mat(c: Color, glow := Color.BLACK, energy := 1.0) -> Material:
	return Toon.flat(c, 0.0, 0.0, glow, energy)


func _box(center: Vector3, size: Vector3, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = center
	add_child(mi)
	return mi


func _build_bus() -> void:
	var shell := _mat(Color(0.28, 0.33, 0.36))
	var floor_m := _mat(Color(0.16, 0.17, 0.19))
	var seat_m := _mat(Color(0.12, 0.38, 0.42))
	var seat_b := _mat(Color(0.09, 0.3, 0.34))
	var trim := _mat(Color(0.7, 0.74, 0.78))
	_box(Vector3(0, -0.05, 0), Vector3(2.9, 0.1, 9.6), floor_m)
	_box(Vector3(0, 2.4, 0), Vector3(2.9, 0.1, 9.6), shell)
	_box(Vector3(0, 2.3, 0), Vector3(0.5, 0.05, 9.0), _mat(Color(0.9, 0.95, 1.0), Color(0.8, 0.9, 1.0), 1.2))
	for side in [-1.0, 1.0]:
		var x: float = side * 1.45
		_box(Vector3(x, 0.45, 0), Vector3(0.1, 0.9, 9.6), shell)
		_box(Vector3(x, 2.15, 0), Vector3(0.1, 0.5, 9.6), shell)
		for i in 8:
			_box(Vector3(x, 1.25, -4.3 + i * 1.23), Vector3(0.12, 1.3, 0.14), trim)
		# the glass: a faint cold sheet, with the night painted behind it
		_box(Vector3(x * 1.02, 1.25, 0), Vector3(0.02, 1.3, 9.4), _mat(Color(0.5, 0.65, 0.75, 1.0), Color(0.25, 0.4, 0.5), 0.25))
	_box(Vector3(0, 1.25, 4.8), Vector3(2.9, 2.5, 0.1), shell)
	# windshield frame + dashboard
	_box(Vector3(0, 0.55, -4.6), Vector3(2.9, 1.1, 0.5), shell)
	_box(Vector3(0, 2.2, -4.6), Vector3(2.9, 0.5, 0.2), shell)
	_box(Vector3(-1.4, 1.25, -4.6), Vector3(0.12, 1.3, 0.2), trim)
	_box(Vector3(1.4, 1.25, -4.6), Vector3(0.12, 1.3, 0.2), trim)
	var wheel := _box(Vector3(-0.7, 1.05, -3.75), Vector3(0.5, 0.05, 0.5), _mat(Color(0.05, 0.05, 0.06)))
	wheel.rotation_degrees = Vector3(65, 0, 0)
	_box(Vector3(-0.7, 0.25, -3.35), Vector3(0.7, 0.5, 0.7), seat_m)
	_box(Vector3(-0.7, 0.75, -3.0), Vector3(0.7, 0.5, 0.12), seat_b)
	for r in 6:
		var z := -2.1 + r * 1.25
		for sx in [-0.95, 0.95]:
			_box(Vector3(sx, 0.25, z), Vector3(0.85, 0.5, 0.8), seat_m)
			_box(Vector3(sx, 0.78, z + 0.4), Vector3(0.85, 0.55, 0.14), seat_b)
	_cabin_light = OmniLight3D.new()
	_cabin_light.position = Vector3(0, 2.1, 0)
	_cabin_light.omni_range = 9.0
	_cabin_light.light_energy = 1.1
	add_child(_cabin_light)
	# the road, the verge and the lamps on both sides
	_box(Vector3(0, -0.12, -20), Vector3(9.0, 0.1, 80), _mat(Color(0.1, 0.11, 0.13)))
	_box(Vector3(0, -0.11, -20), Vector3(0.18, 0.02, 80), _mat(Color(0.85, 0.8, 0.5)))
	for i in 5:
		for sx in [-1.0, 1.0]:
			var lamp := Node3D.new()
			lamp.position = Vector3(sx * 5.0, 0, -42.0 + i * 14.0 + (7.0 if sx > 0 else 0.0))
			var pole := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.05
			cm.bottom_radius = 0.07
			cm.height = 4.6
			pole.mesh = cm
			pole.material_override = _mat(Color(0.12, 0.13, 0.15))
			pole.position.y = 2.3
			lamp.add_child(pole)
			var bulb := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.28
			sm.height = 0.56
			bulb.mesh = sm
			bulb.material_override = _mat(Color(1.0, 0.9, 0.6), Color(1.0, 0.8, 0.45), 2.5)
			bulb.position = Vector3(-sx * 0.5, 4.5, 0)
			lamp.add_child(bulb)
			add_child(lamp)
			_lamps.append(lamp)
	# rain streaks outside the windows
	var streak_m := _mat(Color(0.8, 0.88, 1.0), Color(0.7, 0.8, 1.0), 1.0)
	for i in 36:
		var s := MeshInstance3D.new()
		var qm := BoxMesh.new()
		qm.size = Vector3(0.012, 0.012, 0.9)
		s.mesh = qm
		s.material_override = streak_m
		s.position = Vector3(1.55 if i % 2 == 0 else -1.55, randf_range(1.0, 2.4), randf_range(-14.0, 6.0))
		add_child(s)
		_streaks.append(s)
	# the red glow of the mist, far ahead
	var glow := OmniLight3D.new()
	glow.position = Vector3(0, 2.0, -40)
	glow.light_color = Color(1.0, 0.2, 0.15)
	glow.omni_range = 40.0
	glow.light_energy = 2.2
	add_child(glow)
	# headlights
	for hx in [-0.8, 0.8]:
		var hl := SpotLight3D.new()
		hl.position = Vector3(hx, 0.7, -4.8)
		hl.rotation_degrees = Vector3(-4, 0, 0)
		hl.spot_range = 30.0
		hl.spot_angle = 24.0
		hl.light_energy = 2.0
		add_child(hl)


func _seat_people(char_id: String) -> void:
	# the player at a window seat; everyone else spread over the rows, women and men alternating; the driver in front
	var others: Array = []
	for id in Data.CAST_ORDER:
		if id != char_id:
			others.append(id)
	var spots := [Vector3(0.95, 0, -0.3), Vector3(-0.95, 0, -2.1), Vector3(0.95, 0, -2.1), Vector3(-0.95, 0, 2.2), Vector3(0.95, 0, 3.45), Vector3(-0.95, 0, 3.45)]
	var me := _person(char_id, Vector3(-0.95, 0, 1.0))
	me.pose = CharacterView.Pose.IDLE
	for i in mini(others.size(), spots.size()):
		_person(String(others[i]), spots[i] as Vector3)
	var driver := CharacterView.new()
	add_child(driver)
	if driver.setup_model("res://assets/world/npc_shopkeeper.glb", 1.72, Color(0.9, 0.9, 0.95), "npc"):
		driver.position = Vector3(-0.7, -0.4, -3.35)
		driver.rotation.y = 0.0
		driver.pose = CharacterView.Pose.IDLE
		_people.append(driver)
	else:
		driver.queue_free()


func _person(id: String, at: Vector3) -> CharacterView:
	var v := CharacterView.new()
	add_child(v)
	v.setup(id)
	v.position = at + Vector3(0, -0.42, 0)     # sunk into the seat: the cushion hides the legs
	v.pose = CharacterView.Pose.SCARED if _flip(id) else CharacterView.Pose.IDLE
	_people.append(v)
	return v


func _flip(id: String) -> bool:
	return false


func _spawn_sign() -> void:
	var sign_root := Node3D.new()
	sign_root.position = Vector3(3.3, 0, -26.0)
	var board := _box(Vector3(0, 1.8, 0), Vector3(2.4, 1.0, 0.1), _mat(Color(0.06, 0.32, 0.2)))
	remove_child(board)
	sign_root.add_child(board)
	board.position = Vector3(0, 1.8, 0)
	var l := Label3D.new()
	l.text = "HARROW COVE\n2 km"
	l.font_size = 72
	l.pixel_size = 0.0075
	l.modulate = Color(0.95, 0.98, 0.95)
	l.position = Vector3(0, 1.8, 0.07)
	sign_root.add_child(l)
	var post := _box(Vector3(0, 0.6, 0), Vector3(0.1, 1.2, 0.1), _mat(Color(0.2, 0.2, 0.22)))
	remove_child(post)
	sign_root.add_child(post)
	post.position = Vector3(0, 0.6, 0)
	add_child(sign_root)
	_lamps.append(sign_root)


func _throw_car() -> void:
	var path := "res://assets/world/car_wreck.glb"
	if not ResourceLoader.exists(path):
		return
	_car = (load(path) as PackedScene).instantiate()
	var box := Assets.bounds(_car)
	var k := 4.4 / maxf(maxf(box.size.x, box.size.z), 0.01)
	_car.scale = Vector3.ONE * k
	_car.position = Vector3(2.0, 0.4, -46.0)
	add_child(_car)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(_car, "position", Vector3(0.1, 2.0, -5.2), 3.0).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_property(_car, "rotation", Vector3(TAU * 1.25, 0.8, TAU * 0.5), 3.0).set_trans(Tween.TRANS_LINEAR)
	_speed = 8.0


# ── overlay ──────────────────────────────────────────────────────────────────

func _build_ui() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 60
	add_child(_layer)
	_bar_top = ColorRect.new()
	_bar_top.color = Color.BLACK
	_bar_top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_bar_top.anchor_bottom = 0.11
	_bar_top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_bar_top)
	_bar_bot = ColorRect.new()
	_bar_bot.color = Color.BLACK
	_bar_bot.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_bar_bot.anchor_top = 0.89
	_bar_bot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_bar_bot)
	_caption = Label.new()
	_caption.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_caption.anchor_top = 0.78
	_caption.anchor_bottom = 0.89
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_caption.add_theme_font_size_override("font_size", 30)
	_caption.add_theme_color_override("font_color", Color(1, 1, 1))
	_caption.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	_caption.add_theme_constant_override("outline_size", 8)
	_caption.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_caption)
	_hint = Label.new()
	_hint.text = "TAP TO SKIP"
	_hint.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_hint.offset_left = -220
	_hint.offset_top = 14
	_hint.offset_right = -24
	_hint.add_theme_font_size_override("font_size", 18)
	_hint.modulate = Color(1, 1, 1, 0.55)
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_hint)
	_flash = ColorRect.new()
	_flash.color = Color(1, 1, 1, 0)
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_flash)
	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 1)
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_fade)
