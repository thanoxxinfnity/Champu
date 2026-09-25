class_name CarCatalog
extends RefCounted
## Every car in the game, as data.
##
## The model, the physics and the stat bars in the showroom are all derived
## from the same dictionary, so a car that looks long and heavy also drives
## long and heavy, and the "Drift" bar is not a number someone typed but the
## rear-grip ratio the controller actually uses.
##
## Coordinates: metres, +Z is the nose (VehicleBody3D drives towards +Z),
## y = 0 is the ground, origin is centred between the axles.
##
## body: stations from tail to nose, each [z, half_width, y_bottom, y_top, top_ratio].
##   top_ratio narrows the upper half of the section (tumblehome).
## cabin: [z, roof_y, roof_half_width]; the greenhouse exists where roof_y
##   is above the body's top at that z.

const CARS: Array[Dictionary] = [
	{
		"id": "vortex",
		"price": 15000,
		"name": "Vortex GT-R",
		"maker": "Chomu Motors",
		"class": "SUPERCAR",
		"drivetrain": "AWD",
		"front_torque_share": 0.35,
		"mass": 1380.0,
		"engine_force": 13500.0,
		"top_speed_kmh": 330.0,
		"brake_force": 32.0,
		"steer_max": 0.52,
		"grip_front": 1.7,
		"grip_rear": 1.6,
		"grip_drift": 0.55,
		"downforce": 1.9,
		"length": 4.62,
		"wheelbase": 2.72,
		"track": 0.86,
		"wheel_radius": 0.355,
		"wheel_width": 0.31,
		"wheel_width_rear": 0.34,
		"roundness": 3.0,
		"paint": Color(0.93, 0.33, 0.05),
		"spoiler": "wing_low",
		"doors": "scissor",
		"lights": "slit",
		"body": [
			[-2.31, 0.78, 0.34, 0.74, 0.84],
			[-2.18, 0.95, 0.26, 0.84, 0.84],
			[-1.80, 1.02, 0.26, 0.90, 0.80],
			[-1.20, 1.03, 0.27, 0.92, 0.78],
			[-0.60, 0.98, 0.22, 0.92, 0.80],
			[0.10, 0.95, 0.21, 0.86, 0.82],
			[0.80, 0.97, 0.23, 0.76, 0.86],
			[1.45, 0.98, 0.24, 0.72, 0.88],
			[1.95, 0.93, 0.22, 0.62, 0.90],
			[2.22, 0.84, 0.22, 0.52, 0.92],
			[2.31, 0.66, 0.26, 0.44, 0.94],
		],
		"cabin": [
			[-1.70, 0.91, 0.52],
			[-1.05, 1.10, 0.60],
			[-0.30, 1.19, 0.63],
			[0.20, 1.17, 0.62],
			[0.95, 0.80, 0.60],
		],
	},
	{
		"id": "brute",
		"price": 6000,
		"name": "Brute 69 SS",
		"maker": "Detroit Iron",
		"class": "MUSCLE",
		"drivetrain": "RWD",
		"front_torque_share": 0.0,
		"mass": 1640.0,
		"engine_force": 14800.0,
		"top_speed_kmh": 285.0,
		"brake_force": 26.0,
		"steer_max": 0.50,
		"grip_front": 1.35,
		"grip_rear": 1.25,
		"grip_drift": 0.45,
		"downforce": 0.8,
		"length": 5.05,
		"wheelbase": 3.0,
		"track": 0.83,
		"wheel_radius": 0.37,
		"wheel_width": 0.30,
		"wheel_width_rear": 0.34,
		"roundness": 5.0,
		"paint": Color(0.06, 0.09, 0.14),
		"spoiler": "duck",
		"doors": "swing",
		"lights": "round",
		"body": [
			[-2.52, 0.90, 0.36, 0.92, 0.94],
			[-2.40, 0.98, 0.30, 0.99, 0.93],
			[-1.90, 1.00, 0.30, 1.02, 0.92],
			[-1.00, 0.99, 0.30, 1.02, 0.92],
			[0.00, 0.98, 0.30, 1.01, 0.92],
			[1.00, 0.98, 0.30, 1.00, 0.93],
			[1.90, 0.98, 0.31, 0.98, 0.94],
			[2.40, 0.96, 0.32, 0.94, 0.95],
			[2.52, 0.90, 0.36, 0.88, 0.95],
		],
		"cabin": [
			[-1.85, 1.01, 0.66],
			[-1.35, 1.36, 0.70],
			[-0.40, 1.42, 0.72],
			[0.15, 1.40, 0.72],
			[0.75, 1.00, 0.70],
		],
	},
	{
		"id": "kaze",
		"price": 0,
		"name": "Kaze R-Spec",
		"maker": "Hanabi Works",
		"class": "JDM",
		"drivetrain": "RWD",
		"front_torque_share": 0.0,
		"mass": 1320.0,
		"engine_force": 11200.0,
		"top_speed_kmh": 298.0,
		"brake_force": 28.0,
		"steer_max": 0.60,
		"grip_front": 1.55,
		"grip_rear": 1.4,
		"grip_drift": 0.42,
		"downforce": 1.2,
		"length": 4.60,
		"wheelbase": 2.66,
		"track": 0.81,
		"wheel_radius": 0.345,
		"wheel_width": 0.28,
		"wheel_width_rear": 0.30,
		"roundness": 4.0,
		"paint": Color(0.10, 0.36, 0.95),
		"spoiler": "wing_high",
		"doors": "swing",
		"lights": "twin",
		"body": [
			[-2.30, 0.86, 0.34, 0.88, 0.90],
			[-2.18, 0.94, 0.28, 0.94, 0.88],
			[-1.60, 0.97, 0.28, 0.95, 0.86],
			[-0.80, 0.95, 0.27, 0.94, 0.86],
			[0.10, 0.94, 0.27, 0.92, 0.88],
			[0.90, 0.95, 0.27, 0.86, 0.90],
			[1.60, 0.95, 0.28, 0.80, 0.91],
			[2.10, 0.92, 0.27, 0.72, 0.92],
			[2.30, 0.82, 0.30, 0.62, 0.94],
		],
		"cabin": [
			[-2.00, 0.93, 0.62],
			[-1.30, 1.31, 0.66],
			[-0.40, 1.37, 0.68],
			[0.25, 1.35, 0.68],
			[0.95, 0.86, 0.66],
		],
	},
]


static func count() -> int:
	return CARS.size()


static func get_car(index: int) -> Dictionary:
	return CARS[posmod(index, CARS.size())]


static func index_of(id: String) -> int:
	for i in CARS.size():
		if CARS[i].id == id:
			return i
	return 0


## Stat bars on a 0..10 scale, computed from the same numbers the physics use.
static func stats(car: Dictionary) -> Dictionary:
	var accel: float = car.engine_force / car.mass  # m/s² at launch, ~7..10
	var handling: float = car.grip_front + car.grip_rear + car.steer_max * 2.0 + car.downforce * 0.35
	var drift: float = (car.grip_rear - car.grip_drift) * 5.0 + (2.0 if car.drivetrain == "RWD" else 0.0)
	return {
		"speed": clampf((car.top_speed_kmh - 200.0) / 14.0, 1.0, 10.0),
		"acceleration": clampf((accel - 4.5) * 1.8, 1.0, 10.0),
		"handling": clampf((handling - 3.2) * 4.0, 1.0, 10.0),
		"drift": clampf(drift, 1.0, 10.0),
	}
