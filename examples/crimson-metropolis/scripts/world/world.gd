class_name World
extends Node3D
## The playable city: sky and clock, the street grid, the lamp-light pool, and the player on the safehouse step.
## Later systems (doors, tower, traffic, missions) hang off this node; it owns the references they share.

var atmosphere: Atmosphere
var city: City
var scenery: Scenery
var player: Player
var lamp_pool: LampPool
var safehouse: Safehouse
var tower: Tower
var director: Director
var traffic: Traffic
var wanted: Wanted
var mission: PenthouseDeal
var vehicles: Array[Vehicle] = []
## Tests that only care about the buildings and doors turn the population, HUD and phone off.
var with_life := true


func _ready() -> void:
	atmosphere = Atmosphere.new()
	atmosphere.name = "Atmosphere"
	add_child(atmosphere)
	city = City.new()
	city.name = "City"
	add_child(city)
	city.build(7, atmosphere)
	scenery = Scenery.new()
	add_child(scenery)
	scenery.build(7, [City.SAFEHOUSE_PLOT, City.TOWER_PLOT])

	safehouse = Safehouse.new()
	safehouse.name = "Safehouse"
	add_child(safehouse)
	safehouse.position = house_origin()
	safehouse.build()
	tower = Tower.new()
	tower.name = "Tower"
	add_child(tower)
	tower.position = City.block_center(City.TOWER_PLOT)
	tower.build()

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

	if with_life:
		traffic = Traffic.new()
		traffic.name = "Traffic"
		add_child(traffic)
		traffic.populate(self)
		director = Director.new()
		director.name = "Director"
		add_child(director)
		director.setup(self)
		wanted = Wanted.new()
		wanted.name = "Wanted"
		wanted.state = director.state
		wanted.world = self
		wanted.traffic = traffic
		wanted.hud = director.hud
		wanted.director = director
		add_child(wanted)
		mission = PenthouseDeal.new()
		mission.name = "Mission1"
		add_child(mission)
		mission.setup(self, director)
		director.mission = mission


## The house's front wall centre: 14 m in from the sidewalk, so local z = -12 is the plot's street edge.
static func house_origin() -> Vector3:
	var c := City.block_center(City.SAFEHOUSE_PLOT)
	return Vector3(c.x, 0.0, c.z - 26.0)


## On the footpath inside the gate, looking at the front door (-Z is toward the street, so the player faces +Z).
static func spawn_point() -> Vector3:
	return house_origin() + Vector3(0, 0.25, -6.0)
