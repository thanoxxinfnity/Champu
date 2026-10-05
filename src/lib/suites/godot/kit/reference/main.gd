extends "res://kit/game_shell.gd"
## Coin Dash: drive a car round an arena and grab every coin before the clock runs out.
## The whole game is this file. The frame (title, countdown, pause, results, retry), the sky and lighting, the car, the
## camera, the touch controls, the sound and the effects all come from res://kit/.

var car: VehicleBody3D
var world: Node3D
var coins: int = 0
var total: int = 0
var time_left: float = 60.0


func _ready() -> void:
	game_title = "Coin Dash"
	tagline = "Grab every coin before the clock runs out"
	score_key = "coins"
	score_unit = "coins"
	super()


func _build_world() -> void:
	world = Node3D.new()
	add_child(world)
	Stage.environment(world, "day")
	Stage.ground(world, 120.0, Color("#5f9a4a"))
	Stage.arena_walls(world, 50.0)
	Stage.scatter(world, func(): return Props.tree(randf_range(4.0, 7.0)), 26, 46.0, 6.0, [Vector3.ZERO], 10.0, 3)
	Stage.scatter(world, func(): return Props.rock(randf_range(1.2, 2.4)), 14, 46.0, 5.0, [Vector3.ZERO], 9.0, 5)
	Stage.scatter(world, func(): return Props.crate(), 8, 40.0, 7.0, [Vector3.ZERO], 12.0, 8)
	car = Vehicle.create(world, Color("#e63946"), Vector3(0, 1.0, 0))
	for coin in Stage.scatter(world, func(): return Props.coin(), 30, 42.0, 7.0, [Vector3.ZERO], 8.0, 11):
		Props.spin(coin)
		Stage.pickup(coin, car, _collect.bind(coin))
	total = 30
	car.contact_monitor = true
	car.max_contacts_reported = 4
	car.body_entered.connect(_on_crash)
	Stage.chase_camera(world, car)
	Pad.add(self, [
		{"action": "steer_left", "icon": "left", "side": "left", "slot": 0},
		{"action": "steer_right", "icon": "right", "side": "left", "slot": 1},
		{"action": "accelerate", "icon": "gas", "side": "right", "slot": 0},
		{"action": "brake", "icon": "brake", "side": "right", "slot": 1},
	])


func _begin() -> void:
	coins = 0
	time_left = 60.0


func _update(delta: float) -> void:
	time_left -= delta
	var throttle: float = Input.get_action_strength("accelerate") - Input.get_action_strength("brake")
	Vehicle.drive(car, throttle, Input.get_axis("steer_right", "steer_left"), delta)
	hud("COINS  %d / %d" % [coins, total], "%d" % ceili(time_left))
	if coins >= total:
		finish(coins, "ALL COINS!", ["Time left  %d s" % int(time_left)], true)
	elif time_left <= 0.0:
		finish(coins, "TIME'S UP")


func _collect(coin: Node3D) -> void:
	if not is_instance_valid(coin) or state != "playing":
		return
	coins += 1
	Sfx.play("coin")
	Feel.shake(0.08, 0.15)
	Feel.float_text(hud_layer, "+1", Vector2(576, 330), Color("#ffe27a"))
	Fx.burst(world, coin.global_position + Vector3(0, 0.9, 0))
	if coins % 10 == 0:
		Sfx.play("levelup")
		banner("%d COINS!" % coins, 0.9, Color("#ffe27a"))
	coin.queue_free()


func _on_crash(_body: Node) -> void:
	if state == "playing" and car.linear_velocity.length() > 6.0:
		Sfx.play("hit")
		Feel.shake(0.3, 0.3)
		Feel.flash(Color(1.0, 0.3, 0.2, 0.3), 0.2)
