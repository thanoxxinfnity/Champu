extends SceneTree
## Real phone input end to end: window 2400x1080 (stretch expand), the lobby Start button is tapped with a real InputEventScreenTouch, then the left thumb
## drags to walk, the right thumb drags to look, the attack/roll/sprint buttons are tapped. Nothing here touches hud.move or player.move_input.
##   xvfb-run -a godot --rendering-driver opengl3 --resolution 2400x1080 --fixed-fps 60 --path . -s tests/touch_test.gd   (needs a real window for the stretch maths)

var _pointer := {}


func _tap(pos: Vector2, idx := 0, frames := 4) -> void:
	_touch(pos, idx, true)
	for i in frames:
		await process_frame
	_touch(pos, idx, false)
	await process_frame


func _touch(pos: Vector2, idx: int, down: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.position = pos
	e.pressed = down
	Input.parse_input_event(e)
	if down:
		_pointer[idx] = pos
	else:
		_pointer.erase(idx)


func _drag_to(idx: int, to: Vector2, frames := 10) -> void:
	var from: Vector2 = _pointer[idx]
	for i in frames:
		var e := InputEventScreenDrag.new()
		e.index = idx
		var np := from.lerp(to, float(i + 1) / frames)
		e.relative = np - _pointer[idx]
		e.position = np
		_pointer[idx] = np
		Input.parse_input_event(e)
		await process_frame


func _initialize() -> void:
	var game: Game = await T.boot(self, "rachel")
	await T.frames(self, 10)
	var k := root.get_final_transform().get_scale().x   # physical pixels per canvas pixel
	print("viewport ", game.hud.get_viewport().get_visible_rect().size, " scale ", k)
	T.check(game.state == Game.State.LOBBY, "boots into the lobby")
	var start_rect := Rect2()
	for b in game.hud._screen_buttons:
		if String(b.id) == "start":
			start_rect = b.rect
	T.check(start_rect.size != Vector2.ZERO, "the lobby shows a Start button")
	await _tap((start_rect.get_center()) * k)
	for i in 900:
		if game.state == Game.State.PLAYING:
			break
		await process_frame
	T.check(game.state == Game.State.PLAYING, "tapping Start begins the game")
	# dismiss any opening dialog/loading screens the way a player would
	for i in 600:
		if not game.hud.is_modal():
			break
		await process_frame
	T.check(not game.hud.is_modal(), "no screen blocks the controls after Start")
	var p := game.player
	var p0 := p.global_position
	# left thumb: push the stick up
	_touch(Vector2(320, 800), 1, true)
	await process_frame
	await _drag_to(1, Vector2(320, 800) + Vector2(0, -170) * k, 8)
	await T.frames(self, 90)
	var moved := p.global_position.distance_to(p0)
	print("walked ", snappedf(moved, 0.01), " m, move vec ", game.hud.move, " move_input ", p.move_input)
	T.check(game.hud.move.length() > 0.5, "the stick registers the thumb (%s)" % game.hud.move)
	T.check(moved > 2.0, "the character walks with a thumb on the stick (%.2f m in 1.5 s)" % moved)
	_touch(_pointer[1], 1, false)
	await T.frames(self, 30)
	T.check(game.hud.move == Vector2.ZERO, "releasing the stick stops the character")
	# right thumb drag turns the camera
	var yaw0 := p.yaw
	_touch(Vector2(1900, 500), 2, true)
	await process_frame
	await _drag_to(2, Vector2(2150, 500), 8)
	_touch(_pointer[2], 2, false)
	await T.frames(self, 4)
	T.check(absf(p.yaw - yaw0) > 0.05, "dragging on the right side turns the view (%.2f)" % (p.yaw - yaw0))
	# tap each action button through its on-screen position
	for id in ["attack", "dodge"]:
		var b: Dictionary = game.hud._buttons[id]
		var held_seen := false
		_touch(b.c * k, 3, true)
		await process_frame
		held_seen = bool(game.hud.held.get(id, false))
		await T.frames(self, 3)
		_touch(b.c * k, 3, false)
		await T.frames(self, 3)
		T.check(held_seen, "the %s button reacts to a tap" % id)
	T.done(self)
