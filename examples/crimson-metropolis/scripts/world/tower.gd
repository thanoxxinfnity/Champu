class_name Tower
extends Node3D
## The skyscraper the story climbs. A hand-built two-storey marble lobby you walk into from the street, a lift shaft behind the
## reception desk running the full height, and three more places the lift stops: the 15th-floor executive office, the 29th-floor
## penthouse and the rooftop helipad. The glass-and-steel facade above the lobby is a generated model; it is solid, so from
## outside you see it and from inside you see through it (its back faces are culled) — which is what makes the offices' windows.
##
## Local frame: the street is at +Z (the entrance); the lift is at the back (-Z). The origin is the middle of the plot at ground level.

const FLOOR_Y := 0.16
const LOBBY_H := 6.8
const FLOOR_H := 3.4
const TOP_H := 95.2                 # the facade, from the top of the lobby to the roof
const ROOF_Y := LOBBY_H + TOP_H     # underside of the roof slab = 102.0
const HALF := 20.0                  # the lobby is 40 m square
const ELEV_Z := -14.6
const ROOM_X := 14.0                # the upper rooms are 28 m wide
const ROOM_Z0 := -17.8
const ROOM_Z1 := 16.0

var elevator: ElevatorSystem
var entrance: SlidingDoor
var boss_spot: Node3D              # where the penthouse's host stands (mission 1)
var briefcase_spot: Node3D         # where the briefcase sits on the executive desk (mission 3)
var heli_pad: Node3D               # the middle of the helipad

var _stone := Builder.mat(Color(0.78, 0.77, 0.74), 0.35, 0.1)
var _dark := Builder.mat(Color(0.12, 0.12, 0.14), 0.45, 0.4)
var _marble := Builder.mat(Color(0.86, 0.85, 0.82), 0.18, 0.1)
var _ceiling := Builder.mat(Color(0.95, 0.95, 0.93), 0.95)
var _wood := Builder.mat(Color(0.3, 0.2, 0.13), 0.4)
var _carpet := Builder.mat(Color(0.28, 0.3, 0.36), 1.0)
var _concrete := Builder.mat(Color(0.42, 0.42, 0.44), 0.9)


## Heights of the lift's stops, in this node's space.
static func stop_ys() -> Array[float]:
	return [FLOOR_Y, LOBBY_H + 12.0 * FLOOR_H + FLOOR_Y, LOBBY_H + 26.0 * FLOOR_H + FLOOR_Y, ROOF_Y + FLOOR_Y]


func build() -> void:
	_plaza()
	_lobby()
	_shaft_and_lift()
	_executive_floor()
	_penthouse()
	_roof()
	_facade()


func _plaza() -> void:
	Builder.slab(self, -38.0, -38.0, 38.0, 38.0, FLOOR_Y - 0.04, 0.05, Builder.mat(Color(0.7, 0.69, 0.66), 0.8))


# ── the lobby ─────────────────────────────────────────────────────────────────

func _lobby() -> void:
	Builder.slab(self, -HALF, -HALF, HALF, HALF, FLOOR_Y, 0.2, _marble)
	Builder.slab(self, -HALF, -HALF, HALF, HALF, LOBBY_H, 0.3, _ceiling)
	var h := LOBBY_H - FLOOR_Y
	# Front: two big windows and the entrance between them.
	Builder.wall(self, true, HALF, -HALF, HALF, FLOOR_Y, h, 0.4, _stone, [
		[2.0, 13.0, 0.4, 4.6, true],
		[17.0, 6.0, 0.0, 3.4],
		[26.0, 12.0, 0.4, 4.6, true],
	])
	Builder.wall(self, false, -HALF, -HALF, HALF, FLOOR_Y, h, 0.4, _stone, [[3.0, 14.0, 0.4, 4.6, true], [23.0, 14.0, 0.4, 4.6, true]])
	Builder.wall(self, false, HALF, -HALF, HALF, FLOOR_Y, h, 0.4, _stone, [[3.0, 14.0, 0.4, 4.6, true], [23.0, 14.0, 0.4, 4.6, true]])
	Builder.wall(self, true, -HALF, -HALF, HALF, FLOOR_Y, h, 0.4, _stone)
	entrance = SlidingDoor.new()
	entrance.width = 6.0
	entrance.height = 3.4
	entrance.two_leaves = true
	entrance.paint = Color(0.55, 0.72, 0.85)
	entrance.metallic = 0.5
	entrance.trigger_size = Vector3(10.0, 3.0, 12.0)
	entrance.position = Vector3(0, FLOOR_Y, HALF)
	add_child(entrance)

	# Reception desk, lounge, plants and the name on the wall.
	Builder.box(self, Vector3(-9.0, FLOOR_Y + 0.55, -4.0), Vector3(6.5, 1.1, 1.3), _dark)
	Builder.box(self, Vector3(-9.0, FLOOR_Y + 1.12, -4.0), Vector3(6.7, 0.06, 1.5), _stone, false)
	var f := "res://assets/furniture/"
	_place(f + "01_grey_sofa.glb", 2.6, Vector3(8.0, FLOOR_Y, 2.0), 180.0)
	_place(f + "01_grey_sofa.glb", 2.6, Vector3(8.0, FLOOR_Y, 9.0), 0.0)
	_place(f + "02_coffee_table.glb", 1.3, Vector3(8.0, FLOOR_Y, 5.5), 90.0)
	_place(f + "10_palm_plant.glb", 2.2, Vector3(-15.0, FLOOR_Y, 14.0), 0.0, false)
	_place(f + "10_palm_plant.glb", 2.2, Vector3(15.0, FLOOR_Y, 15.0), 0.0, false)
	var sign := Label3D.new()
	sign.text = "CRIMSON TOWER"
	sign.font_size = 160
	sign.pixel_size = 0.01
	sign.modulate = Color(1.0, 0.62, 0.3)
	sign.position = Vector3(0, 5.2, -HALF + 0.3)
	add_child(sign)
	for pos in [Vector3(-10, LOBBY_H - 0.3, -8), Vector3(10, LOBBY_H - 0.3, -8), Vector3(-10, LOBBY_H - 0.3, 8), Vector3(10, LOBBY_H - 0.3, 8), Vector3(0, LOBBY_H - 0.3, 0)]:
		_light(pos, 1.3, 16.0)


# ── the shaft and the lift ────────────────────────────────────────────────────

func _shaft_and_lift() -> void:
	var stops: Array[Dictionary] = [
		{"label": "G", "name": "Ground Lobby", "y": stop_ys()[0]},
		{"label": "15", "name": "Executive Floor", "y": stop_ys()[1]},
		{"label": "29", "name": "Luxury Penthouse", "y": stop_ys()[2]},
		{"label": "R", "name": "Rooftop Helipad", "y": stop_ys()[3]},
	]
	elevator = ElevatorSystem.new()
	elevator.name = "Elevator"
	elevator.setup(stops)
	elevator.position = Vector3(0, 0, ELEV_Z)
	add_child(elevator)
	# Shaft walls, the full height. The front wall is cut at each stop for the lift doors.
	var top := ROOF_Y + 3.0
	var hw := ElevatorSystem.CAB_W * 0.5 + 0.2
	var z_front := ELEV_Z + ElevatorSystem.CAB_D * 0.5 + 0.1
	var z_back := ELEV_Z - ElevatorSystem.CAB_D * 0.5 - 0.25
	Builder.box(self, Vector3(-hw - 0.15, top * 0.5, (z_front + z_back) * 0.5), Vector3(0.3, top, z_front - z_back + 0.3), _dark)
	Builder.box(self, Vector3(hw + 0.15, top * 0.5, (z_front + z_back) * 0.5), Vector3(0.3, top, z_front - z_back + 0.3), _dark)
	Builder.box(self, Vector3(0, top * 0.5, z_back - 0.15), Vector3(hw * 2.0 + 0.6, top, 0.3), _dark)
	# The front wall: a column either side of the doors, and solid pieces between the stops. (Builder.wall cannot do this: its openings
	# are side by side, not stacked.)
	var half_open := ElevatorSystem.CAB_W * 0.5
	var col_w := hw + 0.3 - half_open
	for sx in [-1.0, 1.0]:
		Builder.box(self, Vector3(sx * (half_open + col_w * 0.5), top * 0.5, z_front), Vector3(col_w, top, 0.3), _dark)
	var ys := stop_ys()
	var spans: Array = [[-0.2, ys[0]]]
	for i in range(ys.size() - 1):
		spans.append([ys[i] + ElevatorSystem.CAB_H, ys[i + 1]])
	spans.append([ys[ys.size() - 1] + ElevatorSystem.CAB_H, top])
	for sp in spans:
		var span_h: float = sp[1] - sp[0]
		if span_h > 0.01:
			Builder.box(self, Vector3(0, sp[0] + span_h * 0.5, z_front), Vector3(ElevatorSystem.CAB_W, span_h, 0.3), _dark)
	# Floor of the shaft pit.
	Builder.slab(self, -hw, z_back, hw, z_front, -0.2, 0.3, _concrete)


# ── the upper rooms ───────────────────────────────────────────────────────────

## A slab over x0..x1 / z0..z1 that leaves the lift shaft's footprint clear, so the cabin can pass through every floor and ceiling.
func _slab_clear(x0: float, z0: float, x1: float, z1: float, top_y: float, thick: float, mat: Material) -> void:
	var hw := ElevatorSystem.CAB_W * 0.5 + 0.5
	var zf := ELEV_Z + ElevatorSystem.CAB_D * 0.5 + 0.35
	var zb := ELEV_Z - ElevatorSystem.CAB_D * 0.5 - 0.5
	Builder.slab(self, x0, z0, -hw, z1, top_y, thick, mat)
	Builder.slab(self, hw, z0, x1, z1, top_y, thick, mat)
	Builder.slab(self, -hw, zf, hw, z1, top_y, thick, mat)
	Builder.slab(self, -hw, z0, hw, zb, top_y, thick, mat)


## A floor with the lift shaft left clear, a ceiling, and glass round the sides.
func _room(y: float, height: float, floor_mat: Material) -> void:
	_slab_clear(-ROOM_X, ROOM_Z0, ROOM_X, ROOM_Z1, y, 0.3, floor_mat)
	_slab_clear(-ROOM_X, ROOM_Z0, ROOM_X, ROOM_Z1, y + height + 0.3, 0.3, _ceiling)
	# Glass on three sides (the street side, and left and right), a solid wall behind the lift.
	var glass_h := height
	Builder.box(self, Vector3(0, y + glass_h * 0.5, ROOM_Z1), Vector3(ROOM_X * 2.0, glass_h, 0.06), Builder.glass(), true, false)
	Builder.box(self, Vector3(-ROOM_X, y + glass_h * 0.5, (ROOM_Z0 + ROOM_Z1) * 0.5), Vector3(0.06, glass_h, ROOM_Z1 - ROOM_Z0), Builder.glass(), true, false)
	Builder.box(self, Vector3(ROOM_X, y + glass_h * 0.5, (ROOM_Z0 + ROOM_Z1) * 0.5), Vector3(0.06, glass_h, ROOM_Z1 - ROOM_Z0), Builder.glass(), true, false)
	Builder.box(self, Vector3(0, y + glass_h * 0.5, ROOM_Z0), Vector3(ROOM_X * 2.0, glass_h, 0.3), _dark)
	for lx in [-8.0, 0.0, 8.0]:
		_light(Vector3(lx, y + height - 0.2, 2.0), 1.1, 14.0)


func _executive_floor() -> void:
	var y := stop_ys()[1]
	_room(y, 3.1, _carpet)
	# A long desk, a chair, a sofa corner and a plant: somebody's office.
	Builder.box(self, Vector3(0, y + 0.4, 7.0), Vector3(3.2, 0.8, 1.2), _wood)
	Builder.box(self, Vector3(0, y + 0.83, 7.0), Vector3(3.3, 0.06, 1.3), _dark, false)
	Builder.box(self, Vector3(0, y + 0.55, 9.3), Vector3(0.7, 0.9, 0.7), _dark, false)
	var f := "res://assets/furniture/"
	_place(f + "01_grey_sofa.glb", 2.8, Vector3(-9.0, y, 6.0), 90.0)
	_place(f + "02_coffee_table.glb", 1.3, Vector3(-6.0, y, 6.0), 90.0)
	_place(f + "07_bookshelf.glb", 2.2, Vector3(-12.9, y, -6.0), 90.0)
	_place(f + "10_palm_plant.glb", 1.8, Vector3(10.0, y, 12.0), 0.0, false)
	briefcase_spot = Node3D.new()
	briefcase_spot.position = Vector3(0.9, y + 0.86, 7.0)
	add_child(briefcase_spot)
	var bc := load(Data.model_path("briefcase")) as PackedScene
	if bc != null:
		var node := bc.instantiate() as Node3D
		briefcase_spot.add_child(node)
		ModelFit.place_by_largest(node, 0.45, 20.0, 0.0)


func _penthouse() -> void:
	var y := stop_ys()[2]
	_room(y, 6.4, Builder.mat(Color(0.72, 0.7, 0.66), 0.25))
	var f := "res://assets/furniture/"
	_place(f + "09_persian_rug.glb", 5.0, Vector3(4.0, y + 0.005, 4.0), 0.0, false, true, 0.12)
	_place(f + "01_grey_sofa.glb", 3.0, Vector3(4.0, y, 8.0), 0.0)
	_place(f + "08_armchair.glb", 1.2, Vector3(0.0, y, 3.0), 90.0)
	_place(f + "08_armchair.glb", 1.2, Vector3(8.0, y, 3.0), -90.0)
	_place(f + "02_coffee_table.glb", 1.4, Vector3(4.0, y, 4.5), 0.0)
	_place(f + "15_floor_lamp.glb", 2.0, Vector3(11.0, y, 10.0), 0.0, false)
	_place(f + "10_palm_plant.glb", 2.4, Vector3(-10.0, y, 12.0), 0.0, false)
	# A bar along the right wall, and a TV on the back wall running the Chomugiri ad.
	Builder.box(self, Vector3(12.0, y + 0.55, -4.0), Vector3(1.2, 1.1, 8.0), _dark)
	Builder.box(self, Vector3(12.0, y + 1.13, -4.0), Vector3(1.4, 0.06, 8.2), _stone, false)
	var tv := ChomuTv.new()
	tv.size = Vector2(2.4, 1.35)
	tv.position = Vector3(-7.0, y + 2.4, ROOM_Z0 + 0.25)
	tv.rotation.y = PI
	add_child(tv)
	boss_spot = Node3D.new()
	boss_spot.position = Vector3(4.0, y, 0.5)
	add_child(boss_spot)


func _roof() -> void:
	var y := stop_ys()[3]
	# The roof slab, with the shaft left open; the shaft ends in a capped head-house at the pad.
	_slab_clear(-ROOM_X - 2.0, ROOM_Z0 - 2.0, ROOM_X + 2.0, ROOM_Z1 + 2.0, y, 0.3, _concrete)
	var hw := ElevatorSystem.CAB_W * 0.5 + 0.5
	Builder.box(self, Vector3(0, y + ElevatorSystem.CAB_H + 0.6, ELEV_Z - 0.1), Vector3(hw * 2.0 + 0.2, 0.3, 4.2), _concrete)
	var parapet := 1.2
	Builder.wall(self, true, ROOM_Z1 + 2.0, -ROOM_X - 2.0, ROOM_X + 2.0, y, parapet, 0.3, _concrete)
	Builder.wall(self, true, ROOM_Z0 - 2.0, -ROOM_X - 2.0, ROOM_X + 2.0, y, parapet, 0.3, _concrete)
	Builder.wall(self, false, -ROOM_X - 2.0, ROOM_Z0 - 2.0, ROOM_Z1 + 2.0, y, parapet, 0.3, _concrete)
	Builder.wall(self, false, ROOM_X + 2.0, ROOM_Z0 - 2.0, ROOM_Z1 + 2.0, y, parapet, 0.3, _concrete)
	# The lift's head-house: the shaft rises through the roof here, walled, with its doors facing the pad.
	heli_pad = Node3D.new()
	heli_pad.position = Vector3(0, y, 4.0)
	add_child(heli_pad)
	var disk := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 7.0
	cm.bottom_radius = 7.0
	cm.height = 0.04
	disk.mesh = cm
	disk.material_override = Builder.mat(Color(0.2, 0.22, 0.25), 0.8)
	disk.position = Vector3(0, 0.02, 0)
	heli_pad.add_child(disk)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 6.3
	tm.outer_radius = 6.6
	ring.mesh = tm
	ring.scale = Vector3(1, 0.02, 1)
	ring.material_override = Builder.mat(Color(0.95, 0.95, 0.9), 0.6)
	ring.position = Vector3(0, 0.05, 0)
	heli_pad.add_child(ring)
	var h := Label3D.new()
	h.text = "H"
	h.font_size = 400
	h.pixel_size = 0.01
	h.modulate = Color(0.95, 0.95, 0.9)
	h.rotation_degrees.x = -90.0
	h.position = Vector3(0, 0.07, 0)
	heli_pad.add_child(h)
	_light(Vector3(0, y + 4.5, 4.0), 1.4, 20.0)


## The generated facade, standing on the lobby roof.
func _facade() -> void:
	var scene := load(Data.model_path("skyscraper")) as PackedScene
	if scene == null:
		return
	var node := scene.instantiate() as Node3D
	add_child(node)
	ModelFit.place_by_height(node, TOP_H, 0.0, LOBBY_H)
	node.name = "Facade"


# ── helpers ───────────────────────────────────────────────────────────────────

func _place(path: String, size: float, pos: Vector3, yaw := 0.0, solid := true, lay_flat := false, squash_y := 1.0) -> Node3D:
	var scene := load(path) as PackedScene
	if scene == null:
		return null
	var node := scene.instantiate() as Node3D
	add_child(node)
	ModelFit.place_by_largest(node, size, yaw, pos.y, lay_flat)
	node.position += Vector3(pos.x, 0.0, pos.z)
	if squash_y != 1.0:
		node.scale.y *= squash_y
		node.position.y += pos.y - ModelFit.aabb_of(node).position.y
	if solid:
		ModelFit.collider_for(node)
	return node


func _light(pos: Vector3, energy: float, range_m: float) -> void:
	var l := OmniLight3D.new()
	l.position = pos
	l.light_energy = energy
	l.omni_range = range_m
	l.light_color = Color(1.0, 0.95, 0.85)
	add_child(l)
