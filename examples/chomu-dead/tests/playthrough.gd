extends SceneTree
## Plays the whole story headless, the way a player would — walks to each
## objective, collects what the chapter hands out, clears the ghouls — and checks
## that every chapter completes in order and the ending fires. Also dies once
## and retries, to prove checkpoints work.
##   godot --headless --path . --fixed-fps 60 -s tests/playthrough.gd

var game: Game
var frame := 0
var fails := 0
var stage := 0
var wait := 0


func _initialize() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)


func _check(ok: bool, what: String) -> void:
	print(("PASS  " if ok else "FAIL  ") + what)
	if not ok:
		fails += 1


func _kill_all() -> void:
	for z in get_nodes_in_group("enemies"):
		(z as Zombie).take_damage(99999.0, (z as Zombie).chest(), Vector3.UP, false)


func _tp(p: Vector3) -> void:
	game.player.global_position = p
	game.player.velocity = Vector3.ZERO
	game.player.hp = game.player.max_hp


func _wait_for_chapter(n: int, label: String, next: int) -> void:
	# Called every frame while waiting for story.chapter to reach `n`.
	if game.story.chapter == n:
		_check(true, label)
		stage = next
		wait = 20


func _process(_d: float) -> bool:
	frame += 1
	if wait > 0:
		wait -= 1
		return false
	match stage:
		0:
			game.begin()
			wait = 15
			stage = 1
		1:
			_check(game.story.chapter == 0, "chapter 1 starts")
			_tp(Vector3(-13.5, 0.1, -65.6))
			wait = 30
			stage = 2
		2:
			_check(game.player.weapons.has("pistol"), "pistol collected from the cabinet")
			_kill_all()
			wait = 10
			stage = 3
		3:
			_tp(Vector3(8, 0.1, -62.5))
			stage = 4
		4:
			_wait_for_chapter(1, "ch1 done -> chapter 2 starts", 5)
		5:
			_kill_all()
			_tp(Vector3(4, 0.1, -36.5))
			stage = 6
		6:
			_wait_for_chapter(2, "ch2 done -> chapter 3 starts", 7)
		7:
			_kill_all()
			_tp(Vector3(-27, 0.1, 9))
			wait = 20
			stage = 8
		8:
			_check(game.player.weapons.has("shotgun"), "shotgun collected at the gas station")
			_tp(Vector3(-29, 0.1, 5))
			stage = 9
		9:
			wait = 30
			stage = 91
		91:
			_check(game.story.has_cutters, "bolt cutters collected")
			stage = 92
		92:
			_wait_for_chapter(3, "ch3 done -> chapter 4 starts", 10)
		10:
			_kill_all()
			_tp(Vector3(23, 0.1, 24))
			stage = 11
		11:
			wait = 30
			stage = 111
		111:
			_check(game.story.gate_open, "church gate cut open")
			stage = 112
		112:
			_wait_for_chapter(4, "ch4 done -> chapter 5 (horde) starts", 12)
		12:
			# Die once during the horde, retry, and carry on.
			_tp(Vector3(40, 0.1, 24))
			wait = 200
			stage = 13
		13:
			game.player.take_damage(99999.0, Vector3.ZERO)
			wait = 20
			stage = 14
		14:
			_check(game.state == Game.State.DEAD, "player died")
			game.retry()
			wait = 10
			stage = 15
		15:
			_check(game.state == Game.State.PLAYING and game.player.hp > 99.0, "retry restores the player")
			_check(game.story.chapter == 4, "retry stays in the same chapter")
			stage = 16
			frame = 0
		16:
			# Survive the horde: keep him alive and the yard clear until the timer is up.
			game.player.hp = game.player.max_hp
			if frame % 90 == 0:
				_kill_all()
			if game.story.chapter == 4 and game.story.survive_t > 46.0:
				_kill_all()
			if game.story.chapter == 4 and frame > 6000:
				_check(false, "horde chapter never completed (survive_t %.1f)" % game.story.survive_t)
				return _finish()
			if game.story._finished or game.story.chapter == 5:
				stage = 17
		17:
			_wait_for_chapter(5, "ch5 done -> chapter 6 starts", 18)
		18:
			_tp(Vector3(44, 0.1, 14))
			wait = 20
			stage = 19
		19:
			_check(game.player.weapons.has("rifle"), "rifle collected in the vestry")
			_tp(Vector3(0, 0.1, 90))
			wait = 40
			stage = 20
		20:
			_check(game.story.boss != null, "the Warden appears in the yard")
			if game.story.boss != null:
				game.story.boss.take_damage(game.story.boss.max_hp, game.story.boss.chest(), Vector3.UP, true)
			wait = 10
			stage = 21
		21:
			_check(game.story.boss_dead, "the Warden dies")
			stage = 211
		211:
			_wait_for_chapter(6, "ch6 done -> chapter 7 starts", 22)
		22:
			_kill_all()
			_tp(Vector3(0, 0.1, 111))
			stage = 23
			wait = 10
		23:
			_check(game.state == Game.State.WON, "reaching the helicopter wins the game")
			return _finish()
	return false


func _finish() -> bool:
	print("RESULT ", "OK" if fails == 0 else "FAILED(%d)" % fails)
	quit(fails)
	return true
