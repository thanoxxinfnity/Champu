class_name Dread
extends Node
## The director of the fear. It watches how exposed the player is (in the dark, far from a lit room,
## near the creature, low on battery) and turns that into a tension that grows and fades. Tension
## drives the picture and the sound, and sets how often the building does something to the player:
## lights stutter, something walks in the next room, a shape stands at the end of the corridor,
## a word flickers on the glass. None of it can hurt you; all of it means to be believed.

const WHISPERS := ["BEHIND YOU", "SMILE", "HE SEES YOU", "DON'T RUN", "STILL HERE?", "HOLD YOUR BREATH", "NOT ALONE", "LOOK UP"]

var game: Game
var tension := 0.0
var _next := 22.0
var _cool := 0.0
var _decoy: Node3D
var _decoy_t := 0.0
var _gaze := 0.0
var _rng := RandomNumberGenerator.new()
var events := 0          # how many have fired (the tests read it)


func _ready() -> void:
	_rng.seed = 77


## What the player is exposed to right now, 0..1.
func _target() -> float:
	var p := game.player
	var h := game.hollow
	var t := 0.22
	var zone := game.level.zone_at(p.global_position)
	if game.level.is_lit(zone):
		t -= 0.2
	else:
		t += 0.18
	if h.state != Hollow.S.DORMANT:
		t += 0.12
		var d := h.global_position.distance_to(p.global_position)
		t += clampf(1.0 - d / 24.0, 0.0, 1.0) * 0.35
		if h.state == Hollow.S.HUNT:
			t += 0.25
	if p.torch_on and p.battery < 25.0:
		t += 0.1
	if p.hidden:
		t += 0.1
	t += game._progress() * 0.04
	return clampf(t, 0.0, 1.0)


func update(delta: float) -> void:
	tension = move_toward(tension, _target(), delta * (0.35 if _target() > tension else 0.12))
	game.ui.set_dread(tension)
	game.sfx.set_dread(tension)
	_decoy_step(delta)
	_cool -= delta
	_next -= delta * (0.6 + tension * 1.2)
	if _next > 0.0 or _cool > 0.0:
		return
	if game.ui.modal_open or game.player.dead or game.s.won or game.get_tree().paused or game.hollow.state == Hollow.S.HUNT:
		_next = 4.0
		return
	_next = _rng.randf_range(16.0, 34.0)
	_fire()


func _fire() -> void:
	events += 1
	_cool = 6.0
	var pick := _rng.randf()
	if pick < 0.28:
		flicker()
	elif pick < 0.55:
		distant_sound()
	elif pick < 0.75:
		whisper()
	elif _decoy == null and game.hollow.state != Hollow.S.DORMANT:
		peek()
	else:
		flicker()


## The lights nearest the player stutter and die for a breath, then catch again.
func flicker() -> void:
	var zone := game.level.zone_at(game.player.global_position)
	var entries: Array = game.level.lights.get(zone, [])
	if entries.is_empty():
		distant_sound()
		return
	game.sfx.play("click", -6.0, 0.7)
	for e in entries:
		var l: OmniLight3D = e.light
		var base := l.light_energy
		var tw := create_tween()
		for k in range(4):
			tw.tween_property(l, "light_energy", 0.0, 0.04)
			tw.tween_property(l, "light_energy", base * _rng.randf_range(0.3, 1.0), 0.07)
		tw.tween_property(l, "light_energy", 0.0, 0.5)
		tw.tween_property(l, "light_energy", base, 0.12)


## Something moves in the building, out of sight.
func distant_sound() -> void:
	var p := game.player.global_position
	var ang := _rng.randf() * TAU
	var at := p + Vector3(cos(ang), 0.0, sin(ang)) * _rng.randf_range(11.0, 22.0)
	var which: String = ["creak", "hollow_step", "door", "growl", "hammer", "musicbox"][_rng.randi() % 6]
	game.sfx.play_at(which, at + Vector3(0, 1.2, 0), -8.0, _rng.randf_range(0.8, 1.1))
	game.player.scare(0.12)


func whisper() -> void:
	game.ui.whisper(WHISPERS[_rng.randi() % WHISPERS.size()])
	game.sfx.play("creak", -10.0, 0.6)


## A shape at the far end of the corridor. Look at it and it is gone.
func peek() -> void:
	var p := game.player
	var fwd := -p.cam.global_transform.basis.z
	var best := ""
	var best_d := 0.0
	for id in game.level.nodes:
		var n: Dictionary = game.level.nodes[id]
		if game.level.is_lit(n.zone):
			continue
		var to: Vector3 = n.pos - p.global_position
		var d := to.length()
		if d < 11.0 or d > 24.0:
			continue
		if fwd.dot(to.normalized()) < 0.7:
			continue
		if d > best_d and _visible(p.eye_pos(), n.pos + Vector3(0, 1.5, 0)):
			best = id
			best_d = d
	if best == "":
		flicker()
		return
	if game.hollow.global_position.distance_to(game.level.nodes[best].pos) < 8.0:
		return
	_decoy = Rig.make_grin(2.4)
	if _decoy == null:
		return
	game.add_child(_decoy)
	_decoy.global_position = game.level.nodes[best].pos
	_decoy.look_at(Vector3(p.global_position.x, _decoy.global_position.y, p.global_position.z), Vector3.UP, true)
	(_decoy.get_meta("anim") as AnimationPlayer).play("peek")
	_decoy_t = 3.2
	_gaze = 0.0
	game.sfx.play("creak", -4.0, 0.5)


func _visible(from: Vector3, to: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(from, to, Data.L_WORLD)
	return game.get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _decoy_step(delta: float) -> void:
	if _decoy == null:
		return
	_decoy_t -= delta
	var p := game.player
	var to := _decoy.global_position + Vector3(0, 1.6, 0) - p.eye_pos()
	var looking := (-p.cam.global_transform.basis.z).dot(to.normalized()) > 0.95
	_gaze = _gaze + delta if looking else maxf(0.0, _gaze - delta)
	var torch_on_it := looking and p.torch_on and p.battery > 0.0
	if _decoy_t <= 0.0 or _gaze > 1.1 or torch_on_it or to.length() < 7.0:
		if _gaze > 0.2 or torch_on_it:
			game.sfx.play("screech", -12.0, 1.3)
			p.scare(0.3)
		_decoy.queue_free()
		_decoy = null
