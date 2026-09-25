extends SceneTree
## Builds every map headless and checks it: build time, that the ground
## collision matches the height data, that the road collision sits on the
## road, and how many nodes/instances each map made.
##   godot --headless --path . -s tests/world_test.gd [-- map ...]

var fails := 0


func _init() -> void:
	var ids := OS.get_cmdline_user_args()
	if ids.is_empty():
		ids = PackedStringArray(["hills", "metro", "canyon", "frost"])
	for id in ids:
		await _check(id)
	print("WORLD TEST: ", "PASS" if fails == 0 else "%d FAILURES" % fails)
	quit(1 if fails else 0)


func _ok(cond: bool, what: String) -> void:
	print(("  ok   " if cond else "  FAIL ") + what)
	if not cond:
		fails += 1


func _check(id: String) -> void:
	var t0 := Time.get_ticks_msec()
	var w := WorldBuilder.new(id)
	w.build()
	var ms := Time.get_ticks_msec() - t0
	get_root().add_child(w)
	await physics_frame
	await physics_frame
	print("%s: built in %d ms, %d nodes, %d road samples, %d coins, %d traffic" % [id, ms, _count(w), w.samples.size(), w.coins.total(), w.traffic.cars.size()])
	var space := w.get_world_3d().direct_space_state
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	var worst := 0.0
	var misses := 0
	for k in 60:
		var x := rng.randf_range(-900, 900)
		var z := rng.randf_range(-900, 900)
		var hit := _ray(space, x, z)
		if hit.is_empty():
			misses += 1
			continue
		var h := w.height_at(x, z)
		# Props and buildings sit on top, so only compare ground hits.
		if (hit.collider as Node).name == "Ground":
			worst = maxf(worst, absf(hit.position.y - h))
	_ok(misses == 0, "ground under every random point (%d misses)" % misses)
	_ok(worst < 1.0, "ground collision matches heights (worst %.2f m)" % worst)
	var road_err := 0.0
	for k in 40:
		var i := rng.randi_range(0, w.main_count - 1)
		var s := w.samples[i]
		var hit2 := _ray(space, s.x, s.z)
		if not hit2.is_empty():
			road_err = maxf(road_err, absf(hit2.position.y - s.y))
	_ok(road_err < 0.25, "road surface on the centreline (worst %.3f m)" % road_err)
	var sp := w.spawn_transform()
	_ok(not _ray(space, sp.origin.x, sp.origin.z).is_empty(), "spawn has ground")
	_ok(w.portals.size() == 3, "three portals")
	#w.free()
	w.queue_free()
	await process_frame


func _ray(space: PhysicsDirectSpaceState3D, x: float, z: float) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, 900, z), Vector3(x, -300, z))
	return space.intersect_ray(q)


func _count(n: Node) -> int:
	var c := 1
	for ch in n.get_children():
		c += _count(ch)
	return c
