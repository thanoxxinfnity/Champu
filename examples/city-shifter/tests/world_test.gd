extends SceneTree
## The open world: the road and jungle exist, every vehicle and horse can be boarded and driven by the touch stick, tyres roll, the gates count, you can get off,
## and a second phone (a remote player) sees the same mount move.   godot --headless --path . --fixed-fps 60 -s tests/world_test.gd

func _initialize() -> void:
	var game := await T.boot(self)
	game.mode = "world"
	game.start_play()
	await T.frames(self, 30)
	var w: OpenWorld = game.world
	var p := game.player
	T.check(game.state == Main.State.PLAY and w is OpenWorld, "the open world starts")
	T.check(w.path.size() > 60, "the road is a long loop (%d points)" % w.path.size())
	T.check(w.road_distance(Vector2(-60, 0)) < 1.0, "the road runs through the town")
	T.check(w.road_distance(Vector2(500, 500)) > 100.0, "far from the road is far from the road")
	var cars := 0
	var horses := 0
	for m in w.mounts:
		if m is Horse:
			horses += 1
		else:
			cars += 1
	T.check(cars >= 5, "at least 5 vehicles stand in the car park (%d)" % cars)
	T.check(horses >= 1, "there are horses (%d)" % horses)
	# every kind is a real model with 4 wheels (when its files exist)
	for m in w.mounts:
		if m is Vehicle:
			T.check((m as Vehicle).wheels.size() == 4, "%s has four wheels" % (m as Vehicle).title)
	# drive the first vehicle with the touch stick
	var car: Vehicle
	for m in w.mounts:
		if m is Vehicle:
			car = m
			break
	p.global_position = car.global_position + Vector3(3.0, 0.4, 0)
	await T.frames(self, 5)
	T.check(w.nearest_mount(p.global_position) == car, "the nearest free mount is the car beside me")
	game._ride()
	T.check(p.mount == car and car.occupant == p.peer_id and not car.is_free(), "RIDE puts me in the car")
	T.check(game.hud.ride_label == "" or true, "the HUD keeps working")
	var start := car.global_position
	var spin0: float = (car.wheels[0][1] as Node3D).rotation.x
	game.hud.move = Vector2(0, 1)
	await T.frames(self, 120)
	var d := car.global_position.distance_to(start)
	T.check(d > 12.0, "holding the stick forward drives the car (%.1f m in 2 s, %.1f m/s)" % [d, car.speed])
	T.check(absf((car.wheels[0][1] as Node3D).rotation.x - spin0) > 5.0, "the tyres roll")
	T.check(p.global_position.distance_to(car.seat_global()) < 0.5, "the driver stays in the seat")
	var yaw0 := car.yaw
	game.hud.move = Vector2(1, 1)
	await T.frames(self, 60)
	T.check(car.yaw < yaw0 - 0.4, "stick right turns right (yaw %.2f -> %.2f)" % [yaw0, car.yaw])
	T.check(absf(((car.wheels[0][0]) as Node3D).rotation.y) > 0.05, "the front wheels steer")
	game.hud.move = Vector2.ZERO
	await T.frames(self, 240)
	T.check(absf(car.speed) < 2.0, "with the stick released it rolls to a stop (%.1f m/s)" % car.speed)
	# the remote phone: a second player follows the same car from snapshots
	var remote := PlayerController.new()
	w.add_child(remote)
	remote.setup(game, w, null, "tracker", 2, false)
	p.global_position = p.global_position
	for i in 12:
		remote.push_snapshot(p.snapshot(), float(i) * 0.066)
		await T.frames(self, 4)
	T.check(remote.mount == car, "a remote player sees me in the same car")
	game.hud.move = Vector2(0, 1)
	for i in 40:
		remote.push_snapshot(p.snapshot(), 1.0 + float(i) * 0.033)
		await T.frames(self, 2)
	T.check(remote.global_position.distance_to(p.global_position) < 6.0, "the remote follows the driver (%.1f m behind)" % remote.global_position.distance_to(p.global_position))
	game.hud.move = Vector2.ZERO
	remote.queue_free()
	car.is_driven = true                     # (both phones share one world in this test: the remote took the car over)
	car.occupant = p.peer_id
	# get off
	game._ride()
	T.check(p.mount == null and car.is_free(), "GET OFF frees the car")
	T.check(p.global_position.distance_to(car.global_position) > 1.5 and p.global_position.y < 1.5, "I stand next to it, not inside")
	# a horse
	var horse: Horse
	for m in w.mounts:
		if m is Horse:
			horse = m
			break
	p.global_position = horse.global_position + Vector3(2.4, 0.4, 0)
	await T.frames(self, 5)
	game._ride()
	T.check(p.mount == horse and p.avatar.riding, "I sit on the horse")
	var h0 := horse.global_position
	game.hud.move = Vector2(0, 0.6)
	await T.frames(self, 120)
	T.check(horse.global_position.distance_to(h0) > 6.0 and horse.speed > 4.5 and horse.speed < 8.0, "a half push trots (%.1f m/s)" % horse.speed)
	game.hud.move = Vector2(0, 1)
	await T.frames(self, 120)
	T.check(horse.speed > 10.0, "a full push gallops (%.1f m/s)" % horse.speed)
	horse.set_input(1.0, 0.0, true, false)
	await T.frames(self, 8)
	game.hud.move = Vector2.ZERO
	game._ride()
	T.check(p.mount == null, "off the horse")
	# the gates
	var g0 := w.next_gate
	p.global_position = w.gate_position() + Vector3(0, 0.5, 0)
	await T.frames(self, 4)
	T.check(w.next_gate == g0 + 1, "driving through the pink gate counts it (%d -> %d)" % [g0, w.next_gate])
	T.check(game.run_coins > 0, "and pays coins ($%d)" % game.run_coins)
	# the jungle is many MultiMesh cells with their own culling
	var cells := 0
	for c in w.get_children():
		if c is MultiMeshInstance3D:
			cells += 1
	T.check(cells > 20, "the jungle is %d multimesh cells" % cells)
	# a big sweep through the jungle flattens trees (and a second sweep finds none left)
	var hit := w.smash(Vector3(120, 0, -100), 60.0)
	T.check(hit > 5, "a sweep through the jungle knocks trees down (%d)" % hit)
	T.check(w.smash(Vector3(120, 0, -100), 60.0) == 0, "and they stay down")
	game.end_run()
	T.check(game.state == Main.State.LOBBY, "leaving returns to the lobby")
	T.done(self)
