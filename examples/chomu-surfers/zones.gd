extends Node
## The levels.
##
## An endless runner does not have levels you load; it has zones you reach. A
## loading screen every 300m would break the one thing the genre is for. So the
## world changes around you instead — colours, sky, fog, music, speed and how
## crowded the track is — and the change is announced so it reads as progress
## rather than as a glitch.
##
## Ordered by distance. The last one has no end and keeps getting harder, so a
## good run never simply stops having content.

class Zone:
	var name: String
	var from: float           ## Metres at which this zone starts.
	var ground: Color
	var rail: Color
	var sky_top: Color
	var sky_horizon: Color
	var fog: Color
	var fog_density: float
	var obstacle_chance: float
	var coin_chance: float
	var speed_cap: float
	var bpm: int

	func _init(n: String, f: float, g: Color, r: Color, st: Color, sh: Color, fg: Color,
			fd: float, oc: float, cc: float, sc: float, b: int) -> void:
		name = n; from = f; ground = g; rail = r
		sky_top = st; sky_horizon = sh; fog = fg; fog_density = fd
		obstacle_chance = oc; coin_chance = cc; speed_cap = sc; bpm = b


var zones: Array = []


func _ready() -> void:
	zones = [
		# Easy on purpose. A first zone that kills you teaches nothing.
		Zone.new("Sunset Yard", 0.0,
			Color(0.22, 0.24, 0.29), Color(0.91, 0.45, 0.16),
			Color(0.22, 0.31, 0.53), Color(0.85, 0.56, 0.35), Color(0.68, 0.52, 0.42),
			0.012, 0.45, 0.75, 14.0, 104),
		Zone.new("Neon District", 350.0,
			Color(0.13, 0.12, 0.20), Color(0.95, 0.15, 0.55),
			Color(0.06, 0.04, 0.16), Color(0.45, 0.10, 0.50), Color(0.35, 0.12, 0.45),
			0.020, 0.55, 0.70, 18.0, 124),
		Zone.new("Frost Line", 750.0,
			Color(0.78, 0.84, 0.90), Color(0.35, 0.65, 0.85),
			Color(0.55, 0.70, 0.86), Color(0.86, 0.92, 0.96), Color(0.82, 0.88, 0.93),
			0.030, 0.60, 0.65, 21.0, 136),
		Zone.new("Ember Deep", 1200.0,
			Color(0.20, 0.10, 0.09), Color(1.0, 0.45, 0.10),
			Color(0.14, 0.04, 0.03), Color(0.62, 0.18, 0.06), Color(0.48, 0.16, 0.07),
			0.034, 0.66, 0.60, 24.0, 148),
		# No `to`: this one runs forever and the speed cap is the ceiling.
		Zone.new("The Void", 1800.0,
			Color(0.07, 0.07, 0.10), Color(0.55, 0.95, 0.85),
			Color(0.02, 0.02, 0.05), Color(0.10, 0.14, 0.20), Color(0.06, 0.10, 0.14),
			0.042, 0.72, 0.55, 26.0, 160),
	]


## The zone a given distance falls in, and its index.
func at_distance(metres: float) -> Array:
	var index := 0
	for i in zones.size():
		if metres >= zones[i].from:
			index = i
	return [index, zones[index]]


func count() -> int:
	return zones.size()
