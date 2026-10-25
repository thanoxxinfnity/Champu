extends SceneTree
## Where do the triangles come from? Sums mesh triangles (x2 for outline passes) by zone and by source, at one spot.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/tri_breakdown.gd -- 2 -52

func _tris(m: Mesh) -> int:
	var t := 0
	for s in m.get_surface_count():
		var arr := m.surface_get_arrays(s)
		var idx = arr[Mesh.ARRAY_INDEX]
		t += (idx.size() if idx != null and idx.size() > 0 else arr[Mesh.ARRAY_VERTEX].size()) / 3
	return t


func _initialize() -> void:
	var a := OS.get_cmdline_user_args()
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	await game.start_game(false)
	for i in 6:
		await process_frame
	game.player.global_position = Vector3(float(a[0]) if a.size() > 0 else 0.0, 0, float(a[1]) if a.size() > 1 else -52.0)
	for i in 20:
		await process_frame
	var cam := game.get_viewport().get_camera_3d()
	var by := {}
	var cnt := {}
	for n in game.find_children("*", "VisualInstance3D", true, false):
		if not (n as Node3D).is_visible_in_tree():
			continue
		var tri := 0
		var key: String = String(n.get_parent().name) if n.get_parent() != null else "?"
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			var mi := n as MeshInstance3D
			tri = _tris(mi.mesh)
			var mult := 1
			for s in mi.mesh.get_surface_count():
				var m: Material = mi.get_active_material(s)
				if m != null and m.next_pass != null:
					mult = 2
			tri *= mult
			key = "%s:%s" % [n.get_path().get_name(min(4, n.get_path().get_name_count() - 1)), mi.mesh.resource_name if mi.mesh.resource_name != "" else mi.mesh.get_class()]
		elif n is MultiMeshInstance3D:
			var mm := (n as MultiMeshInstance3D).multimesh
			tri = _tris(mm.mesh) * mm.visible_instance_count if mm.visible_instance_count >= 0 else _tris(mm.mesh) * mm.instance_count
			if tri == 0:
				tri = _tris(mm.mesh) * mm.instance_count
			key = "multimesh:" + String(n.name)
		else:
			continue
		var g := String(n.get_path()).split("/")
		var short := "/".join(g.slice(0, mini(5, g.size())))
		by[short] = by.get(short, 0) + tri
		cnt[short] = cnt.get(short, 0) + 1
	var rows: Array = []
	for k in by:
		rows.append([by[k], k, cnt[k]])
	rows.sort_custom(func(x, y): return x[0] > y[0])
	var total := 0
	for r in rows:
		total += r[0]
	print("TOTAL scene tris (all visible nodes, outline x2): ", total)
	for r in rows.slice(0, 25):
		print("tri %8d  n=%3d  %s" % [r[0], r[2], r[1]])
	quit()
