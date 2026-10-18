class_name World
extends Node3D
## The playable city: sky and clock, the street grid, the lamp-light pool, and the player on the safehouse step.
## Later systems (doors, tower, traffic, missions) hang off this node; it owns the references they share.

var atmosphere: Atmosphere
var city: City
var player: Player
var lamp_pool: LampPool


func _ready() -> void:
	atmosphere = Atmosphere.new()
	atmosphere.name = "Atmosphere"
	add_child(atmosphere)
	city = City.new()
	city.name = "City"
	add_child(city)
	city.build(7, atmosphere)

	player = Player.new()
	player.name = "Player"
	add_child(player)
	player.global_position = spawn_point()
	atmosphere.follow = player

	lamp_pool = LampPool.new()
	lamp_pool.name = "LampPool"
	add_child(lamp_pool)
	lamp_pool.follow = player


## On the sidewalk in front of the safehouse, facing the avenue (-Z).
static func spawn_point() -> Vector3:
	var c := City.block_center(City.SAFEHOUSE_PLOT)
	return Vector3(c.x, 0.2, c.z - City.BLOCK * 0.5 + City.SIDEWALK + 1.0)
