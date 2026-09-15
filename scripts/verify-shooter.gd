extends SceneTree
## Loads the generated shooter and checks it is actually a game.

var _ticks := 0
var _scene: Node
var _player: Node
var _director: Node
var _weapon: Node
var _hud: Node
var _fired := false
var _peak_zombies := 0
var _start_health := 0.0
var _killed := false


func _initialize() -> void:
	# Every script on its own first, so a parse error names its own file.
	for path in ["res://player.gd", "res://look.gd", "res://weapon.gd", "res://enemy.gd",
			"res://director.gd", "res://hud.gd", "res://wiring.gd", "res://joystick.gd", "res://audio.gd"]:
		var script := load(path)
		print("script ", path, ": ", "loaded" if script != null else "FAILED")
		if script == null:
			quit(1)
			return

	var packed := load("res://main.tscn") as PackedScene
	if packed == null:
		print("main.tscn: FAILED to load")
		quit(1)
		return
	_scene = packed.instantiate()
	root.add_child(_scene)

	_player = _scene.get_node_or_null("Player")
	_director = _scene.get_node_or_null("Director")
	_weapon = _scene.get_node_or_null("Player/Camera/Weapon")
	_hud = _scene.get_node_or_null("HUD")
	print("Player: ", _player != null, "  Director: ", _director != null,
		"  Weapon: ", _weapon != null, "  HUD: ", _hud != null)
	print("Camera at eye height: ", _scene.get_node_or_null("Player/Camera").position)
	print("Look node: ", _scene.get_node_or_null("Player/Look") != null)
	print("cover pieces: ", _scene.get_node("Arena").get_child_count() - 5, "  walls: 4")
	_start_health = _player.health


func _process(_delta: float) -> bool:
	_ticks += 1

	var zombies := 0
	for child in _scene.get_children():
		if child is CharacterBody3D and child != _player:
			zombies += 1
	_peak_zombies = maxi(_peak_zombies, zombies)

	# Fire once the horde is up, at a zombie rather than at nothing.
	# Every zombie in turn, until one of them is actually in the open.
	#
	# Two earlier versions of this got it wrong in ways that looked like a broken
	# gun: the first shot at whichever zombie came first and hit a crate, which is
	# the cover doing its job; the second teleported one into the open and fired
	# in the same frame, which misses because the physics server still has the
	# body at its old position until the next physics step.
	if _ticks >= 150 and zombies > 0 and not _fired:
		_fired = true
		var camera := _scene.get_node("Player/Camera") as Camera3D
		for child in _scene.get_children():
			if not (child is CharacterBody3D) or child == _player:
				continue
			camera.look_at(child.global_position + Vector3(0, 0.95, 0), Vector3.UP)
			var before: float = child.health
			for i in 8:
				_weapon.fire()
				_weapon._cooldown = 0.0
			if child.health < before:
				print("zombie health ", before, " -> ", child.health, "  (damage lands: true)")
				_killed = true
				break
		if not _killed:
			print("no zombie took a hit — every one of them was behind cover")

	# One zombie dragged to arm's length, so the melee path is exercised without
	# waiting the eleven seconds it takes to walk in from the spawn ring.
	if _ticks == 200:
		for child in _scene.get_children():
			if child is CharacterBody3D and child != _player and child.health > 0.0:
				child.global_position = _player.global_position + Vector3(1.2, 0.0, 0.0)
				print("dragged a zombie to ", child.global_position, " player at ", _player.global_position)
				break

	if _ticks > 400:
		print("")
		print("waves started: ", _director.wave, "  peak zombies: ", _peak_zombies, " of ", _director.first_wave_size, " asked for")
		print("score after kills: ", _director.score)
		print("player took damage: ", _player.health < _start_health, " (", _start_health, " -> ", _player.health, ")")
		# Against the wave the director was actually told to spawn, not a constant:
		# the first mission opens with four, and asserting five made a correct build
		# look broken.
		var wanted: int = _director.first_wave_size
		var ok: bool = _peak_zombies >= wanted and _director.wave >= 1 and _killed and _player.health < _start_health
		print("")
		print("RESULT: ", "PASS" if ok else "FAIL")
		quit(0 if ok else 1)
		return true
	return false
