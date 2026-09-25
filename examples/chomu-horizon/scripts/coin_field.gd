class_name CoinField
extends Node3D
## Every coin on a map, drawn as one MultiMesh (the spin and bob happen in
## the vertex shader, so thousands cost one draw call). Pickup is a lookup
## in a 32 m grid around the car, never a physics query. Big coins (the
## treasure on hilltops) are a second MultiMesh and worth 50.

signal collected(value: int, pos: Vector3)

const CELL := 32.0
const VALUE := 10
const BIG_VALUE := 50

var _pos := PackedVector3Array()
var _big := PackedByteArray()
var _taken := PackedByteArray()
var _slot := PackedInt32Array()      # index inside its MultiMesh
var _grid := {}
var _small: MultiMesh
var _large: MultiMesh
var remaining := 0


func setup(coins: Array) -> void:
	var small_x: Array[Transform3D] = []
	var big_x: Array[Transform3D] = []
	for c in coins:
		var p := Vector3(float(c[0]), float(c[1]), float(c[2]))
		var big: bool = (c as Array).size() > 3
		_pos.append(p)
		_big.append(1 if big else 0)
		_taken.append(0)
		if big:
			_slot.append(big_x.size())
			big_x.append(Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 2.2), p))
		else:
			_slot.append(small_x.size())
			small_x.append(Transform3D(Basis.IDENTITY, p))
		var key := Vector2i(floori(p.x / CELL), floori(p.z / CELL))
		var bucket: PackedInt32Array = _grid.get(key, PackedInt32Array())
		bucket.append(_pos.size() - 1)
		_grid[key] = bucket
	remaining = _pos.size()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.55
	mesh.bottom_radius = 0.55
	mesh.height = 0.12
	mesh.radial_segments = 20
	mesh.rings = 0
	var mat := ShaderMaterial.new()
	mat.shader = preload("res://shaders/coin.gdshader")
	_small = _make("Coins", mesh, small_x, mat)
	var big_mat := mat.duplicate() as ShaderMaterial
	big_mat.set_shader_parameter("gold", Color(1.0, 0.55, 0.9))
	big_mat.set_shader_parameter("glow", 1.2)
	_large = _make("BigCoins", mesh, big_x, big_mat)


func _make(node_name: String, mesh: Mesh, xs: Array[Transform3D], mat: Material) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xs.size()
	for i in xs.size():
		mm.set_instance_transform(i, xs[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = node_name
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.visibility_range_end = 420.0
	add_child(mmi)
	return mm


## Collect every coin within `radius` of `p` (the magnet widens it) and
## return the value picked up. `pull` > 0 draws coins inside `pull` towards
## the car first, for the nitro coin magnet.
func collect(p: Vector3, radius: float, pull: float = 0.0, delta: float = 0.0) -> int:
	var total := 0
	var reach := maxf(radius, pull)
	var c0 := Vector2i(floori((p.x - reach) / CELL), floori((p.z - reach) / CELL))
	var c1 := Vector2i(floori((p.x + reach) / CELL), floori((p.z + reach) / CELL))
	for cx in range(c0.x, c1.x + 1):
		for cz in range(c0.y, c1.y + 1):
			var key := Vector2i(cx, cz)
			if not _grid.has(key):
				continue
			for i in (_grid[key] as PackedInt32Array):
				if _taken[i] == 1:
					continue
				var d := _pos[i].distance_to(p)
				if d < radius:
					_take(i)
					var v := BIG_VALUE if _big[i] == 1 else VALUE
					total += v
					collected.emit(v, _pos[i])
				elif pull > 0.0 and d < pull:
					# Magnet: slide the coin towards the car.
					_pos[i] = _pos[i].move_toward(p, (18.0 + (pull - d) * 3.0) * delta)
					_move(i)
	return total


func _take(i: int) -> void:
	_taken[i] = 1
	remaining -= 1
	var mm := _large if _big[i] == 1 else _small
	mm.set_instance_transform(_slot[i], Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -1000, 0)))


func _move(i: int) -> void:
	var mm := _large if _big[i] == 1 else _small
	var s := 2.2 if _big[i] == 1 else 1.0
	mm.set_instance_transform(_slot[i], Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * s), _pos[i]))


func total() -> int:
	return _pos.size()
