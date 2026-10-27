extends SceneTree
## Boundary stress run: the hero is driven at high speed across the whole map (town, district, jungle, the far edges and past them), jetting and dropping,
## and every frame is checked: never below the ground without the safety floor catching it, never stuck under the floor, no script errors; the bots
## run the whole time too. Prints the worst frame, the draw calls of a busy view and how many falls the floor caught.
##   xvfb-run -a godot --rendering-driver opengl3 --path . --fixed-fps 60 -s tests/stress_test.gd

func _initialize() -> void:
	var g := await T.boot(self, "outlaw")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 30)
	var p: PlayerController = g.player
	var w: OpenWorld = g.world
	p.shield = 9999.0
	var half: float = OpenWorld.HALF
	# a route of waypoints: town, district, the four edges and corners, and 30 m past each edge
	var route: Array = [Vector2(0, 0), Vector2(60, 30), Vector2(-60, -30)]
	if w.district != null:
		var r: Rect2 = w.district.rect
		route.append_array([r.position, r.position + r.size, r.get_center(), Vector2(r.position.x, r.end.y)])
	for k in [Vector2(1, 0), Vector2(0, 1), Vector2(-1, 0), Vector2(0, -1), Vector2(1, 1), Vector2(-1, -1)]:
		route.append(k * (half - 5.0))
		route.append(k * (half + 30.0))
		route.append(Vector2.ZERO)
	var frames := 0
	var below := 0
	var worst_y := 1.0e9
	var stuck := 0
	var draws := 0
	var last := p.global_position
	for target in route:
		var tgt: Vector2 = target
		print("waypoint ", tgt, "  frames so far ", frames)
		var guard := 0
		while Vector2(p.global_position.x, p.global_position.z).distance_to(tgt) > 6.0 and guard < 500:
			var to := Vector3(tgt.x - p.global_position.x, 0, tgt.y - p.global_position.z).normalized()
			p.yaw = atan2(-to.x, -to.z)
			p.move_input = Vector2(0, 1)
			p.jet_held = guard % 120 < 50
			if guard % 120 == 0:
				p.press_jump()
			# high speed: push the body along every frame on top of the normal run (the "teleport-ish" stress)
			p.global_position += to * 0.9
			await process_frame
			guard += 1
			frames += 1
			worst_y = minf(worst_y, p.global_position.y)
			if p.global_position.y < -0.5:
				below += 1
			if p.global_position.distance_to(last) < 0.001 and not p.jet_held:
				stuck += 1
			last = p.global_position
			draws = maxi(draws, int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)))
	p.move_input = Vector2.ZERO
	p.jet_held = false
	# drop from high above the town and the district: must land on something, not fall through
	for drop in [Vector3(0, 60, 0), Vector3(20, 80, 10)]:
		p.global_position = drop
		p.velocity = Vector3.ZERO
		await T.frames(self, 360)
		worst_y = minf(worst_y, p.global_position.y)
		T.check(p.global_position.y > -0.5 and p.is_on_floor(), "a drop from %.0f m lands on solid ground (y %.2f)" % [drop.y, p.global_position.y])
	# below the floor on purpose: the safety floor must catch it within a second
	p.global_position = Vector3(5, -20, 5)
	await T.frames(self, 60)
	T.check(p.global_position.y > -1.0, "a hero pushed under the map is put back on the surface (y %.1f)" % p.global_position.y)
	T.check(frames > 300, "the run crossed the map (%d frames, %d waypoints)" % [frames, route.size()])
	T.check(below < frames / 50, "the hero almost never dipped below the ground (%d frames of %d, worst y %.2f)" % [below, frames, worst_y])
	T.check(stuck < frames / 10, "never stuck in place (%d frames)" % stuck)
	var bad_bots := 0
	for a in g.mc.actors:
		var b := a as PlayerController
		if b != p and b.alive and b.global_position.y < -1.0:
			bad_bots += 1
	T.check(bad_bots == 0, "no bot is under the map (%d)" % bad_bots)
	print("max draw calls seen: %d   falls caught by the floor: %d" % [draws, g.hud.falls_caught])
	T.done(self)
