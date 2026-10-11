extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/game_test.gd
## What the things in the world do: the fuse box, the generator's levers, the keycard panel, the bomb and its countdown, the electrified
## water, the falling pipes, the conveyor belts, and what being hurt does.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func steps(n: int) -> void:
	for i in range(n):
		await physics_frame


func goto(p: Vector3, n := 6) -> void:
	game.player.global_position = p
	game.player.velocity = Vector3.ZERO
	await steps(n)


func quiet() -> void:
	for e in game.enemies.duplicate():
		if e != game.warden:
			e.queue_free()
			game.enemies.erase(e)
	await steps(2)


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	await steps(6)
	game._begin()
	await steps(10)
	await quiet()
	var s := game.s

	print("-- chapter 1: the fuse box and the lift")
	game.fusebox(null)
	check(not s.cable_in, "the box does nothing without the cable")
	s.inv = ["cable", "fuse", "fuse", "fuse"]
	game.fusebox(null)
	check(s.cable_in and not s.inv.has("cable"), "the cable goes in first")
	game.fusebox(null)
	check(s.fuses_in == 1 and not s.unlocked.has("lift1"), "one fuse is not enough")
	game.fusebox(null)
	check(s.fuses_in == 2 and s.unlocked.has("lift1"), "two fuses unlock the lift")
	check(s.inv.count("fuse") == 1, "and the spare stays in the pack")

	print("-- chapter 2: the generator")
	game._enter_chapter(2, false)
	await steps(10)
	await quiet()
	check(s.chapter == 2 and game.world.current == "c2_lobby", "the lift took the player to the flooded lobby")
	game.lever(null, "red")
	game.lever(null, "blue")
	game.lever(null, "green")
	check(not s.gen_on and s.levers.is_empty(), "red, blue, green is the wrong order: nothing starts and the levers reset")
	game.lever(null, "blue")
	game.lever(null, "red")
	game.lever(null, "green")
	check(s.gen_on and s.unlocked.has("lift2"), "blue, red, green starts the generator and unlocks the lift")

	print("-- the electrified water")
	s.gen_on = false
	await goto(Vector3(110, 0, 10))           # off the planks, in the water
	check(Dressing.in_water("c2_lobby", game.player.global_position), "the player is standing in water")
	var h0 := game.player.health
	await steps(60 * 2)
	check(game.player.health < h0, "standing in the water while the current is on hurts (%d -> %d)" % [h0, game.player.health])
	game.player.health = 3
	game.player.dead = false
	await goto(Vector3(111, 0, 6))            # on a plank
	var h1 := game.player.health
	await steps(60 * 2)
	check(game.player.health == h1, "on a plank it does not")
	s.gen_on = true
	await goto(Vector3(110, 0, 10))
	h1 = game.player.health
	await steps(60 * 2)
	check(game.player.health == h1, "once the generator runs the water is safe")
	check(game.noise_radius_in_water() > 8.0, "and a step in the water is loud enough to wake a hunter")

	print("-- chapter 3: the keycard and the factory")
	game._enter_chapter(3, false)
	await steps(10)
	check(game.warden != null and is_instance_valid(game.warden), "the Warden walks the assembly floor")
	await goto(Vector3(213, 1.0, 4.0))
	game.player.push = Vector3.ZERO
	await steps(2)
	var x0 := game.player.global_position.x
	await steps(60)
	check(game.player.global_position.x > x0 + 0.8, "the belt carries the player along (%.1f -> %.1f)" % [x0, game.player.global_position.x])
	await goto(Vector3(230, 0, 6), 4)
	game.door_panel(null, "lift3")
	check(not s.unlocked.has("lift3"), "the panel refuses without a keycard")
	s.inv = ["keycard"]
	game.door_panel(null, "lift3")
	check(s.unlocked.has("lift3") and s.inv.is_empty(), "with the keycard it opens")
	game.office_switch(null)
	check(s.unlocked.has("office"), "the switch in the locker room opens the office")

	print("-- falling pipes")
	await goto(Vector3(214, 0, 6), 6)
	var pipes := 0
	await steps(10)
	for n in game.world.loaded["c3_floor"].get_children():
		if n is RigidBody3D:
			pipes += 1
	check(s.sprung.has("c3_floor") and pipes >= 1, "stepping into the trigger drops pipes (%d bodies)" % pipes)
	var layer_ok := true
	for n in game.world.loaded["c3_floor"].get_children():
		if n is RigidBody3D and n.collision_layer != Data.L_ENEMY:
			layer_ok = false
	check(layer_ok, "they live on layer 2, with the creatures")
	game.player.health = 1
	check(true, "(a pipe cannot take the last point of health: see game.gd)")
	await steps(60 * 3)
	var settled := true
	for n in game.world.loaded["c3_floor"].get_children():
		if n is RigidBody3D and (n.global_position.y < -0.5 or n.global_position.y > 4.0):
			settled = false
	if not settled:
		for n in game.world.loaded["c3_floor"].get_children():
			if n is RigidBody3D:
				print("    pipe at ", n.global_position, " sleeping ", n.sleeping)
	check(settled, "and land on the floor rather than through it")

	print("-- chapter 4: the bomb")
	game._enter_chapter(4, false)
	await steps(10)
	await quiet()
	await goto(Vector3(331, 0, 9.5), 10)
	game.plant_bomb(null)
	check(not s.planted, "the core refuses without a bomb")
	s.inv = ["wiring", "timer", "gel"]
	check(game.craft(0, 1) and s.inv == ["gel", "detonator"], "wiring and timer make a detonator")
	check(game.craft(0, 1) and s.inv == ["mega_bomb"], "and the detonator with the gel a mega-bomb")
	game.plant_bomb(null)
	check(s.planted and s.countdown > 170.0 and s.unlocked.has("exit"), "planted: the clock starts and the exit lift unlocks")
	if game.warden != null and is_instance_valid(game.warden):
		game.warden.stun(1.0)
	s.countdown = 0.2
	await steps(60)
	check(game.player.dead, "when the clock runs out the player is dead")
	game.player.dead = false
	s.planted = true
	s.countdown = BOMB_RESET
	game.lift_button(null, 4)
	check(s.won, "the exit lift with the bomb planted ends the game")

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)


const BOMB_RESET := 100.0
