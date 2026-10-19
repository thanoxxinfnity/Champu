extends SceneTree
## godot --headless --path . -s tests/fight_test.gd   (prints ALL OK)
var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func make(n: String, pos: Vector3) -> Fighter:
	var f := Fighter.new()
	f.fighter_name = n
	var cs := CollisionShape3D.new()
	cs.shape = CapsuleShape3D.new()
	f.add_child(cs)
	get_root().add_child(f)
	f.global_position = pos
	return f

func tick(f: Array, n: int) -> void:
	for i in n:
		for x in f:
			x._physics_process(1.0 / 60.0)

func _init() -> void:
	print("fight test")
	var a := make("A", Vector3(0, 0, 0))
	var b := make("B", Vector3(1.2, 0, 0))
	a.opponent = b
	b.opponent = a
	await process_frame
	var both := [a, b]

	a.intent["light"] = true
	tick(both, 2)
	a.intent["light"] = false
	check(a.state == Fighter.State.ATTACK, "light attack starts")
	tick(both, 40)
	check(b.health < Fighter.MAX_HEALTH, "light attack hits (hp %.1f)" % b.health)
	check(a.energy > 0.0, "landing a hit builds cursed energy")
	check(b.state == Fighter.State.HIT or b.state == Fighter.State.IDLE, "target is stunned or recovered")

	# blocking cuts damage
	tick(both, 60)
	b.reset_round(Vector3(1.2, 0, 0))
	a.reset_round(Vector3(0, 0, 0))
	b.intent["block"] = true
	tick(both, 3)
	a.intent["heavy"] = true
	tick(both, 2)
	a.intent["heavy"] = false
	tick(both, 60)
	check(b.health > Fighter.MAX_HEALTH - 14.0 * 0.5, "block reduces heavy damage (hp %.1f)" % b.health)

	# dodge i-frames
	b.reset_round(Vector3(1.2, 0, 0))
	a.reset_round(Vector3(0, 0, 0))
	b.intent["block"] = false
	b.intent["dodge"] = true
	tick(both, 2)
	b.intent["dodge"] = false
	check(b.state == Fighter.State.DODGE, "dodge enters i-frame state")
	check(b.receive_hit(a, Fighter.MOVES["heavy"], 14.0) == 0.0, "no damage during the dodge")

	# energy gates specials
	a.reset_round(Vector3(0, 0, 0))
	b.reset_round(Vector3(3, 0, 0))
	a.intent["special"] = true
	tick(both, 3)
	check(a.state != Fighter.State.ATTACK, "special needs energy")
	a.energy = 100.0
	tick(both, 3)
	check(a.state == Fighter.State.ATTACK and a.energy < 100.0, "special spends energy")
	a.intent["special"] = false
	tick(both, 80)

	# KO
	a.reset_round(Vector3(0, 0, 0))
	b.reset_round(Vector3(1.2, 0, 0))
	b.health = 3.0
	b.receive_hit(a, Fighter.MOVES["light"], 6.0)
	check(not b.is_alive() and b.health == 0.0, "health 0 -> KO")

	# match: first to 2 rounds
	var m := MatchController.new()
	get_root().add_child(m)
	var a2 := make("A2", Vector3(0, 0, 0))
	var b2 := make("B2", Vector3(2, 0, 0))
	var won: Array = []
	m.match_ended.connect(func(w: Fighter) -> void: won.append(w))
	m.setup(a2, b2)
	check(m.running and m.round_no == 1, "round 1 starts")
	b2.receive_hit(a2, Fighter.MOVES["ultimate"], 999.0)
	check(m.wins[a2] == 1 and not m.running, "KO ends the round with a win for A")
	m.start_round()
	b2.receive_hit(a2, Fighter.MOVES["ultimate"], 999.0)
	check(won.size() == 1 and won[0] == a2, "second round win ends the match")
	m.start_round() if false else null

	# timeout: more health wins
	var m2 := MatchController.new()
	get_root().add_child(m2)
	var a3 := make("A3", Vector3(0, 0, 0))
	var b3 := make("B3", Vector3(2, 0, 0))
	var rw: Array = []
	m2.round_ended.connect(func(w: Fighter) -> void: rw.append(w))
	m2.round_time = 1.0
	m2.setup(a3, b3)
	b3.health = 40.0
	m2._process(1.5)
	check(rw.size() == 1 and rw[0] == a3, "time-out goes to the fighter with more health")

	# AI beats a passive opponent
	var a4 := make("AI", Vector3(0, 0, 0))
	var b4 := make("Dummy", Vector3(4, 0, 0))
	a4.opponent = b4
	b4.opponent = a4
	var ai := FightAI.new()
	ai.fighter = a4
	ai.level = FightAI.Level.HARD
	get_root().add_child(ai)
	var both2 := [a4, b4]
	for i in 60 * 40:
		ai._physics_process(1.0 / 60.0)
		tick(both2, 1)
		if not b4.is_alive():
			break
	check(b4.health < 100.0, "AI approaches and damages a passive opponent (hp %.1f)" % b4.health)
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
