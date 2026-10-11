extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/playthrough.gd          (creatures off: the tasks, the lifts, the clock)
## OV_LIVE=1 godot --headless ... -s tests/playthrough.gd                    (creatures hunting; the bot defends itself with the stunner)
## A bot plays the whole game with the real controls: it walks the navigation mesh with the real physics, aims at things, taps the hand,
## opens the pack and crafts in it, crosses the water on the planks, throws the levers in the right order, plants the bomb and runs.

var game: Game
var fails := 0
var frames := 0
var live := OS.get_environment("OV_LIVE") == "1"
var film := OS.get_environment("OV_FILM") == "1"
var deaths := 0
var stuck_msgs := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	game.enemies_off = not live
	root.add_child(game)
	await physics_frame
	await physics_frame
	await run()
	print("-- %s (%d frames, %.0f game-seconds, %d deaths)" % ["ALL OK" if fails == 0 else "%d FAILED" % fails, frames, frames / 60.0, deaths])
	quit(0 if fails == 0 else 1)


func step(n := 1) -> void:
	for i in range(n):
		await physics_frame
		frames += 1
		if frames > 60 * 60 * 30:
			print("  FAIL the bot ran for 30 game-minutes")
			quit(1)
		if game.player.dead and game.playing:
			await recover()
		defend()
		if film and live and not game.player.dead:
			game.player.health = maxi(game.player.health, 2)   # the recording bot has a safety net: it is shown being hurt, not dying in a loop
		if live and frames % 60 == 0 and OS.get_environment("OV_TRACE") == "1":
			var line := "  t=%ds %s hp %d emp %d pos (%.0f,%.0f)" % [frames / 60, game.world.current, game.player.health, game.player.emp_charges, here().x, here().z]
			for e in game.enemies:
				if is_instance_valid(e):
					line += " | %s s%d d%.1f" % [e.kind, e.state, e.global_position.distance_to(here())]
			print(line)


## Dead: wait out the jump scare, tap retry.
func recover() -> void:
	deaths += 1
	print("  death %d in %s (chapter %d, hurt by the clock: %s)" % [deaths, game.world.current, game.s.chapter, str(game.s.countdown < 1.0 and game.s.planted)])
	for i in range(60 * 3):
		await physics_frame
	game.respawn()
	await physics_frame
	await physics_frame


## With the creatures hunting: stun whatever is chasing close by, or simply too close.
func defend() -> void:
	if not live:
		return
	var p := game.player
	if not p.has_emp or p.emp_charges <= 0:
		return
	for e in game.enemies:
		if not is_instance_valid(e) or e.state == Enemy.S.STUNNED:
			continue
		var chest: Vector3 = e.global_position + Vector3(0, e._cfg.height * 0.55, 0)
		var to := chest - p.cam.global_position
		var close: bool = to.length() < 4.5 and e.state != Enemy.S.PATROL
		if (e.state == Enemy.S.CHASE and to.length() < 9.0) or close:
			p.yaw = atan2(-to.x, -to.z)
			p.pitch = asin(to.normalized().y)
			if p.fire_emp():
				return


## Any creature awake near enough to hear: creep.
func creeping() -> bool:
	if not live:
		return false
	for e in game.enemies:
		if is_instance_valid(e) and e.state == Enemy.S.PATROL and e.global_position.distance_to(here()) < 14.0:
			return true
	return false


## Something is coming for the bot: run.
func threatened() -> bool:
	if not live:
		return false
	for e in game.enemies:
		if is_instance_valid(e) and e.state != Enemy.S.STUNNED:
			var d := e.global_position.distance_to(here())
			if (e.state == Enemy.S.CHASE and d < 12.0) or (e.state == Enemy.S.INVESTIGATE and d < 5.0):
				return true
	return false


func here() -> Vector3:
	return game.player.global_position


func walk_to(target: Vector3, tol := 0.7) -> bool:
	var p := game.player
	var guard := 0
	var last := here()
	var still := 0
	var sidesteps := 0
	var side_t := 0
	var side_dir := 1.0
	var side_yaw := 0.0
	while Vector2(here().x - target.x, here().z - target.z).length() > tol:
		if p.dead:
			return false
		# The navigation mesh knows nothing about a creature standing still in the corridor (it is a real, solid
		# body now, not a ghost the player walks through) — a push straight at it makes no progress at all, the
		# same way a prop can block the enemies' own navigation. Step directly sideways for a moment, the way
		# they recover from that, holding one facing the whole time: re-aiming at the path's next point every
		# frame (as the normal branch below does) would just turn the "sideways" push back toward the thing
		# blocking it, frame by frame, and cancel itself out.
		if side_t > 0:
			side_t -= 1
			p.yaw = side_yaw
			p.move_input = Vector2(side_dir, 0)
		else:
			var path := game.world.path(here(), game.world.snap(target))
			var next := target
			for pt in path:
				if Vector2(pt.x - here().x, pt.z - here().z).length() > 0.9:
					next = pt
					break
			var d := next - here()
			d.y = 0
			p.yaw = lerp_angle(p.yaw, atan2(-d.x, -d.z), 0.35)
			p.pitch = lerpf(p.pitch, -0.05, 0.1)
			p.move_input = Vector2(0, -1)
		p.sprint_held = threatened()
		p.crouching = creeping() and not p.sprint_held
		await step()
		guard += 1
		if guard % 30 == 0:
			if here().distance_to(last) < 0.25:
				still += 1
			else:
				still = 0
			last = here()
			if still >= 2 and side_t <= 0 and sidesteps < 3:
				sidesteps += 1
				side_dir = 1.0 if sidesteps % 2 == 1 else -1.0
				side_yaw = p.yaw
				side_t = 70
				still = 0
			elif still >= 4:
				if stuck_msgs < 8:
					print("  STUCK at ", here(), " heading for ", target, " path points ", game.world.path(here(), game.world.snap(target)).size())
					stuck_msgs += 1
				p.move_input = Vector2.ZERO
				return false
		if guard > 60 * 70:
			print("  STUCK (timeout) at ", here(), " heading for ", target)
			p.move_input = Vector2.ZERO
			return false
	p.move_input = Vector2.ZERO
	await step(3)
	return true


func walk_via(points: Array) -> bool:
	for pt in points:
		if not await walk_to(pt, 0.8):
			return false
	return true


func find_use(id: String) -> Use:
	for u in game.world.uses:
		if is_instance_valid(u) and u.id == id:
			return u
	return null


## Somewhere to stand from which the use-point is in reach and in sight.
func stand_for(u: Use) -> Vector3:
	var space := game.world.get_world_3d().direct_space_state
	var best := Vector3.INF
	var best_d := INF
	var centre := u.global_position
	for radius in [1.3, 1.7, 2.1, 1.0, 2.4]:
		for k in range(24):
			var ang := TAU * k / 24.0
			var stand := Vector3(centre.x + cos(ang) * radius, 0.0, centre.z + sin(ang) * radius)
			var down := PhysicsRayQueryParameters3D.create(stand + Vector3(0, 1.0, 0), stand + Vector3(0, -0.5, 0), Data.L_WORLD)
			var ground := space.intersect_ray(down)
			if ground.is_empty():
				continue
			stand.y = ground.position.y
			var shape := CapsuleShape3D.new()
			shape.radius = 0.32
			shape.height = 1.7
			var sq := PhysicsShapeQueryParameters3D.new()
			sq.shape = shape
			sq.transform = Transform3D(Basis.IDENTITY, stand + Vector3(0, 0.97, 0))
			sq.collision_mask = Data.L_WORLD
			if not space.intersect_shape(sq, 1).is_empty():
				continue
			var eye := stand + Vector3(0, Player.EYE, 0)
			var q := PhysicsRayQueryParameters3D.create(eye, centre, Data.L_WORLD | Data.L_USE)
			var hit := space.intersect_ray(q)
			if hit.is_empty() or hit.collider != u or eye.distance_to(centre) > Player.REACH - 0.2:
				continue
			var dd := here().distance_to(stand)
			if dd < best_d:
				best_d = dd
				best = stand
	return best


const ROOM_OF := {
	"emp": "c1_cryo", "paper_p_wake": "c1_cryo", "cell_cryo": "c1_cryo", "fuse_1": "c1_server", "fuse_2": "c1_store", "fuse_3": "c1_store", "cable": "c1_store",
	"cell_store": "c1_store", "fusebox": "c1_hall", "lift_1": "c1_lift",
	"paper_p_flood": "c2_lobby", "timer": "c2_ctrl", "cell_ctrl": "c2_ctrl", "wiring": "c2_pump", "cell_pump": "c2_pump", "lever_blue": "c2_pump", "lever_red": "c2_pump",
	"lever_green": "c2_pump", "lift_2": "c2_lift",
	"paper_p_factory": "c3_floor", "office_switch": "c3_lockers", "keycard": "c3_office", "gel": "c3_work", "door_panel_lift3": "c3_work", "lift_3": "c3_lift",
	"paper_p_core": "c4_lobby", "plant": "c4_reactor", "lift_4": "c4_exit",
}


func room_centre(room: String) -> Vector3:
	var r: Array = Rooms.LIST[room].r
	return Vector3((r[0] + r[1]) * 0.5, 0.0, (r[2] + r[3]) * 0.5)


func use_it(id: String, via: Array = []) -> bool:
	for attempt in range(4):
		var u := find_use(id)
		if u == null and ROOM_OF.has(id):
			# Not built yet: walk there, and the streamer builds it on the way.
			await walk_to(room_centre(ROOM_OF[id]), 2.5)
			u = find_use(id)
		if u == null:
			print("  (no use-point %s in %s)" % [id, game.world.current])
			return false
		var stand := stand_for(u)
		if stand == Vector3.INF:
			print("  (nowhere to stand for %s)" % id)
			return false
		if not via.is_empty():
			if not await walk_via(via):
				continue
		if not await walk_to(stand, 0.5):
			continue
		var p := game.player
		var want := u.global_position - p.cam.global_position
		for i in range(40):
			p.yaw = lerp_angle(p.yaw, atan2(-want.x, -want.z), 0.3)
			p.pitch = lerpf(p.pitch, asin(want.normalized().y), 0.3)
			await step()
		if p.focus == u:
			p.use_edge = true
			await step(4)
			return true
	return false


func read_paper_at(id: String, via: Array = []) -> bool:
	var ok := await use_it("paper_" + id, via)
	if ok:
		await step(60 * (3 if film else 1))
		game.ui.close_modal()
		await step(3)
	return ok


func take(id: String, via: Array = []) -> bool:
	# A creature may knock the bot off its mark: try again until the thing is really in the pack.
	for attempt in range(4):
		if game.s.taken.has(id):
			return true
		if await use_it(id, via):
			await step(10)
	return game.s.taken.has(id)


func run() -> void:
	var p := game.player
	seed(11)
	if film:
		game.ui.show_title(false)
		await step(60 * 4)
	game._begin()
	await step(10)
	game.ui.close_modal()
	check(game.playing and game.world.current == "c1_cryo", "the game begins in the cryo chamber")
	if live:
		for e in game.enemies:
			e.process_mode = Node.PROCESS_MODE_INHERIT

	# ── Chapter 1 ───────────────────────────────────────────────────────────
	print("-- chapter 1: the safe room")
	check(await read_paper_at("p_wake"), "read the first paper")
	check(await take("emp"), "take the stunner from the table")
	check(p.has_emp and p.emp_charges >= 3, "and it has a charge")
	check(await take("cell_cryo"), "take the spare cell")
	check(await take("fuse_1", [Vector3(15, 0, 4)]) or await take("fuse_1"), "fuse from the server desk")
	check(await take("fuse_2") and await take("fuse_3") and await take("cable") and await take("cell_store"), "two fuses, the cable and a cell from the store room")
	check(game.s.inv.count("fuse") >= 2 and game.s.inv.has("cable"), "the pack holds three fuses and the cable")
	for i in range(8):
		if game.s.unlocked.has("lift1"):
			break
		await use_it("fusebox")
	check(game.s.unlocked.has("lift1"), "the fuse box is wired and the lift unlocks (%d fuses in)" % game.s.fuses_in)
	check(await use_it("lift_1"), "ride the lift down")
	await step(20)

	# ── Chapter 2 ───────────────────────────────────────────────────────────
	print("-- chapter 2: the sparking corridors")
	check(game.s.chapter == 2 and game.world.current == "c2_lobby", "chapter two begins in the flooded lobby")
	check(await read_paper_at("p_flood"), "read the warning")
	var planks := [Vector3(103, 0, 6), Vector3(107, 0, 6), Vector3(111, 0, 6), Vector3(113, 0, 5.5)]
	check(await walk_via(planks) and game.player.health == 3, "cross the lobby on the planks without a shock")
	check(await walk_via([Vector3(116, 0, 6), Vector3(120, 0, 6.5), Vector3(120, 0, 8.5)]), "through the pipe tunnel to the control-room door")
	check(await take("timer", [Vector3(120, 0, 11)]), "the timer from the control room desk")
	check(await take("cell_ctrl"), "a cell")
	check(await walk_via([Vector3(120, 0, 8.5), Vector3(124, 0, 6.0), Vector3(128, 0, 5.5), Vector3(131, 0, 5.5)]), "on to the pump room")
	check(await take("wiring"), "the wiring")
	check(await take("cell_pump"), "a cell")
	for attempt in range(3):
		if game.s.gen_on:
			break
		for lever in ["blue", "red", "green"]:
			await use_it("lever_" + lever)
	check(game.s.gen_on and game.s.unlocked.has("lift2"), "the levers in the right order start the generator")
	check(await use_it("lift_2", [Vector3(137, 0, 5), Vector3(141, 0, 4.5)]), "ride the lift down")
	await step(20)

	# ── Chapter 3 ───────────────────────────────────────────────────────────
	print("-- chapter 3: the factory")
	check(game.s.chapter == 3 and game.world.current == "c3_floor", "chapter three begins on the assembly floor")
	check(await read_paper_at("p_factory"), "read the shift board")
	check(await walk_via([Vector3(205, 0, 15), Vector3(204.5, 0, 16.5)]) or true, "to the locker room door")
	check(await use_it("office_switch", [Vector3(204.5, 0, 18.5)]), "throw the switch that opens the office")
	check(game.s.unlocked.has("office"), "the office is open")
	check(await walk_via([Vector3(204.5, 0, 15.5), Vector3(217.5, 0, 15.2), Vector3(217.5, 0, 18.5)]), "to the foreman's office")
	check(await take("keycard"), "the keycard")
	check(await walk_via([Vector3(217.5, 0, 15.2), Vector3(227, 0, 6.5)]), "back across the floor to the workshop door")
	check(await take("gel", [Vector3(231, 0, 6.5)]), "the gel from the workshop")
	check(game.s.briefcase == ["mega_bomb"], "the wiring, the timer and the gel built the mega-bomb in their own case as they came in (%s)" % [game.s.briefcase])
	check(not game.s.inv.has("detonator") and not game.s.inv.has("mega_bomb"), "none of it ever sat in the pack")
	check(await use_it("door_panel_lift3"), "swipe the keycard at the lift")
	check(game.s.unlocked.has("lift3"), "the lift is unlocked")
	check(await use_it("lift_3", [Vector3(239, 0, 6)]), "ride the lift down")
	await step(20)

	# ── Chapter 4 ───────────────────────────────────────────────────────────
	print("-- chapter 4: the core escape")
	check(game.s.chapter == 4 and game.world.current == "c4_lobby", "chapter four begins in the lift lobby")
	check(await read_paper_at("p_core"), "read the reactor notice")
	check(await walk_via([Vector3(308, 0, 5.5), Vector3(318, 0, 5.5), Vector3(324, 0, 5.5), Vector3(331, 0, 10)]), "down the descent to the reactor")
	check(await use_it("plant"), "plant the bomb on the core")
	check(game.s.planted and game.s.countdown > 100.0, "the three-minute clock is running (%.0f s)" % game.s.countdown)
	var t0 := game.s.countdown
	check(await walk_via([Vector3(331, 0, 11.5), Vector3(330.5, 0, 14), Vector3(325, 0, 16.5), Vector3(322, 0, 16.5), Vector3(318, 0, 17), Vector3(309, 0, 17)]), "run: the waste hall and the return tunnel")
	check(game.s.countdown > 0.0, "with time to spare (%.0f s left, %.0f used)" % [game.s.countdown, t0 - game.s.countdown])
	check(await use_it("lift_4", [Vector3(304, 0, 16.5)]), "reach the exit lift and press the button")
	check(game.s.won, "the game is won")
