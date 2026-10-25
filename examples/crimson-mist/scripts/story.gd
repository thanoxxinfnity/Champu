class_name Story
extends Node
## Chapter 1 "The Red Bell": six missions. Each mission creates its interactables and enemies when it starts, `tick` watches its end condition,
## and every mission start is a checkpoint (position, inventory, flags) that death rolls back to.

var game: Game
var mission := -1
var flags := {}
var objective_title := ""
var objective := ""
var marker := Vector3.ZERO
var has_marker := false
var kills_in_mission := 0
var interactables: Array[Interactable] = []
var checkpoint := {}
var crafted := {}
var picked := {}        # world-loot slots already taken
var spawned_zones := {}
var finished := false
var _time_in_mission := 0.0
var _ambush_enemy: Enemy
var _boss: Enemy

const SPAWNS := {
	"clinic": [["mist_walker", Vector3(8.0, 0, -6.0), "dormant"], ["crawler", Vector3(-9.0, 0, -6.5), "dormant"]],
	"market": [
		["mist_walker", Vector3(-3, 0, -36), "patrol"], ["mist_walker", Vector3(4, 0, -44), "patrol"], ["mist_walker", Vector3(-5, 0, -61), "patrol"],
		["crawler", Vector3(-4.5, 0, -40.5), "dormant"], ["crawler", Vector3(4, 0, -64), "dormant"],
		["bloater", Vector3(0, 0, -78), "patrol"], ["mist_walker", Vector3(2, 0, -84), "dormant"]],
	"church": [
		["weeper", Vector3(-2, 0, -112), "dormant"], ["mist_walker", Vector3(5, 0, -100), "patrol"], ["mist_walker", Vector3(-4, 0, -96), "patrol"],
		["mist_walker", Vector3(3, 0, -110), "dormant"]],
	"road": [
		["crawler", Vector3(-2, 0, -135), "dormant"], ["crawler", Vector3(2, 0, -140), "dormant"], ["mist_walker", Vector3(0, 0, -148), "patrol"],
		["mist_walker", Vector3(-3, 0, -156), "patrol"], ["bloater", Vector3(1, 0, -164), "patrol"], ["crawler", Vector3(-2, 0, -170), "dormant"],
		["mist_walker", Vector3(2, 0, -178), "patrol"], ["crawler", Vector3(0, 0, -184), "dormant"]],
}

const LOOT := {
	# mission 2 start: everything the workbench needs lies along Market Street (+ a little extra)
	"loot1": ["scrap", 1, "Search stall"], "loot2": ["scrap", 1, "Search stall"], "loot3": ["scrap", 1, "Search stall"],
	"loot4": ["cloth", 1, "Search car"], "loot5": ["fuel", 1, "Search car"], "loot6": ["ammo", 6, "Search wreck"],
	"loot7": ["alcohol", 1, "Search shelf"], "loot8": ["cloth", 1, "Search crates"],
	"loot9": ["scrap", 1, "Search crates"], "loot10": ["bandage", 1, "Take first-aid kit"],
	"loot11": ["ammo", 6, "Search crates"], "loot12": ["flare", 1, "Take flare"],
}


func _name_of(id: String) -> String:
	return String(Data.CAST[id].name).split(" ")[0]


func _fmt(s: String) -> String:
	return s.replace("{me}", _name_of(game.player.char_id)).replace("{ally1}", Data.ally_name(game.player.char_id, 1)).replace("{ally2}", Data.ally_name(game.player.char_id, 2))


func say(lines: Array, per_line := 3.6) -> void:
	var out: Array = []
	for l in lines:
		out.append([_fmt(l[0]), _fmt(l[1])])
	game.hud.say(out, per_line)


func start(index: int, from_checkpoint := false) -> void:
	mission = index
	_time_in_mission = 0.0
	kills_in_mission = 0
	var m: Dictionary = Data.MISSIONS[index]
	objective_title = m.title
	objective = _fmt(String(m.goal))
	game.hud.chapter_card(objective_title, objective)
	game.hud.set_objective(objective_title, objective)
	_clear_interactables()
	if index >= 2:
		_ensure_loot()
	match index:
		0: _start_wake(from_checkpoint)
		1: _start_power()
		2: _start_rescue()
		3: _start_craft()
		4: _start_road()
		5: _start_boss()
	checkpoint = {"mission": index, "pos": game.player.global_position, "inv": game.player.inventory.duplicate(), "crowbar": game.player.has_crowbar,
		"pistol": game.player.has_pistol, "mag": game.player.mag, "flags": flags.duplicate(true), "picked": picked.duplicate(), "yaw": game.player.yaw}
	game.save_progress()


func restart_mission() -> void:
	var cp := checkpoint
	var p := game.player
	game.clear_enemies()
	p.revive(true)
	p.global_position = cp.pos
	p.velocity = Vector3.ZERO
	p.inventory = cp.inv.duplicate()
	p.has_crowbar = cp.crowbar
	p.has_pistol = cp.pistol
	p.mag = cp.mag
	p.yaw = cp.yaw
	flags = cp.flags.duplicate(true)
	picked = cp.picked.duplicate()
	spawned_zones.clear()
	game.hud.hide_all_screens()
	start(int(cp.mission), true)


func _clear_interactables() -> void:
	## Mission-specific things (doors, prisoners, notes ...) go; world loot stays until someone takes it.
	var keep: Array[Interactable] = []
	for it in interactables:
		if not is_instance_valid(it):
			continue
		if it.kind == "loot" and it.key != "":
			keep.append(it)
		else:
			it.queue_free()
	interactables = keep


func _ensure_loot() -> void:
	var have := {}
	for it in interactables:
		have[it.key] = true
	for k in LOOT:
		if picked.has(k) or have.has(k):
			continue
		var spec: Array = LOOT[k]
		var it := _make("loot", spec[0], spec[2], game.world.spots[k])
		it.count = spec[1]
		it.key = k


func _make(kind: String, value: String, label: String, pos: Vector3, glint := true, radius := 2.1) -> Interactable:
	var it := Interactable.new()
	it.setup(kind, value, label, radius)
	game.add_child(it)
	it.global_position = pos
	if glint:
		it.add_glint()
	interactables.append(it)
	return it


func _spawn_zone(key: String) -> void:
	if spawned_zones.has(key):
		return
	spawned_zones[key] = true
	for s in SPAWNS.get(key, []):
		var e := game.spawn_enemy(s[0], s[1], key)
		if s[2] == "patrol":
			e.state = Enemy.S.PATROL
		elif s[2] == "chase":
			e.wake()


# ── missions ─────────────────────────────────────────────────────────────────

func _start_wake(from_cp: bool) -> void:
	flags["ambush"] = false
	flags["ambush_dead"] = false
	_make("loot", "crowbar", "Take crowbar", game.world.spots.crowbar)
	_make("note", "0", "Read note", game.world.spots.note0, false)
	marker = game.world.spots.crowbar
	has_marker = true
	if not from_cp:
		say([["{me}", "Ngh… my head. The harbour clinic… why is it so dark?"], ["{me}", "The bell rang, then the mist came up. I need something to defend myself."]])


func _start_power() -> void:
	_make("loot", "fuel", "Take fuel can", game.world.spots.fuel)
	_make("loot", "fuse", "Take fuse", game.world.spots.fuse)
	_make("note", "1", "Read memo", game.world.spots.note1, false)
	_make("generator", "", "Start generator", game.world.spots.generator, true, 2.6)
	var cab := _make("cabinet", "", "Open cabinet", game.world.spots.cabinet)
	cab.enabled = false
	flags["power"] = false
	_spawn_zone("clinic")
	say([["{me}", "Generator room's at the back. Fuel in storage, a spare fuse in the nurse's office."]])


func _start_rescue() -> void:
	_make("note", "2", "Read sign", game.world.spots.note2, false)
	_make("door", "", "Break storeroom door", game.world.spots.storeroom, true, 2.4)
	_make("ally", "1", "Free survivor", game.world.spots.ally1, false, 2.4).enabled = false
	flags["door_broken"] = false
	flags["ally1_free"] = false
	say([["{me}", "Market Street. The old radio shop sends a signal every night — someone's alive in there."]])


func _start_craft() -> void:
	flags["near_bench"] = false
	crafted.clear()
	_make("workbench", "", "Use workbench", game.world.spots.workbench, true, 2.6)
	say([["{me}", "A workbench. Bandages, a flare, a sturdier crowbar — everything I need is on this street."]])


func _start_road() -> void:
	flags["ally2_free"] = false
	flags["barricade"] = false
	flags["road_cleared"] = false
	_make("ally", "2", "Talk to survivor", game.world.spots.ally2, false, 2.4)
	_make("barricade", "", "Burn barricade (flare)", game.world.spots.barricade, true, 3.0)
	_make("note", "3", "Read wall", game.world.spots.note3, false)
	_make("note", "4", "Read page", game.world.spots.note4, false)
	say([["{me}", "The bell road is blocked. But I saw lights in the church — someone's in there."]])


func _start_boss() -> void:
	flags["boss_spawned"] = false
	flags["boss_dead"] = false


# ── interaction ──────────────────────────────────────────────────────────────

func on_interact(it: Interactable) -> void:
	var p := game.player
	match it.kind:
		"loot":
			_loot(it)
		"note":
			game.hud.read_note(Data.NOTES[int(it.value)])
			game.sfx.play("note")
			it.used = true
			it.queue_free()
			interactables.erase(it)
		"generator":
			if p.count("fuel") < 1 or p.count("fuse") < 1:
				game.hud.toast("NEEDS A FUEL CAN AND A FUSE")
				game.sfx.play("empty", -4.0)
				return
			p.spend("fuel")
			p.spend("fuse")
			game.world.power_on()
			game.sfx.play("clank", 0.0, 0.6)
			game.sfx.play("boom", -6.0, 1.6)
			it.used = true
			flags["power"] = true
			for o in interactables:
				if o.kind == "cabinet":
					o.enabled = true
			say([["{me}", "Lights! The exit door's unlocked — and the cabinet clicked open."]])
		"cabinet":
			p.has_pistol = true
			p.mag = int(Data.WEAPONS.pistol.mag)
			p.add_item("ammo", 6)
			it.used = true
			game.hud.toast("FOUND A PISTOL")
			game.sfx.play("pickup")
		"door":
			if not p.has_crowbar:
				game.hud.toast("YOU NEED A CROWBAR")
				return
			game.world.open_storeroom()
			game.sfx.play("slam", 0.0, 1.2)
			game.shake(0.3)
			it.used = true
			flags["door_broken"] = true
			for o in interactables:
				if o.kind == "ally" and o.value == "1":
					o.enabled = true
			game.hud.toast("DOOR BROKEN")
		"ally":
			it.used = true
			if it.value == "1":
				flags["ally1_free"] = true
				game.add_companion(1)
				say([["{ally1}", "Ah! Don't — oh, you're human. Thank god. They've been scratching at that door for hours."],
					["{me}", "Can you walk? Stay close, I'm taking you with me."],
					["{ally1}", "I'll watch your back. I can see them before they see us — trust me."]])
				_advance_after(6.0)
			else:
				flags["ally2_free"] = true
				game.add_companion(2)
				say([["{ally2}", "Quiet… the Bellkeeper sleeps in the bell. Every toll wakes the mist."],
					["{ally2}", "The road to the tower is blocked. Burn the barricade — they're afraid of fire."]])
		"workbench":
			game.hud.show_craft(true)
		"barricade":
			if p.count("flare") < 1:
				game.hud.toast("YOU NEED A FLARE")
				return
			p.spend("flare")
			game.world.burn_barricade()
			game.sfx.play("boom", 0.0, 0.8)
			game.shake(0.5)
			it.used = true
			flags["barricade"] = true
			_spawn_zone("road")
			say([["{me}", "Burn, you rotten thing."]])
			game.hud.set_objective(objective_title, "Clear the bell road and reach the tower.")
			objective = "Clear the bell road and reach the tower."


func _loot(it: Interactable) -> void:
	var p := game.player
	var item := it.value
	var n := it.count + (1 if p.char_id == "rina" and item in ["scrap", "cloth", "alcohol", "fuel"] else 0)
	match item:
		"crowbar":
			p.has_crowbar = true
			game.hud.toast("CROWBAR")
			game.sfx.play("pickup")
			it.used = true
			it.queue_free()
			interactables.erase(it)
			if not flags.get("ambush", false):
				flags["ambush"] = true
				say([["{me}", "A crowbar. Heavy enough. Something is moving in the corridor — stay quiet…"]])
				get_tree().create_timer(3.0).timeout.connect(_spawn_ambush)
			return
		"fuse", "fuel":
			pass
	var got := p.add_item(item, n)
	if got <= 0:
		game.hud.toast("CAN'T CARRY ANY MORE %s" % String(Data.ITEMS[item].name).to_upper())
		return
	if item == "ammo" and p.has_pistol:
		game.hud.toast("+%d AMMO" % got)
	else:
		game.hud.toast("+%d %s" % [got, String(Data.ITEMS[item].name).to_upper()])
	game.sfx.play("pickup")
	if it.key != "":
		picked[it.key] = true
	it.used = true
	it.queue_free()
	interactables.erase(it)


func _spawn_ambush() -> void:
	if mission != 0 or is_instance_valid(_ambush_enemy):
		return
	_ambush_enemy = game.spawn_enemy("mist_walker", Vector3(0, 0, -3.5), "clinic")
	_ambush_enemy.wake()
	_ambush_enemy.died.connect(func(_e: Enemy) -> void:
		flags["ambush_dead"] = true)


func craft(recipe: String) -> void:
	var p := game.player
	if p.craft(recipe):
		crafted[recipe] = true
		game.sfx.play("pickup", 0.0, 1.2)
		game.hud.toast("CRAFTED: %s" % String(Data.RECIPES[recipe].name).to_upper())
	else:
		game.hud.toast("NOT ENOUGH MATERIALS")
		game.sfx.play("empty", -4.0)


func _advance_after(sec: float) -> void:
	var m := mission
	get_tree().create_timer(sec).timeout.connect(func() -> void:
		if mission == m and game.state == Game.State.PLAYING:
			complete_mission())


func complete_mission() -> void:
	game.hud.toast("MISSION COMPLETE")
	game.sfx.play("note", 0.0, 1.3)
	if mission + 1 < Data.MISSIONS.size():
		start(mission + 1)
	else:
		finish_chapter()


func on_kill(e: Enemy) -> void:
	kills_in_mission += 1
	if e == _boss:
		flags["boss_dead"] = true


# ── per frame ────────────────────────────────────────────────────────────────

func tick(delta: float) -> void:
	if finished:
		return
	_time_in_mission += delta
	var p := game.player
	var spots: Dictionary = game.world.spots
	var pz := p.global_position.z
	match mission:
		0:
			if not p.has_crowbar:
				marker = spots.crowbar
			elif not flags.get("ambush_dead", false):
				has_marker = false
			else:
				complete_mission()
		1:
			has_marker = true
			if flags.get("power", false):
				marker = spots.cabinet if not p.has_pistol else spots.exit
				if pz < -25.5:
					complete_mission()
			elif p.count("fuel") < 1:
				marker = spots.fuel
			elif p.count("fuse") < 1:
				marker = spots.fuse
			else:
				marker = spots.generator
		2:
			if pz < -28.0:
				_spawn_zone("market")
			if not flags.get("door_broken", false):
				marker = spots.storeroom
			elif not flags.get("ally1_free", false):
				marker = spots.ally1
			has_marker = true
		3:
			has_marker = true
			var need := _need_item()
			marker = need if need != Vector3.ZERO else spots.workbench
			if crafted.has("bandage") and crafted.has("flare") and crafted.has("crowbar_plus"):
				say([["{me}", "That's better. The barricade on the bell road won't burn itself."]])
				complete_mission()
		4:
			if pz < -88.0:
				_spawn_zone("church")
			has_marker = true
			if not flags.get("ally2_free", false):
				marker = spots.church_door if p.global_position.distance_to(spots.church_door) > 6.0 and p.global_position.x > -10.0 else spots.ally2
			elif not flags.get("barricade", false):
				marker = spots.barricade
			else:
				marker = spots.arena
				if pz < -186.0:
					complete_mission()
		5:
			has_marker = not flags.get("boss_spawned", false)
			marker = spots.arena
			if not flags.get("boss_spawned", false) and pz < -196.0:
				flags["boss_spawned"] = true
				_begin_boss()
			elif flags.get("boss_dead", false) and not finished:
				finish_chapter()


## World position of the nearest ingredient the craft mission still needs, or ZERO when the bag already has enough.
func _need_item() -> Vector3:
	var p := game.player
	var need := {"scrap": 3, "cloth": 2, "alcohol": 1, "fuel": 1}
	for r in crafted:
		match r:
			"bandage":
				need["cloth"] = int(need["cloth"]) - 1
				need["alcohol"] = int(need["alcohol"]) - 1
			"flare":
				need["scrap"] = int(need["scrap"]) - 1
				need["fuel"] = int(need["fuel"]) - 1
			"crowbar_plus":
				need["scrap"] = int(need["scrap"]) - 2
				need["cloth"] = int(need["cloth"]) - 1
	var missing := {}
	for k in need:
		if p.count(k) < int(need[k]):
			missing[k] = true
	if missing.is_empty():
		return Vector3.ZERO
	var best := Vector3.ZERO
	var bd := 1e9
	for it in interactables:
		if it.kind == "loot" and missing.has(it.value) and is_instance_valid(it):
			var d := it.global_position.distance_to(p.global_position)
			if d < bd:
				bd = d
				best = it.global_position
	return best


func _begin_boss() -> void:
	game.world.close_arena()
	game.hud.show_loading_free()
	say([["{ally1}", "That's it. That's the thing that rings the bell."], ["{me}", "Stay behind me. We end this tonight."]], 3.2)
	_boss = game.spawn_enemy("bellkeeper", game.world.spots.boss_spawn, "arena")
	_boss.wake()
	game.hud.boss_show(String(Data.ENEMIES.bellkeeper.name))
	_boss.died.connect(func(_e: Enemy) -> void:
		flags["boss_dead"] = true)


func boss_phase2() -> void:
	say([["{ally2}", "It's calling more of them! Watch the ground!"]], 2.6)
	for i in 2:
		game.spawn_enemy("crawler", game.world.spots.arena + Vector3(randf_range(-8, 8), 0, randf_range(-6, 6)), "arena").wake()


func finish_chapter() -> void:
	if finished:
		return
	finished = true
	game.hud.boss_hide()
	game.sfx.play("note", 0.0, 0.7)
	say([["{ally1}", "The bell… it stopped."], ["{me}", "The mist isn't thinning — it's moving. Toward the lighthouse."],
		["{ally2}", "That's where it started. The keeper there knows more."], ["{me}", "Then that's where we go."]], 3.4)
	get_tree().create_timer(14.0).timeout.connect(func() -> void:
		game.chapter_complete())
