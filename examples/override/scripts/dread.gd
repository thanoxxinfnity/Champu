class_name Dread
extends Node
## The director of the fear: a tension that rises near the creatures, in the water and with the bomb ticking, and falls
## in a quiet room. It darkens and roughens the picture, thickens the room tone, and now and then the building does
## something: the lamps stutter, something heavy moves a long way off.

var game: Game
var tension := 0.0
var events := 0
var _next := 18.0
var _cool := 0.0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.seed = 91


func _target() -> float:
	var p := game.player
	var t := 0.2
	for e in game.enemies:
		if is_instance_valid(e) and e.state != Enemy.S.STUNNED:
			t += clampf(1.0 - e.global_position.distance_to(p.global_position) / 20.0, 0.0, 1.0) * 0.4
			if e.state == Enemy.S.CHASE:
				t += 0.25
	if game.world.current != "" and Dressing.in_water(game.world.current, p.global_position):
		t += 0.15
	if game.s.planted:
		t += 0.3
	if p.hidden:
		t += 0.1
	return clampf(t, 0.0, 1.0)


func update(delta: float) -> void:
	var goal := _target()
	tension = move_toward(tension, goal, delta * (0.35 if goal > tension else 0.12))
	game.ui.set_dread(tension)
	game.sfx.set_dread(tension)
	_cool -= delta
	_next -= delta * (0.6 + tension * 1.2)
	if _next > 0.0 or _cool > 0.0:
		return
	if game.ui.modal_open or game.player.dead or game.s.won:
		_next = 4.0
		return
	_next = _rng.randf_range(14.0, 30.0)
	_fire()


func _fire() -> void:
	events += 1
	_cool = 6.0
	if _rng.randf() < 0.5:
		flicker()
	else:
		distant_sound()


func flicker() -> void:
	var node: Node3D = game.world.loaded.get(game.world.current)
	if node == null:
		return
	game.sfx.play("click", -6.0, 0.7)
	for l in node.find_children("*", "OmniLight3D", true, false):
		var light := l as OmniLight3D
		var base := light.light_energy
		if base <= 0.05:
			continue
		var tw := create_tween()
		for k in range(4):
			tw.tween_property(light, "light_energy", 0.0, 0.04)
			tw.tween_property(light, "light_energy", base * _rng.randf_range(0.3, 1.0), 0.07)
		tw.tween_property(light, "light_energy", 0.0, 0.5)
		tw.tween_property(light, "light_energy", base, 0.12)


func distant_sound() -> void:
	var p := game.player.global_position
	var ang := _rng.randf() * TAU
	var at := p + Vector3(cos(ang), 0.0, sin(ang)) * _rng.randf_range(11.0, 22.0)
	var which: String = ["creak", "mech_step", "crash", "scrape"][_rng.randi() % 4]
	game.sfx.play_at(which, at + Vector3(0, 1.2, 0), -8.0, _rng.randf_range(0.8, 1.1))
	game.player.shake(0.12)
