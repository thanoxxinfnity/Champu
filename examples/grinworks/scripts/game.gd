class_name Game
extends Node3D
## Grinworks. The state of the game, what each thing in the world does when you use it, and
## the flow: title, play, die, retry, launch, win.

class State:
	var has_fuse := false
	var has_keycard := false
	var cells := 0               # carried
	var cells_in := 0            # in the pod console
	var locker_open := false
	var valves := {"A": false, "B": false, "C": false, "D": false, "E": false}
	var gen_on := false
	var breaker_open := false    # the fuse is in
	var breaker: Array = []
	var breaker_solved := false
	var radio_solved := false
	var launching := false
	var won := false
	var notes: Array = []
	var picked: Array = []
	var hints: Array = []
	var deaths := 0
	var checkpoint := "ai"
	var started := false
	var seconds := 0.0

const SAVE := "user://station9.json"
const LAUNCH_TIME := 25.0
const SPAWN_YAW := -90.0
static var autostart := false

var s := State.new()
var level: Level
var player: Player
var hollow: Hollow
var ui: Ui
var sfx: Sfx
var env: Environment
var playing := false
var _launch_left := 0.0
var _awake_t := 0.0
var _death_t := 0.0
var _hum_t := 5.0
var headless_test := false


func _ready() -> void:
	sfx = Sfx.new()
	add_child(sfx)
	var we := WorldEnvironment.new()
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.005, 0.008, 0.012)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.1, 0.13, 0.18)
	env.ambient_light_energy = 0.55
	env.fog_enabled = true
	env.fog_light_color = Color(0.015, 0.025, 0.035)
	env.fog_density = 0.028
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	we.environment = env
	add_child(we)

	level = Level.new()
	level.name = "Level"
	add_child(level)
	level.build(self)

	player = Player.new()
	player.name = "Player"
	player.game = self
	add_child(player)
	player.global_position = level.nodes["ai"].pos + Vector3(-0.5, 0, -0.5)
	player.yaw = deg_to_rad(SPAWN_YAW)

	hollow = Hollow.new()
	hollow.name = "Hollow"
	hollow.game = self
	add_child(hollow)
	hollow.caught_player.connect(_on_caught)

	ui = Ui.new()
	ui.name = "Ui"
	ui.game = self
	add_child(ui)
	ui.start_pressed.connect(func(): start_new())
	ui.continue_pressed.connect(func(): continue_game())
	ui.retry_pressed.connect(respawn)
	ui.restart_pressed.connect(func(): start_new())
	ui.resume_pressed.connect(func(): set_paused(false))
	ui.pause_pressed.connect(func(): set_paused(true))
	s.breaker = Puzzles.breaker_start()
	player.frozen = true
	ui.show_title(FileAccess.file_exists(SAVE))
	sfx.start_ambience()
	if autostart:
		autostart = false
		call_deferred("_begin")


# ── flow ─────────────────────────────────────────────────────────────────────

func start_new() -> void:
	if FileAccess.file_exists(SAVE):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE))
	autostart = true
	get_tree().paused = false
	get_tree().reload_current_scene()


func continue_game() -> void:
	_load()
	_begin()


func _begin() -> void:
	playing = true
	s.started = true
	ui.hide_all_screens()
	player.frozen = false
	var node: String = s.checkpoint
	player.respawn(level.nodes[node].pos + Vector3(0, 0, 0.3), SPAWN_YAW)
	player.battery = maxf(player.battery, 60.0)
	ui.set_playing(true)
	if "intro" not in s.notes:
		call_deferred("read_note", null, "intro")
	_hint_later("look", 2.5)


func set_paused(on: bool) -> void:
	if not playing:
		return
	get_tree().paused = on
	if on:
		ui.show_pause()
	else:
		ui.hide_all_screens()
		ui.set_playing(true)


func _hint_later(id: String, wait: float) -> void:
	if id in s.hints:
		return
	await get_tree().create_timer(wait).timeout
	if id in s.hints or not playing:
		return
	s.hints.append(id)
	ui.toast(Data.HINTS[id])


func _process(delta: float) -> void:
	if not playing:
		return
	if not get_tree().paused and not s.won:
		s.seconds += delta
	hollow.frozen = ui.modal_open and not s.launching
	_update_hud(delta)
	if s.launching and not player.dead:
		_launch_left -= delta
		ui.set_countdown("GATE OPENS IN %d" % ceili(maxf(_launch_left, 0.0)))
		if _launch_left <= 0.0:
			_win()
	# The Hollow wakes the first time you step out of the airlock.
	if hollow.state == Hollow.S.DORMANT and not s.won and level.zone_at(player.global_position) != "airlock" and not player.dead:
		_awake_t += delta
		if _awake_t > 1.0:
			hollow.wake(_spawn_node())
			hollow.speed_bonus = float(_progress())
			hollow.grace = 4.0
			_hint_later("torch", 4.0)
			_hint_later("hide", 40.0)
	# Light flicker in dark zones, harder when it is close.
	_hum_t -= delta
	if _hum_t <= 0.0:
		_hum_t = randf_range(9.0, 18.0)
		sfx.play("drip", -12.0, randf_range(0.8, 1.2))
		if randf() < 0.4:
			sfx.play("creak", -16.0)


func _spawn_node() -> String:
	var best := "hne"
	var best_d := -1.0
	for id in ["hne", "hnw", "hse", "cn", "cs"]:
		if level.is_lit(level.nodes[id].zone):
			continue
		var d: float = level.nodes[id].pos.distance_to(player.global_position)
		if d > best_d:
			best_d = d
			best = id
	return best


func _progress() -> int:
	return int(s.locker_open) + int(s.gen_on) + int(s.breaker_solved) + int(s.radio_solved)


func _update_hud(delta: float) -> void:
	ui.set_battery(player.battery / 100.0, player.torch_on)
	if player.battery < 40.0 and "crank" not in s.hints and not player.dead:
		s.hints.append("crank")
		ui.toast(Data.HINTS["crank"], 6.0)
	ui.set_stamina(player.stamina)
	ui.set_noise(player.noise)
	ui.set_items(s.has_fuse, s.has_keycard, s.cells, s.cells_in)
	var f := player.focus
	ui.set_prompt(f.label() if (f != null and not player.dead and not ui.modal_open) else "", f != null)
	ui.set_objective(objective())
	# Fear: the nearer the Hollow, the faster the heart and the darker the edges.
	var fear := 0.0
	if hollow.state != Hollow.S.DORMANT and not player.hidden:
		var d := hollow.global_position.distance_to(player.global_position)
		fear = clampf(1.0 - d / 16.0, 0.0, 1.0)
		if hollow.state == Hollow.S.HUNT:
			fear = maxf(fear, 0.6)
	sfx.heart_rate = 0.0 if fear < 0.15 else lerpf(1.1, 2.6, fear)
	ui.set_fear(fear, hollow.state == Hollow.S.HUNT)
	if player.hidden:
		ui.set_hidden(true)
	else:
		ui.set_hidden(false)


func objective() -> String:
	if s.launching:
		return "SURVIVE. Keep the torch on Mr. Grin until the gate opens."
	if s.cells_in >= 3:
		return "Use the gate controls."
	if s.cells + s.cells_in >= 3:
		return "Take the three power cells to the gate controls in the DELIVERY BAY."
	if s.radio_solved:
		return "Collect the intercom's power cell in the MASCOT OFFICE."
	if s.has_keycard:
		return "MASCOT OFFICE: decode the word on the intercom (toy lab whiteboard + the note in cubby 7)."
	if s.breaker_solved:
		return "Take the keycard and the power cell from the TOY LAB."
	if s.gen_on and s.has_fuse:
		return "TOY LAB: the breaker box needs the fuse."
	if s.gen_on:
		return "The toy lab is open. You need a FUSE: try cubby 7 in the NAP ROOM."
	if s.has_fuse:
		return "BOILER ROOM: route the steam and start the generator."
	return "NAP ROOM: open cubby 7.  BOILER ROOM: start the generator."


# ── noise, light, death ──────────────────────────────────────────────────────

func noise(pos: Vector3, radius: float, kind := "") -> void:
	if hollow != null and hollow.state != Hollow.S.DORMANT:
		hollow.hear(pos, radius, kind)


func far_dark_node(from: Vector3, avoid: Vector3) -> String:
	var cands: Array = []
	for id in level.nodes:
		if level.is_lit(level.nodes[id].zone):
			continue
		var d_avoid: float = level.nodes[id].pos.distance_to(avoid)
		var route: Array = level.route(level.nearest_node(from, false), id, true)
		if route.is_empty():
			continue
		cands.append({"id": id, "d": d_avoid})
	if cands.is_empty():
		return level.nearest_node(from, false)
	cands.sort_custom(func(a, b): return a.d > b.d)
	return cands[randi() % mini(3, cands.size())].id


func light_zone(zone: String) -> void:
	level.set_lit(zone, true)
	sfx.play("poweron", -4.0)
	if "light" not in s.hints:
		_hint_later("light", 3.0)


func _on_caught() -> void:
	if player.dead or s.won:
		return
	player.dead = true
	s.deaths += 1
	hollow.face(player.global_position)
	sfx.play("jump", 2.0)
	player.scare(1.0)
	# Look at it, one last time.
	var to := hollow.global_position + Vector3(0, 1.9, 0) - player.eye_pos()
	player.yaw = atan2(-to.x, -to.z)
	player.pitch = clampf(asin(to.normalized().y), -1.0, 1.0)
	ui.flash_red()
	await get_tree().create_timer(1.7).timeout
	if not player.dead:
		return
	ui.show_death(s.deaths)


func respawn() -> void:
	hollow.sleep()
	hollow.clear_drag()
	_awake_t = 0.0
	var node: String = s.checkpoint
	if s.launching:
		node = "pod_in"
		_launch_left = LAUNCH_TIME
	ui.hide_all_screens()
	ui.set_playing(true)
	player.respawn(level.nodes[node].pos + Vector3(0, 0, 0.3), SPAWN_YAW)
	player.frozen = false
	if s.launching:
		await get_tree().create_timer(4.0).timeout
		hollow.wake("hnw")
		hollow.speed_bonus = 3.0
		hollow.grace = 0.0
		hollow.hunt_player()
	else:
		_awake_t = -4.0   # a few seconds of peace in the lit room


# ── what things do ───────────────────────────────────────────────────────────

func read_note(_u: Use, id: String) -> void:
	var n: Dictionary = Data.NOTES[id]
	sfx.play("note", -4.0)
	if id not in s.notes:
		s.notes.append(id)
		_save()
	ui.show_note(n.title, Data.note_body(id))


func pick_up(u: Use, item: String, holder: Node3D) -> void:
	if item.begins_with("battery"):
		player.battery = minf(100.0, player.battery + 60.0)
		ui.toast("Battery +60%")
	elif item == "fuse":
		s.has_fuse = true
		ui.toast("Took the fuse.")
	elif item == "keycard":
		s.has_keycard = true
		ui.toast("Took the keycard.")
	elif item.begins_with("cell"):
		s.cells += 1
		ui.toast("Power cell %d of 3." % (s.cells + s.cells_in))
	sfx.play("pickup", -2.0)
	s.picked.append(item)
	level.uses.erase(u)
	holder.queue_free()
	u.queue_free()
	_save()


func hide_in(u: Use) -> void:
	player.enter_hide(u)
	sfx.play("locker", -2.0)
	# Seen going in = dragged out. Unseen, it only hears nothing.
	if hollow.state == Hollow.S.HUNT and hollow._sees and hollow.global_position.distance_to(player.global_position) < 10.0:
		hollow.drag_from(u)
		ui.toast("He saw you hide...")
	elif hollow.state in [Hollow.S.HUNT, Hollow.S.INVESTIGATE, Hollow.S.PATROL]:
		hollow.clear_drag()
	_hint_later("hide", 0.5)


func crew_locker(u: Use) -> void:
	if s.locker_open:
		ui.toast("The cubby is empty.")
		return
	ui.show_dial("CUBBY 7", "Four digits. The foreman's memo says which.", 4, "digits", func(code: String):
		if code == Puzzles.locker_code():
			s.locker_open = true
			s.has_fuse = true
			sfx.play("locker", 0.0)
			sfx.play("win", -6.0)
			ui.close_modal()
			ui.toast("It opens. Inside: a FUSE and a note.")
			s.checkpoint = "dm_in"
			light_zone("dorm")
			light_zone("corW")
			_note_after("locker_note", 1.2)
			u.enabled = false
			_save()
			return true
		sfx.play("error", -4.0)
		noise(player.global_position, 4.0, "dial")
		ui.toast("Wrong code.")
		return false
	)


func _note_after(id: String, wait: float) -> void:
	await get_tree().create_timer(wait).timeout
	if playing:
		read_note(null, id)


func turn_valve(_u: Use, letter: String) -> void:
	if s.gen_on:
		ui.toast("The generator is running. Leave the valves alone.")
		return
	s.valves[letter] = not s.valves[letter]
	sfx.play("valve", -2.0)
	noise(player.global_position, 6.0, "valve")
	_refresh_valves()


func _refresh_valves() -> void:
	for letter in Puzzles.VALVES:
		var l: Label3D = level.valve_labels[letter]
		l.text = "OPEN" if s.valves[letter] else "CLOSED"
		l.modulate = Color(0.35, 0.95, 0.5) if s.valves[letter] else Color(0.9, 0.3, 0.25)


func gen_start(_u: Use) -> void:
	if s.gen_on:
		ui.toast("The generator is already running.")
		return
	if Puzzles.valve_rules_hold(s.valves):
		s.gen_on = true
		sfx.play("poweron", 0.0)
		ui.toast("The generator catches. The toy lab door unlocks.")
		s.checkpoint = "en_in"
		light_zone("engine")
		light_zone("corS")
		level.doors["lab_door"].set_open(true)
		level.pickup("cell_engine", "power_cell", 0.3, Vector3(-6.4, 0.45, 22.0), "Take power cell", Color(0.3, 0.7, 1.0))
		_save()
	else:
		# The wrong settings: the pipes hammer and the whole station hears it.
		sfx.play("hammer", 2.0)
		noise(player.global_position, 30.0, "bang")
		player.scare(0.8)
		ui.toast("The pipes hammer. The whole factory heard that.")


func door_panel(_u: Use, id: String) -> void:
	var d: Door = level.doors[id]
	if d.open:
		ui.toast("Open.")
	elif id == "lab_door":
		ui.toast("No power. The generator in the Boiler room feeds this door.")
		sfx.play("error", -6.0)
	elif id == "control_door":
		if s.has_keycard:
			d.set_open(true)
			ui.toast("Access granted.")
		else:
			ui.toast("Locked. It needs a keycard.")
			sfx.play("error", -6.0)
	else:
		ui.toast("The delivery bay shutter opens when the intercom word is decoded.")
		sfx.play("error", -6.0)


func breaker_panel(_u: Use) -> void:
	if s.breaker_solved:
		ui.toast("All breakers are on.")
		return
	if not s.breaker_open:
		if not s.has_fuse:
			ui.toast("The panel is dead. A fuse is missing.")
			sfx.play("error", -6.0)
			return
		s.breaker_open = true
		s.has_fuse = false
		sfx.play("click", -2.0)
		ui.toast("You slot the fuse in.")
	_open_breaker_ui()


func _open_breaker_ui() -> void:
	ui.show_breaker(s.breaker, func(cell: int):
		s.breaker = Puzzles.breaker_press(s.breaker, cell)
		sfx.play("click", -2.0)
		noise(player.global_position, 3.0, "click")
		if Puzzles.breaker_solved(s.breaker):
			s.breaker_solved = true
			ui.close_modal()
			s.checkpoint = "lb_in"
			light_zone("lab")
			light_zone("corE")
			sfx.play("win", -4.0)
			ui.toast("Power restored to the toy lab. A cell and a keycard drop from the charger.")
			_spawn_lab_rewards()
			_save()
		return s.breaker
	)


func _spawn_lab_rewards() -> void:
	level.pickup("cell_lab", "power_cell", 0.3, Vector3(31.2, 0.45, 3.0), "Take power cell", Color(0.3, 0.7, 1.0))
	level.pickup("keycard", "keycard", 0.12, Vector3(31.2, 0.9, -3.0), "Take keycard", Color(1.0, 0.6, 0.2))


func radio_use(_u: Use) -> void:
	if s.radio_solved:
		ui.toast("The intercom is quiet. Its power cell is yours.")
		return
	ui.show_dial("INTERCOM — TEST WORD", "Seven letters. The toy lab whiteboard has it scrambled; the note in cubby 7 has the key.", 7, "letters", func(word: String):
		if word == Puzzles.LAUNCH_WORD:
			s.radio_solved = true
			sfx.play("win", -2.0)
			ui.close_modal()
			ui.toast("Decoded. The delivery bay shutter opens. The intercom's power cell pops out.")
			s.checkpoint = "ct_in"
			light_zone("control")
			light_zone("corN")
			light_zone("pod")
			level.doors["pod_door"].set_open(true)
			level.pickup("cell_control", "power_cell", 0.3, Vector3(1.8, 0.45, -26.0), "Take power cell", Color(0.3, 0.7, 1.0))
			_note_after("control_note", 1.5)
			_save()
			return true
		sfx.play("error", -2.0)
		ui.toast("Static. That is not the word.")
		return false
	)


func pod_prompt() -> String:
	if s.launching:
		return "Gate opening..."
	if s.cells_in >= 3:
		return "Open the gate"
	if s.cells > 0:
		return "Insert power cells (%d)" % s.cells
	return "Gate controls (%d of 3 cells)" % s.cells_in


func pod_console(_u: Use) -> void:
	if s.launching:
		return
	if not level.doors["pod_door"].open:
		ui.toast("The gate controls are dead.")
		return
	if s.cells > 0:
		s.cells_in += s.cells
		s.cells = 0
		sfx.play("pickup", 0.0)
		ui.toast("%d of 3 cells in." % s.cells_in)
		_save()
	if s.cells_in >= 3:
		_start_launch()
	else:
		ui.toast("The gate needs three cells: Boiler room, Toy lab, Mascot office.")


func _start_launch() -> void:
	s.launching = true
	_launch_left = LAUNCH_TIME
	level.set_lit("pod", false)
	level.set_lit("corN", false)
	level.set_lit("corE", false)
	sfx.play("launch", 0.0)
	sfx.play("beep", -2.0)
	ui.toast("GATE OPENING. Power diverted — the lights are failing.")
	level.pickup("battery_pod1", "battery", 0.18, Vector3(15.2, 0.35, -4.4), "Take battery", Color(0.4, 1.0, 0.5))
	level.pickup("battery_pod2", "battery", 0.18, Vector3(11.3, 0.35, -9.0), "Take battery", Color(0.4, 1.0, 0.5))
	_save()
	# A few seconds of warning, then it comes through the hub.
	await get_tree().create_timer(6.0).timeout
	if s.launching and not player.dead:
		sfx.play("growl", 0.0)
		hollow.wake("hnw")
		hollow.speed_bonus = 3.0
		hollow.grace = 0.0
		hollow.hunt_player()


func _win() -> void:
	s.won = true
	s.launching = false
	hollow.sleep()
	sfx.play("win", 0.0)
	player.frozen = true
	ui.set_countdown("")
	var mins := int(s.seconds / 60.0)
	ui.show_win("Time %d:%02d  ·  Deaths %d" % [mins, int(s.seconds) % 60, s.deaths])
	if FileAccess.file_exists(SAVE):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SAVE))


# ── saving ───────────────────────────────────────────────────────────────────

func _save() -> void:
	if headless_test:
		return
	var d := {
		"has_fuse": s.has_fuse, "has_keycard": s.has_keycard, "cells": s.cells, "cells_in": s.cells_in,
		"locker_open": s.locker_open, "valves": s.valves, "gen_on": s.gen_on, "breaker_open": s.breaker_open,
		"breaker": s.breaker, "breaker_solved": s.breaker_solved, "radio_solved": s.radio_solved,
		"notes": s.notes, "picked": s.picked, "hints": s.hints, "deaths": s.deaths, "checkpoint": s.checkpoint, "seconds": s.seconds,
	}
	var f := FileAccess.open(SAVE, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))


func _load() -> void:
	var f := FileAccess.open(SAVE, FileAccess.READ)
	if f == null:
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var d: Dictionary = parsed
	s.has_fuse = d.get("has_fuse", false)
	s.has_keycard = d.get("has_keycard", false)
	s.cells = int(d.get("cells", 0))
	s.cells_in = int(d.get("cells_in", 0))
	s.locker_open = d.get("locker_open", false)
	var v: Dictionary = d.get("valves", {})
	for k in v:
		s.valves[k] = bool(v[k])
	s.gen_on = d.get("gen_on", false)
	s.breaker_open = d.get("breaker_open", false)
	s.breaker = d.get("breaker", Puzzles.breaker_start())
	s.breaker_solved = d.get("breaker_solved", false)
	s.radio_solved = d.get("radio_solved", false)
	s.notes = d.get("notes", [])
	s.picked = d.get("picked", [])
	s.hints = d.get("hints", [])
	s.deaths = int(d.get("deaths", 0))
	s.checkpoint = d.get("checkpoint", "ai")
	s.seconds = float(d.get("seconds", 0.0))
	_restore_world()


func _restore_world() -> void:
	_refresh_valves()
	if s.locker_open:
		level.set_lit("dorm", true, true)
		level.set_lit("corW", true, true)
		for u in level.uses:
			if u.id == "crew_locker":
				u.enabled = false
	if s.gen_on:
		level.set_lit("engine", true, true)
		level.set_lit("corS", true, true)
		level.doors["lab_door"].set_open(true, true)
		level.pickup("cell_engine", "power_cell", 0.3, Vector3(-6.4, 0.45, 22.0), "Take power cell", Color(0.3, 0.7, 1.0))
	if s.breaker_solved:
		level.set_lit("lab", true, true)
		level.set_lit("corE", true, true)
		_spawn_lab_rewards()
	if s.radio_solved:
		level.set_lit("control", true, true)
		level.set_lit("corN", true, true)
		level.set_lit("pod", true, true)
		level.doors["pod_door"].set_open(true, true)
		level.pickup("cell_control", "power_cell", 0.3, Vector3(1.8, 0.45, -26.0), "Take power cell", Color(0.3, 0.7, 1.0))
	if s.has_keycard or "keycard" in s.picked:
		level.doors["control_door"].set_open(true, true)
	# Whatever was already picked up is gone from the world.
	for u in level.uses.duplicate():
		if u.id.begins_with("pick_") and u.tag in s.picked:
			var holder: Node3D = u.get_meta("holder", null)
			if holder != null:
				holder.queue_free()
			level.uses.erase(u)
			u.queue_free()


func _notification(what: int) -> void:
	# Android's back button, and the app losing focus, both pause: a horror game should never run on
	# while somebody answers a message.
	if (what == NOTIFICATION_WM_GO_BACK_REQUEST or what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_WINDOW_FOCUS_OUT) and playing and not s.won and not player.dead:
		if what == NOTIFICATION_WM_GO_BACK_REQUEST:
			set_paused(not get_tree().paused)
		elif not get_tree().paused:
			set_paused(true)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_ESCAPE and playing and not s.won:
		set_paused(not get_tree().paused)
