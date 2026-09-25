extends Node3D
## Game flow: the garage (ShowroomManager + GarageUI) and driving (WorldBuilder
## + VehicleController + CameraFollow + VehicleFX + EngineAudio + HUD +
## MobileInputManager), with a fade between them.
##
## Only one of the showroom and the world is in the tree at a time: each owns
## a WorldEnvironment and a camera, and a node outside the tree costs nothing.
## One map is kept built at a time; switching maps (garage or portal) frees
## the old one first so a phone never holds two worlds.
##
## The signature features live here: portals between maps, coins with a
## nitro magnet, slow-motion big air, rewind, chameleon paint and neon smoke.

enum State { GARAGE, DRIVE }

const REWIND_SECONDS := 3.0
const HISTORY_STEP := 0.1
const HISTORY_LEN := 90
const MAGNET_RADIUS := 16.0

var state: State = State.GARAGE
var garage := {}
var index := 0
var quality := 2  # EXTRA HIGH by default (desktop / editor)

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
var _postfx: ColorRect
var _loading: Label
var _chime: AudioStreamPlayer
var _busy := false
var _time_of_day := "golden"
var _last_index := -1
var _trap_cooldown := 0.0
var _in_zone := false
var _zone_points := 0
var _history: Array = []          # [transform, linear_velocity, angular_velocity]
var _nitro_cd: Array = []
var _ring_cd: Array = []
var _stunt_combo := 0
var _stunt_timer := 0.0
var _history_clock := 0.0
var _rewind_cooldown := 0.0
var _portal_lock := 0.0
var _save_clock := 0.0
var _slowmo := false
var _on_ice := false
var _paint_hue := 0.0


func _ready() -> void:
	if OS.has_feature("mobile"):
		Engine.max_fps = 60
		quality = 1  # HIGH by default on phones
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
	ui.drive.connect(_on_drive_pressed)
	ui.config_changed.connect(_on_config)
	ui.time_changed.connect(func(mode: String) -> void:
		_time_of_day = mode
		if world:
			world.set_time_of_day(mode))
	ui.quality_changed.connect(func(q: int) -> void:
		quality = q
		_apply_quality())
	ui.steer_mode_changed.connect(func(m: int) -> void: input.steer_mode = m as MobileInputManager.Steer)
	ui.map_changed.connect(func(id: String) -> void:
		garage.map = id
		PaintCustomizer.save_garage(garage))
	ui.logo_requested.connect(_on_logo_requested)
	ui.logo_removed.connect(_on_logo_removed)
	ui.quality = quality
	ui._quality_btn.text = "GFX: " + GarageUI.QUALITY_NAMES[quality]
	ui.set_map(garage.map)
	ui.set_wallet(garage.coins)

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
	input.rewind_pressed.connect(_rewind)

	_postfx = ColorRect.new()
	_postfx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_postfx.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var pf_mat := ShaderMaterial.new()
	pf_mat.shader = preload("res://shaders/post_fx.gdshader")
	_postfx.material = pf_mat
	layer.add_child(_postfx)

	_fade = ColorRect.new()
	_fade.color = Color(0, 0, 0, 0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_fade)
	_loading = Label.new()
	_loading.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_loading.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_loading.add_theme_font_size_override("font_size", 30)
	_loading.add_theme_color_override("font_color", Color(1.0, 0.6, 0.2))
	_loading.modulate.a = 0.0
	_fade.add_child(_loading)

	_chime = AudioStreamPlayer.new()
	_chime.stream = load("res://audio/ui_click.wav")
	_chime.pitch_scale = 2.2
	_chime.volume_db = -6.0
	add_child(_chime)

	_show_current_car(0)
	showroom.camera.make_current()
	_apply_quality()


# ─────────────────────────────── garage ────────────────────────────────────


func _config_for(car: Dictionary) -> Dictionary:
	if not garage.cars.has(car.id):
		garage.cars[car.id] = PaintCustomizer.default_config(car)
	return garage.cars[car.id]


func _owns(car: Dictionary) -> bool:
	return (garage.owned as Array).has(car.id) or int(car.get("price", 0)) == 0


func _show_current_car(direction: int) -> void:
	var car := CarCatalog.get_car(index)
	var cfg := _config_for(car)
	showroom.show_car(car, cfg, direction)
	ui.set_car(car, cfg, index, CarCatalog.count())
	ui.set_ownership(_owns(car), int(car.get("price", 0)), garage.coins)
	ui.set_wallet(garage.coins)


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


func _on_drive_pressed() -> void:
	var car := CarCatalog.get_car(index)
	if _owns(car):
		_enter_drive()
		return
	var price := int(car.price)
	if garage.coins < price:
		return
	garage.coins -= price
	(garage.owned as Array).append(car.id)
	PaintCustomizer.save_garage(garage)
	_show_current_car(0)


func _transition(work: Callable, message: String = "") -> void:
	if _busy:
		return
	_busy = true
	_loading.text = message
	_loading.modulate.a = 1.0 if message != "" else 0.0
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", 1.0, 0.28)
	tw.tween_callback(work)
	tw.tween_interval(0.08)
	tw.tween_property(_loading, "modulate:a", 0.0, 0.15)
	tw.tween_property(_fade, "color:a", 0.0, 0.4)
	tw.tween_callback(func() -> void: _busy = false)


# ─────────────────────────────── drive ─────────────────────────────────────


func _map_name(id: String) -> String:
	var i := GarageUI.MAP_IDS.find(id)
	return GarageUI.MAP_NAMES[i] if i >= 0 else id.to_upper()


func _enter_drive() -> void:
	if state == State.DRIVE:
		return
	var msg := "" if world and world.map_id == garage.map else "LOADING  " + _map_name(garage.map)
	_transition(_start_drive, msg)


## Builds (or reuses) the world for `id`; the previous map is freed.
func _ensure_world(id: String) -> void:
	if world and world.map_id == id:
		return
	if world:
		if world.is_inside_tree():
			remove_child(world)
		world.free()
	world = WorldBuilder.new(id)
	world.name = "World"
	world.time_of_day = _time_of_day
	world.quality = quality
	world.build()
	world.coins.collected.connect(_on_coin)


func _start_drive() -> void:
	state = State.DRIVE
	if showroom.is_inside_tree():
		remove_child(showroom)
	_ensure_world(garage.map)
	if not world.is_inside_tree():
		add_child(world)
	world.set_time_of_day(_time_of_day)
	_spawn_car(world.spawn_transform())
	ui.visible = false
	hud.toast(CarCatalog.get_car(index).name.to_upper(), "FREE ROAM  ·  " + str(world.meta.name).to_upper(), Color.WHITE, 2.6)


func _spawn_car(xf: Transform3D) -> void:
	var car := CarCatalog.get_car(index)
	var cfg := _config_for(car)
	var model := CarBuilder.build(car)
	PaintCustomizer.apply(model, cfg)
	_paint_hue = (cfg.color as Color).h
	vehicle = VehicleController.new()
	vehicle.name = "PlayerCar"
	vehicle.setup(car, model)
	vehicle.fall_limit = float(world.meta.height_range[0]) - 15.0
	add_child(vehicle)
	vehicle.global_transform = xf
	vehicle.reset_requested.connect(_reset_car)
	vehicle.drift_banked.connect(func(pts: int) -> void:
		if _in_zone:
			_zone_points += pts
		_award(pts / 40))
	_set_headlights(_time_of_day == "night")
	world.traffic.player = vehicle

	fx = VehicleFX.new()
	fx.name = "FX"
	add_child(fx)
	fx.setup(vehicle)
	fx.smoke_tint = {"desert": Color(0.85, 0.62, 0.42), "snow": Color(0.95, 0.97, 1.0)}.get(world.biome, Color.WHITE)
	fx.neon_smoke = cfg.underglow
	fx.neon_color = PaintCustomizer.GLOW_COLORS[int(cfg.glow) % PaintCustomizer.GLOW_COLORS.size()]
	audio = EngineAudio.new()
	audio.name = "Audio"
	add_child(audio)
	audio.setup(vehicle)

	cam = CameraFollow.new()
	cam.name = "ChaseCamera"
	cam.target = vehicle
	cam.far = 3000.0
	add_child(cam)
	cam.make_current()
	cam.snap()

	input.vehicle = vehicle
	input.release_all()
	input.visible = true
	hud.bind(vehicle, world)
	hud.coins = garage.coins
	hud.visible = true
	_last_index = -1
	_in_zone = false
	_history.clear()
	_nitro_cd.resize(world.nitro_pads.size())
	_nitro_cd.fill(0.0)
	for i in world.nitro_pads.size():
		world.nitro_show(i)
	_ring_cd.resize(world.stunt_rings.size())
	_ring_cd.fill(0.0)
	for i in world.stunt_rings.size():
		world.ring_show(i)
	_stunt_combo = 0
	_stunt_timer = 0.0
	_portal_lock = 2.0
	_apply_quality()


func _despawn_car() -> void:
	_set_slowmo(false)
	for n in [vehicle, fx, audio, cam]:
		if n:
			n.queue_free()
	vehicle = null
	fx = null
	audio = null
	cam = null
	if world and world.traffic:
		world.traffic.player = null


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
	_history.clear()
	cam.snap()
	hud.toast("RESET", "", Color(1, 1, 1, 0.9), 1.0)


## Rewind: put the car back where it was a few seconds ago, with the speed
## it had then, so a missed corner can be taken again.
func _rewind() -> void:
	if vehicle == null or _rewind_cooldown > 0.0 or _history.size() < 5:
		return
	var back := mini(int(REWIND_SECONDS / HISTORY_STEP), _history.size() - 1)
	var snap: Array = _history[_history.size() - 1 - back]
	_history.resize(_history.size() - back)
	vehicle.reset_to(snap[0], snap[1], snap[2])
	cam.snap()
	_rewind_cooldown = 1.0
	hud.toast("REWIND", "%.0f SECONDS BACK" % (back * HISTORY_STEP), Color(0.55, 0.85, 1.0), 1.2)


func _enter_garage() -> void:
	if state != State.DRIVE:
		return
	_transition(_start_garage)


func _start_garage() -> void:
	state = State.GARAGE
	input.visible = false
	input.vehicle = null
	hud.visible = false
	_despawn_car()
	if world.is_inside_tree():
		remove_child(world)
	add_child(showroom)
	showroom.camera.make_current()
	ui.visible = true
	PaintCustomizer.save_garage(garage)
	_show_current_car(0)
	_apply_quality()


## Portal travel: same car, new map, arriving on that map's portal plaza.
func _travel(to: String) -> void:
	_transition(func() -> void:
		_despawn_car()
		garage.map = to
		ui.set_map(to)
		PaintCustomizer.save_garage(garage)
		_ensure_world(to)
		if not world.is_inside_tree():
			add_child(world)
		world.set_time_of_day(_time_of_day)
		_spawn_car(world.portal_arrival())
		hud.toast(str(world.meta.name).to_upper(), "PORTAL JUMP", Color(0.85, 0.4, 1.0), 2.6),
		"WARPING TO  " + _map_name(to))


## Native file picker (Android's Storage Access Framework via Godot 4.3's
## DisplayServer). Silently does nothing on a platform without one (desktop
## test runs, headless CI) rather than failing.
func _on_logo_requested() -> void:
	if not DisplayServer.has_feature(DisplayServer.FEATURE_NATIVE_DIALOG_FILE):
		if hud.visible:
			hud.toast("NOT SUPPORTED HERE", "", Color(1, 0.5, 0.3), 1.6)
		return
	var filters := PackedStringArray(["*.png,*.jpg,*.jpeg,*.webp;Images"])
	DisplayServer.file_dialog_show("Choose a logo image", "", "", false,
		DisplayServer.FILE_DIALOG_MODE_OPEN_FILE, filters, Callable(self, "_on_logo_picked"))


func _on_logo_picked(status: bool, paths: PackedStringArray, _filter_index: int) -> void:
	if not status or paths.is_empty():
		return
	var img := Image.new()
	if img.load(paths[0]) != OK:
		return
	var biggest := maxi(img.get_width(), img.get_height())
	if biggest > 512:
		var s := 512.0 / float(biggest)
		img.resize(maxi(int(img.get_width() * s), 1), maxi(int(img.get_height() * s), 1), Image.INTERPOLATE_LANCZOS)
	var car := CarCatalog.get_car(index)
	DirAccess.make_dir_recursive_absolute("user://logos")
	var path := "user://logos/%s.png" % car.id
	if img.save_png(path) != OK:
		return
	var cfg := _config_for(car)
	cfg.logo_path = path
	showroom.apply_config(cfg)
	PaintCustomizer.save_garage(garage)


func _on_logo_removed() -> void:
	var car := CarCatalog.get_car(index)
	var cfg := _config_for(car)
	cfg.logo_path = ""
	showroom.apply_config(cfg)
	PaintCustomizer.save_garage(garage)


func _on_coin(value: int, _pos: Vector3) -> void:
	_award(value)
	if not _chime.playing:
		_chime.play()


func _award(value: int) -> void:
	if value <= 0:
		return
	garage.coins += value
	hud.add_coins(value, garage.coins)


func _set_slowmo(on: bool) -> void:
	if on == _slowmo:
		return
	_slowmo = on
	Engine.time_scale = 0.45 if on else 1.0


func _physics_process(delta: float) -> void:
	if state != State.DRIVE or vehicle == null or _busy:
		return
	var real_dt := delta / Engine.time_scale
	var pos := vehicle.global_position
	var off := world.is_offroad(pos)
	cam.offroad = off
	if off and vehicle.speed_kmh > 8.0:
		# Grass, sand and snow scrub off speed, gently: this is an open world.
		var drag := {"desert": 2.2, "snow": 1.8}.get(world.biome, 1.4) as float
		vehicle.apply_central_force(-vehicle.linear_velocity.normalized() * vehicle.mass * drag)

	# Water: the car drowns (frozen lakes are ice instead: low grip, drift heaven).
	var ground := world.height_at(pos.x, pos.z)
	if world.has_water:
		if world.biome == "snow":
			var ice := ground < world.water_level - 0.2 and pos.y < world.water_level + 1.5
			if ice != _on_ice:
				_on_ice = ice
				vehicle.grip_scale = 0.38 if ice else 1.0
				if ice:
					hud.toast("ICE LAKE", "NO GRIP  ·  PURE DRIFT", Color(0.6, 0.9, 1.0), 1.8)
		elif pos.y < world.water_level - 0.9:
			hud.toast("SPLASH!", "BACK TO THE ROAD", Color(0.4, 0.7, 1.0), 1.6)
			_reset_car()
			return

	# Rewind history.
	_rewind_cooldown = maxf(_rewind_cooldown - real_dt, 0.0)
	_history_clock += real_dt
	if _history_clock >= HISTORY_STEP:
		_history_clock = 0.0
		_history.append([vehicle.global_transform, vehicle.linear_velocity, vehicle.angular_velocity])
		if _history.size() > HISTORY_LEN:
			_history.pop_front()

	# Coins, with the nitro magnet.
	world.coins.collect(pos, 3.2, MAGNET_RADIUS if vehicle.nitro_active else 0.0, delta)

	# Nitro pads: a full refill, on a cooldown so you cannot just sit on one.
	for i in _nitro_cd.size():
		if _nitro_cd[i] > 0.0:
			_nitro_cd[i] = maxf(_nitro_cd[i] - real_dt, 0.0)
			if _nitro_cd[i] == 0.0:
				world.nitro_show(i)
			continue
		if pos.distance_to(world.nitro_pads[i]) < 4.2:
			vehicle.nitro = 1.0
			_nitro_cd[i] = 10.0
			world.nitro_hide(i)
			hud.toast("NITRO REFILL", "", Color(0.3, 0.85, 1.0), 1.0)

	# Stunt rings: fly a jump through one for a chained score combo — a
	# skill-and-exploration loop layered on top of point-to-point racing.
	_stunt_timer = maxf(_stunt_timer - real_dt, 0.0)
	if _stunt_timer == 0.0:
		_stunt_combo = 0
	for i in _ring_cd.size():
		if _ring_cd[i] > 0.0:
			_ring_cd[i] = maxf(_ring_cd[i] - real_dt, 0.0)
			if _ring_cd[i] == 0.0:
				world.ring_show(i)
			continue
		if pos.distance_to(world.stunt_rings[i]) < 3.0:
			_stunt_combo += 1
			_stunt_timer = 5.0
			var bonus := 40 * _stunt_combo
			_award(bonus)
			vehicle.skill_total += bonus * 2
			hud.toast("STUNT RING  x%d" % _stunt_combo, "+%d COINS" % bonus, Color(1.0, 0.82, 0.15), 1.4)
			_ring_cd[i] = 6.0
			world.ring_hide(i)

	# Big air: slow motion while high in the air, coins on landing.
	var height := pos.y - ground
	_set_slowmo(vehicle.air_time > 0.45 and height > 2.2)
	if vehicle.last_air > 0.0:
		if vehicle.last_air > 0.9:
			var bonus := int(vehicle.last_air * 60.0)
			_award(bonus)
			hud.toast("BIG AIR  %.1fs" % vehicle.last_air, "+%d COINS" % bonus, Color(0.5, 0.9, 1.0), 2.2)
			vehicle.skill_total += bonus * 5
		vehicle.last_air = 0.0

	# Chameleon paint rolls its hue with speed.
	var cfg := _config_for(vehicle.car)
	if int(cfg.finish) == PaintCustomizer.CHAMELEON:
		var base: Color = cfg.color
		var h := fposmod(base.h + vehicle.speed_kmh / 320.0 + (0.15 if vehicle.is_drifting else 0.0), 1.0)
		_paint_hue = lerp_angle(_paint_hue * TAU, h * TAU, 3.0 * real_dt) / TAU
		var mat: ShaderMaterial = vehicle.model.get_meta("paint_material")
		mat.set_shader_parameter("base_color", Color.from_hsv(fposmod(_paint_hue, 1.0), maxf(base.s, 0.7), maxf(base.v, 0.6)))

	# Portals.
	_portal_lock = maxf(_portal_lock - real_dt, 0.0)
	if _portal_lock == 0.0:
		for p in world.portals:
			var d: Vector3 = p.pos - pos
			if Vector2(d.x, d.z).length() < 5.0 and absf(d.y) < 6.0:
				_portal_lock = 5.0
				_travel(p.to)
				return

	_save_clock += real_dt
	if _save_clock > 20.0:
		_save_clock = 0.0
		PaintCustomizer.save_garage(garage)

	_trap_cooldown = maxf(_trap_cooldown - real_dt, 0.0)
	var i := world.nearest_index(pos, false)
	if i < 0 or i >= world.main_count or world.distance_to_road(pos) > 20.0:
		_last_index = -1
		return
	var n := world.main_count
	# Speed trap: crossing its sample in either direction.
	if _last_index >= 0 and _trap_cooldown == 0.0:
		var t := world.speed_trap_index
		var crossed := _between(t, _last_index, i, n)
		if crossed and vehicle.speed_kmh > 20.0:
			var kmh := int(vehicle.speed_kmh)
			garage.best_trap = maxi(int(garage.best_trap), kmh)
			hud.toast("SPEED TRAP  %d KM/H" % kmh, "BEST  %d KM/H  ·  +%d COINS" % [garage.best_trap, kmh / 2], Color(0.35, 0.85, 1.0), 2.6)
			vehicle.skill_total += kmh * 3
			_award(kmh / 2)
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
			var reward := _zone_points / 25
			hud.toast("DRIFT ZONE  %s" % DriveHUD._fmt(_zone_points), "ZONE COMPLETE  ·  +%d COINS" % reward, Color(1.0, 0.45, 0.08), 3.0)
			_award(reward)
	_last_index = i


## True when `x` lies on the short way round the loop from a to b.
func _between(x: int, a: int, b: int, n: int) -> bool:
	var fwd := posmod(b - a, n)
	var back := posmod(a - b, n)
	if fwd <= back:
		return posmod(x - a, n) <= fwd and posmod(x - a, n) > 0
	return posmod(a - x, n) <= back and posmod(a - x, n) > 0


# ─────────────────────────────── quality ───────────────────────────────────


## 0 LOW, 1 HIGH, 2 EXTRA HIGH, 3 EXTREME — higher is heavier.
func _apply_quality() -> void:
	var vp := get_viewport()
	match quality:
		0:
			vp.msaa_3d = Viewport.MSAA_DISABLED
			vp.scaling_3d_scale = 0.7
		1:
			vp.msaa_3d = Viewport.MSAA_2X
			vp.scaling_3d_scale = 0.85
		2:
			vp.msaa_3d = Viewport.MSAA_4X
			vp.scaling_3d_scale = 1.0
		_:
			vp.msaa_3d = Viewport.MSAA_4X
			vp.scaling_3d_scale = 1.15
	_postfx.visible = quality >= 1
	if quality >= 1:
		var pf := _postfx.material as ShaderMaterial
		var sharpen: float = [0.0, 0.18, 0.28, 0.4][quality]
		var aberr: float = [0.0, 0.0009, 0.0016, 0.0024][quality]
		pf.set_shader_parameter("sharpen", sharpen)
		pf.set_shader_parameter("aberration", aberr)
	if world and world.is_inside_tree():
		world.set_quality(quality)
		world.sun.directional_shadow_max_distance = [0.0, 65.0, 110.0, 165.0][quality]
		world.env.glow_enabled = quality >= 1
		world.env.glow_intensity = [0.0, 0.6, 0.75, 0.95][quality]
	if showroom:
		showroom.env.glow_enabled = quality >= 1
