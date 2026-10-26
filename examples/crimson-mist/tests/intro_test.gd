extends SceneTree
## The opening cut-scene plays to the end (or is skipped by a tap) and hands the game over: playing, the player's camera current, no bus left behind.

func _initialize() -> void:
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	game.start_game(false, true)
	var frames := 0
	while game.state != Game.State.PLAYING and frames < 6000:
		await process_frame
		frames += 1
	T.check(game.state == Game.State.PLAYING, "the intro ended and the game is playing (%d frames)" % frames)
	T.check(frames > 700, "the cut-scene really ran (%d frames)" % frames)
	T.check(game.player.cam.is_current(), "the player's camera is current again")
	await process_frame
	await process_frame
	var left := 0
	for c in game.get_children():
		if c is Intro:
			left += 1
	T.check(left == 0, "the cut-scene is freed")
	# skipping: a tap after the first second ends it
	var game2: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game2)
	await process_frame
	game2.start_game(false, true)
	for i in 400:
		await process_frame
		if i == 200:
			var ev := InputEventKey.new()
			ev.pressed = true
			ev.keycode = KEY_SPACE
			Input.parse_input_event(ev)
	var n := 0
	while game2.state != Game.State.PLAYING and n < 1500:
		await process_frame
		n += 1
	T.check(game2.state == Game.State.PLAYING and n < 300, "a tap skips it (%d more frames)" % n)
	T.done(self)
