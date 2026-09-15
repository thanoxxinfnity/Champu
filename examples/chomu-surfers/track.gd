extends Node3D
## The endless track.
##
## Segments are recycled rather than spawned and freed: an endless runner that
## instantiates a new chunk every second builds up garbage until the frame rate
## falls off, and on a phone that happens within a minute.

const SEGMENT_LENGTH := 24.0
const SEGMENTS := 6
const LANE_X := [-2.2, 0.0, 2.2]

@export var obstacle_chance: float = 0.55
@export var coin_chance: float = 0.7

var _segments: Array[Node3D] = []
var _player: Node3D
var _rng := RandomNumberGenerator.new()
## Kept so a zone change can recolour the world without rebuilding it.
var _ground_materials: Array[StandardMaterial3D] = []
var _rail_materials: Array[StandardMaterial3D] = []
## Distance at which the next segment recycles, so difficulty can ramp.
var _spawned_to: float = 0.0


func _ready() -> void:
	_rng.randomize()
	_player = get_parent().get_node_or_null("Player")
	for i in SEGMENTS:
		var segment := _make_segment()
		segment.position.z = -SEGMENT_LENGTH * i
		add_child(segment)
		_segments.append(segment)
		# The first two are left clear, so the game does not kill you before you
		# have seen it.
		if i >= 2:
			_populate(segment, i)


func _process(_delta: float) -> void:
	if _player == null:
		return

	for segment in _segments:
		# One segment behind the player is far enough to recycle without the
		# swap being visible.
		if segment.position.z > _player.global_position.z + SEGMENT_LENGTH:
			segment.position.z -= SEGMENT_LENGTH * SEGMENTS
			_populate(segment, _segments.size())


func _make_segment() -> Node3D:
	var segment := Node3D.new()

	var floor_body := StaticBody3D.new()
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(9.0, 0.5, SEGMENT_LENGTH)
	mesh.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.22, 0.24, 0.29)
	# Tiled along the segment: one stretched copy over 24 metres is a smear,
	# and the repeat is what actually makes the ground read as a surface.
	material.uv1_scale = Vector3(2.0, SEGMENT_LENGTH / 6.0, 1.0)
	mesh.material_override = material
	_ground_materials.append(material)
	floor_body.add_child(mesh)

	var shape := CollisionShape3D.new()
	var box_shape := BoxShape3D.new()
	box_shape.size = box.size
	shape.shape = box_shape
	floor_body.add_child(shape)
	floor_body.position.y = -0.25
	segment.add_child(floor_body)

	# Rails, purely visual, so speed is readable. Without something passing the
	# camera the track looks static no matter how fast you are going.
	for x in [-3.6, 3.6]:
		var rail := MeshInstance3D.new()
		var rail_mesh := BoxMesh.new()
		rail_mesh.size = Vector3(0.3, 0.8, SEGMENT_LENGTH)
		rail.mesh = rail_mesh
		var rail_material := StandardMaterial3D.new()
		rail_material.albedo_color = Color(0.91, 0.45, 0.16)
		rail_material.uv1_scale = Vector3(1.0, SEGMENT_LENGTH / 4.0, 1.0)
		_rail_materials.append(rail_material)
		rail.material_override = rail_material
		rail.position = Vector3(x, 0.15, 0.0)
		segment.add_child(rail)

	var holder := Node3D.new()
	holder.name = "Contents"
	segment.add_child(holder)
	return segment


func _populate(segment: Node3D, _index: int) -> void:
	var holder: Node3D = segment.get_node("Contents")
	for child in holder.get_children():
		child.queue_free()

	# Obstacles first, one slot at a time, and never all three lanes at once:
	# a wall across the track is not a challenge, it is a dead end, and the
	# player cannot tell that from a bug.
	var blocked_at := {}
	for slot in 3:
		if _rng.randf() >= obstacle_chance:
			continue
		var z: float = -SEGMENT_LENGTH * 0.5 + slot * (SEGMENT_LENGTH / 3.0)
		var lanes: Array = [0, 1, 2]
		lanes.shuffle()
		# At most two of the three, so one lane is always open.
		var count: int = 1 if _rng.randf() < 0.7 else 2
		var here: Array[int] = []
		for i in count:
			var lane: int = lanes[i]
			holder.add_child(_make_obstacle(lane, z))
			here.append(lane)
		blocked_at[slot] = here

	# Coins go down in a line, not scattered one at a time. Scattered coins in a
	# random lane are almost never in the lane you are in — five test runs
	# collected one coin between them — and a coin you cannot see coming is not
	# a reward, it is an accident. A line is visible from a distance and gives
	# you a reason to pick a lane.
	if _rng.randf() >= coin_chance:
		return

	var free_lanes: Array = [0, 1, 2]
	free_lanes.shuffle()
	var trail_lane: int = free_lanes[0]
	var spacing := 1.6
	var length: int = _rng.randi_range(5, 9)
	var start := -SEGMENT_LENGTH * 0.5 + _rng.randf() * (SEGMENT_LENGTH - length * spacing)

	for i in length:
		var z: float = start + i * spacing
		# Skip the few that would sit inside an obstacle rather than dropping
		# the whole trail: a broken line still reads as a line.
		if _occupied(blocked_at, trail_lane, z):
			continue
		holder.add_child(_make_coin(trail_lane, z))


## Whether an obstacle already stands at this lane and depth.
func _occupied(blocked_at: Dictionary, lane: int, z: float) -> bool:
	for slot in blocked_at:
		var slot_z: float = -SEGMENT_LENGTH * 0.5 + int(slot) * (SEGMENT_LENGTH / 3.0)
		if absf(slot_z - z) < 1.6 and lane in blocked_at[slot]:
			return true
	return false


func _make_obstacle(lane: int, z: float) -> Area3D:
	var area := Area3D.new()
	# The player's hitbox does the detecting, so these carry the layer it
	# masks against and monitor nothing themselves.
	area.collision_layer = 2
	area.collision_mask = 0
	area.monitoring = false

	# Half of them are low, so rolling under is a real move rather than a
	# button that never matters.
	var low := _rng.randf() < 0.45
	var size := Vector3(1.8, 1.1, 1.4) if low else Vector3(1.8, 2.4, 1.4)

	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.9, 0.85, 0.85) if low else Color(0.85, 0.87, 0.92)
	var skin: Texture2D = _texture("barrier" if low else "obstacle")
	if skin != null:
		material.albedo_texture = skin
	else:
		# No texture generated: fall back to the colours that always read.
		material.albedo_color = Color(0.78, 0.22, 0.24) if low else Color(0.32, 0.36, 0.45)
	mesh.material_override = material
	area.add_child(mesh)

	var shape := CollisionShape3D.new()
	var box_shape := BoxShape3D.new()
	box_shape.size = size
	shape.shape = box_shape
	area.add_child(shape)

	area.position = Vector3(LANE_X[lane], size.y * 0.5, z)
	area.set_meta("kind", "obstacle")
	area.add_to_group("hazard")
	return area


func _make_coin(lane: int, z: float) -> Area3D:
	var area := Area3D.new()
	# The player's hitbox does the detecting, so these carry the layer it
	# masks against and monitor nothing themselves.
	area.collision_layer = 2
	area.collision_mask = 0
	area.monitoring = false

	var mesh := MeshInstance3D.new()
	var cylinder := CylinderMesh.new()
	cylinder.top_radius = 0.35
	cylinder.bottom_radius = 0.35
	cylinder.height = 0.1
	mesh.mesh = cylinder
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(1.0, 0.78, 0.18)
	material.emission_enabled = true
	material.emission = Color(0.9, 0.6, 0.1)
	var skin: Texture2D = _texture("coin")
	if skin != null:
		material.albedo_texture = skin
		material.albedo_color = Color(1, 1, 1)
	mesh.material_override = material
	mesh.rotation = Vector3(PI / 2.0, 0.0, 0.0)
	area.add_child(mesh)

	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.5
	shape.shape = sphere
	area.add_child(shape)

	area.position = Vector3(LANE_X[lane], 1.0, z)
	area.set_meta("kind", "coin")
	area.add_to_group("coin")
	return area


## A generated texture, or null if this build has none.
##
## Cached, because a coin is created three times a segment and loading the same
## image from disk each time is a stutter you can feel.
var _texture_cache := {}

func _texture(name: String) -> Texture2D:
	if _texture_cache.has(name):
		return _texture_cache[name]
	var tex: Texture2D = load("res://textures/%s.jpg" % name) as Texture2D
	_texture_cache[name] = tex
	return tex


## Recolours and re-skins the whole track for a zone change.
##
## The materials are edited in place rather than the segments rebuilt: a runner
## cannot pause to reload geometry, and swapping a mesh under the player is
## visible as a stutter at exactly the moment they are being told they did well.
func repaint(ground: Color, rail: Color, zone: int) -> void:
	# With a texture the colour becomes a tint, so it is lightened — multiplying
	# a photo by a dark colour just makes mud.
	var ground_tex: Texture2D = _texture("road_%d" % zone)
	var rail_tex: Texture2D = _texture("rail_%d" % zone)

	# With a texture the colour is a *tint*, so it is mixed down from white
	# rather than lightened. lightened() on an already-pale texture — snow, ice —
	# pushes it past white and the whole stage renders as a blank sheet, which is
	# exactly what Frost Line did.
	for m in _ground_materials:
		m.albedo_texture = ground_tex
		m.albedo_color = Color.WHITE.lerp(ground, 0.4) if ground_tex != null else ground
	for m in _rail_materials:
		m.albedo_texture = rail_tex
		m.albedo_color = Color.WHITE.lerp(rail, 0.55) if rail_tex != null else rail
