extends SceneTree
## Every skill, in the real game: the same hero at skill level 0 and at level 10 plays the open world, and what happens is measured (not the numbers in the data file):
## health, jetpack tank and cooling, running, damage taken, the air dash, car speed (DRIVING), horse speed (HORSEMANSHIP), gauntlet damage and shot cost, melee damage, bridge life, coins.
##   godot --headless --path . --fixed-fps 60 -s tests/skills_play_test.gd

var game: Main


func _skills(level: int) -> Dictionary:
	var d := {}
	for sid in Data.SKILL_ORDER:
		d[sid] = level
	return {"outlaw": d}


func _measure(level: int) -> Dictionary:
	game.save.skills = _skills(level)
	game.mode = "world"
	game.match_type = "solo"
	game.sel = Data.CAST_ORDER.find("outlaw")
	game.start_play()
	await T.frames(self, 20)
	var m := {}
	var p := game.player
	var mc: MatchController = game.mc
	for b in mc._brains:
		b.set_physics_process(false)
	m.hp = p.max_hp
	m.fuel = p.max_fuel
	m.cool = p.jet.cool_mult
	m.dash = float(p.info.dash_mult)
	# running: 1.5 s straight over the open ground
	p.global_position = Vector3(0, 0.3, 150)
	p.yaw = 0.0
	p.velocity = Vector3.ZERO
	await T.frames(self, 5)
	var z0 := p.global_position.z
	game.hud.move = Vector2(0, 1)
	await T.frames(self, 90)
	game.hud.move = Vector2.ZERO
	m.run = z0 - p.global_position.z
	# damage taken
	p.shield = 0.0
	p.hp = p.max_hp
	p.take_damage(40.0, null)
	m.taken = p.max_hp - p.hp
	# a bot: gauntlet and hammer
	var bot: PlayerController
	for a in mc.actors:
		if a.is_bot:
			bot = a
			break
	p.global_position = Vector3(0, 0.3, 120)
	p.yaw = 0.0
	p.pitch = 0.0
	bot.global_position = Vector3(0, 0.3, 114)
	bot.velocity = Vector3.ZERO
	bot.shield = 0.0
	bot.hp = 300.0
	bot.max_hp = 300.0
	p.shield = 0.0
	p.tool.equip("shift_gauntlet")
	p.tool.cd_left = 0.0
	var c0 := p.tool.charge_of("shift_gauntlet")
	await T.frames(self, 2)
	p.tool.fire()
	m.gaunt = 300.0 - bot.hp
	m.cost = c0 - p.tool.charge_of("shift_gauntlet")
	await T.frames(self, 30)
	bot.hp = 300.0
	bot.shield = 0.0
	bot.global_position = p.global_position + Vector3(0, 0, -2.0)
	bot.velocity = Vector3.ZERO
	p.tool.equip("hammer")
	p.tool.cd_left = 0.0
	await T.frames(self, 2)
	p.tool.fire()
	m.melee = 300.0 - bot.hp
	# bridge life
	p.tool.place_bridge()
	m.bridge = float(p.tool.live[p.tool.live.size() - 1].get_meta("ttl"))
	# coins
	var rc0 := game.run_coins
	game._on_broken(Vector3.ZERO, 10.0, Color.WHITE)
	m.coins = game.run_coins - rc0
	# a car at full throttle
	var car: Vehicle
	for mt in game.world.mounts:
		if mt is Vehicle and (mt as Vehicle).spec.max == 38.0:
			car = mt
			break
	p.global_position = car.global_position + Vector3(-3, 0.5, 0)
	game._ride()
	game.hud.move = Vector2(0, 1)
	var top := 0.0
	for i in 420:
		await physics_frame
		top = maxf(top, car.speed)
	m.car = top
	game.hud.move = Vector2.ZERO
	game._ride()
	# a horse at a full gallop
	var horse: Horse
	for mt in game.world.mounts:
		if mt is Horse:
			horse = mt
			break
	p.global_position = horse.global_position + Vector3(-2, 0.5, 0)
	game._ride()
	game.hud.move = Vector2(0, 1)
	var htop := 0.0
	for i in 300:
		await physics_frame
		htop = maxf(htop, horse.speed)
	m.horse = htop
	game.hud.move = Vector2.ZERO
	game._ride()
	game.end_run()
	await T.frames(self, 10)
	return m


var _orig_save := {}


func _initialize() -> void:
	_orig_save = Data.load_save()
	game = await T.boot(self)
	var a: Dictionary = await _measure(0)
	var b: Dictionary = await _measure(10)
	print("level 0:  ", a)
	print("level 10: ", b)
	T.check(float(b.hp) / float(a.hp) > 1.39, "VITALITY 10: health x%.2f" % (float(b.hp) / float(a.hp)))
	T.check(float(b.taken) / float(a.taken) < 0.78, "TOUGH SKIN 10: damage taken x%.2f" % (float(b.taken) / float(a.taken)))
	T.check(float(b.run) / float(a.run) > 1.18, "SPRINT 10: the same 1.5 s covers x%.2f the ground (%.1f m -> %.1f m)" % [float(b.run) / float(a.run), a.run, b.run])
	T.check(float(b.fuel) / float(a.fuel) > 1.45, "JET TANK 10: fuel x%.2f" % (float(b.fuel) / float(a.fuel)))
	T.check(float(b.cool) / float(a.cool) > 1.55, "COOLING 10: jetpack cools x%.2f faster" % (float(b.cool) / float(a.cool)))
	T.check(float(b.dash) / float(a.dash) < 0.65, "AIR DASH 10: the dash costs x%.2f the fuel (%.1f)" % [float(b.dash) / float(a.dash), 18.0 * float(b.dash)])
	T.check(float(b.car) / float(a.car) > 1.25, "DRIVING 10: the car's top speed %.1f -> %.1f m/s" % [a.car, b.car])
	T.check(float(b.horse) / float(a.horse) > 1.25, "HORSEMANSHIP 10: the gallop %.1f -> %.1f m/s" % [a.horse, b.horse])
	T.check(float(b.gaunt) / float(a.gaunt) > 1.25 and float(b.gaunt) / float(a.gaunt) < 1.36, "FIREPOWER 10: a gauntlet hit does x%.2f damage (%.0f -> %.0f)" % [float(b.gaunt) / float(a.gaunt), a.gaunt, b.gaunt])
	T.check(float(b.cost) / float(a.cost) < 0.75, "EFFICIENCY 10: a shot uses x%.2f of the charge" % (float(b.cost) / float(a.cost)))
	T.check(float(b.melee) / float(a.melee) > 1.7, "MELEE MASTERY 10 (+ firepower): the hammer does x%.2f (%.0f -> %.0f)" % [float(b.melee) / float(a.melee), a.melee, b.melee])
	T.check(float(b.bridge) / float(a.bridge) > 1.55, "BUILDER 10: a bridge block lives %.0f s -> %.0f s" % [a.bridge, b.bridge])
	T.check(float(b.coins) / float(a.coins) > 1.4, "TREASURE HUNTER 10: %d -> %d coins from the same blocks" % [a.coins, b.coins])
	Data.write_save(_orig_save)               # (the game saves at the end of a run: leave no skills behind for the other tests)
	T.done(self)
