extends SceneTree
## godot --headless --path . -s tests/tower_test.gd
## The lift, used the way a player uses it: walk in from the street, press the call button, step into the cabin, read the floor
## panel, ride to the executive floor, the penthouse and the roof, walk out at each, and call the cabin back from upstairs.

var fails := 0
var world: World
var tower: Tower
var e: ElevatorSystem
var p: Player


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func until(cond: Callable, seconds: float) -> bool:
	var t := 0.0
	while t < seconds:
		if cond.call():
			return true
		await physics_frame
		t += 1.0 / 60.0
	return cond.call()


## Walk (with the real controller) to a world position; true on arrival.
func go(world_pos: Vector3, timeout := 12.0) -> bool:
	var t := 0.0
	while t < timeout:
		await physics_frame
		t += 1.0 / 60.0
		var d := world_pos - p.global_position
		d.y = 0.0
		if d.length() < 0.35:
			p.set_move_input(Vector2.ZERO)
			return true
		p.yaw = atan2(-d.x, -d.z)
		p.set_move_input(Vector2(0, -0.8))
	p.set_move_input(Vector2.ZERO)
	return false


## Into the cabin the way a person does: to the front of the doors first, then straight in.
func enter_cabin() -> bool:
	var front := e.cabin.global_position + Vector3(0, 0.0, ElevatorSystem.CAB_D * 0.5 + 1.6)
	if not await go(Vector3(front.x, p.global_position.y, front.z), 12.0):
		return false
	return await go(Vector3(e.cabin.global_position.x, p.global_position.y, e.cabin.global_position.z + 0.2), 8.0)


func stop_world_y(i: int) -> float:
	return tower.to_global(Vector3(0, e.stops[i].y, 0)).y


func ride_to(i: int, what: String) -> void:
	var button := e.panel._buttons.filter(func(b): return int(b.get_meta("stop")) == i)[0] as Button
	button.pressed.emit()
	var from := e.current
	await until(func(): return absf(e.cabin.global_position.y - stop_world_y(from)) > 3.0, 8.0)
	check(e.moving and not e.stop_doors[from].is_open, what + ": the doors shut and the cabin is moving")
	check(absf(p.global_position.y - e.cabin.global_position.y) < 0.4, what + ": the rider travels with the cabin (offset %.2f m)" % absf(p.global_position.y - e.cabin.global_position.y))
	var arrived := await until(func(): return not e.moving and e.current == i and e.stop_doors[i].is_open, 40.0)
	check(arrived, what + ": arrives and the doors open")
	check(absf(e.cabin.global_position.y - stop_world_y(i)) < 0.05 and absf(p.global_position.y - stop_world_y(i)) < 0.3, what + ": level with the floor (cabin y=%.2f, wanted %.2f)" % [e.cabin.global_position.y, stop_world_y(i)])


func _init() -> void:
	await process_frame
	world = World.new()
	world.with_life = false
	root.add_child(world)
	await process_frame
	tower = world.tower
	e = tower.elevator
	p = world.player
	world.atmosphere.clock_running = false
	print("tower_test")

	check(e.stops.size() == 4 and e.stops[0].label == "G" and e.stops[1].label == "15" and e.stops[2].label == "29" and e.stops[3].label == "R", "four stops: G, 15, 29, R")
	check(e.current == 0 and not e.moving and not e.stop_doors[0].is_open, "the cabin waits at the ground floor, doors shut")

	# In from the street through the sliding glass doors.
	p.global_position = tower.to_global(Vector3(0.0, 0.3, 30.0))
	for i in range(30):
		await physics_frame
	check(await go(tower.to_global(Vector3(0.0, 0.2, 12.0)), 15.0), "walks in through the entrance (the glass doors slide open)")
	check(tower.entrance.is_open or tower.entrance.moving, "the entrance doors opened for them")

	# The call button.
	var btn := e.call_buttons[0]
	check(await go(btn.global_position + Vector3(0.6, -1.1, 1.0)), "walks to the call button")
	for i in range(15):
		await physics_frame
	check(p.focus == btn, "the button offers 'E - Call Elevator' (%s)" % btn.prompt)
	p.use_focus()
	check(await until(func(): return e.doors_open(), 6.0), "the lift doors open")

	# Into the cabin; the floor panel shows.
	check(await enter_cabin(), "steps into the cabin")
	for i in range(10):
		await physics_frame
	check(e.panel.visible, "the floor panel appears while inside")
	var texts := e.panel._buttons.map(func(b): return b.text)
	check(texts == ["[R] Rooftop Helipad", "[29] Luxury Penthouse", "[15] Executive Floor", "[G] Ground Lobby"], "the panel lists the four floors, top first: %s" % str(texts))

	await ride_to(1, "to 15")
	check(await go(tower.to_global(Vector3(0.0, 0.2, 6.0)) + Vector3(0, stop_world_y(1) - tower.global_position.y, 0), 12.0), "walks out into the executive office")
	check(absf(p.global_position.y - stop_world_y(1)) < 0.3 and p.is_on_floor(), "and stands on its floor")

	# Call it back from up here, then go up further.
	var btn1 := e.call_buttons[1]
	await go(btn1.global_position + Vector3(0.6, -1.1, 1.0))
	e.call_to(0)
	await until(func(): return e.moving, 3.0)
	await until(func(): return not e.moving and e.current == 0, 40.0)
	check(e.current == 0, "the cabin can be sent away to the lobby")
	for i in range(15):
		await physics_frame
	p.use_focus()
	check(await until(func(): return e.current == 1 and e.doors_open(), 40.0), "pressing the call button up there brings it back")

	check(await enter_cabin(), "steps back in")
	for i in range(10):
		await physics_frame
	await ride_to(2, "to 29")
	check(await go(tower.to_global(Vector3(4.0, 0.2, 4.0)) + Vector3(0, stop_world_y(2) - tower.global_position.y, 0), 12.0), "walks out into the penthouse")
	check(tower.boss_spot != null and tower.boss_spot.global_position.y > stop_world_y(2) - 0.5, "the host has a spot in the penthouse")

	check(await enter_cabin(), "back into the cabin")
	for i in range(10):
		await physics_frame
	await ride_to(3, "to R")
	check(await go(tower.heli_pad.global_position, 12.0), "walks out onto the helipad")
	check(absf(p.global_position.y - stop_world_y(3)) < 0.3, "the helipad is at the roof level (%.1f m up)" % p.global_position.y)

	check(await enter_cabin(), "back in")
	for i in range(10):
		await physics_frame
	await ride_to(0, "down to G")

	# A jammed lift ignores calls.
	e.set_jammed(true)
	var cur := e.current
	e.call_to(2)
	await physics_frame
	check(not e.moving and e.current == cur, "a jammed lift does not move")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(0 if fails == 0 else 1)
