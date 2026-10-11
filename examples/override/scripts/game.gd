class_name Game
extends Node3D
## Project OVERRIDE. The state of the game, what everything in the world does when it is used, the four chapters
## and the way from one to the next, crafting, and what happens when the player is hurt.

class State:
	var chapter := 1
	var inv: Array = []              # item ids carried (25 slots)
	var taken := {}                  # pick-up id -> true
	var dropped: Array = []          # things the player put down: {id, item, room, x, y, z}
	var drop_n := 0
	var unlocked := {}               # door key -> true
	var sprung := {}                 # debris trap id -> true
	var fuses_in := 0
	var cable_in := false
	var levers: Array = []
	var gen_on := false
	var planted := false
	var countdown := 0.0
	var read := {}                   # paper id -> true
	var deaths := 0
	var started := false
	var won := false
	var seconds := 0.0

const SAVE := "user://override.json"
const BOMB_TIME := 180.0
static var autostart := false

var s := State.new()
var world: World
var player: Player
var ui: Ui
var sfx: Sfx
var dread: Dread
var env: Environment
var enemies: Array[Enemy] = []
var warden: Enemy
var headless_test := false
var hid_spots: Array = []            # where the player has hidden (newest first): the creatures remember
var last_throw_from := Vector3.ZERO
var enemies_off := false           # a test can switch the creatures off to check the rest of the game on its own
var playing := false
var _lamps_flicker := 0.0
var _fade: ColorRect


func _ready() -> void:
	sfx = Sfx.new()
	add_child(sfx)
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.004, 0.006, 0.01)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.1, 0.12, 0.16)
	env.ambient_light_energy = 0.5
	# The renderer for phones has no volumetric fog: this is its stand-in, dense and dark, with light cones and dust in the rooms.
	env.fog_enabled = true
	env.fog_light_color = Color(0.03, 0.02, 0.03)
	env.fog_density = 0.04
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.1
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	world = World.new()
	world.name = "World"
	world.game = self
	add_child(world)

	player = Player.new()
	player.name = "Player"
	player.game = self
	add_child(player)
	player.died.connect(_on_died)
	player.hurt_taken.connect(func(h: int): ui.set_health(h))

	dread = Dread.new()
	dread.game = self
	dread.name = "Dread"
	add_child(dread)

	ui = Ui.new()
	ui.name = "Ui"
	ui.game = self
	add_child(ui)
	ui.start_pressed.connect(func(): start_new())
	ui.continue_pressed.connect(func(): continue_game())
	ui.retry_pressed.connect(respawn)
	ui.restart_pressed.connect(func(): start_new())

	_fade = ColorRect.new()
	_fade.color = Color.BLACK
	_fade.modulate.a = 0.0
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var fl := CanvasLayer.new()
	fl.layer = 20
	add_child(fl)
	fl.add_child(_fade)
	_fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	player.frozen = true
	ui.show_title(FileAccess.file_exists(SAVE))
	sfx.start_ambience()
	# The first room is built behind the title so the first frame of play is not a hitch.
	world.start_at(Rooms.CHAPTERS[1].room)
	player.global_position = Rooms.CHAPTERS[1].spawn
	if autostart:
		autostart = false
		call_deferred("_begin")


# ── flow ─────────────────────────────────────────────────────────────────────

func start_new() -> void:
	if FileAccess.file_exists(SAVE):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE))
	autostart = true
	Engine.time_scale = 1.0
	get_tree().paused = false
	get_tree().reload_current_scene()


func continue_game() -> void:
	_load()
	_begin()


func _begin() -> void:
	playing = true
	s.started = true
	ui.hide_all_screens()
	_enter_chapter(s.chapter, false)
	ui.set_playing(true)


func _enter_chapter(ch: int, fade := true) -> void:
	if fade and not headless_test:
		var tw := create_tween()
		tw.tween_property(_fade, "modulate:a", 1.0, 0.6)
		await tw.finished
	s.chapter = ch
	player.frozen = false
	var def: Dictionary = Rooms.CHAPTERS[ch]
	for e in enemies.duplicate():
		e.queue_free()
	enemies.clear()
	warden = null
	for id in world.loaded.keys():
		world._unload(id)
	world.current = ""
	player.respawn(def.spawn, def.yaw)
	world.start_at(def.room)
	if ch >= 3:
		_spawn_warden(ch)
	_save()
	if fade and not headless_test:
		var tw2 := create_tween()
		tw2.tween_property(_fade, "modulate:a", 0.0, 0.8)


func respawn() -> void:
	ui.hide_all_screens()
	ui.set_playing(true)
	s.levers.clear()
	if s.planted:
		s.countdown = BOMB_TIME
	_enter_chapter(s.chapter, false)
	if s.planted:
		# The bomb is set: you come back at the reactor, not at the start of the chapter.
		player.respawn(Vector3(331, 0, 9.5), 180.0)
		world.start_at("c4_reactor")


func _on_died() -> void:
	s.deaths += 1
	sfx.play("jump", 2.0)
	player.shake(1.0)
	ui.flash_red()
	await get_tree().create_timer(1.6).timeout
	if player.dead:
		ui.show_death()


func _spawn_warden(ch: int) -> void:
	var w := Enemy.new()
	w.kind = "warden"
	w.game = self
	w.name = "Warden"
	w.rage = 1.0 if ch == 3 else 1.3
	if ch == 3:
		w.position = Vector3(214, 0, 8)
		w.patrol = [Vector3(206, 0, 3), Vector3(224, 0, 6), Vector3(214, 0, 14), Vector3(206, 0, 11), Vector3(222, 0, 13), Vector3(235, 0, 7)]
	else:
		w.position = Vector3(335, 0, 5)
		w.patrol = [Vector3(326, 0, 2), Vector3(336, 0, 9), Vector3(331, 0, 15), Vector3(312, 0, 5), Vector3(326, 0, 9)]
	add_child(w)
	enemies.append(w)
	warden = w


func paused_world() -> bool:
	return Engine.time_scale == 0.0 or ui == null or ui.modal_open or not playing or player.frozen and not player.dead


func _process(delta: float) -> void:
	if not playing:
		return
	if not s.won and Engine.time_scale > 0.0:
		s.seconds += delta
	world.focus_if_needed(player.global_position)
	dread.update(delta)
	_water(delta)
	_belts()
	if s.planted and not s.won and not player.dead:
		s.countdown -= delta
		ui.set_countdown(clampf(s.countdown / BOMB_TIME, 0.0, 1.0))
		var beat := fmod(s.countdown, 1.0 if s.countdown > 30.0 else 0.5)
		if beat < delta:
			sfx.play("beep", -6.0 if s.countdown > 30.0 else -2.0, 1.0 if s.countdown > 30.0 else 1.5)
		if s.countdown <= 0.0:
			_explode()
	var near := 0.0
	for e in enemies:
		if is_instance_valid(e) and e.state != Enemy.S.STUNNED:
			near = maxf(near, 1.0 - e.global_position.distance_to(player.global_position) / 14.0)
	sfx.heart_rate = lerpf(0.0, 2.4, clampf(maxf(near, 0.9 if player.health <= 1 else 0.0), 0.0, 1.0)) if (near > 0.15 or player.health <= 1) else 0.0
	ui.set_focus(player.focus != null and not player.dead and not ui.modal_open and not player.hidden)
	ui.set_emp(player.has_emp, player.emp_charges)


var _wet_t := 0.0


## The current in the flooded rooms: until the generator runs, standing in water hurts.
func _water(delta: float) -> void:
	if s.gen_on or player.dead or player.hidden:
		_wet_t = 0.0
		return
	if world.current != "" and Dressing.in_water(world.current, player.global_position):
		_wet_t += delta
		if _wet_t >= 0.9:
			_wet_t = 0.0
			sfx.play("zap", -2.0)
			sparks_at(player.global_position + Vector3(0, 0.2, 0))
			hurt_player(1, player.global_position)
	else:
		_wet_t = 0.0


func _belts() -> void:
	player.push = Vector3.ZERO
	if world.current != "c3_floor" or player.dead:
		return
	var p := player.global_position
	for b in Dressing.BELTS:
		if p.x >= b[0] and p.x <= b[1] and p.z >= b[2] - 0.5 and p.z <= b[3] + 0.5 and p.y < 1.4:
			player.push = Vector3(b[4], 0.0, 0.0)


## The scrap's flight: a short arc, then the clang (the noise is made at the moment it lands).
func scrap_flies(from: Vector3, to: Vector3) -> void:
	last_throw_from = player.global_position
	var t_fly := clampf(from.distance_to(to) / 22.0, 0.2, 0.8)
	var lump := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.14, 0.09, 0.1)
	lump.mesh = bm
	lump.material_override = Assets.mat(Color(0.6, 0.62, 0.68), 0.5, 0.8)
	add_child(lump)
	lump.global_position = from
	var land := func() -> void:
		if is_instance_valid(lump):
			lump.queue_free()
		noise(to, Player.NOISE_CLANG, "clang")
		sfx.play_at("clang", to + Vector3(0, 0.2, 0), 2.0)
		sparks_at(to + Vector3(0, 0.15, 0))
	if headless_test:
		land.call()
		return
	var fly := func(k: float) -> void:
		if is_instance_valid(lump):
			lump.global_position = from.lerp(to, k) + Vector3(0, sin(k * PI) * 0.9, 0)
			lump.rotation += Vector3(0.3, 0.2, 0.1)
	var tw := create_tween()
	tw.tween_method(fly, 0.0, 1.0, t_fly)
	tw.tween_callback(land)


func remember_hide(spot: Vector3) -> void:
	for i in range(hid_spots.size() - 1, -1, -1):
		if (hid_spots[i] as Vector3).distance_to(spot) < 0.5:
			hid_spots.remove_at(i)
	hid_spots.push_front(spot)
	if hid_spots.size() > 4:
		hid_spots.pop_back()


func noise(pos: Vector3, radius: float, what: String) -> void:
	for e in enemies:
		if is_instance_valid(e):
			e.hear(pos, radius, what)


func door_entered(d: Dictionary) -> void:
	# The player stands in a doorway: the room on the side they are walking towards becomes the one that matters.
	# (Both rooms build a trigger for the same doorway, so this must give the same answer whichever one fires.)
	var p := player.global_position
	var centre := float(d.at) + 0.5
	var along := p.x - centre if d.axis == "x" else p.z - centre
	var heading := player.velocity.x if d.axis == "x" else player.velocity.z
	var toward_b: bool = heading > 0.2 or (absf(heading) <= 0.2 and along >= 0.0)
	world.focus(d.b if toward_b else d.a)


func room_built(id: String, node: Node3D) -> void:
	var l := node.find_children("*", "OmniLight3D", true, false)
	if l.size() > 0 and s.chapter == 1 and s.unlocked.has("lift1") and id == "c1_hall":
		for light in l:
			(light as OmniLight3D).light_color = Color(0.85, 0.95, 1.0)


func room_freed(_id: String) -> void:
	pass


# ── what things do ───────────────────────────────────────────────────────────

func read_paper(_u: Use, paper: String) -> void:
	sfx.play("note", -4.0)
	s.read[paper] = true
	ui.show_paper(Data.PAPERS[paper].title, Data.PAPERS[paper].body)


func pick_up(u: Use, id: String, holder: Node3D) -> void:
	var item := id.split("_")[0]
	if id.begins_with("drop_"):
		item = "_".join(id.split("_").slice(2))     # drop_<n>_<item>, and an item's own name may hold an underscore
	if id == "emp":
		player.equip_emp()
		player.emp_charges = maxi(player.emp_charges, 3)
	elif id.begins_with("cell_"):
		player.emp_charges = mini(6, player.emp_charges + 2)
	else:
		if s.inv.size() >= Data.PACK_SLOTS:
			sfx.play("error", -6.0)
			return
		s.inv.append(item)
	sfx.play("pickup", -2.0)
	noise(player.global_position, 2.5, "pickup")
	s.taken[id] = true
	for i in range(s.dropped.size() - 1, -1, -1):
		if s.dropped[i].id == id:
			s.dropped.remove_at(i)
	world.uses.erase(u)
	holder.queue_free()
	u.queue_free()
	_save()


## The radius a footstep carries in water (the test reads it).
func noise_radius_in_water() -> float:
	return maxf(4.2 * 2.2, 9.0)


## Put the item in `slot` down on the floor in front of the player. It stays there (through room streaming and saves)
## until it is picked up again, and it makes a small noise.
func drop_item(slot: int) -> bool:
	if player == null or player.dead or player.hidden or world.current == "" or slot < 0 or slot >= s.inv.size():
		return false
	var item: String = s.inv[slot]
	var pos := _drop_spot()
	s.inv.remove_at(slot)
	s.drop_n += 1
	var rec := {"id": "drop_%d_%s" % [s.drop_n, item], "item": item, "room": world.current, "x": pos.x, "y": pos.y, "z": pos.z}
	s.dropped.append(rec)
	Dressing.spawn_dropped(world, world.loaded[world.current], rec)
	sfx.play("toss", -2.0)
	noise(player.global_position, 3.0, "drop")
	_save()
	return true


## About a metre in front of the feet, stopped short by a wall, down on the floor.
func _drop_spot() -> Vector3:
	var space := player.get_world_3d().direct_space_state
	var from := player.global_position + Vector3(0, 1.0, 0)
	var fwd := -player.global_transform.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(from, from + fwd * 1.6, Data.L_WORLD))
	var at := from + fwd * 1.3 if hit.is_empty() else (hit.position as Vector3) - fwd * 0.4
	var down := space.intersect_ray(PhysicsRayQueryParameters3D.create(at, at + Vector3(0, -3.0, 0), Data.L_WORLD))
	return Vector3(at.x, (down.position as Vector3).y if not down.is_empty() else player.global_position.y, at.z)


func has_item(item: String) -> bool:
	return item in s.inv


func take_item(item: String) -> bool:
	var i := s.inv.find(item)
	if i < 0:
		return false
	s.inv.remove_at(i)
	return true


func craft(a: int, b: int) -> bool:
	if a == b or a >= s.inv.size() or b >= s.inv.size():
		return false
	var out := Data.recipe(s.inv[a], s.inv[b])
	if out == "":
		sfx.play("error", -6.0)
		return false
	var hi := maxi(a, b)
	var lo := mini(a, b)
	s.inv.remove_at(hi)
	s.inv.remove_at(lo)
	s.inv.append(out)
	sfx.play("win", -6.0)
	_save()
	return true


func fusebox(_u: Use) -> void:
	if s.unlocked.has("lift1"):
		return
	if not s.cable_in:
		if take_item("cable"):
			s.cable_in = true
			sfx.play("click", -2.0)
		else:
			sfx.play("error", -6.0)
		return
	if take_item("fuse"):
		s.fuses_in += 1
		sfx.play("click", -2.0)
		sfx.play("zap", -8.0)
		if s.fuses_in >= 3:
			world.unlock("lift1")
			sfx.play("poweron", -2.0)
			for light in world.loaded["c1_hall"].find_children("*", "OmniLight3D", true, false):
				(light as OmniLight3D).light_color = Color(0.85, 0.95, 1.0)
		_save()
	else:
		sfx.play("error", -6.0)


func lever(_u: Use, color: String) -> void:
	if s.gen_on:
		return
	sfx.play("click", -2.0)
	s.levers.append(color)
	if s.levers.size() >= 3:
		var order := s.levers.duplicate()
		s.levers.clear()
		if order == Data.lever_solutions()[0]:
			s.gen_on = true
			world.unlock("lift2")
			sfx.play("poweron", -2.0)
			sfx.play("launch", -6.0)
			_save()
		else:
			# The wrong order trips the breakers with a bang that carries.
			sfx.play("error", -2.0)
			sfx.play("zap", -2.0)
			sparks_at(player.global_position + player.aim_dir() * 1.2 + Vector3(0, 1.0, 0))
			noise(player.global_position, 18.0, "bang")


func door_panel(_u: Use, key: String) -> void:
	if s.unlocked.has(key):
		return
	if take_item("keycard"):
		world.unlock(key)
		sfx.play("win", -4.0)
		_save()
	else:
		sfx.play("error", -6.0)


func office_switch(_u: Use) -> void:
	if s.unlocked.has("office"):
		return
	world.unlock("office")
	sfx.play("click", -2.0)
	sfx.play("door", -2.0)
	noise(player.global_position, 8.0, "switch")


func plant_bomb(_u: Use) -> void:
	if s.planted:
		return
	if not take_item("mega_bomb"):
		sfx.play("error", -6.0)
		return
	s.planted = true
	s.countdown = BOMB_TIME
	world.unlock("exit")
	sfx.play("launch", 0.0)
	sfx.play("beep", -2.0)
	if warden != null and is_instance_valid(warden):
		warden.rage = 1.5
		warden.hear(player.global_position, 60.0, "bang")
	for e in enemies:
		if is_instance_valid(e):
			e.hear(player.global_position, 40.0, "alarm")
	# Every lamp on the level goes to alarm red.
	for id in world.loaded:
		for light in world.loaded[id].find_children("*", "OmniLight3D", true, false):
			(light as OmniLight3D).light_color = Color(1.0, 0.1, 0.05)
	_save()


func lift_button(_u: Use, key: int) -> void:
	if key >= 4:
		if not s.planted:
			sfx.play("error", -6.0)
			return
		_win()
		return
	sfx.play("beep", -2.0)
	sfx.play("launch", -4.0)
	_enter_chapter(key + 1)


func hide_in(u: Use) -> void:
	player.enter_hide(u)
	sfx.play("locker", -2.0)
	# Seen going in: it comes for the locker. Otherwise it only heard you stop.
	for e in enemies:
		if is_instance_valid(e) and e.state == Enemy.S.CHASE and e.global_position.distance_to(player.global_position) < 12.0 and e._can_see_from(player):
			e.drag_from(u)


func pull_from_hide(e: Enemy) -> void:
	if player.hidden:
		player.exit_hide()
	hurt_player(e._cfg.damage, e.global_position)


func hurt_player(amount: int, from: Vector3) -> void:
	if player.dead:
		return
	player.hurt(amount)
	sfx.play("hit", 0.0)
	ui.flash_red()
	# A shove away from whatever hit you.
	var away := player.global_position - from
	away.y = 0.0
	if away.length() > 0.1:
		player.velocity += away.normalized() * 4.0


func drop_debris(room: Node3D, centre: Vector3) -> void:
	sfx.play("creak", -2.0)
	var hurt_once := [false]          # the whole trap hurts at most once
	for i in range(3):
		await get_tree().create_timer(0.15 * i).timeout
		if not is_instance_valid(room):
			return
		var b := RigidBody3D.new()
		b.collision_layer = Data.L_ENEMY            # debris lives on layer 2, with the creatures
		b.collision_mask = Data.L_WORLD | Data.L_PLAYER
		b.mass = 12.0
		b.linear_damp = 0.15
		b.angular_damp = 1.2
		var cs := CollisionShape3D.new()
		var cyl := CylinderShape3D.new()     # a convex shape, tight to the pipe
		cyl.radius = 0.13
		cyl.height = 2.4
		cs.shape = cyl
		b.add_child(cs)
		var m := Assets.make("ceiling_pipe", 2.4, true)
		m.rotation_degrees.z = 90.0
		b.add_child(m)
		# They start just under the ceiling, one below the other, so none of them begins inside it.
		var ceiling: float = Rooms.LIST[room.get_meta("room", "c1_hall")].h
		b.position = Vector3(centre.x + randf_range(-1.0, 1.0), ceiling - 0.6 - i * 0.4, centre.z + randf_range(-1.0, 1.0))
		b.rotation_degrees = Vector3(randf() * 20.0, randf() * 360.0, 90.0 + randf_range(-10, 10))
		room.add_child(b)
		b.contact_monitor = true
		b.max_contacts_reported = 4
		b.body_entered.connect(func(body: Node):
			sfx.play_at("crash", b.global_position, 2.0)
			noise(b.global_position, 16.0, "bang")
			player.shake(clampf(1.0 - b.global_position.distance_to(player.global_position) / 14.0, 0.0, 0.8))
			# Falling pipes are a fright and a bruise, never the last blow: they cannot take the last point of health.
			if body is Player and not hurt_once[0] and b.linear_velocity.length() > 3.0 and player.health > 1:
				hurt_once[0] = true
				hurt_player(1, b.global_position))


func emp_bolt(from: Vector3, to: Vector3) -> void:
	if headless_test:
		return
	var len := from.distance_to(to)
	var beam := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.02
	cm.bottom_radius = 0.02
	cm.height = len
	cm.radial_segments = 6
	beam.mesh = cm
	beam.material_override = Assets.mat(Color(0.4, 0.8, 1.0), 0.2, 0.0, 6.0)
	add_child(beam)
	beam.global_position = (from + to) * 0.5
	beam.look_at(to, Vector3.UP)
	beam.rotate_object_local(Vector3.RIGHT, PI * 0.5)
	var tw := beam.create_tween()
	tw.tween_property(beam, "scale", Vector3(0.1, 1.0, 0.1), 0.2)
	tw.tween_callback(beam.queue_free)


func sparks_at(pos: Vector3) -> void:
	if headless_test:
		return
	var p := GPUParticles3D.new()
	p.amount = 20
	p.lifetime = 0.6
	p.one_shot = true
	p.explosiveness = 1.0
	p.visibility_aabb = AABB(Vector3(-3, -3, -3), Vector3(6, 6, 6))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 80.0
	pm.initial_velocity_min = 1.5
	pm.initial_velocity_max = 4.0
	pm.gravity = Vector3(0, -8, 0)
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.04, 0.04)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(0.6, 0.85, 1.0)
	m.emission_enabled = true
	m.emission = Color(0.4, 0.7, 1.0)
	m.emission_energy_multiplier = 5.0
	q.material = m
	p.draw_pass_1 = q
	add_child(p)
	p.global_position = pos
	p.emitting = true
	get_tree().create_timer(1.2).timeout.connect(p.queue_free)


func _explode() -> void:
	s.planted = false
	sfx.play("boom", 4.0)
	player.hurt(99)


func _win() -> void:
	s.won = true
	playing = false
	player.frozen = true
	sfx.play("win", 0.0)
	if FileAccess.file_exists(SAVE):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE))
	ui.show_win()


# ── saving ───────────────────────────────────────────────────────────────────

func _save() -> void:
	if headless_test:
		return
	var d := {"chapter": s.chapter, "inv": s.inv, "taken": s.taken, "dropped": s.dropped, "drop_n": s.drop_n, "unlocked": s.unlocked, "fuses_in": s.fuses_in, "cable_in": s.cable_in,
		"gen_on": s.gen_on, "has_emp": player.has_emp, "emp": player.emp_charges, "deaths": s.deaths, "seconds": s.seconds}
	var f := FileAccess.open(SAVE, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))


func _load() -> void:
	var f := FileAccess.open(SAVE, FileAccess.READ)
	if f == null:
		return
	var d = JSON.parse_string(f.get_as_text())
	if typeof(d) != TYPE_DICTIONARY:
		return
	s.chapter = int(d.get("chapter", 1))
	s.inv = d.get("inv", [])
	s.taken = d.get("taken", {})
	s.dropped = d.get("dropped", [])
	s.drop_n = int(d.get("drop_n", 0))
	s.unlocked = d.get("unlocked", {})
	s.fuses_in = int(d.get("fuses_in", 0))
	s.cable_in = d.get("cable_in", false)
	s.gen_on = d.get("gen_on", false)
	if d.get("has_emp", false):
		player.equip_emp()
	player.emp_charges = int(d.get("emp", 0))
	s.deaths = int(d.get("deaths", 0))
	s.seconds = float(d.get("seconds", 0.0))
