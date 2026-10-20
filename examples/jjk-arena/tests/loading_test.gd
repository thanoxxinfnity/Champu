extends SceneTree
## godot --headless --path . -s tests/loading_test.gd   (prints ALL OK)
var fails := 0
func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func _init() -> void:
	print("loading screen test")
	var missing := 0
	for p in LoadingScreen.IMAGES:
		if not FileAccess.file_exists(p):
			missing += 1
	check(missing == 0 and LoadingScreen.IMAGES.size() >= 8, "all key-art images exist (%d)" % LoadingScreen.IMAGES.size())
	check(LoadingScreen.TIPS.size() >= 6, "tips rotate")
	var ls := LoadingScreen.new()
	ls.min_show_time = 8.0
	var done := []
	ls.finished.connect(func() -> void: done.append(true))
	get_root().add_child(ls)
	ls.size = Vector2(1280, 720)
	await process_frame
	var tip0 := ls._tip.text
	check(ls._bar.value <= 0.1, "progress bar starts near empty")
	for i in 100:
		ls._process(0.1)
	check(ls._idx >= 2, "slides advance (index %d)" % ls._idx)
	check(ls._tip.text != tip0 or ls._idx >= 6, "the tip changes with the slide")
	check(ls._bar.value >= 1.0 and done.size() == 1, "bar fills and the screen reports finished")
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
