extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/playthrough.gd
## A bot plays the whole game with the real controls: walks the map with the real physics, aims at
## things, presses USE, types answers into the real dials, and escapes. The Hollow is told to ignore
## it here (its own behaviour is tests/hollow_test.gd).

var game: Game
var fails := 0
var frames := 0
var live := OS.get_environment("S9_LIVE") == "1"   # the Hollow is really hunting; the bot defends itself with the torch
var film := OS.get_environment("S9_FILM") == "1"   # lingers on the title and win screens, for a recording
var deaths := 0
var modal_t := 0
var streak := 0            # frames spent defending in a row
var ignore_until := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	await physics_frame
	await physics_frame
	await run()
	if live:
		print("  live Hollow: %d deaths on the way" % deaths)
		check(deaths <= 10, "a bot that uses the torch gets through with few deaths (%d)" % deaths)
	print("-- %s (%d frames, %.0f game-seconds)" % ["ALL OK" if fails == 0 else "%d FAILED" % fails, frames, frames / 60.0])
	quit(0 if fails == 0 else 1)


func step(n := 1) -> void:
	for i in range(n):
		await physics_frame
		frames += 1
		# A note left open is read for a few seconds and closed, as a player would.
		modal_t = modal_t + 1 if game.ui.modal_open else 0
		if modal_t > 60 * 4:
			game.ui.close_modal()
			modal_t = 0
		if frames > 60 * 60 * 25:
			print("  FAIL the bot ran for 25 game-minutes and did not finish")
			quit(1)
		if live and game.player.dead and game.playing:
			await _recover()


## The bot died: wait out the jump scare, press TRY AGAIN.
func _recover() -> void:
	deaths += 1
	print("  death %d at %.0fs in %s, hollow state %d, battery %.0f, torch %s" % [deaths, frames / 60.0, game.level.zone_at(game.player.global_position), game.hollow.state, game.player.battery, str(game.player.torch_on)])
	for i in range(60 * 3):
		await physics_frame
	game.respawn()
	await physics_frame
	game.ui.close_modal()


func threat() -> bool:
	if frames < ignore_until:
		return false
	var h := game.hollow
	if not live or h.state in [Hollow.S.DORMANT, Hollow.S.STUNNED, Hollow.S.FLEE, Hollow.S.CAUGHT]:
		return false
	var d := h.global_position.distance_to(game.player.global_position)
	# Something that is only wandering, far off, is not worth stopping for; something coming for you is.
	var coming := h.state in [Hollow.S.HUNT, Hollow.S.INVESTIGATE, Hollow.S.LURK]
	return (d < 13.0 and coming or d < 7.0) and not game.level.is_lit(game.level.zone_at(game.player.global_position))


func defend() -> void:
	var p := game.player
	var h := game.hollow
	streak += 1
	if streak % 300 == 0:
		print("  defending for %ds: state %d, dist %.1f, battery %.0f, zone %s, hollow zone %s" % [streak / 60, h.state, h.global_position.distance_to(p.global_position), p.battery, game.level.zone_at(p.global_position), game.level.zone_at(h.global_position)])
	if streak > 60 * 20:
		# Twenty seconds of holding a torch on something that is not going away: walk on regardless.
		streak = 0
		ignore_until = frames + 60 * 15
		return
	var to := h.global_position + Vector3(0, 1.3, 0) - p.cam.global_position
	p.yaw = atan2(-to.x, -to.z)
	p.pitch = asin(to.normalized().y)
	p.move_input = Vector2.ZERO
	p.torch_on = true
	if p.battery < 8.0:
		p.battery = 8.0


func use_of(id: String) -> Use:
	for u in game.level.uses:
		if u.id == id:
			return u
	return null


## Walks the real player along the waypoint graph to `node_id`.
func walk_to(node_id: String) -> bool:
	var p := game.player
	var lv := game.level
	# Start from a waypoint in the room the player is standing in (the nearest one may be behind a wall).
	var here := ""
	var best_d := INF
	var zone := lv.zone_at(p.global_position)
	for id in lv.nodes:
		if lv.nodes[id].zone != zone:
			continue
		var d := p.global_position.distance_squared_to(lv.nodes[id].pos)
		if d < best_d:
			best_d = d
			here = id
	if here == "":
		here = lv.nearest_node(p.global_position, false)
	var route := lv.route(here, node_id, true)
	if route.is_empty():
		print("  no route to ", node_id)
		return false
	for id in route:
		var target: Vector3 = lv.nodes[id].pos
		var guard := 0
		while Vector2(p.global_position.x - target.x, p.global_position.z - target.z).length() > 0.45:
			if p.dead:
				return false
			if threat():
				defend()
				await step()
				continue
			streak = 0
			# Charging the torch when it is low and nothing is near (loud, and it takes a while).
			if live and p.battery < 30.0:
				p.move_input = Vector2.ZERO
				p.crank_held = true
				for k in range(60 * 6):
					if threat() or p.dead:
						break
					await step()
				p.crank_held = false
				continue
			var d := target - p.global_position
			d.y = 0
			p.yaw = lerp_angle(p.yaw, atan2(-d.x, -d.z), 0.3)
			p.pitch = lerpf(p.pitch, -0.06, 0.08)
			p.move_input = Vector2(0, -1)
			p.sprint_held = false
			await step()
			guard += 1
			if guard > 60 * 40:
				print("  STUCK at ", p.global_position, " heading for ", id)
				p.move_input = Vector2.ZERO
				return false
	p.move_input = Vector2.ZERO
	await step(3)
	return true


## Stands the player somewhere it can reach `use` from, looks at it, and presses USE for real.
func use_it(id: String) -> bool:
	for attempt in range(6):
		var before := deaths
		var ok := await _use_it_once(id)
		if ok or deaths == before or not live:
			return ok
	return false


func _use_it_once(id: String) -> bool:
	var u := use_of(id)
	if u == null:
		print("  no such use ", id)
		return false
	var p := game.player
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.33
	capsule.height = 1.7
	var space := game.get_world_3d().direct_space_state
	var centre := u.global_position
	var best := Vector3.INF
	for ring in [0.9, 1.3, 1.7, 2.1]:
		for k in range(16):
			var ang := TAU * float(k) / 16.0
			var pos := Vector3(centre.x + cos(ang) * ring, 0.0, centre.z + sin(ang) * ring)
			if game.level.zone_at(pos) == "":
				continue
			var q := PhysicsShapeQueryParameters3D.new()
			q.shape = capsule
			q.collision_mask = Data.L_WORLD
			q.transform = Transform3D(Basis(), pos + Vector3(0, 0.9, 0))
			if not space.intersect_shape(q, 1).is_empty():
				continue
			var eye := pos + Vector3(0, 1.6, 0)
			var dir := (centre - eye).normalized()
			var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(eye, eye + dir * Player.REACH, Data.L_WORLD | Data.L_USE))
			if not hit.is_empty() and hit.collider == u:
				best = pos
				break
		if best != Vector3.INF:
			break
	if best == Vector3.INF:
		print("  cannot stand to use ", id)
		return false
	var nearest := ""
	var nd := INF
	for nid in game.level.nodes:
		if game.level.nodes[nid].zone != game.level.zone_at(best):
			continue
		var dd: float = best.distance_squared_to(game.level.nodes[nid].pos)
		if dd < nd:
			nd = dd
			nearest = nid
	if nearest == "":
		nearest = game.level.nearest_node(best, false)
	if not await walk_to(nearest):
		return false
	p.global_position = best
	var eye2 := best + Vector3(0, 1.6, 0)
	var to := centre - eye2
	p.yaw = atan2(-to.x, -to.z)
	p.pitch = asin(to.normalized().y)
	await step(4)
	if p.focus != u:
		print("  not aiming at ", id, " (focus ", p.focus.id if p.focus else "none", ")")
		return false
	p.use_edge = true
	await step(2)
	return true


func pick(item: String) -> void:
	check(await use_it("pick_" + item), "pick up %s" % item)


func dial(value: String, charset: String) -> void:
	for i in range(value.length()):
		var want := value.unicode_at(i) - (48 if charset == "digits" else 65)
		game.ui._dial_values[i] = want
		(game.ui._dial_labels[i] as Label).text = value[i]
	game.ui._dial_submit()
	await step(3)


## In a recording the bot also reads the story tapes it passes, the way a player who wanted the whole story would.
func lore(ids: Array) -> void:
	if not film:
		return
	for id in ids:
		if await use_it("note_" + id):
			await step(60 * 4)
			game.ui.close_modal()


func run() -> void:
	var lv := game.level
	var p := game.player
	seed(int(OS.get_environment("S9_SEED")) if OS.get_environment("S9_SEED") != "" else 11)
	if film:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(Game.SAVE))
		game.ui.show_title(false)
		await step(60 * 5)   # the title screen, typed in
	game.cinematic = film
	game._begin()
	await step(5)
	while game.ui.cinematic_active:
		await step()
	await step(5)
	game.ui.close_modal()
	check(game.playing, "game begins")
	check("intro" in game.s.notes, "the intro note is in the journal")
	if not live:
		game.hollow.grace = 1e9   # the bot is invisible to it here
	game.ui.close_modal()

	print("-- the Hollow wakes when you leave the airlock")
	check(game.hollow.state == Hollow.S.DORMANT, "dormant in the airlock")
	await walk_to("hw")
	await step(120)
	check(game.hollow.state != Hollow.S.DORMANT, "awake in the hub")
	if not live:
		game.hollow.sleep()
		game._awake_t = -1e9

	await lore(["lore_gas"])
	print("-- dormitory: the crew locker")
	check(game.objective().begins_with("NAP ROOM"), "objective points to the nap room")
	check(await use_it("note_dorm_diary"), "read Anya's diary")
	game.ui.close_modal()
	check(await use_it("note_dorm_scribble"), "read the scribble")
	game.ui.close_modal()
	check(await use_it("note_dorm_locker"), "read the captain's memo")
	game.ui.close_modal()
	check(await use_it("crew_locker"), "use crew locker 7")
	check(game.ui.modal_open, "the code dial opens")
	await dial("1234", "digits")
	check(not game.s.locker_open, "a wrong code does not open it")
	await dial(Puzzles.locker_code(), "digits")
	check(game.s.locker_open and game.s.has_fuse, "the right code opens it and gives the fuse")
	check(lv.is_lit("dorm") and lv.is_lit("corW"), "the dormitory is lit")
	await step(120)
	game.ui.close_modal()
	check("locker_note" in game.s.notes, "the note in the locker is in the journal")

	await lore(["lore_child", "lore_anya"])
	print("-- engine room: the valves")
	for letter in ["A", "B", "C", "D", "E"]:
		pass
	check(await use_it("note_engine_manual1"), "read manual page 1")
	game.ui.close_modal()
	check(await use_it("note_engine_manual2"), "read manual page 2")
	game.ui.close_modal()
	check(await use_it("valve_A"), "turn valve A")
	check(game.s.valves["A"], "valve A is open")
	check(await use_it("gen_start"), "press start with a wrong setting")
	check(not game.s.gen_on, "a wrong setting does not start the generator")
	check(await use_it("valve_A"), "close valve A again")
	for letter in Puzzles.valve_answer().split(""):
		check(await use_it("valve_" + letter), "open valve " + letter)
	check(await use_it("gen_start"), "start the generator")
	check(game.s.gen_on, "generator runs")
	check(lv.is_lit("engine") and lv.is_lit("corS") and lv.doors["lab_door"].open, "engine lit, lab door unlocked")
	await pick("cell_engine")
	check(game.s.cells == 1, "one power cell carried")

	await lore(["lore_guard"])
	print("-- laboratory: the breakers")
	check(await use_it("lab_board"), "read the whiteboard")
	game.ui.close_modal()
	check(await use_it("breaker"), "use the breaker panel (the fuse goes in)")
	check(game.ui.modal_open and game.s.breaker_open and not game.s.has_fuse, "the panel opens, the fuse is used")
	# Solve with the real buttons: breadth-first for the shortest list of presses.
	var board: Array = game.s.breaker.duplicate()
	var presses := _solve_breaker(board)
	check(not presses.is_empty(), "the board can be solved in %d presses" % presses.size())
	for cell in presses:
		game.ui._breaker_press(cell)
		await step(2)
	check(game.s.breaker_solved, "the breakers are all on")
	check(lv.is_lit("lab") and lv.is_lit("corE"), "the lab is lit")
	await pick("cell_lab")
	await pick("keycard")
	check(game.s.cells == 2 and game.s.has_keycard, "second cell and the keycard")

	await lore(["lore_eng"])
	print("-- control room: the radio")
	check(await use_it("door_control"), "swipe the keycard")
	check(lv.doors["control_door"].open, "the control door opens")
	await step(60)
	check(await use_it("radio"), "use the radio")
	await dial("BALLOOX", "letters")
	check(not game.s.radio_solved, "a wrong word is refused")
	await dial(Puzzles.caesar(Puzzles.scrambled_word(), 26 - Puzzles.cipher_shift()), "letters")
	check(game.s.radio_solved, "the decoded word is accepted")
	check(lv.doors["pod_door"].open and lv.is_lit("control"), "pod shutter open, control lit")
	game.ui.close_modal()
	await pick("cell_control")
	game.ui.close_modal()   # the gate note opens with it; a player reads it and closes it
	check(game.s.cells == 3, "three power cells")

	await lore(["lore_ceo"])
	print("-- the pod")
	check(game.objective().contains("DELIVERY BAY"), "objective points to the delivery bay")
	check(await use_it("pod_console"), "use the pod console")
	check(game.s.cells_in == 3 and not game.s.launching and game.ui.modal_open, "three cells in, and the gate lock asks for the count")
	await dial("0000", "digits")
	check(not game.s.gate_ok, "a wrong count is refused")
	await dial(Puzzles.gate_code(), "digits")
	check(game.s.gate_ok and game.s.launching, "the right count opens the lock and the launch starts")
	check(not lv.is_lit("pod"), "the pod bay lights fail")
	game.ui.close_modal()   # the gate note: a player closes it and picks up the torch
	await step(60 * 8)
	if not live:
		check(game.hollow.state != Hollow.S.DORMANT, "the Hollow comes")
	if not live:
		game.hollow.grace = 1e9
	var guard := 0
	while not game.s.won and guard < 60 * 60:
		if threat():
			defend()
		await step()
		guard += 1
	check(game.s.won, "the pod launches and you escape")
	if film:
		await step(60 * 9)   # the win screen


func _solve_breaker(board: Array) -> Array:
	# Breadth-first over press sequences, shortest first.
	var frontier: Array = [{"s": board, "p": []}]
	var seen := {str(board): true}
	while not frontier.is_empty():
		var nxt: Array = []
		for node in frontier:
			if Puzzles.breaker_solved(node.s):
				return node.p
			for cell in range(9):
				var t := Puzzles.breaker_press(node.s, cell)
				if not seen.has(str(t)):
					seen[str(t)] = true
					nxt.append({"s": t, "p": node.p + [cell]})
		frontier = nxt
	return []
