extends SceneTree
## Real window at a phone's size (run under xvfb): fingers land where the buttons are drawn. Two thumbs at once: the left one steers, the right one holds JUMP/JET,
## a third finger taps SHATTER WAVE; the stick moves the player; releasing lets go.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/touch_test.gd

func tap(idx: int, pos: Vector2, down: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.position = pos
	e.pressed = down
	Input.parse_input_event(e)
	await process_frame


func drag(idx: int, pos: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx
	e.position = pos
	e.relative = rel
	Input.parse_input_event(e)
	await process_frame


func _initialize() -> void:
	DisplayServer.window_set_size(Vector2i(2400, 1080))
	await process_frame
	await process_frame
	var game := await T.boot(self, "outlaw")
	game.start_play()
	await T.frames(self, 20)
	var win := Vector2(DisplayServer.window_get_size())
	var vp := root.get_visible_rect().size
	print("window ", win, " viewport ", vp)
	var k := win.x / vp.x                       # window pixels per virtual pixel
	var hud := game.hud
	var jet_rect: Rect2 = hud._btn["jet"].rect
	var jet_px := jet_rect.get_center() * k
	var stick_px := Vector2(300.0, win.y - 330.0)
	await tap(0, stick_px, true)
	T.check(hud._stick_id == 0, "a finger on the left half starts the stick")
	T.check(hud._stick_origin.distance_to(stick_px / k) < 3.0, "…right under the thumb (virtual %s, expected %s)" % [str(hud._stick_origin), str(stick_px / k)])
	await drag(0, stick_px + Vector2(0, -150.0), Vector2(0, -150.0))
	T.check(hud.move.y > 0.5, "dragging up steers forward (%.2f)" % hud.move.y)
	await tap(1, jet_px, true)
	T.check(hud.is_held("jet"), "the second thumb holds JUMP/JET while the first is still steering (button at %s)" % str(jet_rect))
	T.check(hud._stick_id == 0 and hud.move.y > 0.5, "…and the stick still works")
	var fire_px: Vector2 = (hud._btn["fire"].rect as Rect2).get_center() * k
	await tap(2, fire_px, true)
	T.check(hud.is_held("fire"), "a third finger holds SHATTER WAVE")
	await T.frames(self, 30)
	var z0 := game.player.global_position.z
	await T.frames(self, 30)
	T.check(game.player.global_position.z < z0 - 0.5 or not game.player.is_on_floor(), "the player moves forward with the thumb")
	T.check(game.player.tool.shots > 0, "the gauntlet fired from the held button")
	await tap(2, fire_px, false)
	await tap(1, jet_px, false)
	T.check(not hud.is_held("jet") and not hud.is_held("fire"), "lifting the fingers lets go of the buttons")
	await tap(0, stick_px, false)
	T.check(hud.move == Vector2.ZERO, "…and the stick")
	# look: drag on the right
	var look_px := Vector2(win.x * 0.6, win.y * 0.4)
	await tap(3, look_px, true)
	await drag(3, look_px + Vector2(200, 0), Vector2(200, 0))
	T.check(absf(hud.look.x) > 0.3 or absf(game.player.yaw) > 0.3, "dragging on the right half turns the camera")
	await tap(3, look_px, false)
	# every button lies inside the screen with room to spare
	for name in hud._btn:
		var r: Rect2 = hud._btn[name].rect
		T.check(r.position.x >= 0 and r.position.y >= 0 and r.end.x <= vp.x and r.end.y <= vp.y, "button %s is on screen" % name)
	var names := hud._btn.keys()
	var overlap := 0
	for i in names.size():
		for j in range(i + 1, names.size()):
			if (hud._btn[names[i]].rect as Rect2).intersects(hud._btn[names[j]].rect):
				overlap += 1
	T.check(overlap == 0, "no two buttons overlap")
	T.done(self)
