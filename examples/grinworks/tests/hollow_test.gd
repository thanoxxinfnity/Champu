extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/hollow_test.gd
## How the Hollow behaves: it hears, sees, hunts, kills, flinches from a torch, will not cross into
## a lit room, burns when its room is lit, and can be hidden from — but not if it saw you hide.

var game: Game
var fails := 0
var caught := 0


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
	game._begin()
	await physics_frame
	game.ui.close_modal()
	game.hollow.caught_player.connect(func(): caught += 1)
	game._awake_t = -1e9
	await run()
	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)


func step(n := 1) -> void:
	for i in range(n):
		await physics_frame


func reset(player_pos: Vector3, hollow_node: String, torch := false, crouch := false) -> void:
	var h := game.hollow
	var p := game.player
	game.s.launching = false
	p.dead = false
	p.hidden = false
	p.frozen = false
	p.collision_layer = Data.L_PLAYER
	p.global_position = player_pos
	p.velocity = Vector3.ZERO
	p.torch_on = torch
	p.battery = 100.0
	p.crouching = crouch
	p.move_input = Vector2.ZERO
	h.clear_drag()
	h.wake(hollow_node)
	h.grace = 0.0
	h._path.clear()
	h._dose = 0.0
	h._need = Hollow.NEED_BASE
	caught = 0
	await step(2)


func face(target: Vector3) -> void:
	var p := game.player
	var to := target - p.global_position
	p.yaw = atan2(-to.x, -to.z)
	p.pitch = 0.0


func run() -> void:
	var h := game.hollow
	var p := game.player
	var lv := game.level

	print("-- noise")
	await reset(Vector3(-25, 0, 0), "hne")
	h._wait = 99.0
	game.noise(Vector3(0, 0, -2), 12.0, "step")
	check(h.state == Hollow.S.INVESTIGATE, "a footstep in range sends it to look")
	await reset(Vector3(-25, 0, 0), "hne")
	game.noise(Vector3(-7, 0, 7), 4.0, "step")
	check(h.state == Hollow.S.PATROL, "a quiet step far away is not heard")
	await reset(Vector3(-25, 0, 0), "hne")
	game.noise(Vector3(-7, 0, 7), 30.0, "bang")
	check(h.state == Hollow.S.INVESTIGATE, "pipe hammer is heard across the station")
	var start := h.global_position
	await step(60 * 14)
	check(h.global_position.distance_to(Vector3(-7, 0, 7)) < 4.0 or h.state == Hollow.S.PATROL, "it walks to where the noise was, then goes back to patrolling")

	print("-- sight and the kill")
	await reset(Vector3(0, 0, 0), "hn")
	h._wait = 99.0
	face(h.global_position)
	p.torch_on = false
	await step(30)
	print("  info state %d, sees %s, dist %.1f" % [h.state, str(h._sees), h.global_position.distance_to(p.global_position)])
	check(h.state == Hollow.S.PATROL or h.state == Hollow.S.INVESTIGATE, "at 7 m, in the dark, with the torch off, it does not see you")
	await reset(Vector3(0, 0, 0), "hn", true)
	h._wait = 99.0
	p.torch_on = true
	p.battery = 100.0
	# Looking away so the beam is not on it.
	p.yaw = deg_to_rad(180.0)
	await step(20)
	check(h.state == Hollow.S.HUNT, "with the torch on it sees you from 7 m and hunts")
	await step(60 * 6)
	check(caught > 0, "a hunter that reaches you kills you (%d)" % caught)

	print("-- the torch")
	await reset(Vector3(0, 0, 0), "hn", true)
	h._wait = 99.0
	face(h.global_position + Vector3(0, 1.3, 0))
	var stunned := false
	for i in range(60 * 4):
		await step()
		face(h.global_position)
		if h.state == Hollow.S.STUNNED:
			stunned = true
			break
	check(stunned, "a torch held on it makes it flinch")
	check(h._need > Hollow.NEED_BASE, "each flinch makes the next one take longer (%.2f s)" % h._need)
	await step(60 * 3)
	check(h.state == Hollow.S.FLEE, "then it runs")
	check(caught == 0, "and you were not caught")
	await step(60 * 12)
	check(h.state == Hollow.S.PATROL or h.state == Hollow.S.INVESTIGATE or h.state == Hollow.S.HUNT, "and it comes back to hunting")

	print("-- lit rooms are safe")
	lv.set_lit("dorm", true, true)
	lv.set_lit("corW", true, true)
	await reset(Vector3(-25, 0, 0), "hw", true)
	h.grace = 0.0
	h._start_hunt()
	var inside := false
	for i in range(60 * 25):
		await step()
		if lv.zone_at(h.global_position) in ["dorm", "corW"]:
			inside = true
			break
	check(not inside, "it never steps into a lit room, however hard it hunts")
	check(h.state == Hollow.S.LURK or h.state == Hollow.S.HUNT, "it waits at the edge (%d)" % h.state)
	check(caught == 0, "you are not caught in the lit room")
	var d := h.global_position.distance_to(p.global_position)
	print("  info it waits %.1f m away" % d)

	print("-- burning")
	await reset(Vector3(0, 0, 0), "cn")
	lv.set_lit("corN", true)
	await step(20)
	check(h.state == Hollow.S.FLEE, "lighting the room it stands in burns it out")
	await step(60 * 5)
	check(not lv.is_lit(lv.zone_at(h.global_position)) or h.state == Hollow.S.FLEE, "it ends up in the dark")
	lv.set_lit("corN", false, true)

	print("-- doors")
	lv.doors["lab_door"].set_open(false, true)
	var r := lv.route("hne", "lb_c")
	check(r.is_empty(), "with the lab door shut there is no way in for it")
	lv.doors["lab_door"].set_open(true, true)
	check(not lv.route("hne", "lb_c").is_empty(), "with the door open there is")

	print("-- lockers")
	var locker: Use = null
	for u in lv.lockers:
		if u.id == "hide_0":
			locker = u
	await reset(Vector3(-9.0, 0, -4.0), "hne")
	h._wait = 99.0
	p.torch_on = false
	game.hide_in(locker)
	check(p.hidden, "you can hide")
	check(not h._locker_target, "unseen, it is not told where you are")
	await step(60 * 20)
	check(caught == 0 and not p.dead, "hidden and unseen, you survive twenty seconds with it about")
	p.exit_hide()
	await reset(Vector3(-6.0, 0, -4.0), "hn", false)
	h._start_hunt()
	h._sees = true
	game.hide_in(locker)
	check(h._locker_target != null, "seen going in, it knows")
	await step(60 * 10)
	check(caught > 0, "and it opens the locker")
