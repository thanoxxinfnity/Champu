extends SceneTree
## The sky spawner: a hard cap of 50 bodies, recycled (never more nodes), and the three release rules: below Y -10, more than 50 m behind, older than 15 s.

func _initialize() -> void:
	var world := TrainWorld.new()
	root.add_child(world)
	var fx := Fx.new()
	root.add_child(fx)
	var sp := OptimizedSkySpawner.new()
	sp.world = world
	sp.fx = fx
	sp.enabled = false
	root.add_child(sp)
	await process_frame
	T.check(sp.pool.size() == Data.DEBRIS_CAP, "the pool holds exactly %d bodies" % Data.DEBRIS_CAP)
	var nodes_before := sp.get_child_count()
	for i in 60:
		sp.spawn_block(Vector3(0, 12 + i * 0.1, -20), 1.0, Vector3.ZERO, i)
	T.check(sp.active_count() == Data.DEBRIS_CAP, "no more than the cap is ever active (%d)" % sp.active_count())
	T.check(sp.spawn_block(Vector3.ZERO, 1.0, Vector3.ZERO, 0) == null, "a spawn at the cap returns nothing")
	T.check(sp.get_child_count() == nodes_before, "nothing new is created while playing")
	sp.release_all()
	T.check(sp.active_count() == 0 and sp.pool.size() == Data.DEBRIS_CAP, "release_all gives every body back to the pool")
	# rule 1: Y < -10
	var a := sp.spawn_block(Vector3(10, -11, -20), 1.0, Vector3.ZERO, 0)
	# rule 2: more than 50 m behind the train
	var b := sp.spawn_block(Vector3(0, 6, 55), 1.0, Vector3.ZERO, 1)
	b.freeze = true
	# rule 3: older than 15 s
	var c := sp.spawn_block(Vector3(0, 8, -30), 1.0, Vector3.ZERO, 2)
	c.freeze = true
	c.age = Data.DEBRIS_TTL + 0.5
	# a fresh block that must survive
	var d := sp.spawn_block(Vector3(0, 8, -40), 1.0, Vector3.ZERO, 3)
	d.freeze = true
	await T.frames(self, 4)
	T.check(not a.active, "a block below Y -10 is released")
	T.check(not b.active, "a block more than 50 m behind is released")
	T.check(not c.active, "a block older than 15 s is released")
	T.check(d.active, "a fresh block on the roof stays")
	# a block that leaves the roof becomes a kinematic faller that drifts back with the world and is released after the drop
	sp.release_all()
	var f := sp.spawn_block(Vector3(8, Data.DECK_Y - 1.5, -20), 1.0, Vector3(0, -3, 0), 4)
	await T.frames(self, 3)
	T.check(f.faller, "a block off the side turns into a cheap faller")
	var z0 := f.global_position.z
	await T.frames(self, 20)
	T.check(f.global_position.z > z0 or not f.active, "…and drifts back with the speed of the train")
	for i in 400:
		await process_frame
	T.check(not f.active, "…until it is released")
	# a block lands on the roof and rests there (real physics, the roof is solid)
	sp.release_all()
	var r := sp.spawn_block(Vector3(0, Data.DECK_Y + 4.0, -6), 1.0, Vector3.ZERO, 0)
	await T.frames(self, 90)
	T.check(r.active and absf(r.global_position.y - (Data.DECK_Y + 0.5)) < 0.4, "a block rests on the roof (y %.2f)" % r.global_position.y)
	# snapshots: pack on the host, rebuild on a client
	var host_n := sp.pack_snapshot().size() / OptimizedSkySpawner.STRIDE
	var cl := OptimizedSkySpawner.new()
	cl.world = world
	cl.authority = false
	root.add_child(cl)
	await process_frame
	cl.apply_snapshot(sp.pack_snapshot())
	T.check(cl.active_count() == host_n and host_n >= 1, "a client rebuilds the host's blocks from a snapshot (%d)" % cl.active_count())
	cl.apply_snapshot(PackedFloat32Array())
	T.check(cl.active_count() == 0, "…and drops the ones the host no longer lists")
	T.done(self)
