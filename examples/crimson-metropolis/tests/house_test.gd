extends SceneTree
## godot --headless --path . -s tests/house_test.gd
## A bot walks the safehouse with the real controller: front door (opens it), hall, up the stairs, into the bedroom through
## its door, to the bed, and back down and out through the garage. Every leg must arrive, with the floor under it.

var fails := 0
var world: World
var h: Safehouse
var p: Player


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func local_to_world(v: Vector2) -> Vector3:
	return h.to_global(Vector3(v.x, 0.0, v.y))


## Walk to a point (house-local x, z); opens any closed door that is in front of us on the way. Returns true on arrival.
func go(target: Vector2, what: String, timeout := 15.0) -> bool:
	var goal := local_to_world(target)
	var t := 0.0
	var pause := 0.0
	while t < timeout:
		await physics_frame
		t += 1.0 / 60.0
		var d := goal - p.global_position
		d.y = 0.0
		if d.length() < 0.55:
			p.set_move_input(Vector2.ZERO)
			return true
		if pause > 0.0:
			pause -= 1.0 / 60.0
			p.set_move_input(Vector2.ZERO)
			continue
		p.yaw = atan2(-d.x, -d.z)
		p.set_move_input(Vector2(0, -0.85))
		var f := p.focus
		if f is UseTrigger and f.get_parent() is InteractiveDoor:
			var door := f.get_parent() as InteractiveDoor
			var to_door := (f as Node3D).global_position - p.global_position
			to_door.y = 0.0
			if not door.is_open and not door.moving and to_door.length() < 1.9 and to_door.normalized().dot(d.normalized()) > 0.3:
				p.use_focus()
				pause = 1.0
	p.set_move_input(Vector2.ZERO)
	return false


func leg(target: Vector2, what: String, floor_y := -1.0) -> void:
	var ok := await go(target, what)
	var detail := ""
	if floor_y >= 0.0:
		ok = ok and absf(p.global_position.y - floor_y) < 0.45
		detail = " (y=%.2f)" % p.global_position.y
	check(ok, what + detail)


func _init() -> void:
	await process_frame
	world = World.new()
	root.add_child(world)
	await process_frame
	h = world.safehouse
	p = world.player
	world.atmosphere.clock_running = false
	for i in range(30):
		await physics_frame

	print("house_test")
	check(p.is_on_floor(), "the player starts on the footpath")
	var fd := h.front_doors[0]
	check(not fd.is_open, "the front door starts shut")
	var ground := Safehouse.FLOOR_Y
	var upper := Safehouse.UPPER_Y

	await leg(Vector2(-0.55, -1.5), "reaches the front doors")
	await leg(Vector2(-0.55, 2.2), "walks in through the front door", ground)
	check(fd.is_open or h.front_doors[1].is_open, "a front door opened for them")
	await leg(Vector2(0.0, 4.5), "crosses the hall", ground)
	await leg(Vector2(-2.0, 5.6), "reaches the foot of the stairs", ground)
	await leg(Vector2(-2.0, 12.0), "climbs the stairs", ground + 2.0)
	await leg(Vector2(-2.0, 16.8), "arrives on the upstairs landing", upper)
	await leg(Vector2(1.2, 16.0), "walks into the corridor", upper)
	await leg(Vector2(1.6, 9.0), "reaches the bedroom door", upper)
	await leg(Vector2(5.0, 9.0), "goes through the bedroom door", upper)
	await leg(Vector2(9.0, 12.4), "crosses the bedroom to the bed", upper)
	for i in range(10):
		await physics_frame
	check(p.focus == h.bed_use, "the bed offers 'E - Sleep' (focus=%s)" % p.focus)
	await leg(Vector2(4.6, 14.2), "walks to the wardrobe", upper)
	for i in range(10):
		await physics_frame
	check(p.focus == h.wardrobe_use, "the wardrobe offers 'E - Change Clothes'")

	await leg(Vector2(1.6, 9.2), "back out of the bedroom", upper)
	await leg(Vector2(1.2, 16.8), "to the landing", upper)
	await leg(Vector2(-1.9, 16.8), "to the head of the stairs", upper)
	await leg(Vector2(-2.0, 14.0), "steps onto the stairs", ground + 2.9)
	await leg(Vector2(-2.0, 7.0), "descends the stairs", ground + 0.4)
	await leg(Vector2(-1.2, 3.0), "back in the hall", ground)
	await leg(Vector2(-4.5, 2.5), "through the garage door into the garage", ground)
	await leg(Vector2(-7.5, 5.0), "walks up to the car", ground)
	var gd := h.garage_door
	await leg(Vector2(-7.5, -4.0), "leaves through the garage door", ground)
	check(gd.is_open or gd.moving, "the garage door rose for them")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(0 if fails == 0 else 1)
