class_name ShowroomManager
extends Node3D
## The garage: a dark studio with a glossy floor, a ceiling softbox, rim
## lights and an LED turntable ring, plus a cinematic orbit camera.
##
## Reflections: the phone renderer (Compatibility) has no screen-space
## reflections or reflection probes, so the floor is a translucent gloss
## layer over a mirrored copy of the car — the classic showroom trick, and it
## costs one extra draw of the car. The car paint reflects a procedural
## studio panorama (softbox, strip lights, warm horizon) used only for
## reflections, so it looks lit by a studio rather than by a black void.

signal car_swiped(direction: int)
signal car_tapped

const FLOOR_ALPHA := 0.8

var camera: Camera3D
var env: Environment
var current: Node3D
var current_mirror: Node3D
var current_car: Dictionary
var doors_open := false

var _yaw := 0.6
var _pitch := 0.2
var _dist := 6.4
var _idle := 3.0
var _press_pos := Vector2.ZERO
var _press_time := 0
var _dragging := false
var _touches := {}
var _pinch_start := 0.0
var _dist_start := 0.0
var _door_amount := 0.0
var _door_tween: Tween
var _slot: Node3D
var _outgoing: Array[Node3D] = []


func build() -> void:
	_build_environment()
	_build_room()
	_slot = Node3D.new()
	_slot.name = "Turntable"
	add_child(_slot)
	camera = Camera3D.new()
	camera.name = "ShowroomCamera"
	camera.fov = 42.0
	camera.near = 0.05
	add_child(camera)
	_update_camera(0.0)


func _studio_panorama() -> ImageTexture:
	var w := 256
	var h := 128
	var img := Image.create(w, h, false, Image.FORMAT_RGBF)
	for y in h:
		var t := float(y) / h
		var base := lerpf(0.05, 0.015, t)
		for x in w:
			img.set_pixel(x, y, Color(base, base, base * 1.1))
	# Overhead softbox.
	for y in range(4, 22):
		for x in range(96, 160):
			img.set_pixel(x, y, Color(5.0, 5.0, 5.2))
	# Vertical strip lights either side.
	for strip_x in [30, 94, 162, 226]:
		for y in range(36, 70):
			for x in range(strip_x, strip_x + 4):
				img.set_pixel(x, y, Color(2.6, 2.6, 2.7))
	# Warm horizon band for rim reflections.
	for y in range(62, 66):
		for x in w:
			img.set_pixel(x, y, Color(1.4, 0.6, 0.2))
	return ImageTexture.create_from_image(img)


func _build_environment() -> void:
	var pano := PanoramaSkyMaterial.new()
	pano.panorama = _studio_panorama()
	var sky := Sky.new()
	sky.sky_material = pano
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.012, 0.013, 0.018)
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.52, 0.6)
	env.ambient_light_energy = 0.18
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.05
	env.glow_enabled = true
	env.glow_intensity = 0.9
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.0
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.1
	env.adjustment_contrast = 1.08
	var we := WorldEnvironment.new()
	we.name = "StudioEnvironment"
	we.environment = env
	add_child(we)


func _emissive(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m


func _build_room() -> void:
	# Glossy floor over the mirrored world.
	var floor_mi := MeshInstance3D.new()
	floor_mi.name = "GlossFloor"
	var pm := PlaneMesh.new()
	pm.size = Vector2(80, 80)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.012, 0.013, 0.018, FLOOR_ALPHA)
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.metallic = 0.5
	fm.roughness = 0.16
	fm.metallic_specular = 0.8
	floor_mi.mesh.surface_set_material(0, fm)
	add_child(floor_mi)

	# LED turntable rings.
	for ring in [[3.55, Color(1.0, 0.45, 0.1), 3.5], [3.75, Color(1.0, 1.0, 1.0), 1.2]]:
		var t := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = ring[0] - 0.025
		tm.outer_radius = ring[0] + 0.025
		tm.rings = 96
		tm.ring_segments = 6
		t.mesh = tm
		t.material_override = _emissive(ring[1], ring[2])
		t.position = Vector3(0, 0.012, 0)
		t.scale = Vector3(1, 0.3, 1)
		add_child(t)

	# Ceiling softbox (what the paint reflects, made visible) and a truss.
	var soft := MeshInstance3D.new()
	var sb := BoxMesh.new()
	sb.size = Vector3(5.2, 0.06, 2.6)
	soft.mesh = sb
	soft.material_override = _emissive(Color(1, 1, 1), 2.2)
	soft.position = Vector3(0, 6.5, 0)
	add_child(soft)
	var truss_mat := StandardMaterial3D.new()
	truss_mat.albedo_color = Color(0.06, 0.06, 0.07)
	truss_mat.metallic = 0.8
	truss_mat.roughness = 0.4
	for z in [-1.5, 1.5]:
		var bar := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(12, 0.12, 0.12)
		bar.mesh = bm
		bar.material_override = truss_mat
		bar.position = Vector3(0, 6.7, z)
		add_child(bar)

	# Vertical LED strips around the back of the room.
	for i in 14:
		var a := lerpf(PI * 0.05, PI * 0.95, float(i) / 13.0) + PI
		var strip := MeshInstance3D.new()
		var sm := BoxMesh.new()
		sm.size = Vector3(0.08, 4.2, 0.08)
		strip.mesh = sm
		var warm := i % 3 == 0
		strip.material_override = _emissive(Color(1.0, 0.5, 0.15) if warm else Color(0.8, 0.85, 1.0), 2.6 if warm else 1.6)
		strip.position = Vector3(cos(a) * 13.0, 2.1, sin(a) * 13.0)
		add_child(strip)
	# Back wall panels so the strips have something to sit on.
	var wall_mat := StandardMaterial3D.new()
	wall_mat.albedo_color = Color(0.03, 0.032, 0.04)
	wall_mat.roughness = 0.7
	for i in 7:
		var a2 := lerpf(PI * 0.0, PI, float(i) / 6.0) + PI
		var panel := MeshInstance3D.new()
		var pmesh := BoxMesh.new()
		pmesh.size = Vector3(6.2, 7.0, 0.2)
		panel.mesh = pmesh
		panel.material_override = wall_mat
		panel.position = Vector3(cos(a2) * 13.4, 3.5, sin(a2) * 13.4)
		panel.rotation = Vector3(0, -a2 - PI * 0.5, 0)
		add_child(panel)

	# Lights: overhead key with shadows, soft fills, and two coloured rims.
	_spot(Vector3(0, 6.3, 0.3), Vector3(0, 0, 0), Color(1, 0.98, 0.95), 3.4, 34.0, true)
	_spot(Vector3(4.5, 4.5, 4.0), Vector3(0, 0.4, 0), Color(0.95, 0.96, 1.0), 1.5, 30.0, false)
	_spot(Vector3(-4.5, 4.0, 3.5), Vector3(0, 0.4, 0), Color(0.95, 0.96, 1.0), 1.1, 30.0, false)
	_spot(Vector3(-5.5, 1.6, -4.5), Vector3(0, 0.6, 0), Color(1.0, 0.45, 0.12), 3.2, 26.0, false)
	_spot(Vector3(5.5, 1.6, -4.5), Vector3(0, 0.6, 0), Color(0.2, 0.75, 1.0), 2.8, 26.0, false)


func _spot(pos: Vector3, look: Vector3, color: Color, energy: float, angle: float, shadow: bool) -> void:
	var s := SpotLight3D.new()
	s.light_color = color
	s.light_energy = energy
	s.spot_angle = angle
	s.spot_range = 16.0
	s.spot_attenuation = 0.8
	s.shadow_enabled = shadow
	add_child(s)
	s.position = pos
	s.look_at_from_position(pos, look, Vector3.FORWARD if absf(pos.x) < 0.1 and absf(pos.z) < 0.5 else Vector3.UP)


# ─────────────────────────────── cars ──────────────────────────────────────


func _mirror_of(model: Node3D) -> Node3D:
	var m := model.duplicate() as Node3D
	for n in _all(m):
		if n is Light3D:
			n.queue_free()
		elif n.name == "ContactShadow":
			n.queue_free()
	m.scale = Vector3(1, -1, 1)
	return m


func _all(n: Node) -> Array[Node]:
	var out: Array[Node] = [n]
	for c in n.get_children():
		out.append_array(_all(c))
	return out


## Shows a car; direction +1 slides it in from the right (next), -1 from the
## left (previous), 0 swaps instantly.
func show_car(car: Dictionary, config: Dictionary, direction: int = 0) -> void:
	current_car = car
	var model := CarBuilder.build(car)
	PaintCustomizer.apply(model, config)
	var mirror := _mirror_of(model)
	var holder := Node3D.new()
	holder.add_child(model)
	holder.add_child(mirror)
	_slot.add_child(holder)
	_door_amount = 0.0
	doors_open = false

	var old := current.get_parent() as Node3D if current else null
	current = model
	current_mirror = mirror
	if direction == 0 or old == null:
		if old:
			old.queue_free()
		return
	var off := 9.5 * direction
	holder.position = Vector3(off, 0, 0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(holder, "position:x", 0.0, 0.6).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(old, "position:x", -off, 0.5).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(old.queue_free)
	_outgoing.append(old)
	_spin_wheels(holder, 0.6, direction)
	_spin_wheels(old, 0.5, direction)


func _spin_wheels(holder: Node3D, time: float, direction: int) -> void:
	for n in _all(holder):
		if String(n.name).begins_with("Wheel_"):
			var w := n as Node3D
			var tw := create_tween()
			tw.tween_property(w, "rotation:x", w.rotation.x - direction * 9.0, time).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


func apply_config(config: Dictionary) -> void:
	if current:
		PaintCustomizer.apply(current, config)
		PaintCustomizer.apply(current_mirror, config)


func toggle_doors() -> void:
	doors_open = not doors_open
	if _door_tween:
		_door_tween.kill()
	_door_tween = create_tween()
	_door_tween.tween_method(_set_doors, _door_amount, 1.0 if doors_open else 0.0, 0.7).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _set_doors(amount: float) -> void:
	_door_amount = amount
	var style: String = current_car.get("doors", "swing")
	if current:
		CarBuilder.set_doors(current, amount, style)
		CarBuilder.set_doors(current_mirror, amount, style)


# ─────────────────────────────── camera ────────────────────────────────────


func _process(delta: float) -> void:
	if not visible:
		return
	_idle += delta
	if _idle > 2.5:
		_yaw += delta * 0.16
	_update_camera(delta)


func _update_camera(_delta: float) -> void:
	if camera == null or not camera.is_inside_tree():
		return
	var target := Vector3(0, 0.62, 0)
	var dir := Vector3(sin(_yaw) * cos(_pitch), sin(_pitch), cos(_yaw) * cos(_pitch))
	camera.global_position = target + dir * _dist
	camera.look_at(target, Vector3.UP)


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			_touches[t.index] = t.position
			if _touches.size() == 2:
				var pts := _touches.values()
				_pinch_start = (pts[0] as Vector2).distance_to(pts[1])
				_dist_start = _dist
		else:
			_touches.erase(t.index)
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		_touches[d.index] = d.position
		if _touches.size() == 2 and _pinch_start > 0.0:
			var pts2 := _touches.values()
			var now := (pts2[0] as Vector2).distance_to(pts2[1])
			_dist = clampf(_dist_start * _pinch_start / maxf(now, 1.0), 4.4, 10.0)
			_idle = 0.0
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_dist = clampf(_dist - 0.3, 4.4, 10.0)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_dist = clampf(_dist + 0.3, 4.4, 10.0)
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_press_pos = mb.position
				_press_time = Time.get_ticks_msec()
				_dragging = true
			elif _dragging:
				_dragging = false
				var dt := Time.get_ticks_msec() - _press_time
				var dv := mb.position - _press_pos
				if dt < 320 and absf(dv.x) > 90.0 and absf(dv.x) > absf(dv.y) * 2.0:
					car_swiped.emit(1 if dv.x < 0.0 else -1)
				elif dv.length() < 12.0 and dt < 350:
					car_tapped.emit()
	elif event is InputEventMouseMotion and _dragging and _touches.size() < 2:
		var mm := event as InputEventMouseMotion
		_yaw -= mm.relative.x * 0.006
		_pitch = clampf(_pitch + mm.relative.y * 0.004, 0.02, 0.9)
		_idle = 0.0
