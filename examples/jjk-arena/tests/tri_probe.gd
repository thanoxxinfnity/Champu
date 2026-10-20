extends SceneTree
## Triangle and part count of every ModelCatalog model (towers, mid-rise blocks, trees) - the open world's triangle budget.

func _tris(m: Mesh) -> int:
	var n := 0
	for s in m.get_surface_count():
		var a := m.surface_get_arrays(s)
		var idx = a[Mesh.ARRAY_INDEX]
		n += (idx.size() if idx != null else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	return n

func _init() -> void:
	for name in ModelCatalog.TOWERS + ModelCatalog.MIDRISE + ModelCatalog.TREES:
		var e := ModelCatalog.entry(name)
		if e.is_empty():
			print("MISSING ", name)
			continue
		var t := 0
		for p in e["parts"]:
			t += _tris(p[0])
		print("TRI %-18s parts=%3d tris=%d" % [name, e["parts"].size(), t])
	quit()
