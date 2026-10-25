class_name Game
extends Node
## Crimson Mist — the conductor. Owns the lobby (pick a survivor), builds Harrow Cove when the chapter starts, and is the one place the other scripts
## talk through (`game.sfx`, `game.fx`, `game.noise()`, `game.shake()` ...). The plot lives in Story.

enum State { LOBBY, PLAYING, PAUSED, DEAD, WON }

var state := State.LOBBY
var world: World
var player: Player
var hud: Hud
var story: Story
var sfx: Sfx
var fx: Fx
var companions: Array[Companion] = []
var selected := 0
var play_time := 0.0
var autostart := false
var _touch := false
var _lobby: Node3D
var _lobby_view: CharacterView
var _lobby_cam: Camera3D
var _lobby_t := 0.0
var _lobby_turn := 0.0
var _stream_t := 0.0
var _kafu_t := 0.0
var _save := {}
var _prev_hold := {}
var _shoot_latch := false


func is_touch() -> bool:
	return _touch


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	randomize()
	_touch = DisplayServer.is_touchscreen_available()
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--autostart":
			autostart = true
		elif args[i].begins_with("--char="):
			selected = maxi(0, Data.CAST_ORDER.find(args[i].substr(7)))
	sfx = Sfx.new()
	sfx.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(sfx)
	fx = Fx.new()
	add_child(fx)
	hud = Hud.new()
	hud.game = self
	add_child(hud)
	hud.screen_pressed.connect(_on_screen)
	_save = Data.load_save()
	if _save.has("char") and Data.CAST_ORDER.has(_save.char) and not args.has("--fresh"):
		selected = Data.CAST_ORDER.find(_save.char)
	_enter_lobby()
	if autostart:
		start_game()


# ── lobby ────────────────────────────────────────────────────────────────────

func _enter_lobby() -> void:
	state = State.LOBBY
	get_tree().paused = false
	_lobby = Node3D.new()
	add_child(_lobby)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.2, 0.24, 0.27)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.58, 0.68)
	env.ambient_light_energy = 0.6
	env.fog_enabled = true
	env.fog_light_color = Color(0.28, 0.33, 0.37)
	env.fog_density = 0.05
	env.glow_enabled = true
	env.glow_intensity = 0.7
	var we := WorldEnvironment.new()
	we.environment = env
	_lobby.add_child(we)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-30, -30, 0)
	key.light_energy = 1.0
	key.light_color = Color(1.0, 0.95, 0.9)
	_lobby.add_child(key)
	var rim := OmniLight3D.new()
	rim.position = Vector3(1.8, 2.4, -2.4)
	rim.light_energy = 2.5
	rim.omni_range = 9.0
	rim.light_color = Color(0.55, 0.75, 1.0)
	_lobby.add_child(rim)
	var pedestal := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.0
	cm.bottom_radius = 1.15
	cm.height = 0.2
	cm.radial_segments = 40
	pedestal.mesh = cm
	pedestal.material_override = Toon.flat(Color(0.3, 0.32, 0.34), 0.012, 0.2)
	pedestal.position.y = -0.1
	_lobby.add_child(pedestal)
	var wall := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(30, 14)
	pm.orientation = PlaneMesh.FACE_Z
	wall.mesh = pm
	wall.material_override = Toon.flat(Color(0.26, 0.3, 0.33), 0.0, 0.5)
	wall.position = Vector3(0, 4, -5)
	_lobby.add_child(wall)
	var fl := MeshInstance3D.new()
	var fm := PlaneMesh.new()
	fm.size = Vector2(30, 30)
	fl.mesh = fm
	fl.material_override = Toon.flat(Color(0.16, 0.18, 0.2), 0.0, 0.6)
	fl.position.y = -0.2
	_lobby.add_child(fl)
	var dust := CPUParticles3D.new()
	dust.amount = 60
	dust.lifetime = 7.0
	dust.preprocess = 7.0
	dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	dust.emission_box_extents = Vector3(4, 2.5, 3)
	dust.direction = Vector3(0.2, 1, 0)
	dust.initial_velocity_min = 0.1
	dust.initial_velocity_max = 0.4
	dust.gravity = Vector3.ZERO
	var sm := SphereMesh.new()
	sm.radius = 0.02
	sm.height = 0.04
	sm.radial_segments = 4
	sm.rings = 2
	var dm := StandardMaterial3D.new()
	dm.albedo_color = Color(0.8, 0.85, 0.9)
	dm.emission_enabled = true
	dm.emission = Color(0.7, 0.78, 0.85)
	dm.emission_energy_multiplier = 2.0
	dm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.material = dm
	dust.mesh = sm
	dust.position = Vector3(0, 1.2, 0)
	_lobby.add_child(dust)
	_lobby_cam = Camera3D.new()
	_lobby.add_child(_lobby_cam)
	_lobby_cam.fov = 32.0
	_lobby_cam.look_at_from_position(Vector3(0, 1.15, 4.3), Vector3(0, 0.95, 0))
	_lobby_cam.make_current()
	_show_selected()
	hud.lobby["can_continue"] = _save.has("mission") and not bool(_save.get("done", false))
	hud.show_lobby()
	hud.set_playing(false)
	sfx.start_ambience()


func _show_selected() -> void:
	if _lobby_view != null:
		_lobby_view.queue_free()
	var id: String = Data.CAST_ORDER[selected]
	_lobby_view = CharacterView.new()
	_lobby.add_child(_lobby_view)
	_lobby_view.setup(id)
	_lobby_view.rotation.y = PI - 0.5
	_lobby_turn = 0.0
	var info: Dictionary = Data.CAST[id]
	hud.lobby = {"name": info.name, "role": info.role, "perk": info.perk, "hp": info.hp, "speed": info.speed, "stamina": info.stamina, "carry": info.carry,
		"index": selected, "count": Data.CAST_ORDER.size(), "model_ok": not _lobby_view.stand_in, "can_continue": hud.lobby.get("can_continue", false)}
	hud.update_lobby()


func lobby_step(dir: int) -> void:
	selected = (selected + dir + Data.CAST_ORDER.size()) % Data.CAST_ORDER.size()
	_show_selected()
	sfx.play("swap", -6.0, 1.2)


func _leave_lobby() -> void:
	if _lobby != null:
		_lobby.queue_free()
		_lobby = null
		_lobby_view = null


# ── starting and ending the chapter ──────────────────────────────────────────

func start_game(continue_save := false) -> void:
	_leave_lobby()
	var id: String = Data.CAST_ORDER[selected]
	world = World.new()
	world.game = self
	add_child(world)
	world.build()
	player = Player.new()
	player.setup(self, id)
	add_child(player)
	player.global_position = world.spots.spawn
	player.yaw = PI
	player.died.connect(_on_player_died)
	player.hurt.connect(func(a: float) -> void: hud.hurt_flash(a))
	hud.set_camera(player.cam)
	story = Story.new()
	story.game = self
	add_child(story)
	play_time = 0.0
	hud.hide_all_screens()
	hud.set_playing(true)
	state = State.PLAYING
	var m := 0
	if continue_save and _save.has("mission"):
		m = int(_save.mission)
		_restore_save()
	story.start(m)
	if continue_save:
		story.checkpoint.pos = player.global_position
	hud.toast("LEFT THUMB MOVE  ·  RIGHT THUMB LOOK" if _touch else "WASD MOVE  ·  DRAG LOOK  ·  J ATTACK  ·  E USE")


func _restore_save() -> void:
	var m := int(_save.mission)
	var pos: Array = _save.get("pos", [])
	if pos.size() == 3:
		player.global_position = Vector3(pos[0], pos[1], pos[2])
	for k in _save.get("picked", []):
		story.picked[String(k)] = true
	var inv: Dictionary = _save.get("inv", {})
	for k in inv:
		player.inventory[k] = int(inv[k])
	player.has_crowbar = bool(_save.get("crowbar", false))
	player.has_pistol = bool(_save.get("pistol", false))
	player.mag = int(_save.get("mag", 0))
	if m >= 2:
		world.power_on()
	if m >= 3:
		world.open_storeroom()
		add_companion(1)
	if m >= 5:
		world.burn_barricade()
		add_companion(2)


func save_progress() -> void:
	if story == null or player == null:
		return
	var d := {"char": player.char_id, "mission": story.mission, "inv": player.inventory, "crowbar": player.has_crowbar, "pistol": player.has_pistol, "mag": player.mag,
		"pos": [player.global_position.x, player.global_position.y, player.global_position.z], "done": story.finished, "picked": story.picked.keys()}
	_save = d
	Data.write_save(d)


func chapter_complete() -> void:
	if state == State.WON:
		return
	state = State.WON
	hud.set_playing(false)
	var secs := int(play_time)
	_save = {"char": player.char_id, "done": true, "best": secs}
	Data.write_save(_save)
	hud.show_win("Harrow Cove is still under the mist.\nNext: Chapter 2 — The Lighthouse.\n\nTIME  %d:%02d      DEFEATED  %d" % [secs / 60, secs % 60, player.kills])


func back_to_lobby() -> void:
	state = State.LOBBY
	get_tree().paused = false
	for n in [world, player, story]:
		if n != null:
			n.queue_free()
	for c in companions:
		if is_instance_valid(c):
			c.queue_free()
	companions.clear()
	for e in get_tree().get_nodes_in_group("enemies"):
		e.queue_free()
	for f in get_tree().get_nodes_in_group("flares"):
		f.queue_free()
	for it in get_tree().get_nodes_in_group("none"):
		it.queue_free()
	if story != null:
		story.queue_free()
	world = null
	player = null
	story = null
	_save = Data.load_save()
	hud.boss_hide()
	hud.set_marker(Vector3.ZERO, false)
	await get_tree().process_frame
	_enter_lobby()


func _on_player_died() -> void:
	state = State.DEAD
	for b in ["attack", "shoot", "dodge"]:
		hud.held[b] = false
	get_tree().create_timer(2.0).timeout.connect(func() -> void:
		if state == State.DEAD:
			hud.show_death())


func retry() -> void:
	hud.hide_all_screens()
	state = State.PLAYING
	story.restart_mission()


func set_paused(on: bool) -> void:
	if state != State.PLAYING and state != State.PAUSED:
		return
	get_tree().paused = on
	state = State.PAUSED if on else State.PLAYING
	hud.show_pause(on)


func _on_screen(id: String) -> void:
	sfx.play("swap", -6.0)
	match id:
		"prev": lobby_step(-1)
		"next": lobby_step(1)
		"start": start_game(false)
		"continue": start_game(true)
		"resume": set_paused(false)
		"bag": hud.show_craft(true)
		"lobby": back_to_lobby()
		"retry": retry()
		"close":
			if state == State.PAUSED:
				hud.show_pause(true)
			else:
				hud.hide_all_screens()
		_:
			if id.begins_with("craft_"):
				story.craft(id.substr(6))
				hud.show_craft(true)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		if state == State.PLAYING:
			set_paused(true)


# ── services ─────────────────────────────────────────────────────────────────

func spawn_enemy(kind: String, pos: Vector3, zone := "") -> Enemy:
	var e := Enemy.new()
	e.setup(self, kind, pos, zone)
	add_child(e)
	e.died.connect(_on_enemy_died)
	return e


func _on_enemy_died(e: Enemy) -> void:
	if story != null:
		story.on_kill(e)
	if not e.boss and randf() < 0.18 and e.kind != "bloater":
		var it := story._make("loot", "bandage" if randf() < 0.35 else "ammo", "Search body", e.global_position + Vector3(0, 0.3, 0), true, 1.8)
		it.count = 1 if it.value == "bandage" else 3


func clear_enemies() -> void:
	for e in get_tree().get_nodes_in_group("enemies"):
		e.queue_free()
	for f in get_tree().get_nodes_in_group("flares"):
		f.queue_free()


func add_companion(slot: int) -> void:
	var id := Data.ally_id(player.char_id, slot)
	if id == "":
		return
	for c in companions:
		if c.slot == slot:
			return
	var c := Companion.new()
	c.setup(self, id, slot)
	add_child(c)
	c.global_position = player.global_position + Vector3(2.0 * (1 if slot == 1 else -1), 0, 1.5)
	companions.append(c)


func noise(pos: Vector3, radius: float) -> void:
	for e in get_tree().get_nodes_in_group("enemies"):
		(e as Enemy).hear(pos, radius)


func shake(a: float) -> void:
	if player != null:
		player.shake(a)


func toll(boss: Enemy) -> void:
	sfx.play("bell", 3.0, 0.8)
	shake(0.8)
	var s := Shockwave.new()
	s.game = self
	add_child(s)
	s.global_position = boss.global_position
	noise(boss.global_position, 60.0)
	if boss.phase2:
		for i in 1:
			spawn_enemy("crawler", boss.global_position + Vector3(randf_range(-9, 9), 0, randf_range(2, 10)), "arena").wake()


func on_boss_phase2(_e: Enemy) -> void:
	story.boss_phase2()


func player_hidden() -> bool:
	return false


func player_looking_at(pos: Vector3) -> bool:
	if player == null or player.cam == null:
		return false
	var to := pos - player.cam.global_position
	if to.length() < 0.5:
		return true
	if player.camera_forward().angle_to(to) > deg_to_rad(38.0):
		return false
	var q := PhysicsRayQueryParameters3D.create(player.cam.global_position, pos, Data.L_WORLD)
	return player.get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func nearest_enemy_to(pos: Vector3, max_dist: float) -> Enemy:
	var best: Enemy = null
	var bd := max_dist
	for e in get_tree().get_nodes_in_group("enemies"):
		var en := e as Enemy
		if en.is_dead():
			continue
		var d := en.global_position.distance_to(pos)
		if d < bd:
			bd = d
			best = en
	return best


func nearest_interactable() -> Interactable:
	if story == null or player == null or player.dead:
		return null
	var best: Interactable = null
	var bd := 1e9
	for it in story.interactables:
		if not is_instance_valid(it) or not it.usable():
			continue
		var d := it.global_position.distance_to(player.global_position)
		d = Vector2(it.global_position.x - player.global_position.x, it.global_position.z - player.global_position.z).length()
		if d < it.radius and d < bd:
			bd = d
			best = it
	return best


func interact() -> void:
	var it := nearest_interactable()
	if it != null:
		story.on_interact(it)


# ── frame loop ───────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	hud.update_frame(player, delta)
	if state == State.LOBBY:
		_lobby_tick(delta)
		return
	if state != State.PLAYING:
		return
	play_time += delta
	world.update(delta, player.global_position)
	_stream_t -= delta
	if _stream_t <= 0.0:
		_stream_t = 0.3
		world.update_streaming(player.global_position)
	if player.char_id == "kafu":
		_kafu_t -= delta
		if _kafu_t <= 0.0:
			_kafu_t = 1.2
			for e in get_tree().get_nodes_in_group("enemies"):
				if (e as Enemy).global_position.distance_to(player.global_position) < 18.0:
					(e as Enemy).marked = maxf((e as Enemy).marked, 2.5)
	if not hud.is_modal():
		_gather_input(delta)
	story.tick(delta)
	hud.set_marker(story.marker, story.has_marker)


func _lobby_tick(delta: float) -> void:
	_lobby_t += delta
	if _lobby_view != null:
		_lobby_view.rotation.y = PI - 0.5 + sin(_lobby_t * 0.5) * 0.35
	# keyboard in the lobby
	if Input.is_action_just_pressed("ui_left") or Input.is_physical_key_pressed(KEY_A) and _key_edge("lobby_a"):
		lobby_step(-1)
	elif Input.is_action_just_pressed("ui_right") or Input.is_physical_key_pressed(KEY_D) and _key_edge("lobby_d"):
		lobby_step(1)
	elif Input.is_action_just_pressed("ui_accept"):
		start_game(false)


func _key_edge(id: String) -> bool:
	var now := Time.get_ticks_msec()
	if now - int(_prev_hold.get(id, 0)) > 250:
		_prev_hold[id] = now
		return true
	return false


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and (event as InputEventKey).pressed and not (event as InputEventKey).echo:
		var k := (event as InputEventKey).physical_keycode
		if k == KEY_ESCAPE and (state == State.PLAYING or state == State.PAUSED):
			set_paused(state == State.PLAYING)
		elif state == State.PLAYING and not hud.is_modal():
			match k:
				KEY_R: player.reload()
				KEY_F: player.toggle_torch()
				KEY_E: interact()
				KEY_Q: player.try_flare()
				KEY_H: player.use_bandage()
				KEY_C: hud.show_craft(true)
				KEY_SPACE: player.try_roll()
				KEY_J: player.try_attack()
				KEY_K: player.try_shoot()


func _gather_input(delta: float) -> void:
	var kb := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		kb.y -= 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		kb.y += 1.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		kb.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		kb.x += 1.0
	player.move_input = (hud.move + kb.limit_length(1.0)).limit_length(1.0)
	player.sprint = bool(hud.held.get("sprint", false)) or Input.is_physical_key_pressed(KEY_SHIFT)
	if hud.look != Vector2.ZERO:
		player.look(hud.look * 0.0042)
		hud.look = Vector2.ZERO
	if hud.consume("attack"):
		player.try_attack()
	if bool(hud.held.get("attack", false)):
		player.try_attack()
	if hud.consume("dodge"):
		player.try_roll()
	if bool(hud.held.get("shoot", false)):
		player.try_shoot()
	if hud.consume("use"):
		interact()
	if hud.consume("flare"):
		player.try_flare()
	if hud.consume("bandage"):
		player.use_bandage()
	if hud.consume("reload"):
		player.reload()
	if hud.consume("light"):
		player.toggle_torch()
	if hud.consume("bag"):
		hud.show_craft(true)
	if hud.consume("pause"):
		set_paused(true)
	if Input.is_physical_key_pressed(KEY_BRACKETLEFT):
		player.look(Vector2(-6, 0))
	if Input.is_physical_key_pressed(KEY_BRACKETRIGHT):
		player.look(Vector2(6, 0))
