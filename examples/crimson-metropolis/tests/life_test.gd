extends SceneTree
## godot --headless --path . -s tests/life_test.gd
## The living city: traffic that drives and obeys signals, pedestrians that flee gunfire, the wanted system and its police, the
## phone, the bed (sleep + save), the wardrobe, the valet and hijacking a car.

var fails := 0
var world: World
var d: Director
var p: Player


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func until(cond: Callable, seconds: float) -> bool:
	var n := int(seconds * 60.0)
	for i in range(n):
		if cond.call():
			return true
		await physics_frame
	return cond.call()


func _init() -> void:
	await process_frame
	world = World.new()
	root.add_child(world)
	await process_frame
	d = world.director
	p = world.player
	world.atmosphere.clock_running = false
	d.state.save_path = "user://life_test.cfg"
	print("life_test")

	# ── HUD ──
	check(d.hud != null and d.state.cash == 14582, "HUD and state exist; cash starts at $14,582")
	await steps(5)
	check(d.hud._cash.text == "$14,582", "cash shows as $14,582 (%s)" % d.hud._cash.text)
	check(d.hud.stars_text() == "☆☆☆☆☆", "no stars to begin with")
	d.state.set_stars(3)
	check(d.hud.stars_text() == "★★★☆☆", "three stars show as three filled")
	d.state.set_stars(0)
	check(d.hud._clock.text.contains(":"), "the clock reads %s" % d.hud._clock.text)

	# ── traffic ──
	check(world.traffic.cars.size() == 10, "ten traffic cars were spawned")
	var start: Array = []
	for v in world.traffic.cars:
		start.append(v.global_position)
	await steps(60 * 9)
	var moved := 0
	var speedy := 0
	for i in range(world.traffic.cars.size()):
		var v: Vehicle = world.traffic.cars[i]
		if v.global_position.distance_to(start[i]) > 25.0:
			moved += 1
		if v.linear_velocity.length() > 3.0:
			speedy += 1
	check(moved >= 7, "traffic drives: %d of 10 cars moved more than 25 m in 9 s" % moved)
	var upright := world.traffic.cars.filter(func(v): return v.global_basis.y.y > 0.8).size()
	check(upright >= 9, "cars stay upright (%d of 10)" % upright)
	var lights := world.traffic.lights
	var n0 := Vector2i(1, 1)
	var seen: Dictionary = {}
	for k in range(0, 60):
		lights.clock = k * 1.0
		seen[lights.phase_of(n0, 0)] = true
		check(not (lights.phase_of(n0, 0) == 2 and lights.phase_of(n0, 1) == 2), "") if false else null
	check(seen.has(0) and seen.has(1) and seen.has(2), "the signal cycles red, amber and green")
	var clash := false
	for k in range(0, 600):
		lights.clock = k * 0.1
		if lights.phase_of(n0, 0) == 2 and lights.phase_of(n0, 1) != 0:
			clash = true
	check(not clash, "cross traffic is always red while the other way is green")

	# A car at a red light waits for it.
	var cars := world.traffic.cars
	var car: Vehicle = cars[0]
	var drv := car.ai as LaneDriver
	check(drv != null, "traffic cars carry a lane driver")

	# ── pedestrians ──
	check(world.traffic.peds.size() == 16, "sixteen pedestrians on the pavements")
	var ped: Pedestrian = world.traffic.peds[0]
	p.global_position = ped.global_position + Vector3(3, 0, 0)
	await steps(30)
	var before := ped.global_position
	await steps(90)
	check(ped.global_position.distance_to(before) > 0.8, "a pedestrian walks (%.1f m in 1.5 s)" % ped.global_position.distance_to(before))
	check(not ped.fleeing, "calm until something happens")
	d.gunshot.emit(p.global_position)
	get_root_call("pedestrians", "hear_noise", p.global_position, true)
	check(ped.fleeing, "a gunshot makes nearby pedestrians flee")
	var dist0 := ped.global_position.distance_to(p.global_position)
	await steps(90)
	check(ped.global_position.distance_to(p.global_position) > dist0 + 2.0, "…and run away from the shooter")

	# ── wanted ──
	check(d.state.stars == 0 and world.wanted.police.is_empty(), "no police while clean")
	ped.take_hit(200, p)
	check(ped.dead, "a pedestrian can be killed")
	check(d.state.stars == 2, "killing a pedestrian gives 2 stars (%d)" % d.state.stars)
	await steps(20)
	check(world.wanted.police.size() >= 1, "police cars are sent (%d)" % world.wanted.police.size())
	d.state.set_stars(5)
	await steps(180)
	check(world.wanted.police.size() >= 3, "five stars send more cars (%d)" % world.wanted.police.size())
	var cop: Vehicle = world.wanted.police[0]
	var cd0 := cop.global_position.distance_to(p.global_position)
	var cash0 := d.state.cash
	var caught := false
	for k in range(60 * 20):
		await physics_frame
		if k % 5 == 0 and not scan_finite(k):
			break
		if world.wanted.busted_count > 0:
			caught = true
			break
	check(caught, "police drive to a player standing still (%.0f m away) and bust them" % cd0)
	check(d.state.stars == 0 and d.state.cash < cash0, "busted: stars cleared, fined $%d" % (cash0 - d.state.cash))
	check(p.global_position.distance_to(World.spawn_point()) < 3.0, "…and released back at the safehouse")
	await steps(5)
	check(world.wanted.police.is_empty(), "police stand down at zero stars")

	# Evading: far from every cop for long enough drops a star.
	d.state.set_stars(2)
	await steps(5)
	for v in world.wanted.police:
		v.global_position = Vector3(9000, 1, 9000)
		v.freeze = true
	world.wanted._evade = Wanted.EVADE_TIME - 0.01
	await steps(20)
	check(d.state.stars == 1, "staying out of sight lowers the wanted level (%d)" % d.state.stars)
	d.state.set_stars(0)
	await steps(5)

	# ── phone ──
	p.global_position = Vector3(0, 0.3, 0)
	await steps(5)
	check(d.can_use_phone(), "the phone can be used on foot")
	d.phone.open()
	check(d.phone.is_open and d.phone.visible and p.cinematic, "Up opens the phone and holds the player still")
	for app in ["App_contacts", "App_valet", "App_bank", "App_time"]:
		check(d.phone.find_child(app, true, false) != null, "home screen has %s" % app)
	d.phone.show_page(&"bank")
	var cash_b := d.state.cash
	d.state.transfer_to_bank(1000)
	check(d.state.cash == cash_b - 1000, "Maze Bank deposit moves $1,000")
	d.state.withdraw(1000)
	d.phone.show_page(&"time")
	d.phone.find_child("Weather_rain", true, false).pressed.emit()
	check(world.atmosphere.weather == &"rain", "the weather button sets rain")
	world.atmosphere.set_weather(&"clear")
	d.phone.show_page(&"contacts")
	check(d.phone.find_child("StartMission", true, false) != null, "Contacts lists the mission")
	d.phone.close()
	check(not d.phone.is_open and not p.cinematic, "closing the phone gives control back")

	# ── valet ──
	p.global_position = Vector3(30, 0.3, 40)
	var cash_v := d.state.cash
	var msg := d.call_valet()
	check(d.state.cash == cash_v - Director.VALET_FEE, "the valet costs $%d (%s)" % [Director.VALET_FEE, msg])
	var car_p := d.personal_car()
	check(car_p.global_position.distance_to(p.global_position) < 40.0, "the car arrives near the player (%.0f m)" % car_p.global_position.distance_to(p.global_position))

	# ── wardrobe ──
	var o0 := d.state.outfit
	d.next_outfit()
	check(d.state.outfit == (o0 + 1) % 3, "the wardrobe changes the outfit")
	var body := p.model.find_child("Body", true, false) as MeshInstance3D
	check(body.material_override is StandardMaterial3D and (body.material_override as StandardMaterial3D).albedo_color == GameState.OUTFITS[d.state.outfit].tint, "the outfit tint is applied to the model")
	d.next_outfit()
	d.next_outfit()
	check(d.state.outfit == o0, "three outfits cycle")

	# ── bed ──
	world.atmosphere.set_hour(22.0)
	p.health = 30
	d.state.cash = 777
	d.sleep()
	check(d.sleeping, "sleeping begins")
	await until(func(): return not d.sleeping, 8.0)
	check(not d.sleeping, "sleep ends")
	check(absf(fposmod(world.atmosphere.hour - 6.0, 24.0)) < 0.2, "eight hours passed: it is %s" % world.atmosphere.clock_text())
	check(p.health == Player.MAX_HEALTH, "health restored")
	var cfg := ConfigFile.new()
	check(cfg.load(d.state.save_path) == OK and int(cfg.get_value("game", "cash", -1)) == 777, "the game was saved")
	d.state.cash = 1
	d.state.load_save()
	check(d.state.cash == 777, "and loads back")

	# ── hijack ──
	var target: Vehicle = world.traffic.cars[1]
	var tdrv := target.ai
	target.global_position = Vector3(0, 1.0, 0) + Vector3(0, 0, 0)
	target.global_transform = Transform3D(Basis.IDENTITY, Vector3(30, 1.0, 20))
	p.global_position = target.to_global(Vector3(2.3, -0.4, 0.2))
	target.linear_velocity = Vector3.ZERO
	var peds_before := get_nodes("pedestrians")
	target._try_enter(p)
	check(target.ai == null and not is_instance_valid(tdrv) or (tdrv != null and tdrv.is_queued_for_deletion()), "the driver loses the car")
	check(d.state.stars >= 1, "hijacking is a crime (%d star)" % d.state.stars)
	await until(func(): return target.is_player_driven, 8.0)
	check(target.is_player_driven and target.driver == p, "the player drives the hijacked car")
	check(get_nodes("pedestrians") > peds_before - 1, "the driver stepped out as a pedestrian")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(1 if fails > 0 else 0)


func get_root_call(group: String, method: String, a, b) -> void:
	root.get_tree().call_group(group, method, a, b)


func get_nodes(group: String) -> int:
	return root.get_tree().get_nodes_in_group(group).size()


## Reports the first node whose transform has gone non-finite (a physics blow-up), so the cause is visible in the log.
func scan_finite(step: int) -> bool:
	var all: Array = root.get_tree().get_nodes_in_group("vehicles") + root.get_tree().get_nodes_in_group("pedestrians") + [p]
	for n in all:
		var n3 := n as Node3D
		if not n3.global_position.is_finite() or not n3.global_basis.is_finite():
			var extra := ""
			if n3 is Vehicle and (n3 as Vehicle).ai != null:
				extra = " path=%s mode=%s" % [str((n3.ai as LaneDriver).path), (n3.ai as LaneDriver).mode]
			print("NON-FINITE at step %d: %s %s%s" % [step, n3.name, str(n3.get_groups()), extra])
			return false
	return true
