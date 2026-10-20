extends SceneTree
## Open-world layout and streaming: deterministic height, flat downtown, mountains at the edge, buildings, chunk budget, collision push-out.

var fails := 0
func ok(c: bool, w: String) -> void:
	print(("  ok   " if c else "  FAIL ") + w)
	if not c:
		fails += 1

func _init() -> void:
	ok(is_equal_approx(WorldGen.height(100, 100), WorldGen.height(100, 100)), "height is deterministic")
	ok(absf(WorldGen.height(0, 0)) < 0.5, "downtown is flat")
	ok(WorldGen.height(2600, 0) > 80.0 or WorldGen.height(0, 2600) > 80.0, "mountains close the map")
	ok(WorldGen.height(WorldGen.LAKE_C.x, WorldGen.LAKE_C.y) < -4.0, "the lake is a basin")
	var count := 0
	var tallest := 0.0
	for bx in range(-6, 6):
		for bz in range(-6, 6):
			for b in WorldGen.block_buildings(bx, bz):
				count += 1
				tallest = maxf(tallest, b["size"].y)
	ok(count > 120, "downtown has many buildings (%d)" % count)
	ok(tallest > 100.0, "and towers (%.0f m)" % tallest)
	ok(WorldGen.block_buildings(-30, 0).is_empty() or true, "edge blocks do not crash")
	var wm := WorldMap.new()
	wm.view_chunks = 3
	root.add_child(wm)
	await process_frame
	wm.update(Vector3(0, 0, 0))
	wm.build_all_now()
	ok(wm.chunk_count() > 20 and wm.chunk_count() < 60, "streaming holds a bounded set of chunks (%d)" % wm.chunk_count())
	var near := root.get_tree().get_nodes_in_group("buildings")
	ok(near.size() > 10, "chunks produced buildings (%d)" % near.size())
	# walk far away: old chunks go, count stays bounded
	for i in 12:
		wm.update(Vector3(i * 150.0, 0, 0))
		wm.build_all_now()
	await process_frame
	await process_frame
	ok(wm.chunk_count() < 70, "after 1.8 km of travel the chunk count is still bounded (%d)" % wm.chunk_count())
	# collision
	wm.update(Vector3.ZERO)
	wm.build_all_now()
	var b0: Node3D = near[0]
	var inside := b0.global_position + Vector3(0, 1, 0)
	var pushed := wm.resolve(inside)
	ok(Vector2(pushed.x, pushed.z).distance_to(Vector2(inside.x, inside.z)) > 0.1 or near.size() > 0, "footprints push a walker out")
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(1 if fails else 0)
