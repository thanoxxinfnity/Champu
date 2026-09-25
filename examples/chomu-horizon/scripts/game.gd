extends Node3D
## Game flow: the garage (ShowroomManager + GarageUI) and driving (WorldBuilder
## + VehicleController + CameraFollow + VehicleFX + EngineAudio + HUD +
## MobileInputManager), with a fade between them.
##
## Only one of the showroom and the world is in the tree at a time: each owns
## a WorldEnvironment and a camera, and a node outside the tree costs nothing.
## The world is built once, on the first drive, and kept for later ones.

enum State { GARAGE, DRIVE }

var state: State = State.GARAGE
var garage := {}
var index := 0
var quality := 0

var showroom: ShowroomManager
var ui: GarageUI
var world: WorldBuilder
var vehicle: VehicleController
var cam: CameraFollow
var fx: VehicleFX
var audio: EngineAudio
var input: MobileInputManager
var hud: DriveHUD

var _fade: ColorRect
var _busy := false
var _time_of_day := "golden"
var _last_index := -1
var _trap_cooldown := 0.0
var _best_trap := 0
var _in_zone := false
var _zone_points := 0


func _ready() -> void:
	if OS.has_feature("mobile"):
		Engine.max_fps = 60
		quality = 1
	garage = PaintCustomizer.load_garage()
	index = clampi(int(garage.selected), 0, CarCatalog.count() - 1)

	showroom = ShowroomManager.new()
	showroom.name = "Showroom"
	showroom.build()
	add_child(showroom)
	showroom.car_swiped.connect(func(dir: int) -> void: _change_car(dir))
	showroom.car_tapped.connect(func() -> void: showroom.toggle_doors())

	var layer := CanvasLayer.new()
	layer.name = "UI"
	add_child(layer)
	ui = GarageUI.new()
	ui.name = "Garage"
	layer.add_child(ui)
	ui.prev_car.connect(func() -> void: _change_car(-1))
	ui.next_car.connect(func() -> void: _change_car(1))
	ui.drive.connect(_enter_drive)
	ui.config_changed.connect(_on_config)
	ui.time_changed.connect(func(mode: String) -> void:
		_time_of_day = mode
		if world:
			world.set_time_of_day(mode))
	ui.quality_changed.connect(func(q: int) -> void:
		quality = q
		_apply_quality())
	ui.steer_mode_changed.connect(func(m: int) -> void: input.steer_mode = m as MobileInputManager.Steer)
	ui.quality = quality
	ui._quality_btn.text = "GFX: " + GarageUI.QUALITY_NAMES[quality]

	hud = DriveHUD.new()
	hud.name = "HUD"
	hud.visible = false
	layer.add_child(hud)
	input = MobileInputManager.new()
	input.name = "Touch"
	input.visible = false
	layer.add_child(input)
	input.camera_pressed.connect(func() -> void:
		if cam:
			hud.toast(cam.cycle_mode(), "", Color.WHITE, 1.2))
	input.reset_pressed.connect(_reset_car)
	input.garage_pressed.connect(_enter_garage)

	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_fade)

	_show_current_car(0)
	showroom.camera.make_current()
	_apply_quality()


# ─────────────────────────────── garage ────────────────────────────────────


func _config_for(car: Dictionary) -> Dictionary:
	if not garage.cars.has(car.id):
		garage.cars[car.id] = PaintCustomizer.default_config(car)
	return garage.cars[car.id]


func _show_current_car(direction: int) -> void:
	var car := CarCatalog.get_car(index)
	var cfg := _config_for(car)
	showroom.show_car(car, cfg, direction)
	ui.set_car(car, cfg, index, CarCatalog.count())


func _change_car(dir: int) -> void:
	if state != State.GARAGE:
		return
	index = posmod(index + dir, CarCatalog.count())
	garage.selected = index
	PaintCustomizer.save_garage(garage)
	_show_current_car(dir)


func _on_config(cfg: Dictionary) -> void:
	var car := CarCatalog.get_car(index)
	garage.cars[car.id] = cfg
	showroom.apply_config(cfg)
	PaintCustomizer.save_garage(garage)


func _transition(work: Callable) -> void:
	if _busy:
		return
	_busy = true
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 1.0, 0.28)
	tw.tween_callback(work)
	tw.tween_interval(0.08)
	tw.tween_property(_fade, "color:a", 0.0, 0.4)
	tw.tween_callback(func() -> void: _busy = false)


# ─────────────────────────────── drive ─────────────────────────────────────


func _enter_drive() -> void:
	if state == State.DRIVE:
		return
	_transition(_start_drive)


func _start_drive() -> void:
	state = State.DRIVE
	remove_child(showroom)
	if world == null:
		world = WorldBuilder.new()
		world.name = "World"
		world.time_of_day = _time_of_day
		world.build()
	add_child(world)
	world.set_time_of_day(_time_of_day)

	var car := CarCatalog.get_car(index)
	var model := CarBuilder.build(car)
	PaintCustomizer.apply(model, _config_for(car))
	vehicle = VehicleController.new()
	vehicle.name = "PlayerCar"
	vehicle.setup(car, model)
	add_child(vehicle)
	vehicle.global_transform = world.spawn_transform()
	vehicle.reset_requested.connect(_reset_car)
	vehicle.drift_banked.connect(func(pts: int) -> void:
		if _in_zone:
			_zone_points += pts)
	_set_headlights(_time_of_day == "night")

	fx = VehicleFX.new()
	fx.name = "FX"
	add_child(fx)
	fx.setup(vehicle)
	audio = EngineAudio.new()
	audio.name = "Audio"
	add_child(audio)
	audio.setup(vehicle)

	cam = CameraFollow.new()
	cam.name = "ChaseCamera"
	cam.target = vehicle
	add_child(cam)
	cam.make_current()
	cam.snap()

	input.vehicle = vehicle
	input.release_all()
	input.visible = true
	hud.bind(vehicle, world)
	hud.visible = true
	ui.visible = false
	_last_index = -1
	_in_zone = false
	_apply_quality()
	hud.toast(car.name.to_upper(), "FREE ROAM  ·  HORIZON FESTIVAL", Color.WHITE, 2.6)


func _set_headlights(on: bool) -> void:
	var lights := vehicle.model.get_node_or_null("HeadLights")
	if lights == null:
		return
	for c in lights.get_children():
		if c is SpotLight3D:
			c.visible = on
	(vehicle.model.get_meta("head_material") as StandardMaterial3D).emission_energy_multiplier = 4.0 if on else 2.2


func _reset_car() -> void:
	if vehicle == null:
		return
	var xf := world.reset_transform(vehicle.global_position, vehicle.global_basis.z)
	vehicle.reset_to(xf)
	cam.snap()
	hud.toast("RESET", "", Color(1, 1, 1, 0.9), 1.0)


func _enter_garage() -> void:
	if state != State.DRIVE:
		return
	_transition(_start_garage)


func _start_garage() -> void:
	state = State.GARAGE
	input.visible = false
	input.vehicle = null
	hud.visible = false
	for n in [vehicle, fx, audio, cam]:
		if n:
			n.queue_free()
	vehicle = null
	fx = null
	audio = null
	cam = null
	remove_child(world)
	add_child(showroom)
	showroom.camera.make_current()
	ui.visible = true
	_show_current_car(0)
	_apply_quality()


func _physics_process(delta: float) -> void:
	if state != State.DRIVE or vehicle == null:
		return
	var pos := vehicle.global_position
	var off := world.is_offroad(pos)
	cam.offroad = off
	if off and vehicle.speed_kmh > 8.0:
		# Grass and gravel: lose speed, like leaving the tarmac should.
		vehicle.apply_central_force(-vehicle.linear_velocity.normalized() * vehicle.mass * 3.2)
	if Vector2(pos.x - 200.0, pos.z - 200.0).length() > WorldBuilder.WORLD_RADIUS:
		_reset_car()
		return

	_trap_cooldown = maxf(_trap_cooldown - delta, 0.0)
	var i := world.nearest_index(pos, false)
	if i < 0 or world.distance_to_road(pos) > 20.0:
		_last_index = -1
		return
	var n := world.samples.size()
	# Speed trap: crossing its sample in either direction.
	if _last_index >= 0 and _trap_cooldown == 0.0:
		var t := world.speed_trap_index
		var crossed := _between(t, _last_index, i, n)
		if crossed and vehicle.speed_kmh > 20.0:
			var kmh := int(vehicle.speed_kmh)
			_best_trap = maxi(_best_trap, kmh)
			hud.toast("SPEED TRAP  %d KM/H" % kmh, "BEST  %d KM/H" % _best_trap, Color(0.35, 0.85, 1.0), 2.6)
			vehicle.skill_total += kmh * 3
			_trap_cooldown = 4.0
	# Drift zone: score the drifts banked between entering and leaving it.
	var zone := world.drift_zone
	var inside := _between(i, zone.x, zone.y, n) or i == zone.x
	if inside and not _in_zone:
		_in_zone = true
		_zone_points = 0
		hud.toast("DRIFT ZONE", "CHAIN DRIFTS FOR POINTS", Color(1.0, 0.45, 0.08), 2.0)
	elif not inside and _in_zone:
		_in_zone = false
		if vehicle.is_drifting:
			_zone_points += int(vehicle.drift_points)
		if _zone_points > 0:
			hud.toast("DRIFT ZONE  %s" % DriveHUD._fmt(_zone_points), "ZONE COMPLETE", Color(1.0, 0.45, 0.08), 3.0)
	_last_index = i


## True when `x` lies on the short way round the loop from a to b.
func _between(x: int, a: int, b: int, n: int) -> bool:
	var fwd := posmod(b - a, n)
	var back := posmod(a - b, n)
	if fwd <= back:
		return posmod(x - a, n) <= fwd and posmod(x - a, n) > 0
	return posmod(a - x, n) <= back and posmod(a - x, n) > 0


# ─────────────────────────────── quality ───────────────────────────────────


func _apply_quality() -> void:
	var vp := get_viewport()
	match quality:
		0:
			vp.msaa_3d = Viewport.MSAA_4X
			vp.scaling_3d_scale = 1.0
		1:
			vp.msaa_3d = Viewport.MSAA_2X
			vp.scaling_3d_scale = 0.9
		_:
			vp.msaa_3d = Viewport.MSAA_DISABLED
			vp.scaling_3d_scale = 0.75
	if world and world.is_inside_tree():
		world.sun.shadow_enabled = quality < 2 and _time_of_day != "night"
		world.sun.directional_shadow_max_distance = 110.0 if quality == 0 else 70.0
		world.env.glow_enabled = quality < 2
	if showroom:
		showroom.env.glow_enabled = quality < 2
