extends SceneTree
## End-to-end: the real main scene, driven only through its UI signals and
## synthetic touch events, the way a player's fingers would.
## Run: godot --headless --path . --fixed-fps 60 -s tests/flow_test.gd

var game: Node
var frame := 0
var step := 0
var wait_until := 0
var fails: Array[String] = []
var mark := {}


func _initialize() -> void:
	# A clean save: the flow must be deterministic regardless of whatever a
	# previous run (or a real play session) left in the garage file.
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://garage.cfg"))
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)


func check(name: String, ok: bool, detail: String = "") -> void:
	print(("  ok   " if ok else "  FAIL ") + name + ("" if detail == "" else "   " + detail))
	if not ok:
		fails.append(name)


func touch(index: int, at: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = at
	e.pressed = pressed
	root.push_input(e, true)


func drag(index: int, to: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = index
	e.position = to
	root.push_input(e, true)


func btn(id: String) -> Vector2:
	return game.input._buttons[id].center


func after(frames: int) -> void:
	wait_until = frame + frames
	step += 1


func _process(_d: float) -> bool:
	frame += 1
	if frame < wait_until:
		return false
	match step:
		0:
			# This is a controls/flow smoke test, not the shop: own every car
			# so DRIVE always drives, whichever car next_car lands on.
			for c in CarCatalog.CARS:
				if not (game.garage.owned as Array).has(c.id):
					(game.garage.owned as Array).append(c.id)
			game.ui.set_ownership(true, 0, game.garage.coins)
			after(5)
		1:
			check("starts in garage", game.state == 0)
			check("showroom camera current", game.showroom.camera.current)
			check("car has all parts", CarBuilder.validate(game.showroom.current).is_empty(), str(CarBuilder.validate(game.showroom.current)))
			mark.first = game.showroom.current_car.id
			game.ui.next_car.emit()
			after(45)
		2:
			check("next car shown", game.showroom.current_car.id != mark.first, game.showroom.current_car.id)
			var cfg: Dictionary = game.ui.config.duplicate()
			cfg.color = PaintCustomizer.PALETTE[3]
			cfg.finish = 2
			cfg.underglow = true
			game.ui.config = cfg
			game.ui.config_changed.emit(cfg)
			after(3)
		3:
			var mat: ShaderMaterial = game.showroom.current.get_meta("paint_material")
			check("paint applied live", (mat.get_shader_parameter("base_color") as Color).is_equal_approx(PaintCustomizer.PALETTE[3]))
			check("underglow on", game.showroom.current.get_node("Underglow").visible)
			game.showroom.toggle_doors()
			after(50)
		4:
			var door: Node3D = game.showroom.current.get_node("Door_L")
			check("doors open on tap", door.rotation.length() > 0.5, str(door.rotation))
			game.ui.drive.emit()
			after(40)
		5:
			check("in drive", game.state == 1)
			check("chase camera current", game.cam != null and game.cam.current)
			check("touch overlay visible", game.input.visible)
			check("world in tree", game.world != null and game.world.is_inside_tree())
			check("showroom out of tree", not game.showroom.is_inside_tree())
			check("drive car has wheels", game.vehicle != null and game.vehicle.wheels.size() == 4)
			mark.pos = game.vehicle.global_position
			touch(0, btn("gas"), true)
			touch(1, btn("left"), true)
			after(90)
		6:
			var v: VehicleController = game.vehicle
			check("multitouch: gas held", v.in_throttle == 1.0)
			check("multitouch: steering left at same time", v.in_steer < -0.8, str(v.in_steer))
			check("car moved", v.global_position.distance_to(mark.pos) > 5.0, "%.1f m" % v.global_position.distance_to(mark.pos))
			check("car turned left", v.global_basis.z.signed_angle_to(Vector3(0, 0, 1), Vector3.UP) != 0.0)
			touch(1, btn("left"), false)
			drag(0, btn("brake"))
			after(20)
		7:
			var v2: VehicleController = game.vehicle
			check("slide gas->brake without lifting", v2.in_brake == 1.0 and v2.in_throttle == 0.0)
			check("steer released", absf(v2.in_steer) < 0.05, str(v2.in_steer))
			touch(0, btn("brake"), false)
			touch(2, btn("gas"), true)
			touch(3, btn("nitro"), true)
			after(30)
		8:
			var v3: VehicleController = game.vehicle
			check("nitro fires while gas held", v3.nitro_active)
			touch(2, btn("gas"), false)
			touch(3, btn("nitro"), false)
			touch(4, btn("handbrake"), true)
			after(5)
		9:
			check("handbrake button", game.vehicle.in_handbrake)
			touch(4, btn("handbrake"), false)
			mark.mode = game.cam.mode
			touch(5, btn("camera"), true)
			touch(5, btn("camera"), false)
			after(5)
		10:
			check("camera button cycles mode", game.cam.mode != mark.mode)
			check("all inputs released", game.vehicle.in_throttle == 0.0 and not game.vehicle.in_nitro and not game.vehicle.in_handbrake)
			touch(6, btn("reset"), true)
			touch(6, btn("reset"), false)
			after(10)
		11:
			check("reset keeps car upright on road", game.vehicle.global_basis.y.y > 0.95 and game.world.distance_to_road(game.vehicle.global_position) < 6.0, "up=%.2f road=%.1f pos=%s" % [game.vehicle.global_basis.y.y, game.world.distance_to_road(game.vehicle.global_position), game.vehicle.global_position])
			touch(7, btn("garage"), true)
			touch(7, btn("garage"), false)
			after(40)
		12:
			check("back to garage", game.state == 0 and game.vehicle == null and game.showroom.is_inside_tree())
			check("touch overlay hidden", not game.input.visible)
			mark.world = game.world
			after(20)
		13:
			game.ui.drive.emit()
			after(50)
		14:
			check("second drive reuses the world", game.world == mark.world and game.state == 1, "same=%s state=%d busy=%s" % [game.world == mark.world, game.state, game._busy])
			print("FAILS: ", fails)
			return true
	return false
