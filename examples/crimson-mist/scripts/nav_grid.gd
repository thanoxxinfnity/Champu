class_name NavGrid
extends RefCounted
## Walkable-cell grid on the ground plane (1 m cells) with A* paths. Built from the boxes the world registers, so it needs no baking,
## works headless and is deterministic for tests.

var astar := AStarGrid2D.new()
var origin := Vector2.ZERO
var cell := 1.0
var size := Vector2i.ZERO


func setup(rect: Rect2, cell_size := 1.0) -> void:
	origin = rect.position
	cell = cell_size
	size = Vector2i(int(ceil(rect.size.x / cell)), int(ceil(rect.size.y / cell)))
	astar.region = Rect2i(Vector2i.ZERO, size)
	astar.cell_size = Vector2.ONE
	astar.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES
	astar.default_compute_heuristic = AStarGrid2D.HEURISTIC_OCTILE
	astar.default_estimate_heuristic = AStarGrid2D.HEURISTIC_OCTILE
	astar.update()


func to_cell(p: Vector3) -> Vector2i:
	return Vector2i(clampi(int(floor((p.x - origin.x) / cell)), 0, size.x - 1), clampi(int(floor((p.z - origin.y) / cell)), 0, size.y - 1))


func to_world(c: Vector2i) -> Vector3:
	return Vector3(origin.x + (c.x + 0.5) * cell, 0.0, origin.y + (c.y + 0.5) * cell)


func block_rect(r: Rect2, margin := 0.45) -> void:
	var a := to_cell(Vector3(r.position.x - margin, 0, r.position.y - margin))
	var b := to_cell(Vector3(r.end.x + margin, 0, r.end.y + margin))
	for x in range(a.x, b.x + 1):
		for y in range(a.y, b.y + 1):
			astar.set_point_solid(Vector2i(x, y), true)


func unblock_rect(r: Rect2) -> void:
	var a := to_cell(Vector3(r.position.x, 0, r.position.y))
	var b := to_cell(Vector3(r.end.x, 0, r.end.y))
	for x in range(a.x, b.x + 1):
		for y in range(a.y, b.y + 1):
			astar.set_point_solid(Vector2i(x, y), false)


func walkable(p: Vector3) -> bool:
	var c := to_cell(p)
	return not astar.is_point_solid(c)


func nearest_free(c: Vector2i) -> Vector2i:
	if not astar.is_point_solid(c):
		return c
	for r in range(1, 8):
		for dx in range(-r, r + 1):
			for dy in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				var n := Vector2i(c.x + dx, c.y + dy)
				if n.x >= 0 and n.y >= 0 and n.x < size.x and n.y < size.y and not astar.is_point_solid(n):
					return n
	return c


## Path from `a` to `b` in world space (cell centres, the last point is `b` itself when reachable). Empty if none.
func path(a: Vector3, b: Vector3) -> PackedVector3Array:
	var ca := nearest_free(to_cell(a))
	var cb := nearest_free(to_cell(b))
	var ids := astar.get_id_path(ca, cb)
	var out := PackedVector3Array()
	for i in range(1, ids.size()):
		out.append(to_world(ids[i]))
	if not out.is_empty():
		out[out.size() - 1] = Vector3(b.x, 0.0, b.z) if walkable(b) else out[out.size() - 1]
	return out
