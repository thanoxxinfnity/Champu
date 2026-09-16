extends SceneTree
## Does the thing you actually hold in your hand work?
##
## Every bug this checks for was in the shipped build and invisible to every
## other test: the camera could not turn, there was no fire button anywhere, and
## grabbing the movement stick pulled the trigger. None of that shows up in a
## string comparison — the scene file was *correct*, it was the arrangement of
## Controls that ate the input.

var _fails: Array[String] = []
var _scene: Node
var _touch: Control
var _player: CharacterBody3D
var _step: int = 0
var _yaw_before: float = 0.0
var _z_before: float = 0.0


func _check(name: String, ok: bool, detail: String = "") -> void:
	print(("  ok   " if ok else "  FAIL ") + name + ("" if detail == "" else "   " + detail))
	if not ok:
		_fails.append(name)


func _initialize() -> void:
	var packed := load("res://main.tscn") as PackedScene
	if packed == null:
		print("main.tscn did not load")
		quit(1)
		return
	_scene = packed.instantiate()
	root.add_child(_scene)

	_touch = _scene.get_node_or_null("HUD/Touch") as Control
	_player = _scene.get_node_or_null("Player") as CharacterBody3D
	_check("the scene has a touch layer", _touch != null)
	_check("the scene has a player", _player != null)
	if _touch == null or _player == null:
		return


func _layout_checks() -> void:
	# Headless has no touchscreen, so the layer hides itself and stops reading
	# input — correct on a desktop, useless in a test. Turn it on by hand.
	_touch.visible = true
	_touch.set_process_input(true)
	_touch._layout()

	var view: Vector2 = _touch.get_viewport_rect().size
	print("  viewport ", view)
	# Read from the project rather than the window: headless opens whatever size
	# it likes, and this is a question about what ships.
	var orientation: int = ProjectSettings.get_setting("display/window/handheld/orientation", 1)
	_check("the phone is held landscape", orientation == 0 or orientation == 2 or orientation == 4,
		"orientation=%d (0/2/4 landscape, 1/3/5 portrait) — a shooter in portrait is half sky and no controls" % orientation)
	_check("the design resolution agrees with the orientation",
		int(ProjectSettings.get_setting("display/window/size/viewport_width", 0))
		> int(ProjectSettings.get_setting("display/window/size/viewport_height", 0)))
	# Godot turns every touch into a mouse click, and that cannot be switched off
	# without breaking every Button in the menus. So `fire` carries no mouse
	# binding at all: the button presses the action, and so does the weapon when
	# a desktop mouse is captured.
	_check("fire is not bound to the mouse", InputMap.action_get_events("fire").is_empty(),
		"a tap anywhere would pull the trigger, including on the movement stick")

	# The bug in the user's words: "fire button landscape mode ma nahi ha".
	var places: Array = _touch._places
	var radii: Array = _touch._radii
	_check("there are three buttons", places.size() == 3)
	for i in places.size():
		var at: Vector2 = places[i]
		var r: float = radii[i]
		_check("button %d is on the screen" % i,
			at.x - r > 0.0 and at.y - r > 0.0 and at.x + r < view.x and at.y + r < view.y,
			"%s at %s r=%.1f" % [_touch.buttons[i], at, r])
	# A thumb is about 9mm across. On a 1152-wide screen that is ~45px radius.
	_check("the fire button is big enough for a thumb", radii[0] >= 40.0, "r=%.1f" % radii[0])
	_check("the buttons do not overlap each other",
		places[0].distance_to(places[1]) > radii[0] + radii[1]
		and places[0].distance_to(places[2]) > radii[0] + radii[2])
	_check("the fire button is in the right half, clear of the stick", places[0].x > view.x * 0.5)


func _process(_delta: float) -> bool:
	if _touch == null or _player == null:
		return true
	_step += 1
	if _step == 1:
		# Not in _initialize: a node added to the root there is not inside the
		# tree yet, and get_viewport_rect() answers a zero rect.
		_layout_checks()
		return false
	var view: Vector2 = _touch.get_viewport_rect().size

	match _step:
		2:
			# ── Firing ──────────────────────────────────────────────────────
			_press(0, _touch._places[0])
		3:
			_check("pressing the fire button fires", Input.is_action_pressed("fire"))
			_release(0, _touch._places[0])
		4:
			_check("letting go stops firing", not Input.is_action_pressed("fire"))

			# ── The trigger does not go off on its own ──────────────────────
			# Godot turns every touch into a mouse click, and `fire` used to be
			# bound to mouse button 1. Grabbing the stick shot the gun.
			_press(1, Vector2(view.x * 0.2, view.y * 0.7))
		5:
			_check("grabbing the movement stick does not fire", not Input.is_action_pressed("fire"))
			_drag(1, Vector2(view.x * 0.2, view.y * 0.7), Vector2(0, -70))
		6:
			var moved: Vector2 = _player.touch_direction
			_check("pushing the stick up walks forward", moved.y < -0.3, "direction %s" % moved)
			_z_before = _player.global_position.z
			_release(1, Vector2(view.x * 0.2, view.y * 0.7 - 70))
		7:
			_check("letting go of the stick stops", _player.touch_direction == Vector2.ZERO)

			# ── Looking ─────────────────────────────────────────────────────
			# "camra freely move nahi ho raha tha" — the whole reason for this.
			_yaw_before = _player.rotation.y
			_press(2, Vector2(view.x * 0.75, view.y * 0.4))
		8:
			_drag(2, Vector2(view.x * 0.75, view.y * 0.4), Vector2(120, 0))
		9:
			_check("dragging the right half turns the camera",
				absf(_player.rotation.y - _yaw_before) > 0.05,
				"yaw %.3f -> %.3f" % [_yaw_before, _player.rotation.y])
			var pitch_before: float = _scene.get_node("Player/Camera").rotation.x
			_drag(2, Vector2(view.x * 0.75 + 120, view.y * 0.4), Vector2(0, 90))
			_check("dragging up and down tilts it",
				absf(_scene.get_node("Player/Camera").rotation.x - pitch_before) > 0.05)
		10:
			_release(2, Vector2(view.x * 0.75, view.y * 0.4))
			# ── Two thumbs at once ──────────────────────────────────────────
			# Moving while looking is the whole game. One finger stealing the
			# other's job is what a single full-screen Control did.
			_press(3, Vector2(view.x * 0.2, view.y * 0.7))
			_press(4, Vector2(view.x * 0.8, view.y * 0.5))
		11:
			_yaw_before = _player.rotation.y
			_drag(3, Vector2(view.x * 0.2, view.y * 0.7), Vector2(0, -80))
			_drag(4, Vector2(view.x * 0.8, view.y * 0.5), Vector2(100, 0))
		12:
			_check("you can move and look at the same time",
				_player.touch_direction.y < -0.3 and absf(_player.rotation.y - _yaw_before) > 0.05,
				"move %s  yaw delta %.3f" % [_player.touch_direction, _player.rotation.y - _yaw_before])
			# ── Sprint without a fourth button ──────────────────────────────
			_drag(3, Vector2(view.x * 0.2, view.y * 0.7 - 80), Vector2(0, -260))
		13:
			_check("shoving the stick to the edge sprints", Input.is_action_pressed("sprint"))
			_touch.release_all()
		14:
			_check("release_all lets go of everything",
				not Input.is_action_pressed("sprint") and not Input.is_action_pressed("fire")
				and _player.touch_direction == Vector2.ZERO)

			# ── A phone call mid-fight ──────────────────────────────────────
			_press(5, _touch._places[0])
		15:
			_touch._notification(NOTIFICATION_APPLICATION_FOCUS_OUT)
		16:
			_check("losing focus does not leave the trigger held",
				not Input.is_action_pressed("fire"))

			# ── A different phone ───────────────────────────────────────────
			# The layout is recomputed from the live viewport, so a taller or
			# wider screen still has its buttons on it.
			return _resize_check()
		_:
			if _step > 17:
				return _finish()
	return false


## Every aspect ratio a phone comes in, including the daft ones.
func _resize_check() -> bool:
	for size in [Vector2i(2340, 1080), Vector2i(1280, 720), Vector2i(2000, 900), Vector2i(1024, 768)]:
		root.size = size
		_touch._layout()
		var view: Vector2 = _touch.get_viewport_rect().size
		var all_on := true
		for i in _touch._places.size():
			var at: Vector2 = _touch._places[i]
			var r: float = _touch._radii[i]
			if at.x - r < 0.0 or at.y - r < 0.0 or at.x + r > view.x or at.y + r > view.y:
				all_on = false
		_check("every button is on screen at %s" % size, all_on, "logical %s" % view)
	return false


func _finish() -> bool:
	print("")
	if _fails.is_empty():
		print("TOUCH OK — every control does what it looks like it does")
		quit(0)
	else:
		print("TOUCH BROKEN: ", ", ".join(_fails))
		quit(1)
	return true


# ── Pushing events ──────────────────────────────────────────────────────────
# push_input goes straight at the viewport, which is the path a real finger
# takes once the platform layer has transformed it.

func _press(index: int, at: Vector2) -> void:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.position = at
	event.pressed = true
	# in_local_coords: these are already viewport coordinates. Without it
	# push_input applies the inverse stretch transform and the press lands
	# thousands of pixels off the screen.
	root.push_input(event, true)


func _release(index: int, at: Vector2) -> void:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.position = at
	event.pressed = false
	# in_local_coords: these are already viewport coordinates. Without it
	# push_input applies the inverse stretch transform and the press lands
	# thousands of pixels off the screen.
	root.push_input(event, true)


func _drag(index: int, from: Vector2, by: Vector2) -> void:
	var event := InputEventScreenDrag.new()
	event.index = index
	event.position = from + by
	event.relative = by
	# in_local_coords: these are already viewport coordinates. Without it
	# push_input applies the inverse stretch transform and the press lands
	# thousands of pixels off the screen.
	root.push_input(event, true)
