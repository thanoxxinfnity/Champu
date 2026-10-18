extends SceneTree
## godot --headless --path . -s tests/boot_test.gd
## The front door: the loading screen loads the game on a thread, shows its progress, offers Story / Free Roam, and each
## button lands in a running game with the right state.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	await process_frame
	print("boot_test")
	var main := load(ProjectSettings.get_setting("application/run/main_scene")) as PackedScene
	check(main != null and String(ProjectSettings.get_setting("application/run/main_scene")).ends_with("loading_screen.tscn"), "the project starts on the loading screen")
	var screen := main.instantiate()
	root.add_child(screen)
	current_scene = screen
	await process_frame
	check(screen.find_child("Title", true, false) != null and (screen.find_child("Title", true, false) as Label).text == "CRIMSON METROPOLIS", "the title is shown")
	check(screen.find_child("Art", true, false) != null and screen.find_child("Art", true, false).texture != null, "key art is on screen")
	var bar := screen.find_child("Progress", true, false) as ProgressBar
	var seen_partial := false
	var t := 0
	var t0 := Time.get_ticks_msec()
	# Loading runs on a thread in real time, so wait on the clock rather than a frame count (--fixed-fps runs frames far faster).
	while Time.get_ticks_msec() - t0 < 150000 and not (screen.find_child("Buttons", true, false) as Control).visible:
		await process_frame
		t += 1
		if bar.value > 0.02 and bar.value < 0.98:
			seen_partial = true
	var buttons := screen.find_child("Buttons", true, false) as Control
	check(buttons.visible, "loading finishes and the buttons appear (%d frames)" % t)
	check(seen_partial, "the progress bar moved through partial values")
	check(screen.find_child("StoryMode", true, false) != null and screen.find_child("FreeRoam", true, false) != null, "Story Mode and Free Roam buttons exist")

	if screen.find_child("FreeRoam", true, false) == null:
		print("FAILED: no buttons")
		quit(1)
		return
	GameBoot.mode = GameBoot.Mode.STORY
	screen.find_child("FreeRoam", true, false).pressed.emit()
	for i in range(10):
		await process_frame
	await process_frame
	var game := current_scene
	check(game != null and game.get_node_or_null("World") != null, "Free Roam enters the game world")
	var w := game.get_node("World") as World
	for i in range(5):
		await process_frame
	check(w.director.state.mission_stage == PenthouseDeal.Stage.DONE, "Free Roam has no mission prompts")
	check(w.player != null and w.traffic.cars.size() > 0, "the city is populated")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(1 if fails > 0 else 0)
