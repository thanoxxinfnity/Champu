extends SceneTree
## godot --headless --path . -s tests/roster_test.gd   (prints ALL OK)
func _init() -> void:
	var fails := 0
	var g := Roster.gojo_variants()
	var ok: bool = g.size() == 2 and g[0]["model"] != g[1]["model"] and str(g[0]["moves"]) == str(g[1]["moves"])
	print(("  ok   " if ok else "  FAIL "), "Gojo has two looks that share one move set")
	fails += 0 if ok else 1
	ok = str(Roster.find("sukuna")["domain"]) == "malevolent_shrine" and str(Roster.find("gojo_open")["domain"]) == "infinite_void"
	print(("  ok   " if ok else "  FAIL "), "domains: Gojo -> Infinite Void, Sukuna -> Malevolent Shrine")
	fails += 0 if ok else 1
	ok = Roster.CHARACTERS.size() == 5 and Roster.find("nobody").is_empty()
	print(("  ok   " if ok else "  FAIL "), "five entries, unknown id is empty")
	fails += 0 if ok else 1
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
