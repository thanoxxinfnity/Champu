class_name World
extends Node3D
## The playable city: sky and clock, the street grid, the lamp-light pool, and the player on the safehouse step.
## Later systems (doors, tower, traffic, missions) hang off this node; it owns the references they share.

var atmosphere: Atmosphere
var city: City
var player: Player
var lamp_pool: LampPool
var safehouse: Safehouse
var vehicles: Array[Vehicle] = []


func _ready() -> void:
	atmosphere = Atmosphere.new()
	atmosphere.name = "Atmosphere"
	add_child(atmosphere)
	city = City.new()
	city.name = "City"
	add_child(city)
	city.build(7, atmosphere)

	safehouse = Safehouse.new()
	safehouse.name = "Safehouse"
	add_child(safehouse)
	safehouse.position = house_origin()
	safehouse.build()
	# The player's own car waits in the garage, nose to the door.
	var car := Vehicle.make("sedan")
	add_child(car)
	car.global_transform = safehouse.garage_transform()
	vehicles.append(car)

	player = Player.new()
	player.name = "Player"
	add_child(player)
	player.global_position = spawn_point()
	atmosphere.follow = player

	lamp_pool = LampPool.new()
	lamp_pool.name = "LampPool"
	add_child(lamp_pool)
	lamp_pool.follow = player


## The house's front wall centre: 14 m in from the sidewalk, so local z = -12 is the plot's street edge.
static func house_origin() -> Vector3:
	var c := City.block_center(City.SAFEHOUSE_PLOT)
	return Vector3(c.x, 0.0, c.z - 26.0)


## On the footpath inside the gate, looking at the front door (-Z is toward the street, so the player faces +Z).
static func spawn_point() -> Vector3:
	return house_origin() + Vector3(0, 0.25, -6.0)
