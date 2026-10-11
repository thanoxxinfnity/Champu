extends SceneTree
func _init() -> void:
	for name in OS.get_cmdline_user_args():
		var ps := load("res://assets/models/%s.glb" % name) as PackedScene
		var root := ps.instantiate()
		var mi := root.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
		var v: PackedVector3Array = mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
		var bb := mi.get_aabb()
		print("== ", name, " aabb P=", bb.position, " S=", bb.size, " xf=", mi.transform)
		var steps := 20
		for i in range(steps):
			var y0 := bb.position.y + bb.size.y * i / steps
			var y1 := bb.position.y + bb.size.y * (i + 1) / steps
			var xmin := 1e9; var xmax := -1e9; var zmin := 1e9; var zmax := -1e9; var c := 0
			for p in v:
				if p.y >= y0 and p.y < y1:
					xmin = minf(xmin, p.x); xmax = maxf(xmax, p.x); zmin = minf(zmin, p.z); zmax = maxf(zmax, p.z); c += 1
			print("y %.2f  x [%.2f %.2f] z [%.2f %.2f] n=%d" % [float(i) / steps, (xmin-bb.position.x)/bb.size.x, (xmax-bb.position.x)/bb.size.x, (zmin-bb.position.z)/bb.size.z, (zmax-bb.position.z)/bb.size.z, c])
	quit()
