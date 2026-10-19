extends SceneTree
## Headless checks for the destruction system:  godot --headless --path . -s tests/destruction_test.gd   (prints ALL OK)

var fails := 0

func check(ok: bool, what: String) -> void:
	if ok:
		print("  ok   ", what)
	else:
		print("  FAIL ", what)
		fails += 1

# Every undirected edge of a closed mesh must be used by exactly two triangles (after welding vertices by position).
func watertight(mesh: ArrayMesh) -> bool:
	var edges := {}
	for s in mesh.get_surface_count():
		var arr := mesh.surface_get_arrays(s)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var idx = arr[Mesh.ARRAY_INDEX]
		var n: int = v.size() if idx == null else (idx as PackedInt32Array).size()
		for t in range(0, n, 3):
			var k := []
			for j in 3:
				var vi: int = t + j if idx == null else (idx as PackedInt32Array)[t + j]
				var p := v[vi]
				k.append(Vector3i(roundi(p.x * 1000), roundi(p.y * 1000), roundi(p.z * 1000)))
			for j in 3:
				var a: Vector3i = k[j]
				var b: Vector3i = k[(j + 1) % 3]
				if a == b:
					continue
				var sa := str(a)
				var sb := str(b)
				var key := sa + sb if sa < sb else sb + sa
				edges[key] = edges.get(key, 0) + 1
	for e in edges:
		if edges[e] != 2:
			return false
	return true

func volume(mesh: ArrayMesh) -> float:
	var vol := 0.0
	for s in mesh.get_surface_count():
		var arr := mesh.surface_get_arrays(s)
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		for t in range(0, v.size(), 3):
			vol += v[t].dot(v[t + 1].cross(v[t + 2])) / 6.0
	return absf(vol)

func _init() -> void:
	print("destruction test")
	var box := BoxMesh.new()
	box.size = Vector3(4, 1, 4)
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, box.get_mesh_arrays())

	# slicing a box through the middle gives two watertight halves of equal volume
	var halves := MeshSlicer.slice(am, Plane(Vector3(1, 0, 0), 0.0))
	check(halves[0] != null and halves[1] != null, "slice through the middle gives two meshes")
	check(watertight(halves[0]) and watertight(halves[1]), "both halves are watertight (caps close the cut)")
	var v0 := volume(halves[0])
	var v1 := volume(halves[1])
	check(absf(v0 - v1) < 0.05 and absf(v0 + v1 - 16.0) < 0.1, "halves are 8 + 8 volume (got %.2f + %.2f)" % [v0, v1])

	# an oblique plane still conserves volume
	var oblique := MeshSlicer.slice(am, Plane(Vector3(1, 0.4, 0.2).normalized(), 0.3))
	check(absf(volume(oblique[0]) + volume(oblique[1]) - 16.0) < 0.1, "oblique cut conserves volume")
	check(watertight(oblique[0]) and watertight(oblique[1]), "oblique halves are watertight")

	# a plane that misses the mesh leaves one side empty
	var miss := MeshSlicer.slice(am, Plane(Vector3(0, 1, 0), 5.0))
	check(miss[0] == null or miss[1] == null, "plane outside the mesh yields one empty side")

	# manager: swap keeps the transform, hides A, shows B
	var root := Node3D.new()
	get_root().add_child(root)
	var a := MeshInstance3D.new()
	a.mesh = box
	a.name = "Intact"
	var bnode := MeshInstance3D.new()
	bnode.mesh = box
	bnode.name = "Heavy"
	root.add_child(a)
	root.add_child(bnode)
	a.global_transform = Transform3D(Basis.from_euler(Vector3(0, 0.7, 0)).scaled(Vector3(1.5, 1.5, 1.5)), Vector3(3, 1, -2))
	var dm := DestructionManager.new()
	dm.intact = a
	dm.heavy = bnode
	root.add_child(dm)
	await process_frame
	check(a.visible and not bnode.visible, "state A visible, state B hidden before the hit")
	dm.on_ultimate_hit(Vector3(3, 1, -2), 6.0)
	check(not a.visible and bnode.visible, "ultimate swaps A -> B")
	check(bnode.global_transform.is_equal_approx(a.global_transform), "B takes exactly A's transform (position, rotation, scale)")
	check(dm.active_debris() > 0, "rubble is thrown on the swap frame (%d bodies)" % dm.active_debris())
	dm.reset_arena()
	check(a.visible and not bnode.visible, "reset restores state A")

	# pool never grows past its cap, whatever the quality
	dm.quality = DestructionManager.Quality.HIGH
	for i in 10:
		dm._throw_rubble(Vector3.ZERO, 4.0, 1.0)
	check(dm.active_debris() <= DestructionManager.DEBRIS_POOL, "debris pool is capped (%d <= %d)" % [dm.active_debris(), DestructionManager.DEBRIS_POOL])
	dm.quality = DestructionManager.Quality.LOW
	var before := dm._debris_count()
	check(before < 28, "low quality throws less rubble (%d)" % before)

	# slicing a node in the scene replaces it with two rigid bodies
	var slab := MeshInstance3D.new()
	slab.mesh = am
	root.add_child(slab)
	slab.global_position = Vector3(0, 5, 0)
	var pieces := dm.on_cleave_hit(Vector3(0, 5, 0), Vector3(1, 0, 0), slab)
	check(pieces.size() == 2, "cleave turns the slab into two rigid bodies")
	check(not slab.is_inside_tree() or slab.is_queued_for_deletion(), "original slab is removed")
	var moving := 0
	for p in pieces:
		if p.linear_velocity.length() > 0.0 or p.get_meta("age") == 0.0:
			moving += 1
	check(moving == 2, "pieces are dynamic bodies")

	# quality guard: a long run of slow frames lowers the quality
	dm.quality = DestructionManager.Quality.HIGH
	dm.target_fps = 60.0
	for i in 40:
		dm._process(0.05)
	check(dm.quality < DestructionManager.Quality.HIGH, "quality guard lowers settings on slow frames")

	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
