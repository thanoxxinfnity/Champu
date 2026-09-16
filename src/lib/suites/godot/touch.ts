/**
 * Touch controls.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The first version had two nodes reading raw touch: a `Joystick` Control
 * anchored to the full rect, and `look.gd` listening in `_unhandled_input`. A
 * full-rect Control with the default `mouse_filter` consumes every
 * `InputEventScreenTouch` in `_gui_input` and marks it handled, so
 * `_unhandled_input` never ran. The whole screen was a movement stick and the
 * camera could not turn at all — which is exactly what it felt like to play.
 *
 * On top of that, `input_devices/pointing/emulate_mouse_from_touch` defaults to
 * true, and `fire` is bound to mouse button 1. Every tap anywhere on the screen
 * — including on the movement stick — pulled the trigger.
 *
 * So: **one owner for every finger.** This layer reads the raw events, decides
 * what each finger is for from where it landed, and nothing else in the game
 * touches the screen. Mouse emulation is turned off in `project.godot`.
 *
 * ── Two decisions worth stating ─────────────────────────────────────────────
 *
 * **Buttons press real InputMap actions.** `Input.action_press("fire")` rather
 * than a `fired` signal of its own. Touch and the keyboard then travel the same
 * path, and a weapon polling `fire` needs to know nothing about phones. It also
 * means a button cannot drift out of sync with the key that does the same job.
 *
 * **Every position is a fraction of the viewport, recomputed on resize.** A
 * button at a baked pixel offset is a button that is off-screen on the next
 * phone: `window/stretch/aspect="expand"` gives a different logical size for
 * every aspect ratio, and the size the game is *designed* at is almost never
 * the size it *runs* at. This is why the fire button was not where it should be
 * in landscape.
 */

export interface TouchSpec {
  /**
   * Actions the buttons press, in order of importance. The first is the big one
   * in the corner under the thumb; the rest ring outwards from it.
   *
   * Every name must be an action declared in `project.godot` —
   * `Input.action_press` on an unknown action logs an error and does nothing.
   */
  buttons: string[];
  /** Whether dragging the free half of the screen turns the camera. */
  freeLook: boolean;
  /** Whether the left half is a movement stick. */
  stick: boolean;
}

/** What a first-person shooter needs on a phone. */
export const SHOOTER_TOUCH: TouchSpec = { buttons: ['fire', 'reload', 'jump'], freeLook: true, stick: true };

/**
 * The control layer.
 *
 * A `Control` so it can draw itself, but `MOUSE_FILTER_IGNORE` so it is never a
 * GUI control — it reads `_input` directly. Leaving the default filter on a
 * full-rect Control is the bug this file was written to kill, and it would be a
 * shame to reintroduce it here.
 */
export function touchControlsScript(): string {
  return `extends Control
## Every finger on the screen, owned in one place.
##
## Nothing else in the game reads a touch event. Two nodes reading raw touch is
## how the camera stopped turning: a full-rect Control swallowed every event in
## _gui_input before look.gd's _unhandled_input could see it.

## Analog, so it stays a signal rather than a synthesised action.
signal moved(direction: Vector2)
## Already multiplied by sensitivity. The receiver just turns.
signal look(relative: Vector2)

## Fractions of the shorter side of the screen, never pixels. A 52px button is
## a thumb on a 720p phone and a fingernail on a tablet.
const FIRE_RADIUS := 0.132
const SMALL_RADIUS := 0.078
const STICK_RADIUS := 0.150
const MARGIN := 0.055
## Below this the stick reads as a thumb resting, not a thumb pushing.
const DEAD_ZONE := 0.14
## Push the stick to its edge to sprint. A separate sprint button is a fourth
## thing to hit with a thumb that is already busy, and shoving the stick all the
## way forward is what a player does when they want to go faster anyway.
const SPRINT_AT := 0.92

@export var sensitivity: float = 0.0032
## Actions the buttons press. Each must exist in the Input Map.
@export var buttons: PackedStringArray = PackedStringArray(["fire", "reload", "jump"])
@export var free_look: bool = true
@export var stick: bool = true
## Draws the controls on a desktop too, for looking at them without a phone.
@export var force_visible: bool = false

## Screen position and radius per button, rebuilt on every resize.
var _places: Array[Vector2] = []
var _radii: Array[float] = []
var _stick_radius: float = 90.0

## Finger index -> what that finger is doing. One of "stick", "look", or the
## name of a button action.
var _fingers := {}
var _stick_origin := Vector2.ZERO
var _stick_at := Vector2.ZERO
var _sprinting: bool = false


func _ready() -> void:
	# Never a GUI control: it reads raw events in _input instead. The default
	# filter on a full-rect Control eats every touch in the game.
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	# has_feature("mobile") as well as the touchscreen query, because a device
	# that answers false to both and shows no controls is a game that cannot be
	# played at all.
	visible = force_visible or DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")
	set_process_input(visible)
	get_viewport().size_changed.connect(_layout)
	_layout()


## Positions from the live viewport rather than the design size. The stretch
## mode gives a different logical size on every aspect ratio, so a layout
## computed once at 1152x648 puts the fire button off the edge of the phone it
## is actually running on.
func _layout() -> void:
	var view: Vector2 = get_viewport_rect().size
	# The shorter side, so a button is the same fraction of a thumb whichever
	# way round the phone is held.
	var unit: float = minf(view.x, view.y)
	_stick_radius = unit * STICK_RADIUS

	var big: float = unit * FIRE_RADIUS
	var small: float = unit * SMALL_RADIUS
	var margin: float = unit * MARGIN
	var corner := Vector2(view.x - margin - big, view.y - margin - big)
	var gap: float = big + small + margin * 0.4

	_places.clear()
	_radii.clear()
	for i in buttons.size():
		if i == 0:
			_places.append(corner)
			_radii.append(big)
		elif i == 1:
			# Straight above the primary: reload is the one you hit without
			# looking, so it goes where the thumb already travels.
			_places.append(Vector2(corner.x, corner.y - gap))
			_radii.append(small)
		elif i == 2:
			_places.append(Vector2(corner.x - gap, corner.y))
			_radii.append(small)
		else:
			_places.append(Vector2(corner.x - gap * 0.72, corner.y - gap * 0.72))
			_radii.append(small)
	queue_redraw()


func _input(event: InputEvent) -> void:
	if not visible:
		return
	if event is InputEventScreenTouch:
		_on_touch(event as InputEventScreenTouch)
	elif event is InputEventScreenDrag:
		_on_drag(event as InputEventScreenDrag)


func _on_touch(event: InputEventScreenTouch) -> void:
	var index: int = event.index
	if event.pressed:
		if _fingers.has(index):
			return
		var role: String = _role_at(event.position)
		if role == "":
			return
		_fingers[index] = role
		if role == "stick":
			_stick_origin = event.position
			_stick_at = event.position
		elif role != "look":
			Input.action_press(role)
		get_viewport().set_input_as_handled()
		queue_redraw()
		return

	if not _fingers.has(index):
		return
	var was: String = _fingers[index]
	_fingers.erase(index)
	if was == "stick":
		_release_stick()
	elif was != "look":
		Input.action_release(was)
	get_viewport().set_input_as_handled()
	queue_redraw()


## What a finger that just landed here is for. Decided once, on touch-down, and
## never revised: a thumb that slides off the fire button while shooting is
## still shooting, which is what every player expects and no player says.
func _role_at(at: Vector2) -> String:
	for i in _places.size():
		if at.distance_to(_places[i]) <= _radii[i]:
			return String(buttons[i])
	if stick and at.x < get_viewport_rect().size.x * 0.5 and not _has_role("stick"):
		return "stick"
	if free_look:
		return "look"
	return ""


func _has_role(role: String) -> bool:
	for value in _fingers.values():
		if value == role:
			return true
	return false


func _on_drag(event: InputEventScreenDrag) -> void:
	var index: int = event.index
	if not _fingers.has(index):
		return
	var role: String = _fingers[index]
	if role == "look":
		look.emit(event.relative * sensitivity)
	elif role == "stick":
		_stick_at = event.position
		_push_stick()
	get_viewport().set_input_as_handled()


func _push_stick() -> void:
	var offset: Vector2 = _stick_at - _stick_origin
	var reach: float = offset.length() / _stick_radius
	if reach < DEAD_ZONE:
		moved.emit(Vector2.ZERO)
		_set_sprint(false)
		queue_redraw()
		return
	# Screen-down is +y and forward is -z, which is the same sign the keyboard
	# produces, so the vector passes straight through. Flipping it here is a
	# game where pushing up walks you into the wall behind you.
	moved.emit(offset.normalized() * minf(reach, 1.0))
	_set_sprint(reach >= SPRINT_AT)
	queue_redraw()


func _set_sprint(on: bool) -> void:
	if on == _sprinting:
		return
	_sprinting = on
	if on:
		Input.action_press("sprint")
	else:
		Input.action_release("sprint")


func _release_stick() -> void:
	moved.emit(Vector2.ZERO)
	_set_sprint(false)


func _notification(what: int) -> void:
	# A call arriving while the trigger is held otherwise leaves \`fire\` pressed
	# for the rest of the run, and the player comes back to a gun that will not
	# stop and a magazine that never refills.
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
		release_all()


func release_all() -> void:
	for role in _fingers.values():
		if role != "stick" and role != "look":
			Input.action_release(role)
	_fingers.clear()
	_release_stick()
	queue_redraw()


func _draw() -> void:
	for i in _places.size():
		_draw_button(_places[i], _radii[i], String(buttons[i]).to_upper(), _has_role(String(buttons[i])))

	if not _has_role("stick"):
		return
	# Drawn where the thumb landed, not at a fixed corner. A stick pinned to one
	# spot is a stick your thumb is never already on, and the half-second spent
	# finding it is the half-second the horde closes in.
	draw_circle(_stick_origin, _stick_radius, Color(1, 1, 1, 0.10))
	draw_arc(_stick_origin, _stick_radius, 0.0, TAU, 48, Color(1, 1, 1, 0.22), 2.0, true)
	var offset: Vector2 = (_stick_at - _stick_origin).limit_length(_stick_radius)
	draw_circle(_stick_origin + offset, _stick_radius * 0.38, Color(1, 1, 1, 0.32))


func _draw_button(at: Vector2, radius: float, label: String, held: bool) -> void:
	var fill: Color = Color(1.0, 0.55, 0.2, 0.42) if held else Color(1, 1, 1, 0.13)
	draw_circle(at, radius, fill)
	draw_arc(at, radius, 0.0, TAU, 40, Color(1, 1, 1, 0.34), 2.0, true)
	var font: Font = get_theme_default_font()
	if font == null:
		return
	var size: int = int(maxf(radius * 0.32, 11.0))
	var width: float = font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	draw_string(font, at + Vector2(-width * 0.5, size * 0.36), label, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(1, 1, 1, 0.82))
`;
}

/** The scene node, with its exports set for one genre. */
export function touchControlsNode(spec: TouchSpec, resourceId: string, parent: string): string {
  const list = spec.buttons.map((b) => `"${b}"`).join(', ');
  return `[node name="Touch" type="Control" parent="${parent}"]
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
mouse_filter = 2
script = ExtResource("${resourceId}")
buttons = PackedStringArray(${list})
free_look = ${spec.freeLook}
stick = ${spec.stick}`;
}
