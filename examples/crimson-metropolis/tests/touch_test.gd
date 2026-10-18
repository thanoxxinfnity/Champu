extends SceneTree
## godot --headless --path . -s tests/touch_test.gd
## The on-screen controls drive the same fields the keyboard does: stick → walking, USE → doors and cars, stick → throttle and
## steering in a car, FIRE, PHONE and drag-to-look.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	OS.set_environment("CM_TOUCH", "1")
	await process_frame
	var world := World.new()
	root.add_child(world)
	await process_frame
	for c in world.traffic.cars:
		c.process_mode = Node.PROCESS_MODE_DISABLED
	var d := world.director
	var p := world.player
	var t := d.touch
	print("touch_test")
	await physics_frame
	for n in ["Use", "Jump", "Fire", "Sprint", "Phone"]:
		check(t.find_child(n, true, false) != null, "button %s exists" % n)

	var start := p.global_position
	t.set_stick(Vector2(0, -1))
	for i in range(90):
		await physics_frame
	check(p.global_position.distance_to(start) > 2.0, "pushing the stick up walks the player (%.1f m)" % p.global_position.distance_to(start))
	t.set_stick(Vector2.ZERO)
	await physics_frame
	check(p.ext_move == Vector2.ZERO, "releasing it stops")

	var yaw0 := p.yaw
	t.look(Vector2(120, 0))
	check(absf(p.yaw - yaw0) > 0.1, "dragging on the right turns the camera")

	var shots := d.shots_fired
	d.fire()
	t._buttons[&"fire"].pressed.emit()
	await physics_frame
	check(d.shots_fired >= shots + 1, "the FIRE button shoots")

	t.press(&"phone")
	check(d.phone.is_open, "the PHONE button opens the phone")
	t.press(&"phone")
	check(not d.phone.is_open, "…and closes it")

	# USE next to the player's car, then drive with the stick, then USE to get out.
	var car := d.personal_car()
	car.global_transform = Transform3D(Basis.IDENTITY, Vector3(40, 1.0, 40))
	car.linear_velocity = Vector3.ZERO
	p.global_position = car.to_global(Vector3(2.3, -0.4, 0.2))
	for i in range(30):
		await physics_frame
	check(p.focus == car.enter_trigger, "the car offers 'F - Enter Vehicle'")
	t.press(&"use")
	for i in range(60 * 4):
		await physics_frame
		if car.is_player_driven:
			break
	check(car.is_player_driven, "USE gets into the car")
	var cp := car.global_position
	t.set_stick(Vector2(0, -1))
	for i in range(120):
		await physics_frame
	check(car.global_position.distance_to(cp) > 5.0 and car.forward_speed() > 2.0, "stick up is throttle (%.1f m/s)" % car.forward_speed())
	t.set_stick(Vector2(0, 1))
	for i in range(240):
		await physics_frame
	t.set_stick(Vector2.ZERO)
	car.set_controls(0, 0, true)
	for i in range(120):
		await physics_frame
	check(absf(car.forward_speed()) < EXIT_OK, "stick down brakes to a halt")
	t.press(&"use")
	for i in range(60 * 3):
		await physics_frame
		if not car.is_player_driven:
			break
	check(not car.is_player_driven and p.active, "USE gets out again")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(1 if fails > 0 else 0)


const EXIT_OK := 5.0
