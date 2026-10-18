extends SceneTree
## godot --headless --path . -s tests/island_test.gd
## The Bermuda-style island: terrain with collision, every landmark placed on dry land, trees, a player who stands on the ground and
## a car that drives over it, the sails turning, the sea around it, and the loading screen's ISLAND button.

var fails := 0


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	await process_frame
	print("island_test")
	var world := World.new()
	world.map = "island"
	root.add_child(world)
	await process_frame
	await process_frame
	var isl := world.island
	var p := world.player
	check(isl != null and isl.terrain != null and isl.sea != null, "the island has terrain and a sea")
	var lo := 1e9
	var hi := -1e9
	for x in range(-900, 901, 60):
		for z in range(-900, 901, 60):
			var h := isl.height_at(x, z)
			lo = minf(lo, h)
			hi = maxf(hi, h)
	check(lo < -5.0 and hi > 100.0, "relief from the sea floor to the peak (%.0f m … %.0f m)" % [lo, hi])
	check(isl.height_at(1200, 0) < -5.0, "open sea beyond the coast")
	for s in Island.SITES:
		var h := isl.height_at(s.pos.x, s.pos.y)
		check(h > 2.0, "%s stands on dry land (%.1f m)" % [s.name, h])
	for n in ["Clock Tower", "Mill", "Factory", "Shipyard", "Rim Nam", "Cape", "Downtown", "Watch Peak"]:
		check(isl.landmarks.get(n) != null, "landmark placed: %s" % n)
	check(isl.trees > 600, "forests: %d trees and bushes" % isl.trees)
	check(isl.npcs.size() >= 25, "%d people live on the island" % isl.npcs.size())
	var npc0 := isl.npcs[0]
	var npc_start := npc0.global_position
	check(isl.trees > 1200, "the jungle thickens the forests (%d)" % isl.trees)
	check(isl.blades.size() == 1, "the windmill sails have a pivot to turn on")
	var rot0 := (isl.blades[0] as Node3D).rotation.z
	for i in range(60):
		await physics_frame
	check(absf((isl.blades[0] as Node3D).rotation.z - rot0) > 0.05, "…and they turn")

	# Gravity and the heightfield collision hold the player and the cars up.
	for i in range(90):
		await physics_frame
	var ground := isl.height_at(p.global_position.x, p.global_position.z)
	check(absf(p.global_position.y - ground) < 0.6, "the player stands on the ground (%.2f vs %.2f)" % [p.global_position.y, ground])
	check(world.vehicles.size() == 3, "three cars wait in the town")
	var car: Vehicle = world.vehicles[0]
	await physics_frame
	var cg := isl.height_at(car.global_position.x, car.global_position.z)
	check(car.global_position.y - cg < 1.6 and car.global_position.y - cg > 0.2, "the car sits on the ground (%.2f above)" % (car.global_position.y - cg))
	var start := car.global_position
	car.is_player_driven = true
	car.driver = p
	car.set_controls(1.0, 0.0, false)
	for i in range(60 * 5):
		await physics_frame
	check(car.global_position.distance_to(start) > 12.0 and car.global_basis.y.y > 0.8, "the car drives over the island (%.0f m, upright)" % car.global_position.distance_to(start))
	car.is_player_driven = false
	car.driver = null

	# People wander and run from gunfire.
	var moved := 0
	for n in isl.npcs:
		if n.global_position.distance_to(isl.height_at(n.global_position.x, n.global_position.z) * Vector3.UP + Vector3(n.global_position.x, 0, n.global_position.z)) > 3.0:
			moved += 0
	await physics_frame
	var near_npc := isl.npcs[0]
	world.get_tree().call_group("pedestrians", "hear_noise", near_npc.global_position + Vector3(3, 0, 0), true)
	check(near_npc.fleeing, "a gunshot sends an islander running")
	var walkers := 0
	for i in range(60 * 6):
		await physics_frame
	for n in isl.npcs:
		var h := isl.height_at(n.global_position.x, n.global_position.z)
		if absf(n.global_position.y - h) < 1.2:
			walkers += 1
	check(walkers >= isl.npcs.size() - 2, "islanders keep their feet on the ground (%d of %d)" % [walkers, isl.npcs.size()])
	check(npc0.global_position.distance_to(npc_start) > 1.0, "…and walk about")

	# HUD and radar know about the island.
	check(world.director != null and world.director.hud.minimap.island == isl, "the radar shows the island")
	check(world.director.hud.objective_text.begins_with("Explore Bermuda"), "the objective invites exploring")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(1 if fails > 0 else 0)
