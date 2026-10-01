class_name Story
extends Node
## The plot. Seven chapters, each with an objective, a marker, a radio scene,
## the ghouls that live in it and the pickups that belong to it. The Game node
## only forwards what happens (a kill, a pickup, a tick); every rule about what
## it means for the story is here.

var game: Game
var chapter := -1
var pickup_flags := {}          # one-time pickups already taken
var has_cutters := false
var gate_open := false
var boss: Zombie
var boss_dead := false
var survive_t := 0.0
var _waves_done := 0
var _hint_t := 0.0
var _finished := false
var _spawned: Array[Node] = []
var _ending := false

const CHECKPOINTS := [
	Vector3(-11, 0, -80), Vector3(8, 0, -59), Vector3(2, 0, -32), Vector3(-20, 0, 3),
	Vector3(31, 0, 24), Vector3(36, 0, 26), Vector3(0, 0, 90),
]

## Ghouls per chapter: [kind, position, alerted].
const SPAWNS := {
	0: [["nurse", Vector3(10, 0, -70), false], ["nurse", Vector3(4, 0, -83), false], ["walker", Vector3(8, 0, -66), false]],
	1: [["walker", Vector3(-3, 0, -52), false], ["walker", Vector3(3, 0, -47), false], ["walker", Vector3(-2, 0, -43), false],
		["walker", Vector3(5, 0, -41), false], ["cop", Vector3(-1, 0, -30), false], ["runner", Vector3(0, 0, -22), false]],
	2: [["bloater", Vector3(-30, 0, -2), false], ["walker", Vector3(-28, 0, 6), false], ["walker", Vector3(-39, 0, -8), false],
		["walker", Vector3(-25, 0, -5), false], ["runner", Vector3(-22, 0, 11), false], ["walker", Vector3(10, 0, -8), false],
		["walker", Vector3(-8, 0, 0), false]],
	3: [["walker", Vector3(12, 0, 16), false], ["walker", Vector3(17, 0, 24), false], ["cop", Vector3(8, 0, 30), false],
		["nurse", Vector3(14, 0, 10), false]],
	5: [["walker", Vector3(0, 0, 58), false], ["walker", Vector3(-4, 0, 64), false], ["runner", Vector3(2, 0, 70), false],
		["cop", Vector3(-3, 0, 76), false], ["walker", Vector3(5, 0, 78), false], ["nurse", Vector3(-6, 0, 82), false],
		["runner", Vector3(1, 0, 86), false], ["cop", Vector3(3, 0, 80), false]],
}

const PICKUPS := {
	0: [["weapon", "pistol", Vector3(-13.5, 0.9, -65.6)], ["medkit", "", Vector3(12, 0, -72)], ["ammo", "", Vector3(14, 0, -66)]],
	1: [["medkit", "", Vector3(-6, 0, -45)], ["ammo", "", Vector3(6, 0, -44)], ["ammo", "", Vector3(-3, 0, -26)]],
	2: [["cutters", "", Vector3(-29, 0, 5)], ["weapon", "shotgun", Vector3(-27, 0, 9)], ["medkit", "", Vector3(-33, 0, 10)],
		["ammo", "", Vector3(-24, 0, 4)]],
	3: [["medkit", "", Vector3(22, 0, 20)], ["ammo", "", Vector3(20, 0, 28)]],
	4: [["ammo", "", Vector3(36, 0, 20)], ["ammo", "", Vector3(36, 0, 29)], ["medkit", "", Vector3(40, 0, 24)], ["medkit", "", Vector3(33, 0, 33)]],
	5: [["weapon", "rifle", Vector3(44, 0.6, 14)], ["weapon", "smg", Vector3(2, 0.6, 54)], ["ammo", "", Vector3(0, 0, 60)],
		["medkit", "", Vector3(-6, 0, 76)], ["ammo", "", Vector3(4, 0, 88)], ["medkit", "", Vector3(-3, 0, 98)], ["ammo", "", Vector3(3, 0, 99)]],
}


func start(ch: int) -> void:
	chapter = ch
	var c: Dictionary = Data.CHAPTERS[ch]
	survive_t = 0.0
	_waves_done = 0
	game.hud.chapter_card(c.title)
	game.hud.set_objective(c.objective)
	game.hud.set_goal(c.goal if c.goal != null else null)
	game.hud.say(c.radio)
	_spawn_group(ch)
	_spawn_pickups(ch)
	game.sfx.play("static", -6.0)
	if ch == 6:
		game.sfx.chopper(true)


func _spawn_group(ch: int) -> void:
	for e in SPAWNS.get(ch, []):
		var z := game.spawn_enemy(e[0], e[1])
		if e[2]:
			z.alerted = true
		_spawned.append(z)


func _spawn_pickups(ch: int) -> void:
	var i := 0
	for p in PICKUPS.get(ch, []):
		var id := "%d:%d" % [ch, i]
		i += 1
		if pickup_flags.has(id):
			continue
		var pk := game.spawn_pickup(p[0], p[1], p[2])
		pk.set_meta("id", id)


func spawn_notes() -> void:
	for n in Data.NOTES:
		game.spawn_pickup("note", n.text, n.pos)


## Back to the start of the current chapter after dying.
func restart_chapter() -> void:
	for z in get_tree().get_nodes_in_group("enemies"):
		(z as Node).queue_free()
	for pk in get_tree().get_nodes_in_group("chapter_pickups"):
		(pk as Node).queue_free()
	boss = null
	game.hud.boss_hp(-1.0)
	_spawned.clear()
	game.player.global_position = CHECKPOINTS[chapter]
	game.player.dead = false
	game.player.hp = game.player.max_hp
	game.player.velocity = Vector3.ZERO
	for n in game.player.owned:
		var d: Dictionary = Data.WEAPONS[n]
		var w: Dictionary = game.player.weapons[n]
		w.mag = d.mag
		w.reserve = maxi(int(w.reserve), int(d.reserve) / 2)
	var c: Dictionary = Data.CHAPTERS[chapter]
	game.hud.set_objective(c.objective)
	game.hud.set_goal(c.goal if c.goal != null else null)
	_spawn_group(chapter)
	_spawn_pickups(chapter)


func complete() -> void:
	if _finished:
		return
	_finished = true
	var c: Dictionary = Data.CHAPTERS[chapter]
	game.sfx.play("pickup", -2.0)
	game.hud.say(c.done)
	game.hud.set_goal(null)
	game.player.heal(30.0)
	var next_chapter := chapter + 1
	if next_chapter >= Data.CHAPTERS.size():
		return
	var delay := 2.5 + 2.2 * float(c.done.size())
	get_tree().create_timer(delay).timeout.connect(func() -> void:
		_finished = false
		if not game.player.dead and not _ending:
			start(next_chapter))


func on_collect(pk: Pickup) -> void:
	if pk.has_meta("id"):
		pickup_flags[pk.get_meta("id")] = true
	if pk.kind == "cutters":
		has_cutters = true
		game.hud.toast("BOLT CUTTERS")
		if chapter == 2:
			complete()


func on_kill(z: Zombie) -> void:
	game.player.kills += 1
	game.score += int(z.def.score)
	if z.boss:
		boss_dead = true
		game.hud.boss_hp(-1.0)
		if chapter == 5:
			complete()


func boss_phase2(z: Zombie) -> void:
	game.hud.say([["ROHAN", "It's getting angry. Stay moving!"]])
	for i in range(3):
		var a := TAU * float(i) / 3.0
		var zz := game.spawn_enemy("walker", z.global_position + Vector3(sin(a), 0, cos(a)) * 6.0)
		zz.alerted = true


func _spawn_group_gate() -> void:
	for e in [["walker", Vector3(31, 0, 22)], ["walker", Vector3(33, 0, 27)], ["cop", Vector3(36, 0, 24)]]:
		var z := game.spawn_enemy(e[0], e[1])
		z.alerted = true


func tick(delta: float) -> void:
	if chapter < 0 or game.player.dead or _ending:
		return
	var p: Player = game.player
	var c: Dictionary = Data.CHAPTERS[chapter]
	_hint_t = maxf(0.0, _hint_t - delta)
	if _finished:
		return
	var here := p.global_position
	match String(c.kind):
		"reach":
			var goal: Vector3 = c.goal
			var dist := Vector2(here.x - goal.x, here.z - goal.z).length()
			if chapter == 0 and not p.weapons.has("pistol"):
				if dist < 6.0 and _hint_t <= 0.0:
					_hint_t = 6.0
					game.hud.toast("FIND A WEAPON FIRST")
				return
			if chapter == 6:
				if dist < 5.0:
					_ending = true
					game.win()
				return
			if dist < 3.5:
				complete()
		"gate":
			var gp: Vector3 = Vector3(25.0, 0, 24.0)
			var dist2 := Vector2(here.x - gp.x, here.z - gp.z).length()
			if dist2 < 4.5:
				if has_cutters and not gate_open:
					gate_open = true
					game.world.open_gate()
					game.sfx.play("clank", 0.0)
					game.hud.toast("CHAIN CUT")
					_spawn_group_gate()
					complete()
				elif not has_cutters and _hint_t <= 0.0:
					_hint_t = 6.0
					game.hud.toast("THE GATE IS CHAINED — FIND BOLT CUTTERS")
		"survive":
			survive_t += delta
			var alive := get_tree().get_nodes_in_group("enemies").size()
			var wave_times := [2.0, 10.0, 18.0, 27.0, 36.0]
			if _waves_done < wave_times.size() and survive_t >= wave_times[_waves_done]:
				_waves_done += 1
				_horde_wave(_waves_done)
			game.hud.set_objective("Survive the horde in the church yard  (%d s)" % maxi(0, int(45.0 - survive_t)))
			if survive_t >= 45.0 and alive <= 2:
				complete()
		"boss":
			if boss == null and here.z > 86.0 and not boss_dead:
				boss = game.spawn_enemy("warden", Vector3(6, 0, 124))
				boss.alerted = true
				game.sfx.play("roar", 3.0, 0.8)
				game.hud.boss_hp(1.0)
				game.hud.say([["ROHAN", "That's the Warden. Aim for the head."]])
				game.hud.set_goal(Vector3(0, 0, 112))
		_:
			pass


func _horde_wave(n: int) -> void:
	var count := 3 + n
	var kinds := ["walker", "walker", "runner", "nurse", "cop"]
	game.sfx.play("scream", 0.0, 0.8)
	for i in range(count):
		var side := randi() % 3
		var pos := Vector3.ZERO
		match side:
			0: pos = Vector3(randf_range(34, 70), 0, 4)
			1: pos = Vector3(randf_range(34, 70), 0, 50)
			_: pos = Vector3(74, 0, randf_range(8, 46))
		var k: String = kinds[randi() % kinds.size()]
		if n == 4 and i == 0:
			k = "bloater"
		var z := game.spawn_enemy(k, pos)
		z.alerted = true
