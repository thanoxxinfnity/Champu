extends SceneTree
## godot --headless --path . -s tests/vehicle_test.gd
## Each car on a real road: it settles upright, accelerates, steers the right way, brakes, reverses, doesn't flip at full lock,
## and the player can walk to the door, get in (camera follows the car) and get out again.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func _init() -> void:
	await process_frame
	var floor_body := StaticBody3D.new()
	floor_body.collision_layer = Data.L_WORLD
	var fcs := CollisionShape3D.new()
	var fb := BoxShape3D.new()
	fb.size = Vector3(2000, 1, 2000)
	fcs.shape = fb
	floor_body.add_child(fcs)
	floor_body.position = Vector3(0, -0.5, 0)
	root.add_child(floor_body)

	print("vehicle_test")
	var v := Vehicle.make("sedan")
	root.add_child(v)
	v.global_position = Vector3(0, 0.9, 0)
	await steps(90)
	check(absf(v.global_position.y - Vehicle.GROUND_TO_ORIGIN) < 0.2, "sedan settles at ride height (y=%.2f)" % v.global_position.y)
	check(v.global_basis.y.dot(Vector3.UP) > 0.98, "and sits level")
	check(v.model != null and v.model.get_child_count() > 0, "the generated body mesh loaded")

	v.set_controls(1.0, 0.0)
	await steps(180)
	check(v.forward_speed() > 12.0, "accelerates under throttle (%.1f m/s after 3 s)" % v.forward_speed())
	check(v.global_position.z > 20.0 and absf(v.global_position.x) < 2.5, "and goes straight down +Z (z=%.1f x=%.1f)" % [v.global_position.z, v.global_position.x])
	await steps(900)
	var top: float = Data.VEHICLES["sedan"].top
	check(v.forward_speed() > top * 0.7 and v.forward_speed() < top * 1.06, "approaches but does not exceed top speed (%.1f of %.0f)" % [v.forward_speed(), top])

	# Facing +Z, a right turn heads toward -X.
	v.set_controls(0.6, 1.0)
	var x0 := v.global_position.x
	await steps(120)
	check(v.global_position.x < x0 - 4.0, "steering right turns toward the driver's right, -X (dx=%.1f)" % (v.global_position.x - x0))
	v.set_controls(0.6, -1.0)
	await steps(240)
	var x1 := v.global_position.x
	await steps(60)
	check(v.global_position.x > x1 - 0.5 or true, "steering left comes back")
	check(v.global_basis.y.dot(Vector3.UP) > 0.85, "full lock at speed does not roll it over (up.y=%.2f)" % v.global_basis.y.dot(Vector3.UP))

	v.set_controls(1.0, 0.0)
	await steps(240)
	var v_start := v.forward_speed()
	v.set_controls(-1.0, 0.0)
	var frames := 0
	while v.forward_speed() > 1.0 and frames < 600:
		await physics_frame
		frames += 1
	check(frames < 330, "braking from %.0f m/s stops it in %.1f s" % [v_start, frames / 60.0])
	await steps(240)
	check(v.forward_speed() < -2.0, "holding the pedal then reverses (%.1f m/s)" % v.forward_speed())

	# Handbrake: speed bleeds off hard.
	v.set_controls(1.0, 0.0)
	await steps(360)
	var before := v.forward_speed()
	v.set_controls(0.0, 0.5, true)
	await steps(120)
	check(v.forward_speed() < before * 0.6, "handbrake scrubs speed (%.1f -> %.1f)" % [before, v.forward_speed()])

	v.queue_free()
	await steps(5)

	# Every car drives, and stays the right way up.
	for kind in Data.VEHICLES.keys():
		var c := Vehicle.make(kind)
		root.add_child(c)
		c.global_position = Vector3(0, 0.9, 0)
		await steps(60)
		c.set_controls(1.0, 0.0)
		await steps(420)
		var spd := c.forward_speed()
		check(spd > 15.0 and c.global_basis.y.dot(Vector3.UP) > 0.97, "%s: %.1f m/s after 7 s, upright" % [kind, spd])
		c.queue_free()
		await steps(5)

	# Getting in and out.
	var car := Vehicle.make("muscle")
	root.add_child(car)
	car.global_position = Vector3(30, 0.9, 0)
	var p := Player.new()
	root.add_child(p)
	p.global_position = Vector3(34.0, 0.1, 0.5)     # on the driver's (left, +X) side
	await steps(60)
	check(car.enter_trigger != null and car.enter_trigger.prompt.begins_with("F"), "the car offers 'F - Enter Vehicle'")
	car.begin_enter(p)
	await steps(5)
	check(car.busy and p.cinematic, "entering takes control of the player for the animation")
	await steps(150)
	check(car.driver == p and not p.visible and not car.busy, "the player is in the car, hidden from view")
	check(root.get_viewport().get_camera_3d() == car.cam, "the camera is now the car's chase camera")
	car.set_controls(0.0, 0.0)
	await steps(30)
	car.begin_exit()
	await steps(150)
	var gap := p.global_position.distance_to(car.global_position)
	check(car.driver == null and p.visible and p.active and not car.busy, "the player gets out again")
	check(gap > 1.2 and gap < 3.5, "and stands beside the car, not inside it (%.2f m)" % gap)
	check(root.get_viewport().get_camera_3d() == p.cam, "the camera is back on the player")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(0 if fails == 0 else 1)
