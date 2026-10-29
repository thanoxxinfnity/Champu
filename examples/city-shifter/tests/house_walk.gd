extends SceneTree
## A capsule like the hero's walks into a House through the door, then up the first flight: proves the colliders (porch ramp, door, stair ramp) carry a body.
##   godot --headless --path . -s tests/house_walk.gd
func _initialize() -> void:
	var ground := StaticBody3D.new()
	var gs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(600, 1, 600)
	gs.shape = box
	ground.add_child(gs)
	ground.position.y = -0.5
	root.add_child(ground)
	var bad := 0
	for style in 4:
		var h := House.new().build(11.0 if style % 2 == 0 else 8.0, 8.0 if style < 2 else 7.0, 2, style)
		root.add_child(h)
		h.position = Vector3(style * 30.0, 0, 0)
		var hw := h.size.x * 0.5
		var hd := h.size.y * 0.5
		var body := CharacterBody3D.new()
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = 0.35
		cap.height = 1.7
		cs.shape = cap
		cs.position.y = 0.85
		body.add_child(cs)
		body.collision_layer = 2
		body.collision_mask = 1
		body.floor_snap_length = 0.3
		body.floor_max_angle = deg_to_rad(50.0)
		root.add_child(body)
		body.global_position = h.global_position + Vector3(0.45, 0.05, hd + 3.0)
		await physics_frame
		for i in 43:                                          # through the door: straight towards -Z at 5 m/s, to the entrance hall
			body.velocity = Vector3(0, body.velocity.y - 20.0 * (1.0 / 60.0), -5.0)
			body.move_and_slide()
			await physics_frame
		var inside := body.global_position - h.global_position
		var in_ok := inside.z < hd - 0.2 and inside.z > hd - 1.2
		print("style %d: after the door z=%.2f y=%.2f %s" % [style, inside.z, inside.y, "OK" if in_ok else "STUCK"])
		var sx := -hw + 0.25 + 0.7                            # along the hall to the foot of the stair (left strip)
		for i in 300:
			var dx := sx - (body.global_position - h.global_position).x
			if absf(dx) < 0.1:
				break
			body.velocity = Vector3(signf(dx) * 4.0, body.velocity.y - 20.0 * (1.0 / 60.0), 0.0)
			body.move_and_slide()
			await physics_frame
		var foot := body.global_position - h.global_position
		print("style %d: at the stair foot x=%.2f z=%.2f" % [style, foot.x, foot.z])
		for i in 360:                                         # up the flight
			var cur2 := body.global_position - h.global_position
			body.velocity = Vector3(clampf((sx - cur2.x) * 6.0, -3.0, 3.0), body.velocity.y - 20.0 * (1.0 / 60.0), -3.5)
			body.move_and_slide()
			if i % 60 == 0 and OS.get_environment("WALK_DEBUG") != "":
				print("  t=%d pos=%s on_floor=%s" % [i, cur2, body.is_on_floor()])
			await physics_frame
		var up := body.global_position - h.global_position
		var up_ok := up.y > 3.3 and up.z < -hd + 1.4
		print("style %d: after the stair y=%.2f z=%.2f %s" % [style, up.y, up.z, "OK" if up_ok else "NOT UP"])
		if not in_ok or not up_ok:
			bad += 1
		body.queue_free()
	print("HOUSE_WALK ", "ALL OK" if bad == 0 else "FAILED %d" % bad)
	quit(0 if bad == 0 else 1)
