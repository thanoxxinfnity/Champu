class_name Game
extends Node
## Chomu Dead — the conductor. Builds the town, owns the player and the HUD, and
## is the one place the other scripts talk through (`game.sfx`, `game.fx`,
## `game.noise()`, `game.explode()` ...). Rules of the plot live in Story.

enum State { TITLE, PLAYING, PAUSED, DEAD, WON }

var state := State.TITLE
var world: World
var player: Player
var hud: Hud
var story: Story
var sfx: Sfx
var fx: Fx
var score := 0
var play_time := 0.0
var _touch := false
var is_touch: bool:
	get:
		return _touch
var _autostart := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	randomize()
	_touch = DisplayServer.is_touchscreen_available()
	for a in OS.get_cmdline_user_args():
		if a == "--autostart":
			_autostart = true

	sfx = Sfx.new()
	sfx.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(sfx)

	world = World.new()
	world.game = self
	add_child(world)
	fx = Fx.new()
	add_child(fx)
	world.build()

	player = Player.new()
	player.game = self
	player.position = Vector3(-11, 0, -80)
	player.yaw = PI
	add_child(player)
	player.died.connect(_on_player_died)

	hud = Hud.new()
	hud.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(hud)
	hud.set_camera(player.cam)
	hud.start_pressed.connect(begin)
	hud.retry_pressed.connect(retry)
	hud.restart_pressed.connect(restart)
	hud.resume_pressed.connect(func() -> void: set_paused(false))
	hud.pause_pressed.connect(func() -> void: set_paused(not get_tree().paused))
	hud.reload_pressed.connect(player.reload)
	hud.swap_pressed.connect(func() -> void: player.cycle_weapon(1))
	hud.torch_pressed.connect(player.toggle_torch)

	story = Story.new()
	story.game = self
	add_child(story)

	hud.show_title()
	if _autostart:
		begin()


func begin() -> void:
	hud.hide_all_screens()
	hud.set_playing(true)
	state = State.PLAYING
	if not _touch:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	sfx.start_ambience()
	story.spawn_notes()
	story.start(0)
	hud.toast("LEFT STICK MOVE  ·  RIGHT THUMB LOOK" if _touch else "WASD MOVE  ·  MOUSE LOOK  ·  CLICK FIRE  ·  R RELOAD  ·  F LIGHT")


func set_paused(on: bool) -> void:
	if state != State.PLAYING and state != State.PAUSED:
		return
	get_tree().paused = on
	state = State.PAUSED if on else State.PLAYING
	hud.show_pause(on)
	if not _touch:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if on else Input.MOUSE_MODE_CAPTURED


func retry() -> void:
	hud.hide_death()
	state = State.PLAYING
	story.restart_chapter()
	if not _touch:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func restart() -> void:
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().reload_current_scene()


func win() -> void:
	state = State.WON
	sfx.chopper(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.set_playing(false)
	var secs := int(play_time)
	hud.show_win("Rohan and Doctor Iyer lift off over the burning town.\n\nGHOULS KILLED  %d      SCORE  %d      TIME  %d:%02d" % [player.kills, score, secs / 60, secs % 60])


func _on_player_died() -> void:
	state = State.DEAD
	hud.fire = false
	player.fire_held = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().create_timer(1.6).timeout.connect(func() -> void:
		if state == State.DEAD:
			hud.show_death())


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		if state == State.PLAYING:
			set_paused(true)


func _process(delta: float) -> void:
	hud.update_frame(player, delta)
	if state != State.PLAYING:
		return
	play_time += delta
	_gather_input(delta)
	story.tick(delta)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo:
		var k := (event as InputEventKey).physical_keycode
		if k == KEY_ESCAPE and (state == State.PLAYING or state == State.PAUSED):
			set_paused(state == State.PLAYING)
		elif state == State.PLAYING:
			match k:
				KEY_R: player.reload()
				KEY_F: player.toggle_torch()
				KEY_Q: player.cycle_weapon(-1)
				KEY_E: player.cycle_weapon(1)
				KEY_1, KEY_2, KEY_3, KEY_4:
					var i := int(k - KEY_1)
					if i < Data.WEAPON_ORDER.size():
						player.equip(Data.WEAPON_ORDER[i])
	elif event is InputEventMouseButton and state == State.PLAYING:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			player.cycle_weapon(1)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			player.cycle_weapon(-1)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not _touch:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _gather_input(delta: float) -> void:
	# Keyboard and mouse add to whatever the touch HUD reports.
	var kb := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		kb.y -= 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		kb.y += 1.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		kb.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		kb.x += 1.0
	var mv := hud.move + kb.limit_length(1.0)
	player.move_input = mv.limit_length(1.0)
	player.sprint = hud.sprint or Input.is_physical_key_pressed(KEY_SHIFT)
	var firing := hud.fire or (Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))
	# Semi-automatic guns fire once per press; the trigger must be released and pulled again.
	if firing:
		if not player.fire_held and (_was_firing == false or Data.WEAPONS[player.cur].auto):
			player.fire_held = true
		elif Data.WEAPONS[player.cur].auto:
			player.fire_held = true
	else:
		player.fire_held = false
	_was_firing = firing
	# Look: touch drag, drained here.
	if hud.look != Vector2.ZERO:
		player.look(hud.look * 0.0046)
		hud.look = Vector2.ZERO


var _was_firing := false


# ── services for the rest of the game ────────────────────────────────────────

func spawn_enemy(kind: String, pos: Vector3) -> Zombie:
	var z := Zombie.new()
	z.setup(self, kind, pos)
	add_child(z)
	z.died.connect(_on_zombie_died)
	return z


func _on_zombie_died(z: Zombie) -> void:
	story.on_kill(z)


func spawn_pickup(kind: String, value: String, pos: Vector3) -> Pickup:
	var pk := Pickup.new()
	pk.setup(self, kind, value, pos)
	if kind != "note":
		pk.add_to_group("chapter_pickups")
	add_child(pk)
	return pk


func collect(pk: Pickup) -> void:
	match pk.kind:
		"medkit":
			player.heal(45.0)
			hud.toast("+ HEALTH")
			sfx.play("pickup")
		"ammo":
			player.add_ammo(0.5)
			hud.toast("+ AMMO")
			sfx.play("pickup")
		"weapon":
			var had := player.weapons.has(pk.value)
			player.give_weapon(pk.value)
			hud.toast(("+ AMMO  " if had else "NEW WEAPON  ") + String(Data.WEAPONS[pk.value].name))
			sfx.play("pickup")
			if pk.value == "pistol" and not had:
				hud.say([["ROHAN", "A pistol. Still warm. Somebody was using it a minute ago."]])
				_pistol_ambush()
		"cutters":
			sfx.play("pickup")
		"note":
			hud.read_note(pk.value)
			sfx.play("note")
	story.on_collect(pk)


## Picking up the first gun in the ward is what wakes the thing in the corner.
func _pistol_ambush() -> void:
	sfx.play("groan3", -2.0, 0.8)
	var z := spawn_enemy("walker", Vector3(-13, 0, -84))
	z.alerted = true
	var z2 := spawn_enemy("nurse", Vector3(-3, 0, -74))
	z2.alerted = true


func noise(pos: Vector3, radius: float) -> void:
	for e in get_tree().get_nodes_in_group("enemies"):
		(e as Zombie).hear(pos, radius)


func explode(pos: Vector3, radius: float, damage: float, hurt_zombies := true) -> void:
	fx.explosion(pos, radius)
	sfx.play_at("boom", pos, 4.0)
	noise(pos, 50.0)
	var dp := player.global_position.distance_to(pos)
	if dp < radius:
		player.take_damage(damage * (1.0 - dp / radius * 0.6), pos)
	if hurt_zombies:
		for e in get_tree().get_nodes_in_group("enemies"):
			var z := e as Zombie
			var d := z.global_position.distance_to(pos)
			if d < radius:
				z.take_damage(damage * 3.0 * (1.0 - d / radius), z.chest(), (z.global_position - pos).normalized(), false)


func loot_from(z: Zombie) -> void:
	var r := randf()
	if z.boss:
		return
	if r < 0.2:
		spawn_pickup("ammo", "", z.global_position + Vector3(0, 0, 0))
	elif r < 0.28:
		spawn_pickup("medkit", "", z.global_position)


func boss_phase2(z: Zombie) -> void:
	story.boss_phase2(z)
