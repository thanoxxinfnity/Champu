class_name MeshSlicer
extends RefCounted
## Plane slicing of a triangle mesh (one surface) into two closed halves.
##
## Each triangle is clipped against the plane; the cut edges are linked into loops and every loop is capped (triangulated in the plane),
## so both pieces stay watertight and can get a convex collision shape and a rigid body. Only vertex positions, normals and UVs are
## kept (that is all the arena concrete uses), which keeps the work per slice small enough for a phone: a few thousand triangles.

const EPS := 1e-5
const KEY_SCALE := 10000.0

## Returns [above, below] as ArrayMesh (null when a side is empty). `plane` is in the mesh's local space.
## `cap_material` (optional) is used for the new faces; the original surface material is kept for the rest.
static func slice(mesh: Mesh, plane: Plane, cap_material: Material = null) -> Array:
	var arrays := mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var norms: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
	if idx.is_empty():
		idx.resize(verts.size())
		for i in verts.size():
			idx[i] = i
	var has_n := norms.size() == verts.size()
	var has_uv := uvs.size() == verts.size()
	var sides: Array = [_Side.new(), _Side.new()]  # 0 above, 1 below
	var segs: Array[PackedVector3Array] = []
	for t in range(0, idx.size(), 3):
		var tri: Array = []
		for k in 3:
			var i := idx[t + k]
			tri.append(_V.new(verts[i], norms[i] if has_n else Vector3.UP, uvs[i] if has_uv else Vector2.ZERO, plane.distance_to(verts[i])))
		var above: Array = []
		var below: Array = []
		var cut: Array = []
		for k in 3:
			var a: _V = tri[k]
			var b: _V = tri[(k + 1) % 3]
			if a.d >= -EPS:
				above.append(a)
			if a.d <= EPS:
				below.append(a)
			if (a.d > EPS and b.d < -EPS) or (a.d < -EPS and b.d > EPS):
				var f := a.d / (a.d - b.d)
				var m := _V.new(a.p.lerp(b.p, f), a.n.lerp(b.n, f).normalized(), a.uv.lerp(b.uv, f), 0.0)
				above.append(m)
				below.append(m)
				cut.append(m.p)
			elif absf(a.d) <= EPS:
				cut.append(a.p)
		_fan(sides[0], above)
		_fan(sides[1], below)
		if cut.size() == 2 and cut[0].distance_squared_to(cut[1]) > EPS * EPS:
			segs.append(PackedVector3Array([cut[0], cut[1]]))
	var loops := _loops(segs)
	for loop in loops:
		_cap(sides, loop, plane)
	var out: Array = []
	for s in 2:
		out.append(sides[s].build(mesh.surface_get_material(0), cap_material))
	return out

class _V:
	var p: Vector3
	var n: Vector3
	var uv: Vector2
	var d: float
	func _init(p_: Vector3, n_: Vector3, uv_: Vector2, d_: float) -> void:
		p = p_
		n = n_
		uv = uv_
		d = d_

class _Side:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var cv := PackedVector3Array()
	var cn := PackedVector3Array()
	var cuv := PackedVector2Array()
	func add(a: _V) -> void:
		v.append(a.p)
		n.append(a.n)
		uv.append(a.uv)
	func build(mat: Material, cap_mat: Material) -> ArrayMesh:
		if v.size() < 3:
			return null
		var m := ArrayMesh.new()
		var ar := []
		ar.resize(Mesh.ARRAY_MAX)
		ar[Mesh.ARRAY_VERTEX] = v
		ar[Mesh.ARRAY_NORMAL] = n
		ar[Mesh.ARRAY_TEX_UV] = uv
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, ar)
		m.surface_set_material(0, mat)
		if cv.size() >= 3:
			var cr := []
			cr.resize(Mesh.ARRAY_MAX)
			cr[Mesh.ARRAY_VERTEX] = cv
			cr[Mesh.ARRAY_NORMAL] = cn
			cr[Mesh.ARRAY_TEX_UV] = cuv
			m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, cr)
			m.surface_set_material(1, cap_mat if cap_mat != null else mat)
		return m

# Triangulate the clipped polygon (3 or 4 vertices) as a fan, keeping the original winding.
static func _fan(side: _Side, poly: Array) -> void:
	for i in range(1, poly.size() - 1):
		side.add(poly[0])
		side.add(poly[i])
		side.add(poly[i + 1])

static func _key(p: Vector3) -> Vector3i:
	return Vector3i(roundi(p.x * KEY_SCALE), roundi(p.y * KEY_SCALE), roundi(p.z * KEY_SCALE))

# Chain the cut segments into closed loops (each point is shared by exactly two segments on a closed mesh).
static func _loops(segs: Array[PackedVector3Array]) -> Array:
	var by_end := {}
	for i in segs.size():
		for e in 2:
			var k := _key(segs[i][e])
			if not by_end.has(k):
				by_end[k] = []
			by_end[k].append(i)
	var used := {}
	var loops: Array = []
	for i in segs.size():
		if used.has(i):
			continue
		used[i] = true
		var loop := PackedVector3Array([segs[i][0], segs[i][1]])
		var guard := 0
		while guard < segs.size() + 2:
			guard += 1
			var tail := loop[loop.size() - 1]
			var nxt := -1
			for j in by_end.get(_key(tail), []):
				if not used.has(j):
					nxt = j
					break
			if nxt < 0:
				break
			used[nxt] = true
			var s := segs[nxt]
			loop.append(s[1] if _key(s[0]) == _key(tail) else s[0])
		if loop.size() > 3 and _key(loop[0]) == _key(loop[loop.size() - 1]):
			loop.remove_at(loop.size() - 1)
		if loop.size() >= 3:
			loops.append(loop)
	return loops

static func _cap(sides: Array, loop: PackedVector3Array, plane: Plane) -> void:
	var n := plane.normal
	var u := n.cross(Vector3.UP if absf(n.dot(Vector3.UP)) < 0.9 else Vector3.RIGHT).normalized()
	var w := n.cross(u)
	var pts := PackedVector2Array()
	for p in loop:
		pts.append(Vector2(p.dot(u), p.dot(w)))
	var tris := Geometry2D.triangulate_polygon(pts)
	if tris.is_empty():
		tris = PackedInt32Array()
		for i in range(1, loop.size() - 1):
			tris.append_array([0, i, i + 1])
	for t in range(0, tris.size(), 3):
		for side in 2:
			var s: _Side = sides[side]
			var nrm := -n if side == 0 else n  # the cap of the upper half faces down into the cut
			var order := [0, 1, 2]
			# Godot's front faces are clockwise, so the counter-clockwise normal must point away from nrm
			var a := loop[tris[t]]
			var b := loop[tris[t + 1]]
			var c := loop[tris[t + 2]]
			if (b - a).cross(c - a).dot(nrm) > 0.0:
				order = [0, 2, 1]
			var tri := [a, b, c]
			for k in order:
				var p: Vector3 = tri[k]
				s.cv.append(p)
				s.cn.append(nrm)
				s.cuv.append(Vector2(p.dot(u), p.dot(w)) * 0.25)
