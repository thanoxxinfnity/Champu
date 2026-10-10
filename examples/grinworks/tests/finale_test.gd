extends SceneTree
## godot --headless --fixed-fps 60 -s tests/finale_test.gd
## The launch should be winnable by someone who uses the torch, and not by someone who just stands there.

var game: Game
var caught := 0


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	await physics_frame
	await physics_frame
	game._begin()
	await physics_frame
	game.ui.close_modal()
	game.hollow.caught_player.connect(func(): caught += 1)
	var fails := 0
	var wins := 0
	var seeds := 6
	for seed_i in range(seeds):
		if await attempt(seed_i, true):
			wins += 1
	print("  careful player, torch on the creature: %d of %d launches survived" % [wins, seeds])
	if wins < seeds - 1:
		fails += 1
		print("  FAIL a player who aims the torch should nearly always survive")
	var idle_wins := 0
	for seed_i in range(3):
		if await attempt(100 + seed_i, false):
			idle_wins += 1
	print("  idle player, standing still: %d of 3 survived" % idle_wins)
	if idle_wins > 1:
		fails += 1
		print("  FAIL standing still in the dark should not be enough")
	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)


func attempt(seed_i: int, careful: bool) -> bool:
	seed(seed_i)
	var g := game
	var p := g.player
	var h := g.hollow
	var lv := g.level
	for z in lv.lit:
		lv.set_lit(z, z == "airlock", true)
	h.sleep()
	g.s.won = false
	g.s.launching = false
	g.s.cells_in = 3
	p.dead = false
	p.frozen = false
	p.hidden = false
	p.collision_layer = Data.L_PLAYER
	p.global_position = lv.nodes["pod_in"].pos
	p.battery = 100.0
	p.torch_on = true
	p.yaw = 0.0   # facing the pod, away from the door
	p.pitch = 0.0
	lv.doors["pod_door"].set_open(true, true)
	caught = 0
	g._start_launch()
	var frames := 0
	var limit := 60 * 40
	while not g.s.won and caught == 0 and frames < limit:
		await physics_frame
		frames += 1
		if careful and h.state != Hollow.S.DORMANT:
			var to := h.global_position + Vector3(0, 1.3, 0) - p.cam.global_position
			if to.length() < 15.0:
				p.yaw = atan2(-to.x, -to.z)
				p.pitch = asin(to.normalized().y)
				p.torch_on = true
		if p.battery < 30.0:
			p.battery = 30.0   # the pod bay has batteries; the test is about the torch, not the pickup walk
	var won := g.s.won
	g.s.launching = false
	g.s.won = false
	h.sleep()
	h.clear_drag()
	return won
