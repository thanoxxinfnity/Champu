class_name Director
extends Node
## Glue for the life-sim layer: owns the save state, the HUD and the phone, and runs the things you do at home — sleeping in the
## bed, changing clothes, calling the valet — plus the pistol and what happens when the player dies.

signal slept(hours: float)
signal gunshot(position: Vector3)

const SLEEP_HOURS := 8.0
const VALET_FEE := 50
const RESPAWN_FEE := 500
const PISTOL_DAMAGE := 34
const PISTOL_RANGE := 70.0
const FIRE_COOLDOWN := 0.28

var world: World
var state: GameState
var hud: Hud
var phone: Phone
var touch: TouchControls
var atmosphere: Atmosphere
var player: Player
var mission: Node = null
var sleeping := false
var shots_fired := 0
var _fade: ColorRect
var _fire_cd := 0.0


func setup(w: World) -> void:
	world = w
	atmosphere = w.atmosphere
	player = w.player
	state = GameState.new()
	state.name = "State"
	add_child(state)

	hud = Hud.new()
	hud.name = "Hud"
	hud.state = state
	hud.player = player
	hud.atmosphere = atmosphere
	hud.world = w
	add_child(hud)

	phone = Phone.new()
	phone.name = "Phone"
	phone.director = self
	add_child(phone)
	phone.opened.connect(func(): player.set_cinematic(true))
	phone.closed.connect(func():
		player.set_cinematic(false)
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED)

	touch = TouchControls.new()
	touch.name = "Touch"
	touch.director = self
	add_child(touch)

	var fade_layer := CanvasLayer.new()
	fade_layer.layer = 90
	add_child(fade_layer)
	_fade = ColorRect.new()
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.color = Color(0, 0, 0, 0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade_layer.add_child(_fade)

	var sh := w.safehouse
	if sh != null:
		sh.bed_use.callback = func(_p): sleep()
		sh.wardrobe_use.callback = func(_p): next_outfit()
		sh.wardrobe_use.prompt = "E - Change Clothes"
	player.died.connect(_on_player_died)
	apply_outfit()


func can_use_phone() -> bool:
	return player != null and player.active and not player.dead and not player.cinematic and not sleeping


func _process(delta: float) -> void:
	_fire_cd = maxf(0.0, _fire_cd - delta)
	state.play_hours += delta / 3600.0


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("fire") and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		fire()


# ── the bed ───────────────────────────────────────────────────────────────────

## Sleep until the morning-ish: the screen fades, eight hours pass, health is restored and the game is saved.
func sleep() -> void:
	if sleeping or player.dead:
		return
	sleeping = true
	player.set_cinematic(true)
	player.play_clip(&"sleep", 3.0)
	var t := create_tween()
	t.tween_property(_fade, "color:a", 1.0, 0.8)
	await t.finished
	atmosphere.set_hour(fposmod(atmosphere.hour + SLEEP_HOURS, 24.0))
	player.heal_full()
	state.slept_nights += 1
	state.set_stars(0)
	state.save()
	hud.toast("Game saved. You slept 8 hours.", 3.5)
	slept.emit(SLEEP_HOURS)
	await get_tree().create_timer(0.8).timeout
	var u := create_tween()
	u.tween_property(_fade, "color:a", 0.0, 0.9)
	await u.finished
	player.set_cinematic(false)
	sleeping = false


# ── the wardrobe ──────────────────────────────────────────────────────────────

func next_outfit() -> void:
	state.set_outfit(state.outfit + 1)
	apply_outfit()
	hud.toast("Outfit: %s" % GameState.OUTFITS[state.outfit].name, 2.0)


## Tints the character's one generated texture: the three looks share a mesh but not a colour.
func apply_outfit() -> void:
	var body := player.model.find_child("Body", true, false) as MeshInstance3D if player.model != null else null
	if body == null:
		return
	var src := body.mesh.surface_get_material(0)
	var m: StandardMaterial3D = (src.duplicate() as StandardMaterial3D) if src is StandardMaterial3D else StandardMaterial3D.new()
	m.albedo_color = GameState.OUTFITS[state.outfit].tint
	body.material_override = m


# ── valet / waypoints ─────────────────────────────────────────────────────────

func personal_car() -> Vehicle:
	return world.vehicles[0] if world.vehicles.size() > 0 else null


## Brings the personal car to the road nearest the player. Returns what to tell the player.
func call_valet() -> String:
	var car := personal_car()
	if car == null:
		return "No car on file."
	if car.is_player_driven:
		return "You are already in it."
	if state.cash < VALET_FEE:
		return "Not enough cash."
	state.add_cash(-VALET_FEE)
	car.global_transform = valet_spot(player.global_position)
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	hud.toast("Your car is waiting on the road.", 3.0)
	return "Done. It is waiting on the road."


## A parking spot at the kerb of the road nearest to `from`, facing along the road, outer lane.
func valet_spot(from: Vector3) -> Transform3D:
	var best := Vector3.ZERO
	var best_d := INF
	var along_x := false
	for line in City.ROAD_LINES:
		var d1 := absf(from.x - line)
		if d1 < best_d:
			best_d = d1
			best = Vector3(line + City.ROAD_W * 0.5 - 2.0, 0.0, from.z)
			along_x = false
		var d2 := absf(from.z - line)
		if d2 < best_d:
			best_d = d2
			best = Vector3(from.x, 0.0, line + City.ROAD_W * 0.5 - 2.0)
			along_x = true
	best.y = Vehicle.GROUND_TO_ORIGIN + 0.25
	# Vehicle forward is +Z; for a road along X the car turns a quarter.
	var basis := Basis.from_euler(Vector3(0, PI * 0.5 if along_x else 0.0, 0))
	return Transform3D(basis, best)


static func tower_waypoint() -> Vector3:
	return City.block_center(City.TOWER_PLOT)


static func home_waypoint() -> Vector3:
	return World.house_origin()


func set_waypoint(p: Vector3) -> void:
	hud.set_objective("Waypoint set", p)


func start_mission() -> void:
	if mission != null and mission.has_method("start"):
		mission.start()


# ── the pistol ────────────────────────────────────────────────────────────────

## A hitscan shot from the middle of the screen. Anything in group "npc" with take_hit() is hurt; the noise scares the street.
func fire() -> bool:
	if _fire_cd > 0.0 or not player.active or player.cinematic or player.dead:
		return false
	_fire_cd = FIRE_COOLDOWN
	shots_fired += 1
	var cam := player.cam
	var from := cam.global_position
	var to := from - cam.global_basis.z * PISTOL_RANGE
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD | Data.L_DYNAMIC)
	q.exclude = [player.get_rid()]
	var hit := player.get_world_3d().direct_space_state.intersect_ray(q)
	var at: Vector3 = hit.position if not hit.is_empty() else to
	player.play_clip(&"aim_rifle", 0.25)
	gunshot.emit(player.global_position)
	get_tree().call_group("pedestrians", "hear_noise", player.global_position, true)
	if not hit.is_empty():
		var n := hit.collider as Node
		while n != null and not n.is_in_group("npc"):
			n = n.get_parent()
		if n != null and n.has_method("take_hit"):
			n.take_hit(PISTOL_DAMAGE, player)
	_spark(at)
	return true


func _spark(at: Vector3) -> void:
	var m := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.07
	s.height = 0.14
	m.mesh = s
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(1.0, 0.8, 0.3)
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.7, 0.2)
	mat.emission_energy_multiplier = 3.0
	m.material_override = mat
	world.add_child(m)
	m.global_position = at
	get_tree().create_timer(0.08).timeout.connect(m.queue_free)


# ── death ─────────────────────────────────────────────────────────────────────

func _on_player_died() -> void:
	hud.toast("WASTED", 3.0)
	await get_tree().create_timer(2.2).timeout
	respawn()


func respawn() -> void:
	player.dead = false
	player.health = Player.MAX_HEALTH
	player.global_position = World.spawn_point()
	player.velocity = Vector3.ZERO
	state.add_cash(-mini(RESPAWN_FEE, state.cash))
	state.set_stars(0)
	hud.toast("Patched up for $%d." % RESPAWN_FEE, 3.0)
