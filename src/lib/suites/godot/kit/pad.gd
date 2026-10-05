extends Node
## On-screen controls that work with several fingers at once (steer with one thumb, accelerate with the other).
## Buttons press real Input Map actions, so the keyboard and touch share one path. Icons are drawn, not font glyphs.
##
##   Pad.add(self, [
##       {"action": "steer_left",  "icon": "left",  "side": "left",  "slot": 1},
##       {"action": "steer_right", "icon": "right", "side": "left",  "slot": 0},
##       {"action": "accelerate",  "icon": "gas",   "side": "right", "slot": 0},
##       {"action": "brake",       "icon": "brake", "side": "right", "slot": 1},
##   ])
##   Pad.add_stick(self, "move_left", "move_right", "move_forward", "move_back")
## `side` is "left" or "right"; `slot` 0 is the button nearest that screen edge, 1 the next one in.
## icons: left right up down gas brake jump fire boost
## Autoload name: Pad

const DEFAULT_KEYS := {
	"steer_left": [KEY_A, KEY_LEFT], "steer_right": [KEY_D, KEY_RIGHT], "accelerate": [KEY_W, KEY_UP], "brake": [KEY_S, KEY_DOWN],
	"move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT], "move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN],
	"jump": [KEY_SPACE], "fire": [KEY_F, KEY_CTRL], "boost": [KEY_SHIFT], "left": [KEY_A, KEY_LEFT], "right": [KEY_D, KEY_RIGHT],
	"up": [KEY_W, KEY_UP], "down": [KEY_S, KEY_DOWN],
}


## Makes sure an Input Map action exists, with default keys when it is a common name.
func ensure_action(action: String) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
		for key in DEFAULT_KEYS.get(action, []):
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)


func add(parent: Node, specs: Array, accent: Color = Color("#ffffff")) -> Control:
	var canvas := CanvasLayer.new()
	canvas.layer = 15
	parent.add_child(canvas)
	var surface := _PadSurface.new()
	surface.specs = specs
	surface.accent = accent
	canvas.add_child(surface)
	for s in specs:
		ensure_action(str(s["action"]))
	return surface


func add_stick(parent: Node, left: String, right: String, up: String, down: String) -> Control:
	for a in [left, right, up, down]:
		ensure_action(a)
	var canvas := CanvasLayer.new()
	canvas.layer = 14
	parent.add_child(canvas)
	var stick := _StickSurface.new()
	stick.actions = [left, right, up, down]
	canvas.add_child(stick)
	return stick


class _PadSurface extends Control:
	var specs: Array = []
	var accent := Color.WHITE
	var _rects := {}
	var _held := {}
	var _touches := {}

	func _ready() -> void:
		set_anchors_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		get_viewport().size_changed.connect(_layout)
		_layout()

	func _layout() -> void:
		var vp := get_viewport_rect().size
		var unit := minf(vp.x, vp.y) * 0.2
		var margin := unit * 0.22
		_rects.clear()
		for s in specs:
			var slot := int(s.get("slot", 0))
			var side := str(s.get("side", "right"))
			var size := Vector2(unit, unit)
			var x := margin + slot * (unit + margin * 0.7) if side == "left" else vp.x - margin - unit - slot * (unit + margin * 0.7)
			_rects[str(s["action"])] = Rect2(Vector2(x, vp.y - margin - unit), size)
		queue_redraw()

	func _press_at(index: int, pos: Vector2) -> void:
		var hit := ""
		for action in _rects:
			if (_rects[action] as Rect2).grow(unit_slack()).has_point(pos):
				hit = action
		var before: String = _touches.get(index, "")
		if before == hit:
			return
		if before != "":
			_release(before)
		_touches.erase(index)
		if hit != "":
			_touches[index] = hit
			Input.action_press(hit)
			_held[hit] = _held.get(hit, 0) + 1
		queue_redraw()

	func unit_slack() -> float:
		return minf(get_viewport_rect().size.x, get_viewport_rect().size.y) * 0.03

	func _release(action: String) -> void:
		_held[action] = maxi(0, _held.get(action, 0) - 1)
		if _held[action] == 0:
			Input.action_release(action)

	func _input(event: InputEvent) -> void:
		if event is InputEventScreenTouch:
			if event.pressed:
				_press_at(event.index, event.position)
			elif _touches.has(event.index):
				_release(_touches[event.index])
				_touches.erase(event.index)
				queue_redraw()
		elif event is InputEventScreenDrag:
			_press_at(event.index, event.position)
		elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not DisplayServer.is_touchscreen_available():
			if event.pressed:
				_press_at(-1, event.position)
			elif _touches.has(-1):
				_release(_touches[-1])
				_touches.erase(-1)
				queue_redraw()

	func _notification(what: int) -> void:
		if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
			for action in _held:
				Input.action_release(action)
			_held.clear()
			_touches.clear()
			queue_redraw()

	func _draw() -> void:
		for s in specs:
			var action := str(s["action"])
			var r: Rect2 = _rects.get(action, Rect2())
			if r.size == Vector2.ZERO:
				continue
			var down := Input.is_action_pressed(action)
			var center := r.get_center()
			var radius := r.size.x * 0.5
			draw_circle(center, radius, Color(0.05, 0.06, 0.09, 0.62 if not down else 0.82))
			draw_arc(center, radius - 2.0, 0.0, TAU, 48, Color(1, 1, 1, 0.55 if not down else 1.0), 4.0, true)
			_icon(str(s.get("icon", "up")), center, radius * 0.5, Color(1, 1, 1, 0.95 if not down else 1.0))

	func _icon(kind: String, c: Vector2, r: float, color: Color) -> void:
		match kind:
			"left":
				draw_colored_polygon(PackedVector2Array([c + Vector2(-r, 0), c + Vector2(r * 0.7, -r), c + Vector2(r * 0.7, r)]), color)
			"right":
				draw_colored_polygon(PackedVector2Array([c + Vector2(r, 0), c + Vector2(-r * 0.7, -r), c + Vector2(-r * 0.7, r)]), color)
			"up", "jump":
				draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r), c + Vector2(-r, r * 0.7), c + Vector2(r, r * 0.7)]), color)
			"down":
				draw_colored_polygon(PackedVector2Array([c + Vector2(0, r), c + Vector2(-r, -r * 0.7), c + Vector2(r, -r * 0.7)]), color)
			"gas":
				for i in 2:
					var y := c.y + r * 0.55 - i * r * 0.9
					draw_polyline(PackedVector2Array([Vector2(c.x - r, y), Vector2(c.x, y - r * 0.8), Vector2(c.x + r, y)]), color, r * 0.3, true)
			"brake":
				draw_rect(Rect2(c - Vector2(r * 0.8, r * 0.8), Vector2(r * 1.6, r * 1.6)), color)
			"fire":
				draw_circle(c, r * 0.45, color)
				draw_arc(c, r * 0.95, 0.0, TAU, 32, color, r * 0.2, true)
			"boost":
				draw_colored_polygon(PackedVector2Array([c + Vector2(r * 0.15, -r), c + Vector2(-r * 0.6, r * 0.1), c + Vector2(-r * 0.05, r * 0.1), c + Vector2(-r * 0.15, r), c + Vector2(r * 0.6, -r * 0.1), c + Vector2(r * 0.05, -r * 0.1)]), color)
			_:
				draw_circle(c, r * 0.6, color)


class _StickSurface extends Control:
	var actions: Array = []
	var _finger := -2
	var _origin := Vector2.ZERO
	var _pos := Vector2.ZERO

	func _ready() -> void:
		set_anchors_preset(Control.PRESET_FULL_RECT)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _radius() -> float:
		var vp := get_viewport_rect().size
		return minf(vp.x, vp.y) * 0.13

	func _input(event: InputEvent) -> void:
		var vp := get_viewport_rect().size
		if event is InputEventScreenTouch:
			if event.pressed and _finger == -2 and event.position.x < vp.x * 0.45:
				_finger = event.index
				_origin = event.position
				_pos = event.position
				queue_redraw()
			elif not event.pressed and event.index == _finger:
				_stop()
		elif event is InputEventScreenDrag and event.index == _finger:
			_pos = event.position
			_apply()
			queue_redraw()

	func _apply() -> void:
		var v := (_pos - _origin) / _radius()
		if v.length() > 1.0:
			v = v.normalized()
		_drive(actions[0], maxf(-v.x, 0.0))
		_drive(actions[1], maxf(v.x, 0.0))
		_drive(actions[2], maxf(-v.y, 0.0))
		_drive(actions[3], maxf(v.y, 0.0))

	func _drive(action: String, strength: float) -> void:
		if strength > 0.12:
			Input.action_press(action, strength)
		else:
			Input.action_release(action)

	func _stop() -> void:
		_finger = -2
		for a in actions:
			Input.action_release(a)
		queue_redraw()

	func _notification(what: int) -> void:
		if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
			_stop()

	func _draw() -> void:
		if _finger == -2:
			return
		var r := _radius()
		draw_circle(_origin, r, Color(0.05, 0.06, 0.09, 0.45))
		draw_arc(_origin, r, 0.0, TAU, 48, Color(1, 1, 1, 0.5), 4.0, true)
		var knob := _origin + (_pos - _origin).limit_length(r)
		draw_circle(knob, r * 0.42, Color(1, 1, 1, 0.8))
