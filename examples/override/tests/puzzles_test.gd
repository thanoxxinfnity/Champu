extends SceneTree
## godot --headless -s tests/puzzles_test.gd
## The generator's levers have exactly one answer, the recipes are unambiguous, and the items add up.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	print("-- the levers")
	var sols := Data.lever_solutions()
	check(sols.size() == 1, "exactly one order fits the engineer's note (%d)" % sols.size())
	check(sols[0] == ["blue", "red", "green"], "the answer is blue, red, green: %s" % str(sols[0]))
	check(Data.lever_rules_hold(sols[0]), "the answer obeys both rules")
	check(not Data.lever_rules_hold(["red", "blue", "green"]), "red before blue is refused")
	check(not Data.lever_rules_hold(["green", "blue", "red"]), "green first is refused")

	print("-- the recipes")
	check(Data.recipe("wiring", "timer") == "detonator", "wiring + timer = detonator")
	check(Data.recipe("timer", "wiring") == "detonator", "and the other way round")
	check(Data.recipe("detonator", "gel") == "mega_bomb", "detonator + gel = mega-bomb")
	check(Data.recipe("gel", "wiring") == "", "gel + wiring is nothing")
	check(Data.recipe("fuse", "fuse") == "", "two fuses are nothing")
	var seen := {}
	var dup := false
	for r in Data.RECIPES:
		var key := "%s+%s" % [minf_str(r.a, r.b), maxf_str(r.a, r.b)]
		if seen.has(key):
			dup = true
		seen[key] = true
	check(not dup, "no two recipes share the same pair")
	for r in Data.RECIPES:
		check(Data.ITEMS.has(r.a) and Data.ITEMS.has(r.b) and Data.ITEMS.has(r.out), "%s + %s -> %s all have a picture colour" % [r.a, r.b, r.out])

	print("-- the papers")
	for id in Data.PAPERS:
		var p: Dictionary = Data.PAPERS[id]
		check(p.has("title") and p.has("body") and p.body.length() > 10, "paper %s has a title and a body" % id)
	check(Data.PAPERS.size() >= 8, "there are %d papers" % Data.PAPERS.size())

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)


func minf_str(a: String, b: String) -> String:
	return a if a < b else b


func maxf_str(a: String, b: String) -> String:
	return b if a < b else a
