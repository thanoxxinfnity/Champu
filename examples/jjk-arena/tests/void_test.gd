extends SceneTree
## godot --headless --path . -s tests/void_test.gd   (prints ALL OK)

var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

class Enemy extends CharacterBody3D:
	var stunned := false
	var ticks := 0
	func set_stunned(v: bool) -> void:
		stunned = v
	func _physics_process(_d: float) -> void:
		ticks += 1

func _init() -> void:
	print("infinite void test")
	var root := Node3D.new()
	get_root().add_child(root)
	# the sphere is inside-out: every triangle's geometric normal must point at the centre
	var m := InfiniteVoidManager.make_inverted_sphere(1.0, 16, 8)
	var arr := m.surface_get_arrays(0)
	var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var inward := 0
	var total := 0
	for i in range(0, idx.size(), 3):
		var a := v[idx[i]]
		var b := v[idx[i + 1]]
		var c := v[idx[i + 2]]
		var centre := (a + b + c) / 3.0
		if centre.length() < 0.05 or (b - a).cross(c - a).length() < 1e-6:
			continue  # SphereMesh has zero-area triangles at the poles
		total += 1
		# Godot front faces are clockwise: the visible side is opposite to the counter-clockwise cross product
		if (b - a).cross(c - a).dot(centre) > 0.0:
			inward += 1
	check(inward == total, "all %d triangles face inwards (the viewer inside sees them)" % total)
	var nrm: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var normals_in := 0
	for i in v.size():
		if nrm[i].dot(v[i]) < 0.0:
			normals_in += 1
	check(normals_in == v.size(), "vertex normals are flipped inwards")

	var enemy := Enemy.new()
	enemy.add_to_group("enemy")
	root.add_child(enemy)
	var dm := InfiniteVoidManager.new()
	root.add_child(dm)
	await process_frame
	check(not dm.sphere.visible and dm.sphere.scale == Vector3.ZERO, "sphere starts hidden at scale 0")
	dm.activate(Vector3(5, 0, 5))
	check(dm.active and dm.sphere.visible and dm.floor_mesh.visible, "activate shows sphere and mirror floor")
	check(enemy.stunned and dm.is_enemy_stunned(enemy), "enemy is stunned the instant the domain opens")
	check(not enemy.is_physics_processing(), "enemy has no physics/processing while stunned")
	check(dm.streaks.emitting and dm.post_layer.visible, "light streaks and post effect are on")
	await create_timer(0.2).timeout
	var mid := dm.sphere.scale.x
	await create_timer(0.55).timeout
	check(mid > 0.0 and mid < dm.radius, "sphere is growing at 0.2 s (%.1f)" % mid)
	check(is_equal_approx(dm.sphere.scale.x, dm.radius), "sphere covers the whole arena after 0.5 s (%.1f)" % dm.sphere.scale.x)
	dm.deactivate()
	await create_timer(0.7).timeout
	check(not dm.sphere.visible and not dm.active, "domain closes cleanly")
	check(not enemy.stunned and enemy.is_physics_processing(), "enemy is released when the domain ends")
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
