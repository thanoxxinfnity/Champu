extends SceneTree
## godot --headless --path . -s tests/player_test.gd
## The on-foot controller against a real floor and a real wall: it settles, walks camera-relative, sprints
## faster than it jogs, jumps and lands, stops at a wall, and the camera arm pulls in when something is behind.

var fails := 0


func check(ok: bool, what: String) -> void:
	if ok:
		print("  ok   ", what)
	else:
		print("  FAIL ", what)
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func solid(pos: Vector3, size: Vector3) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	cs.shape = box
	b.add_child(cs)
	b.position = pos
	root.add_child(b)
	return b


func _init() -> void:
	await process_frame
	solid(Vector3(0, -0.5, 0), Vector3(200, 1, 200))          # floor, top at y = 0
	var p := Player.new()
	root.add_child(p)
	p.global_position = Vector3(0, 0.6, 0)
	await steps(40)

	print("player_test")
	check(p.is_on_floor(), "settles on the floor")
	check(absf(p.global_position.y) < 0.06, "stands at floor height (y=%.3f)" % p.global_position.y)
	check(p.animation_state() == &"idle", "idles when still (%s)" % p.animation_state())
	check(p.model != null and p.anim != null, "the rigged character loaded")

	# Camera-relative walking: yaw 0 looks down -Z, so "forward" is -Z.
	p.yaw = 0.0
	p.set_move_input(Vector2(0, -1))
	var z0 := p.global_position.z
	await steps(90)
	check(p.global_position.z < z0 - 3.0, "forward moves along the camera's heading (-Z) (dz=%.2f)" % (p.global_position.z - z0))
	check(absf(p.global_position.x) < 0.2, "no sideways drift (x=%.2f)" % p.global_position.x)
	var jog := p.horizontal_speed()
	check(jog > 4.0 and jog <= 4.8, "jog speed ~4.6 (%.2f)" % jog)
	check(p.animation_state() == &"run", "plays run at jog speed (%s)" % p.animation_state())

	p.set_move_input(Vector2(0, -1), true)
	await steps(60)
	var sprint := p.horizontal_speed()
	check(sprint > jog + 1.5, "sprint is faster than jog (%.2f vs %.2f)" % [sprint, jog])
	check(p.cam.fov > 70.0, "FOV widens while sprinting (%.1f)" % p.cam.fov)

	# Yaw 90° looks toward -X: forward must now go -X, not -Z.
	p.set_move_input(Vector2.ZERO)
	await steps(30)
	check(p.horizontal_speed() < 0.5, "stops when input is released (%.2f)" % p.horizontal_speed())
	p.yaw = PI * 0.5
	var before := p.global_position
	p.set_move_input(Vector2(0, -1))
	await steps(60)
	var d := p.global_position - before
	check(d.x < -2.5 and absf(d.z) < 0.4, "forward follows a turned camera (dx=%.2f dz=%.2f)" % [d.x, d.z])

	# Walk (light stick) is slower than jog.
	p.set_move_input(Vector2(0, -0.45))
	await steps(60)
	check(p.horizontal_speed() < 2.6 and p.animation_state() == &"walk", "light stick walks (%.2f, %s)" % [p.horizontal_speed(), p.animation_state()])

	# Jump: leaves the ground, comes back down.
	p.set_move_input(Vector2.ZERO)
	await steps(30)
	var floor_y := p.global_position.y
	p.press_jump()
	await steps(8)
	check(p.global_position.y > floor_y + 0.3 and not p.is_on_floor(), "jump leaves the ground (y=%.2f)" % p.global_position.y)
	check(p.animation_state() == &"jump", "plays jump in the air (%s)" % p.animation_state())
	await steps(70)
	check(p.is_on_floor() and absf(p.global_position.y - floor_y) < 0.06, "lands back on the floor")

	# A wall stops it.
	p.global_position = Vector3(50, 0.1, 50)
	p.yaw = 0.0
	solid(Vector3(50, 2, 44), Vector3(10, 4, 1))               # wall face at z = 44.5
	await steps(10)
	p.set_move_input(Vector2(0, -1), true)
	await steps(180)
	check(p.global_position.z > 44.5 + 0.3, "stops at a wall instead of walking through it (z=%.2f)" % p.global_position.z)

	# The camera arm pulls in against a wall behind the player, and never ends up inside it.
	p.set_move_input(Vector2.ZERO)
	p.global_position = Vector3(-60, 0.1, 0)
	solid(Vector3(-60, 2, 2.0), Vector3(10, 4, 0.5))           # 2 m behind a player facing -Z (camera sits at +Z)
	p.yaw = 0.0
	p.pitch = -0.05
	await steps(30)
	check(p.cam_arm.get_hit_length() < Player.CAM_DISTANCE - 0.5, "camera arm shortens against a wall (%.2f of %.2f)" % [p.cam_arm.get_hit_length(), Player.CAM_DISTANCE])
	check(p.cam.global_position.z < 2.0 - 0.25 + 0.05, "the camera stays in front of that wall (z=%.2f)" % p.cam.global_position.z)

	# Shoulder switch swaps the camera to the other side.
	var sx := p.cam_arm.position.x
	p.switch_shoulder()
	await steps(40)
	check(signf(p.cam_arm.position.x) == -signf(sx), "V swaps shoulders (%.2f -> %.2f)" % [sx, p.cam_arm.position.x])

	# Damage and death.
	var got := []
	p.died.connect(func(): got.append(true))
	p.hurt(30)
	check(p.health == 70, "hurt reduces health (%d)" % p.health)
	p.hurt(500)
	check(p.dead and got.size() == 1, "death fires once")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(0 if fails == 0 else 1)
