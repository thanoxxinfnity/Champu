class_name City
extends Node3D
## The downtown grid: 3 x 3 blocks cut by four roads each way, a ring of tall towers behind it for the skyline.
## Everything here is generated from a seed, so the same seed always makes the same city (the tests rely on it).
##
## Layout (metres): block centres at -100 / 0 / 100 on both axes, each 84 m square; road centre lines at -150 / -50 / 50 / 150,
## each 16 m wide. Two blocks are held back as plots for the hand-built places — the player's safehouse and the tower.

const PITCH := 100.0
const BLOCK := 84.0
const ROAD_W := 16.0
const SIDEWALK := 4.0
const CURB := 0.1
const ROAD_LINES: Array[float] = [-150.0, -50.0, 50.0, 150.0]
const BLOCK_CENTERS: Array[float] = [-100.0, 0.0, 100.0]
const LANE_CENTERS: Array[float] = [2.0, 5.5]   # distance from the road's centre line to the middle of each lane (inner, outer)
const LANE_DIVIDER := 3.75                       # the dashed line between a direction's two lanes

const SAFEHOUSE_PLOT := Vector2i(-1, 1)   # block index (x, z): south-west
const TOWER_PLOT := Vector2i(1, -1)       # north-east

var rng := RandomNumberGenerator.new()
var atmosphere: Atmosphere
var building_shader: Shader
var road_mat: StandardMaterial3D
var intersections := {}             # Vector2i(ix, iz) -> Vector3 centre
var buildings: Array[Dictionary] = []   # {pos, size, height} of every generated tower, for tests and the minimap
var lamp_posts: Array[Vector3] = []


func build(seed_value: int, atmos: Atmosphere = null) -> void:
	rng.seed = seed_value
	atmosphere = atmos
	building_shader = load("res://shaders/building.gdshader")
	_ground()
	_blocks()
	_markings()
	_skyline()
	_lamps()
	for ix in range(ROAD_LINES.size()):
		for iz in range(ROAD_LINES.size()):
			intersections[Vector2i(ix, iz)] = Vector3(ROAD_LINES[ix], 0, ROAD_LINES[iz])


## The centre of a block given its (x, z) index in -1..1.
static func block_center(idx: Vector2i) -> Vector3:
	return Vector3(idx.x * PITCH, 0, idx.y * PITCH)


## The sidewalk-level rectangle (x, z) a hand-built place may use, inside the pavement.
static func plot_rect(idx: Vector2i) -> Rect2:
	var c := block_center(idx)
	var h := BLOCK * 0.5 - SIDEWALK
	return Rect2(c.x - h, c.z - h, h * 2.0, h * 2.0)


func _mat(color: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	return m


func _box(parent: Node, pos: Vector3, size: Vector3, mat: Material, collide := true, layer := Data.L_WORLD) -> Node3D:
	var holder: Node3D
	if collide:
		var sb := StaticBody3D.new()
		sb.collision_layer = layer
		sb.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		sb.add_child(cs)
		holder = sb
	else:
		holder = Node3D.new()
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	holder.add_child(mi)
	holder.position = pos
	parent.add_child(holder)
	return holder


func _ground() -> void:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = 0.05
	var tex := NoiseTexture2D.new()
	tex.noise = noise
	tex.width = 256
	tex.height = 256
	tex.seamless = true
	road_mat = _mat(Color(0.13, 0.13, 0.15), 0.92)
	road_mat.albedo_texture = tex
	road_mat.uv1_triplanar = true
	road_mat.uv1_scale = Vector3(0.08, 0.08, 0.08)
	road_mat.metallic_specular = 0.4
	if atmosphere != null:
		atmosphere.register_wet_material(road_mat)
	# One big slab is the road; sidewalks and lots sit on top of it.
	var ground := _box(self, Vector3(0, -0.5, 0), Vector3(900, 1, 900), road_mat)
	ground.name = "Ground"


func _blocks() -> void:
	var walk_mat := _mat(Color(0.52, 0.51, 0.49), 0.88)
	var pal := [Color(0.62, 0.6, 0.56), Color(0.55, 0.52, 0.5), Color(0.7, 0.66, 0.6), Color(0.46, 0.5, 0.55), Color(0.6, 0.45, 0.4), Color(0.4, 0.42, 0.45)]
	for bx in range(-1, 2):
		for bz in range(-1, 2):
			var idx := Vector2i(bx, bz)
			var c := block_center(idx)
			var slab := _box(self, Vector3(c.x, CURB * 0.5, c.z), Vector3(BLOCK, CURB, BLOCK), walk_mat)
			slab.name = "Block_%d_%d" % [bx, bz]
			if idx == SAFEHOUSE_PLOT or idx == TOWER_PLOT:
				continue
			var dist := maxf(absf(bx), absf(bz))
			var core := dist == 0.0
			var inner := Rect2(c.x - BLOCK * 0.5 + SIDEWALK, c.z - BLOCK * 0.5 + SIDEWALK, BLOCK - SIDEWALK * 2.0, BLOCK - SIDEWALK * 2.0)
			# A 2 x 2 grid of lots with a gap between, each given one building.
			var gap := 3.0
			var lot := (inner.size.x - gap) * 0.5
			for lx in range(2):
				for lz in range(2):
					var origin := Vector2(inner.position.x + lx * (lot + gap), inner.position.y + lz * (lot + gap))
					var margin := rng.randf_range(0.0, 3.0)
					var size_x := lot - margin
					var size_z := lot - margin * rng.randf_range(0.5, 1.5)
					var height := rng.randf_range(46.0, 92.0) if core else rng.randf_range(16.0, 44.0)
					var pos := Vector3(origin.x + lot * 0.5, 0, origin.y + lot * 0.5)
					_tower(pos, Vector2(size_x, size_z), height, pal[rng.randi() % pal.size()], core)


## A podium, a shaft and sometimes a crown: three boxes make a silhouette; one shared shader makes the facade.
func _tower(pos: Vector3, footprint: Vector2, height: float, tint: Color, tall: bool) -> void:
	var mat := _facade_mat(tint)
	var podium_h := minf(9.0, height * 0.3)
	_part(pos, Vector3(footprint.x, podium_h, footprint.y), mat)
	var shaft := Vector2(footprint.x * rng.randf_range(0.7, 0.9), footprint.y * rng.randf_range(0.7, 0.9))
	var shaft_h := height - podium_h
	_part(pos + Vector3(0, podium_h, 0), Vector3(shaft.x, shaft_h, shaft.y), mat)
	if tall and rng.randf() < 0.6:
		var crown := Vector2(shaft.x * 0.55, shaft.y * 0.55)
		_part(pos + Vector3(0, height, 0), Vector3(crown.x, 8.0, crown.y), mat)
	buildings.append({"pos": pos, "size": Vector3(footprint.x, height, footprint.y)})


func _part(base: Vector3, size: Vector3, mat: Material) -> void:
	_box(self, base + Vector3(0, size.y * 0.5, 0), size, mat)


func _facade_mat(tint: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = building_shader
	m.set_shader_parameter("wall_color", tint)
	m.set_shader_parameter("glass_color", Color(0.1, 0.17, 0.25).lerp(tint, rng.randf_range(0.0, 0.18)))
	m.set_shader_parameter("bay", Vector2(rng.randf_range(2.8, 4.2), rng.randf_range(3.2, 4.0)))
	m.set_shader_parameter("seed", rng.randf() * 50.0)
	m.set_shader_parameter("lit_chance", rng.randf_range(0.3, 0.7))
	return m


## Distant towers around the grid so the skyline has depth. No collision: the player cannot reach them.
func _skyline() -> void:
	var ring := 16
	for i in range(ring):
		var a := TAU * float(i) / ring + rng.randf_range(-0.1, 0.1)
		var r := rng.randf_range(260.0, 340.0)
		var size := Vector3(rng.randf_range(22.0, 40.0), rng.randf_range(60.0, 150.0), rng.randf_range(22.0, 40.0))
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = _facade_mat(Color(0.5, 0.52, 0.56))
		mi.position = Vector3(cos(a) * r, size.y * 0.5, sin(a) * r)
		add_child(mi)


func _markings() -> void:
	var white := _mat(Color(0.92, 0.92, 0.9), 0.7)
	var yellow := _mat(Color(0.95, 0.75, 0.15), 0.7)
	var dashes: Array[Transform3D] = []
	var doubles: Array[Transform3D] = []
	var stripes: Array[Transform3D] = []
	var y := 0.015
	# Dashed white lane divider on each side of the centre, double yellow in the middle, both ways.
	for line in ROAD_LINES:
		for t in range(-150, 151, 7):
			if _in_intersection(float(t)):
				continue
			for off in [-LANE_DIVIDER, LANE_DIVIDER]:
				dashes.append(Transform3D(Basis(), Vector3(t, y, line + off)))
				dashes.append(Transform3D(Basis.from_euler(Vector3(0, PI * 0.5, 0)), Vector3(line + off, y, t)))
		for t in range(-150, 151, 4):
			if _in_intersection(float(t)):
				continue
			doubles.append(Transform3D(Basis(), Vector3(t, y, line - 0.25)))
			doubles.append(Transform3D(Basis(), Vector3(t, y, line + 0.25)))
			doubles.append(Transform3D(Basis.from_euler(Vector3(0, PI * 0.5, 0)), Vector3(line - 0.25, y, t)))
			doubles.append(Transform3D(Basis.from_euler(Vector3(0, PI * 0.5, 0)), Vector3(line + 0.25, y, t)))
	# Zebra crossings on the four arms of every intersection.
	for ix in ROAD_LINES:
		for iz in ROAD_LINES:
			for s in range(-6, 7):
				var o := s * 1.1
				stripes.append(Transform3D(Basis(), Vector3(ix + o, y, iz - (ROAD_W * 0.5 + 2.2))))
				stripes.append(Transform3D(Basis(), Vector3(ix + o, y, iz + (ROAD_W * 0.5 + 2.2))))
				stripes.append(Transform3D(Basis.from_euler(Vector3(0, PI * 0.5, 0)), Vector3(ix - (ROAD_W * 0.5 + 2.2), y, iz + o)))
				stripes.append(Transform3D(Basis.from_euler(Vector3(0, PI * 0.5, 0)), Vector3(ix + (ROAD_W * 0.5 + 2.2), y, iz + o)))
	_multi(dashes, Vector2(2.4, 0.16), white, "LaneDashes")
	_multi(doubles, Vector2(3.9, 0.12), yellow, "CentreLines")
	_multi(stripes, Vector2(2.6, 0.55), white, "Crosswalks")


func _in_intersection(t: float) -> bool:
	for line in ROAD_LINES:
		if absf(t - line) < ROAD_W * 0.5 + 3.0:
			return true
	return false


func _multi(xforms: Array[Transform3D], size: Vector2, mat: Material, node_name: String) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var quad := QuadMesh.new()
	quad.size = size
	quad.orientation = PlaneMesh.FACE_Y
	mm.mesh = quad
	mm.instance_count = xforms.size()
	for i in range(xforms.size()):
		mm.set_instance_transform(i, xforms[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.name = node_name
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)


## Lamp posts along every sidewalk edge, one every 30 m. Only the posts exist here; a small pool of real lights follows
## the player (see LampPool), because a light per post across the whole city would cost far more than it is worth.
func _lamps() -> void:
	var pole_mat := _mat(Color(0.18, 0.19, 0.2), 0.5)
	for line in ROAD_LINES:
		for t in range(-140, 141, 30):
			for side in [-1.0, 1.0]:
				var off: float = (ROAD_W * 0.5 + 1.0) * side
				if _in_intersection(float(t)):
					continue
				_lamp(Vector3(t, 0, line + off), pole_mat, side)
				_lamp(Vector3(line + off, 0, t), pole_mat, side)


func _lamp(pos: Vector3, pole_mat: Material, side: float) -> void:
	var post := Streetlight.new()
	post.position = pos
	post.rotation.y = 0.0 if side > 0.0 else PI
	add_child(post)
	post.setup(pole_mat)
	lamp_posts.append(pos + Vector3(0, 7.2, 0))
