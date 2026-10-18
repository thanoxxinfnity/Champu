class_name Safehouse
extends Node3D
## The player's house: a two-storey modern villa you can walk through end to end. Garage on the left (a sliding door that
## opens for a person or a car), a glass-fronted entry hall with the stairs, an open living room and kitchen, and a bedroom
## upstairs with the bed and the wardrobe. Local frame: the front wall is at z = 0 and the house runs back along +Z; x is
## east. Place the node so that -Z faces the street.
##
## Everything is built from boxes with real openings (see Builder) plus generated furniture models; the stairs have a smooth
## ramp collider under visible steps, because a CharacterBody3D walks a ramp far more reliably than a staircase.

const FLOOR_Y := 0.16           # a few cm above the lawn (0.11) so the floor never fights the grass
const LAWN_Y := 0.11
const DRIVE_Y := 0.13
const H1 := 3.2                 # ground-floor clear height
const SLAB := 0.3
const UPPER_Y := FLOOR_Y + H1 + SLAB
const H2 := 3.0
const ROOF_Y := UPPER_Y + H2
const X0 := -12.0
const X1 := 12.0
const DEPTH := 18.0
const EXT := 0.3
const INT := 0.18
const DOOR_H := 2.15
const DOOR_W := 1.05
const STAIR_X0 := -2.9
const STAIR_X1 := -1.1
const STAIR_Z0 := 6.5
const STAIR_Z1 := 15.5

var bed_use: UseTrigger
var wardrobe_use: UseTrigger
var tv: ChomuTv
var garage_door: SlidingDoor
var front_doors: Array[InteractiveDoor] = []
var inner_doors: Array[InteractiveDoor] = []
var lights: Array[OmniLight3D] = []

var _white := Builder.mat(Color(0.9, 0.9, 0.87), 0.85)
var _warm := Builder.mat(Color(0.88, 0.84, 0.77), 0.9)
var _dark := Builder.mat(Color(0.11, 0.11, 0.12), 0.5, 0.3)
var _wood := Builder.mat(Color(0.62, 0.45, 0.3), 0.5)
var _concrete := Builder.mat(Color(0.42, 0.42, 0.43), 0.9)
var _ceiling := Builder.mat(Color(0.95, 0.95, 0.93), 0.95)
var _grass := Builder.mat(Color(0.2, 0.36, 0.17), 1.0)
var _counter := Builder.mat(Color(0.82, 0.82, 0.8), 0.35)


func build() -> void:
	_floors_and_roof()
	_ground_walls()
	_upper_walls()
	_stairs()
	_doors()
	_furniture()
	_lighting()
	_grounds()


# ── structure ─────────────────────────────────────────────────────────────────

func _floors_and_roof() -> void:
	Builder.slab(self, X0, 0.0, -3.0, DEPTH, FLOOR_Y, 0.2, _concrete)          # garage
	Builder.slab(self, -3.0, 0.0, X1, DEPTH, FLOOR_Y, 0.2, _wood)              # the rest, wood
	# Upper floor, with a hole where the stairs arrive.
	Builder.slab(self, -1.0, 0.0, X1, DEPTH, UPPER_Y, SLAB, _wood).name = "UpperFloor"
	Builder.slab(self, -3.0, 0.0, -1.0, STAIR_Z0, UPPER_Y, SLAB, _wood).name = "UpperFloorA"
	Builder.slab(self, -3.0, STAIR_Z1, -1.0, DEPTH, UPPER_Y, SLAB, _wood).name = "UpperFloorB"
	# The garage roof is a terrace at the same level, with a parapet.
	Builder.slab(self, X0, 0.0, -3.0, DEPTH, UPPER_Y, SLAB, _concrete)
	Builder.wall(self, true, 0.1, X0, -3.0, UPPER_Y, 1.0, 0.2, _white)
	Builder.wall(self, true, DEPTH - 0.1, X0, -3.0, UPPER_Y, 1.0, 0.2, _white)
	Builder.wall(self, false, X0 + 0.1, 0.0, DEPTH, UPPER_Y, 1.0, 0.2, _white)
	# Ceiling of the ground floor is the underside of the upper slab; the roof closes the top.
	var roof := Builder.slab(self, -3.0, 0.0, X1, DEPTH, ROOF_Y + SLAB, SLAB, _white)
	roof.name = "Roof"
	# Plain white ceilings under the floors above, so the wood and concrete are only ever seen from above.
	var ceil_y := FLOOR_Y + H1
	Builder.box(self, Vector3(-1.0 + (X1 + 1.0) * 0.5 - 0.0, ceil_y + 0.02, DEPTH * 0.5), Vector3(X1 + 1.0, 0.04, DEPTH), _ceiling, false, false).name = "CeilingA"
	Builder.box(self, Vector3(-2.0, ceil_y + 0.02, STAIR_Z0 * 0.5), Vector3(2.0, 0.04, STAIR_Z0), _ceiling, false, false).name = "CeilingB"
	Builder.box(self, Vector3(-2.0, ceil_y + 0.02, (STAIR_Z1 + DEPTH) * 0.5), Vector3(2.0, 0.04, DEPTH - STAIR_Z1), _ceiling, false, false).name = "CeilingC"
	Builder.box(self, Vector3((X0 - 3.0) * 0.5, ceil_y + 0.02, DEPTH * 0.5), Vector3(-3.0 - X0, 0.04, DEPTH), _ceiling, false, false).name = "CeilingGarage"


func _ground_walls() -> void:
	var y0 := FLOOR_Y
	# Front (z = 0): garage door opening, glazed front doors, a big living-room window.
	Builder.wall(self, true, 0.0, X0, X1, y0, H1, EXT, _white, [
		[2.0, 5.0, 0.0, 2.6],
		[10.9, 2.2, 0.0, 2.2],
		[16.5, 6.0, 0.5, 2.2, true],
	])
	# Back (z = DEPTH): windows to the garden.
	Builder.wall(self, true, DEPTH, X0, X1, y0, H1, EXT, _white, [
		[3.0, 3.0, 1.0, 1.2, true],
		[17.0, 2.6, 0.9, 1.6, true],
		[20.6, 2.6, 0.9, 1.6, true],
	])
	# West (garage side) and east.
	Builder.wall(self, false, X0, 0.0, DEPTH, y0, H1, EXT, _white, [[8.0, 2.0, 1.4, 1.0, true]])
	Builder.wall(self, false, X1, 0.0, DEPTH, y0, H1, EXT, _white, [
		[2.0, 6.0, 0.5, 2.2, true],
		[11.5, 4.0, 1.0, 1.3, true],
	])
	# Garage | hall: a door at z = 2..3.05. Hall | living: a wide arch from z = 1 to 11.
	Builder.wall(self, false, -3.0, 0.0, DEPTH, y0, H1, INT, _warm, [[2.0, DOOR_W, 0.0, DOOR_H]])
	Builder.wall(self, false, 3.0, 0.0, DEPTH, y0, H1, INT, _warm, [[1.0, 10.0, 0.0, 2.6]])


func _upper_walls() -> void:
	var y0 := UPPER_Y
	Builder.wall(self, true, 0.0, -3.0, X1, y0, H2, EXT, _white, [[8.0, 6.0, 0.9, 1.6, true]])
	Builder.wall(self, true, DEPTH, -3.0, X1, y0, H2, EXT, _white, [[8.0, 5.0, 0.9, 1.6, true]])
	Builder.wall(self, false, X1, 0.0, DEPTH, y0, H2, EXT, _white, [[6.0, 6.0, 0.9, 1.6, true]])
	# West wall faces the terrace: a glazed opening for the door out.
	Builder.wall(self, false, -3.0, 0.0, DEPTH, y0, H2, EXT, _white, [[8.0, 1.4, 0.0, 2.2]])
	# Corridor | bedroom, with a door at z = 8.5..9.55.
	Builder.wall(self, false, 3.0, 0.0, DEPTH, y0, H2, INT, _warm, [[8.5, DOOR_W, 0.0, DOOR_H]])
	# A railing along the stairwell so nobody walks off the top landing.
	Builder.wall(self, false, -1.0, STAIR_Z0, STAIR_Z1, y0, 1.0, 0.08, _dark)


func _stairs() -> void:
	var rise := UPPER_Y - FLOOR_Y
	var run := STAIR_Z1 - STAIR_Z0
	var steps := 18
	var step_run := run / steps
	var step_rise := rise / steps
	var width := STAIR_X1 - STAIR_X0
	var tread := Builder.mat(Color(0.5, 0.36, 0.24), 0.5)
	for i in range(steps):
		var h := (i + 1) * step_rise
		Builder.box(self, Vector3((STAIR_X0 + STAIR_X1) * 0.5, FLOOR_Y + h * 0.5, STAIR_Z0 + (i + 0.5) * step_run), Vector3(width, h, step_run), tread, false)
	# The collider: a smooth ramp just under the tread noses.
	var ramp := StaticBody3D.new()
	ramp.collision_layer = Data.L_WORLD
	ramp.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	var len := sqrt(run * run + rise * rise)
	bs.size = Vector3(width, 0.3, len)
	cs.shape = bs
	ramp.add_child(cs)
	var angle := atan2(rise, run)
	# The top face of the ramp runs exactly from the floor's level at the foot to the upper slab's level at the head, so a
	# person steps on and off it without a ledge.
	ramp.position = Vector3((STAIR_X0 + STAIR_X1) * 0.5, FLOOR_Y + rise * 0.5 - 0.15 * cos(angle), STAIR_Z0 + run * 0.5 + 0.15 * sin(angle))
	ramp.rotation.x = -angle
	add_child(ramp)


func _doors() -> void:
	garage_door = SlidingDoor.new()
	garage_door.width = 5.0
	garage_door.height = 2.6
	garage_door.position = Vector3(-7.5, FLOOR_Y, 0.0)
	garage_door.rotation.y = PI                      # its trigger zone must reach out to the street (-Z)
	add_child(garage_door)
	# Front doors: two glazed leaves, hinged at the sides of the opening.
	var left := _door(Vector3(-1.1, FLOOR_Y, 0.0), 0.0, 1.1, true)
	var right := _door(Vector3(1.1, FLOOR_Y, 0.0), PI, 1.1, true)
	front_doors.append(left)
	front_doors.append(right)
	inner_doors.append(_door(Vector3(-3.0, FLOOR_Y, 2.0), -PI * 0.5, DOOR_W, false))
	inner_doors.append(_door(Vector3(3.0, UPPER_Y, 8.5), -PI * 0.5, DOOR_W, false))


func _door(pos: Vector3, yaw: float, w: float, glazed: bool) -> InteractiveDoor:
	var d := InteractiveDoor.new()
	d.width = w
	d.height = 2.2 if glazed else DOOR_H
	d.glazed = glazed
	d.position = pos
	d.rotation.y = yaw
	add_child(d)
	return d


# ── furniture ─────────────────────────────────────────────────────────────────

func _model(path: String, size: float, pos: Vector3, yaw := 0.0, lay_flat := false, solid := true, centre_y = null, squash_y := 1.0) -> Node3D:
	var scene := load(path) as PackedScene
	if scene == null:
		return null
	var node := scene.instantiate() as Node3D
	add_child(node)
	ModelFit.place_by_largest(node, size, yaw, pos.y, lay_flat, centre_y)
	node.position += Vector3(pos.x, 0.0, pos.z)
	if squash_y != 1.0:
		# A generated rug comes out a few cm thick everywhere; press it flat and put it back on the floor.
		node.scale.y *= squash_y
		node.position.y += pos.y - ModelFit.aabb_of(node).position.y
	if solid:
		ModelFit.collider_for(node)
	return node


func _furniture() -> void:
	var f := "res://assets/furniture/"
	var y := FLOOR_Y
	# Living room: sofa facing the TV on the east wall.
	_model(f + "09_persian_rug.glb", 3.4, Vector3(8.2, y + 0.005, 5.0), 0.0, true, false, null, 0.12)
	_model(f + "01_grey_sofa.glb", 2.4, Vector3(5.2, y, 5.0), -90.0)
	_model(f + "02_coffee_table.glb", 1.2, Vector3(8.0, y, 5.0), 90.0)
	_model(f + "03_tv_console.glb", 1.8, Vector3(11.4, y, 5.0), 90.0)
	tv = ChomuTv.new()
	tv.position = Vector3(11.7, y + 1.55, 5.0)
	tv.rotation.y = -PI * 0.5
	add_child(tv)
	_model(f + "08_armchair.glb", 1.1, Vector3(8.0, y, 8.6), 180.0)
	_model(f + "07_bookshelf.glb", 2.1, Vector3(3.6, y, 10.2), 90.0)
	_model(f + "10_palm_plant.glb", 1.5, Vector3(11.0, y, 1.3), 0.0, false, false)
	_model(f + "15_floor_lamp.glb", 1.6, Vector3(3.8, y, 1.4), 0.0, false, false)
	_model(f + "17_landscape_painting.glb", 1.3, Vector3(7.5, y, 0.25), 0.0, false, false, y + 1.7)
	# Kitchen.
	_model(f + "05_fridge.glb", 1.9, Vector3(11.2, y, 17.1), 180.0)
	Builder.box(self, Vector3(7.5, y + 0.45, 17.5), Vector3(7.0, 0.9, 0.7), _counter)
	Builder.box(self, Vector3(7.5, y + 0.93, 17.5), Vector3(7.0, 0.06, 0.74), _dark, false)
	Builder.box(self, Vector3(7.5, y + 0.45, 13.4), Vector3(2.6, 0.9, 1.0), _counter)
	Builder.box(self, Vector3(7.5, y + 0.93, 13.4), Vector3(2.7, 0.06, 1.1), _dark, false)
	# Bedroom upstairs: the bed against the back wall, the wardrobe beside it.
	var u := UPPER_Y
	var bed := _model(Data.model_path("bed"), 2.3, Vector3(9.0, u, 15.8), 180.0)
	var wr := _model(Data.model_path("wardrobe"), 2.2, Vector3(4.2, u, 16.9), 0.0)
	bed_use = _use_point(Vector3(9.0, u + 0.6, 13.6), "E - Sleep")
	wardrobe_use = _use_point(Vector3(4.4, u + 1.0, 15.2), "E - Change Clothes")
	if bed == null:
		Builder.box(self, Vector3(9.0, u + 0.3, 15.8), Vector3(2.0, 0.6, 2.2), Builder.mat(Color(0.5, 0.5, 0.55)))
	if wr == null:
		Builder.box(self, Vector3(4.2, u + 1.1, 16.9), Vector3(1.6, 2.2, 0.7), _wood)


func _use_point(pos: Vector3, prompt: String) -> UseTrigger:
	var t := UseTrigger.new()
	t.prompt = prompt
	t.radius = 1.3
	t.position = pos
	add_child(t)
	return t


func _lighting() -> void:
	for spec in [
		[Vector3(7.5, FLOOR_Y + 2.9, 5.0), 1.4, 11.0],
		[Vector3(7.5, FLOOR_Y + 2.9, 14.0), 1.3, 9.0],
		[Vector3(0.0, FLOOR_Y + 2.9, 9.0), 1.1, 9.0],
		[Vector3(-7.5, FLOOR_Y + 2.9, 9.0), 1.3, 12.0],
		[Vector3(7.5, UPPER_Y + 2.7, 9.0), 1.3, 11.0],
		[Vector3(0.0, UPPER_Y + 2.7, 9.0), 1.0, 8.0],
	]:
		var l := OmniLight3D.new()
		l.position = spec[0]
		l.light_energy = spec[1]
		l.omni_range = spec[2]
		l.light_color = Color(1.0, 0.9, 0.75)
		l.shadow_enabled = false
		add_child(l)
		lights.append(l)


func _grounds() -> void:
	# Lawn, driveway and a low wall round the plot, with gaps for the car gate and a footpath.
	Builder.slab(self, -38.0, -12.0, 38.0, 64.0, LAWN_Y, 0.04, _grass)
	Builder.slab(self, -12.0, -12.0, -3.0, 0.0, DRIVE_Y, 0.04, _concrete)
	Builder.slab(self, -1.6, -12.0, 1.6, 0.0, DRIVE_Y, 0.04, Builder.mat(Color(0.65, 0.63, 0.6), 0.9))
	var wall_h := 1.3
	Builder.wall(self, true, -12.0, -38.0, 38.0, FLOOR_Y, wall_h, 0.3, _white, [[26.0, 9.0, 0.0, wall_h], [36.4, 3.2, 0.0, wall_h]])
	Builder.wall(self, true, 64.0, -38.0, 38.0, FLOOR_Y, wall_h, 0.3, _white)
	Builder.wall(self, false, -38.0, -12.0, 64.0, FLOOR_Y, wall_h, 0.3, _white)
	Builder.wall(self, false, 38.0, -12.0, 64.0, FLOOR_Y, wall_h, 0.3, _white)
	for pos in [Vector3(-14.0, 0, -8.0), Vector3(14.0, 0, -9.0), Vector3(20.0, 0, -6.0)]:
		_model(Data.model_path("palm_tree"), 7.5, Vector3(pos.x, FLOOR_Y, pos.z), randf() * 360.0, false, false)


## Where a car parked inside the garage sits, nose out toward the street.
func garage_transform() -> Transform3D:
	return Transform3D(Basis(Vector3.UP, PI), to_global(Vector3(-7.5, FLOOR_Y + 0.75, 10.0)))
