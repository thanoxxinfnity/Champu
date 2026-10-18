class_name TrafficLights
extends Node3D
## One signal per intersection, all on the same cycle but each with its own offset so the city is not in lockstep. Cars ask
## `is_green(node, axis)`; the lamps on the corner posts show the same answer.
##
## axis 0 = traffic moving along Z (a road at fixed x), axis 1 = moving along X.

const GREEN := 11.0
const AMBER := 2.0
const ALL_RED := 1.5
const CYCLE := (GREEN + AMBER + ALL_RED) * 2.0

var clock := 0.0
var _mats: Dictionary = {}     # Vector2i node -> [axis0 material, axis1 material]


func _ready() -> void:
	name = "TrafficLights"
	for ix in range(City.ROAD_LINES.size()):
		for iz in range(City.ROAD_LINES.size()):
			_build(Vector2i(ix, iz))


func _process(delta: float) -> void:
	clock += delta
	for node in _mats:
		for axis in range(2):
			var m: StandardMaterial3D = _mats[node][axis]
			var c := color_of(node, axis)
			m.albedo_color = c * 0.35
			m.emission = c


static func _offset(node: Vector2i) -> float:
	return float((node.x * 5 + node.y * 3) % 7) * 3.1


## 0 = red, 1 = amber, 2 = green for `axis` at `node`.
func phase_of(node: Vector2i, axis: int) -> int:
	var t := fposmod(clock + _offset(node), CYCLE)
	var half := GREEN + AMBER + ALL_RED
	if axis == 1:
		t = fposmod(t - half, CYCLE)
	if t < GREEN:
		return 2
	if t < GREEN + AMBER:
		return 1
	return 0


func is_green(node: Vector2i, axis: int) -> bool:
	return phase_of(node, axis) == 2


func color_of(node: Vector2i, axis: int) -> Color:
	match phase_of(node, axis):
		2: return Color(0.15, 1.0, 0.3)
		1: return Color(1.0, 0.7, 0.1)
	return Color(1.0, 0.12, 0.1)


func _build(node: Vector2i) -> void:
	var cx: float = City.ROAD_LINES[node.x]
	var cz: float = City.ROAD_LINES[node.y]
	var mats: Array = []
	for axis in range(2):
		var m := StandardMaterial3D.new()
		m.emission_enabled = true
		m.emission_energy_multiplier = 2.2
		mats.append(m)
	_mats[node] = mats
	var h := City.ROAD_W * 0.5 + 0.8
	# A post at each corner: its lamp faces the approach it controls (the one a driver would be stopped at).
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var post := Node3D.new()
			post.position = Vector3(cx + sx * h, 0, cz + sz * h)
			add_child(post)
			var pole := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.07
			cm.bottom_radius = 0.09
			cm.height = 4.2
			pole.mesh = cm
			pole.position.y = 2.1
			pole.material_override = Builder.mat(Color(0.1, 0.1, 0.11), 0.6, 0.4)
			post.add_child(pole)
			# The corner at +x,+z faces traffic coming from -x (axis 1) and from -z (axis 0): alternate by corner.
			var axis := 0 if sx * sz > 0 else 1
			var head := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(0.34, 0.8, 0.34)
			head.mesh = bm
			head.position.y = 4.1
			head.material_override = Builder.mat(Color(0.05, 0.05, 0.06), 0.5)
			post.add_child(head)
			var lamp := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.15
			sm.height = 0.3
			lamp.mesh = sm
			lamp.material_override = mats[axis]
			lamp.position = Vector3(0, 4.1, 0.18)
			lamp.rotation.y = 0.0
			post.add_child(lamp)
			var back := lamp.duplicate() as MeshInstance3D
			back.position.z = -0.18
			post.add_child(back)
