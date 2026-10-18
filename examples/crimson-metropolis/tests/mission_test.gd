extends SceneTree
## godot --headless --path . -s tests/mission_test.gd
## "The Penthouse Deal" start to finish with the real triggers: phone → tower → lift to 29 → Vance → lift to 15 → briefcase
## (alarm) → lift to the roof → helicopter → paid.

var fails := 0
var world: World
var p: Player
var d: Director
var m: PenthouseDeal
var tower: Tower
var e: ElevatorSystem


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func until(cond: Callable, seconds: float) -> bool:
	for i in range(int(seconds * 60.0)):
		if cond.call():
			return true
		await physics_frame
	return cond.call()


## Rides the lift to `stop` with the player standing inside it, like a person would.
func ride_to(stop: int) -> bool:
	e.call_to(e.current)
	await until(func(): return e.doors_open(), 15.0)
	p.global_position = e.cabin.global_position + Vector3(0, 0.15, 0)
	await steps(20)
	e.go_to(stop)
	var ok := await until(func(): return not e.moving and e.current == stop and e.stop_doors[stop].is_open, 40.0)
	await steps(30)
	return ok


func _init() -> void:
	await process_frame
	world = World.new()
	root.add_child(world)
	await process_frame
	d = world.director
	p = world.player
	m = world.mission
	tower = world.tower
	e = tower.elevator
	world.atmosphere.clock_running = false
	d.state.save_path = "user://mission_test.cfg"
	print("mission_test")
	for c in world.traffic.cars:
		c.process_mode = Node.PROCESS_MODE_DISABLED     # keep traffic out of the way of the scripted walk

	check(m.stage() == PenthouseDeal.Stage.IDLE, "the mission has not started")
	d.phone.open()
	d.phone.show_page(&"contacts")
	d.phone.find_child("StartMission", true, false).pressed.emit()
	check(m.stage() == PenthouseDeal.Stage.GO_TO_TOWER, "starting it from the phone sets the first objective")
	check(d.hud.objective_text == "Go to the Crimson Tower.", "objective reads '%s'" % d.hud.objective_text)
	check(d.hud.objective_pos.distance_to(tower.global_position) < 40.0, "the radar marks the tower")
	check(not d.phone.is_open, "the phone closed itself")

	p.global_position = tower.to_global(Vector3(0, 0.3, 30))
	await steps(10)
	check(m.stage() == PenthouseDeal.Stage.TO_PENTHOUSE, "arriving at the tower moves the objective into the lift")

	check(await ride_to(2), "rides to the Luxury Penthouse [29]")
	check(m.stage() == PenthouseDeal.Stage.TALK, "being on the penthouse floor makes Vance the objective")

	# Out of the lift to Vance.
	p.global_position = m.talk_trigger.global_position + Vector3(0.8, -1.0, 0.6)
	await steps(20)
	check(p.focus == m.talk_trigger, "Vance offers 'E - Talk' (%s)" % m.talk_trigger.prompt)
	p.use_focus()
	check(await until(func(): return m.stage() == PenthouseDeal.Stage.GET_BRIEFCASE, 20.0), "his three lines play and the briefcase becomes the objective")
	check(m.lines_said.size() == 3 and m.lines_said[0].begins_with("Vance:"), "three subtitle lines were shown")

	check(await ride_to(1), "rides down to the Executive Floor [15]")
	p.global_position = m.case_trigger.global_position + Vector3(0, -1.0, -0.5)
	await steps(20)
	check(p.focus == m.case_trigger, "the briefcase offers 'E - Take Briefcase'")
	p.use_focus()
	await steps(5)
	check(m.has_case and m.stage() == PenthouseDeal.Stage.ESCAPE, "taking it sets off the alarm and sends you to the roof")
	check(d.state.stars >= 2, "the alarm gives %d stars" % d.state.stars)

	check(await ride_to(3), "rides to the rooftop [R]")
	check(m.stage() == PenthouseDeal.Stage.BOARD, "on the roof the helicopter is the objective")
	check(m.helicopter != null, "the generated helicopter stands on the pad")
	p.global_position = m.heli_trigger.global_position + Vector3(0.6, -1.0, 0.0)
	await steps(20)
	check(p.focus == m.heli_trigger, "the helicopter offers 'E - Board Helicopter'")
	var cash0 := d.state.cash
	p.use_focus()
	await steps(5)
	check(m.stage() == PenthouseDeal.Stage.DONE, "mission passed")
	check(d.state.cash == cash0 + PenthouseDeal.REWARD, "paid $%s" % Hud._commas(PenthouseDeal.REWARD))
	check(d.state.stars == 0, "the wanted level is cleared")
	var cfg := ConfigFile.new()
	check(cfg.load(d.state.save_path) == OK and int(cfg.get_value("game", "mission_stage", 0)) == 99, "completion is saved")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(1 if fails > 0 else 0)
