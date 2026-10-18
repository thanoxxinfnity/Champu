class_name Minimap
extends Control
## A round GTA-style radar: the street grid around the player, turning with the camera, with the objective, police and the
## player's own car as dots. Drawn in code from City's constants, so there is no texture to keep in sync.

const RANGE_M := 130.0          # metres from the centre to the edge
const SIZE := 190.0

var player: Node3D
var heading := 0.0              # the camera's yaw: the map turns so "up" is where the player looks
var objective := Vector3.INF
var island: Island              # set on the island map: the radar shows the coast and the landmarks instead of streets


func _ready() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	clip_contents = true


func _process(_d: float) -> void:
	queue_redraw()


func _to_map(p: Vector3, c: Vector3) -> Vector2:
	var k := SIZE * 0.5 / RANGE_M
	var d := Vector2(p.x - c.x, p.z - c.z)
	# Camera yaw 0 looks down -Z; rotate so the look direction points up the screen.
	return Vector2(SIZE * 0.5, SIZE * 0.5) + d.rotated(heading) * k


func _draw() -> void:
	var half := SIZE * 0.5
	draw_circle(Vector2(half, half), half, Color(0.08, 0.1, 0.13, 0.92))
	if player == null:
		return
	var c := player.global_position
	var k := SIZE * 0.5 / RANGE_M
	if island != null:
		_draw_island(c, k)
	# Roads.
	for line in City.ROAD_LINES if island == null else []:
		var a := _to_map(Vector3(line, 0, c.z - 400), c)
		var b := _to_map(Vector3(line, 0, c.z + 400), c)
		draw_line(a, b, Color(0.32, 0.34, 0.38), City.ROAD_W * k)
		a = _to_map(Vector3(c.x - 400, 0, line), c)
		b = _to_map(Vector3(c.x + 400, 0, line), c)
		draw_line(a, b, Color(0.32, 0.34, 0.38), City.ROAD_W * k)
	# Landmarks.
	if island == null:
		var tower := _to_map(City.block_center(City.TOWER_PLOT), c)
		draw_rect(Rect2(tower - Vector2(5, 5), Vector2(10, 10)), Color(0.45, 0.65, 1.0))
		var home := _to_map(Vector3(Vector3(City.block_center(City.SAFEHOUSE_PLOT)).x, 0, City.block_center(City.SAFEHOUSE_PLOT).z), c)
		draw_circle(home, 4.5, Color(0.5, 1.0, 0.55))
	# Police and other things that asked to be on the radar.
	for n in get_tree().get_nodes_in_group("police"):
		var pn := n as Node3D
		if pn != null:
			draw_circle(_to_map(pn.global_position, c), 3.2, Color(1.0, 0.25, 0.25) if int(Time.get_ticks_msec() / 250) % 2 == 0 else Color(0.3, 0.45, 1.0))
	if objective != Vector3.INF:
		var o := _to_map(objective, c)
		var edge := o - Vector2(half, half)
		if edge.length() > half - 8.0:
			o = Vector2(half, half) + edge.normalized() * (half - 8.0)
		draw_circle(o, 6.0, Color(1.0, 0.85, 0.2))
		draw_arc(o, 8.5, 0, TAU, 20, Color(0, 0, 0, 0.7), 1.5)
	# The player: always the middle, pointing up.
	var pts := PackedVector2Array([Vector2(half, half - 8), Vector2(half - 6, half + 6), Vector2(half + 6, half + 6)])
	draw_colored_polygon(pts, Color.WHITE)
	draw_arc(Vector2(half, half), half - 1.0, 0, TAU, 48, Color(1.0, 0.54, 0.24, 0.9), 2.5)


## Land in green, sea in blue (sampled coarsely round the player), and a dot per settlement.
func _draw_island(c: Vector3, k: float) -> void:
	var cell := 10.0
	var steps := int(RANGE_M / cell)
	for ix in range(-steps, steps + 1):
		for iz in range(-steps, steps + 1):
			var wx := c.x + ix * cell * 2.0
			var wz := c.z + iz * cell * 2.0
			var h := island.height_at(wx, wz)
			var col := Color(0.15, 0.35, 0.55) if h < -0.5 else (Color(0.8, 0.75, 0.55) if h < 2.5 else Color(0.2, 0.42, 0.22).lerp(Color(0.5, 0.5, 0.48), clampf(h / 160.0, 0.0, 1.0)))
			var p := _to_map(Vector3(wx, 0, wz), c)
			draw_rect(Rect2(p - Vector2(cell * 2.0 * k * 0.5, cell * 2.0 * k * 0.5), Vector2(cell * 2.0 * k, cell * 2.0 * k)), col)
	for s in Island.SITES:
		draw_circle(_to_map(Vector3(s.pos.x, 0, s.pos.y), c), 4.0, Color(1.0, 0.9, 0.5))
