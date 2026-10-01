extends SceneTree
## Runs the real game headless for a few seconds and walks the plot: wakes up,
## takes the pistol, kills what comes, leaves the clinic. Prints a line per check
## and exits non-zero if the game threw or the story did not advance.
##   godot --headless --path . --fixed-fps 60 -s tests/smoke.gd

var game: Game
var frame := 0
var fails := 0
var stage := 0


func _initialize() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)


func _check(ok: bool, what: String) -> void:
	print(("PASS  " if ok else "FAIL  ") + what)
	if not ok:
		fails += 1


func _process(_delta: float) -> bool:
	frame += 1
	match stage:
		0:
			if frame == 5:
				game.begin()
				stage = 1
		1:
			if frame == 20:
				_check(game.state == Game.State.PLAYING, "game is playing")
				_check(game.story.chapter == 0, "chapter 1 started")
				_check(get_nodes_in_group("enemies").size() == 3, "ward ghouls spawned (%d)" % get_nodes_in_group("enemies").size())
				game.player.global_position = Vector3(-13.5, 0.2, -66.5)
				stage = 2
		2:
			if frame == 60:
				_check(game.player.weapons.has("pistol"), "pistol picked up")
				_check(get_nodes_in_group("enemies").size() == 5, "ambush spawned (%d)" % get_nodes_in_group("enemies").size())
				# Shoot every ghoul: teleport it in front of the muzzle and fire.
				stage = 3
		3:
			var alive := get_nodes_in_group("enemies")
			if alive.is_empty():
				_check(game.player.kills >= 5, "killed everything (kills %d)" % game.player.kills)
				game.player.global_position = Vector3(8, 0.2, -62.5)
				stage = 4
				frame = 0
			else:
				var z := alive[0] as Zombie
				game.player.yaw = 0.0
				z.global_position = game.player.global_position + Vector3(0, 0, -4)
				z.velocity = Vector3.ZERO
				game.player.look_at_point(z.chest())
				game.player.pitch = 0.0
				game.player._cd = 0.0
				game.player._try_fire()
				if game.player.weapons.pistol.mag == 0:
					game.player.weapons.pistol.mag = 12
		4:
			if frame == 420:
				_check(game.story.chapter == 1, "left the clinic -> chapter 2 (chapter index %d)" % game.story.chapter)
				print("RESULT ", "OK" if fails == 0 else "FAILED(%d)" % fails)
				quit(fails)
	return false
