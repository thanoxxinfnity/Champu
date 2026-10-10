extends SceneTree
## godot --headless --path . -s tests/puzzles_test.gd
## Every puzzle has exactly one answer, and the numbers the notes lead to are the ones the game checks.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	print("-- puzzles")
	var b := Puzzles.bunk_solutions()
	check(b.size() == 1, "bunk clues have exactly one solution (%d)" % b.size())
	check(Puzzles.locker_code() == "3241", "locker code is 3241 (%s)" % Puzzles.locker_code())
	check(Puzzles.cipher_shift() == 2, "cipher shift is Meera's bunk, 2")

	var v := Puzzles.valve_solutions()
	check(v.size() == 1, "valve rules have exactly one solution (%d)" % v.size())
	check(Puzzles.valve_answer() == "BCD", "valves to open: BCD (%s)" % Puzzles.valve_answer())

	var start := Puzzles.breaker_start()
	check(not Puzzles.breaker_solved(start), "breaker board starts unsolved")
	var best := Puzzles.breaker_min_presses(start)
	check(best > 0 and best <= 6, "breaker board is solvable in %d presses" % best)
	var board := start
	for cell in Puzzles.BREAKER_SCRAMBLE:
		board = Puzzles.breaker_press(board, cell)
	check(Puzzles.breaker_solved(board), "pressing the scramble cells again undoes it")
	var all_solvable := true
	for mask in range(512):
		var s: Array = []
		for i in range(9):
			s.append((mask >> i) & 1 == 1)
		if Puzzles.breaker_min_presses(s) < 0:
			all_solvable = false
			break
	print("  info every 3x3 board solvable: %s" % all_solvable)

	check(Puzzles.scrambled_word() == "UWTHCEG", "whiteboard shows UWTHCEG (%s)" % Puzzles.scrambled_word())
	check(Puzzles.caesar(Puzzles.scrambled_word(), 26 - 2) == "SURFACE", "shifting back by 2 gives SURFACE")
	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
