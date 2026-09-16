extends SceneTree
## Is the city a game you can actually play?
##
## Every check here is a thing that is invisible in the scene file and obvious
## in ten seconds of holding the phone: whether the camera turns, whether the
## character walks the way the screen says, whether the car you are standing
## next to is a car you can get into, and whether it then goes anywhere.

var _fails: Array[String] = []
var _scene: Node
var _player: CharacterBody3D
var _rig: SpringArm3D
var _touch: Control
var _step: int = 0
var _mark: Vector3
var _yaw_before: float = 0.0
var _car_mark: Vector3


func _check(name: String, ok: bool, detail: String = "") -> void:
	print(("  ok   " if ok else "  FAIL ") + name + ("" if detail == "" else "   " + detail))
	if not ok:
		_fails.append(name)


func _initialize() -> void:
	_scene = (load("res://main.tscn") as PackedScene).instantiate()
	root.add_child(_scene)
	_player = _scene.get_node("Player")
	_rig = _scene.get_node("CameraRig")
	_touch = _scene.get_node("HUD/Touch")


func _press(index: int, at: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = at
	e.pressed = true
	root.push_input(e, true)


func _release(index: int, at: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = index
	e.position = at
	e.pressed = false
	root.push_input(e, true)


func _drag(index: int, from: Vector2, by: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = index
	e.position = from + by
	e.relative = by
	root.push_input(e, true)


func _process(_delta: float) -> bool:
	_step += 1

	if _step == 1:
		_touch.visible = true
		_touch.set_process_input(true)
		_touch._layout()
		var view: Vector2 = _touch.get_viewport_rect().size

		# ── The controls the city needs, and none it does not ────────────────
		_check("the buttons are USE and JUMP", Array(_touch.buttons) == ["use", "jump"],
			"%s" % [_touch.buttons])
		_check("there is no fire button on a game with no gun",
			not Array(_touch.buttons).has("fire"),
			"a button that does nothing is worse than the gap it hides")
		for i in _touch._places.size():
			var at: Vector2 = _touch._places[i]
			var r: float = _touch._radii[i]
			_check("the %s button is on screen" % _touch.buttons[i],
				at.x - r > 0.0 and at.y - r > 0.0 and at.x + r < view.x and at.y + r < view.y)
		_check("free look is on, because you have to see round you", _touch.free_look)

		# ── The camera is behind you, not in your head ──────────────────────
		var cam: Camera3D = _scene.get_node("CameraRig/Camera")
		_check("the camera is on a spring arm", _rig is SpringArm3D)
		_check("and it is far enough back to see yourself",
			_rig.spring_length > 2.0, "spring_length %.1f" % _rig.spring_length)
		_check("the player has a body to look at", _scene.get_node_or_null("Player/Body") != null)
		_check("the camera is the current one", cam.current)
		return false

	if _step == 3:
		_yaw_before = _rig.rotation.y
		_press(0, Vector2(_touch.get_viewport_rect().size.x * 0.75, 200))
		return false

	if _step == 4:
		_drag(0, Vector2(_touch.get_viewport_rect().size.x * 0.75, 200), Vector2(140, 40))
		return false

	# Checked at 20, not at 5. The rig applies the turn in _physics_process, and
	# a headless run gets far fewer physics steps than process frames — so at
	# step 5 the yaw the drag set has not been written to the transform yet, and
	# the camera looks stuck when it is only early.
	if _step == 20:
		_check("dragging turns the camera round the player",
			absf(_rig.rotation.y - _yaw_before) > 0.05,
			"yaw %.3f -> %.3f" % [_yaw_before, _rig.rotation.y])
		_check("and tilts it", absf(_rig.rotation.x + 0.25) > 0.02,
			"pitch %.3f" % _rig.rotation.x)
		_release(0, Vector2(_touch.get_viewport_rect().size.x * 0.75, 200))
		_mark = _player.global_position
		return false

	if _step > 20 and _step <= 600:
		# ── Walking is relative to the camera, not to the body ──────────────
		_player.set_move_input(Vector2(0, -1))
		if _step == 600:
			var moved: float = _player.global_position.distance_to(_mark)
			_check("pushing the stick up walks", moved > 2.0, "moved %.1fm" % moved)
			# Away from the camera, which is what "up" means on a screen.
			var away: Vector3 = (_player.global_position - _mark).normalized()
			_check("and walks where the camera is looking",
				away.dot(_rig.forward()) > 0.7,
				"walked %s, camera forward %s" % [away.snapped(Vector3(0.01, 0.01, 0.01)), _rig.forward().snapped(Vector3(0.01, 0.01, 0.01))])
			_check("the character turns to face where it is going",
				absf(angle_difference(_player.rotation.y, atan2(away.x, away.z))) < 0.5)
			_player.set_move_input(Vector2.ZERO)
		return false

	if _step == 610:
		# ── The car ─────────────────────────────────────────────────────────
		var car: VehicleBody3D = _scene.get_node("Cars/Sedan")
		_check("the car has wheels", car.get_children().any(func(c): return c is VehicleWheel3D),
			"%d children" % car.get_child_count())
		var wheels := 0
		for c in car.get_children():
			if c is VehicleWheel3D:
				wheels += 1
		_check("four of them", wheels == 4, "%d" % wheels)
		_check("it has a door you can walk into", car.get_node_or_null("Door") != null)
		# Stood next to it, the way a player would be.
		_player.global_position = car.global_position + Vector3(2.2, 0.5, 0.0)
		return false

	if _step == 615:
		var car: VehicleBody3D = _scene.get_node("Cars/Sedan")
		_player.enter_car(car)
		_check("you can get in", _player.is_driving())
		_check("and the camera pulls back for it", _rig.spring_length > 6.0,
			"spring_length %.1f" % _rig.spring_length)
		_car_mark = car.global_position
		return false

	if _step > 615 and _step <= 1400:
		# Full throttle, straight ahead.
		var car: VehicleBody3D = _scene.get_node("Cars/Sedan")
		car.set_move_input(Vector2(0, -1))
		if _step == 1400:
			var drove: float = car.global_position.distance_to(_car_mark)
			_check("and it actually drives", drove > 5.0, "moved %.1fm" % drove)
			_check("the car stays on its wheels",
				car.global_transform.basis.y.dot(Vector3.UP) > 0.7,
				"up vector %s — a tall centre of mass rolls it on the first corner" % car.global_transform.basis.y.snapped(Vector3(0.01, 0.01, 0.01)))
			_check("the player rides with it",
				_player.global_position.distance_to(car.global_position) < 4.0)
			_player.leave_car()
			_check("and you can get out", not _player.is_driving())
			_check("standing on something, not inside the car",
				_player.global_position.distance_to(car.global_position) > 1.5)
			return _finish()
		return false

	return false


func _finish() -> bool:
	print("")
	if _fails.is_empty():
		print("CITY OK — walks, looks, drives")
		quit(0)
	else:
		print("CITY BROKEN: ", ", ".join(_fails))
		quit(1)
	return true
