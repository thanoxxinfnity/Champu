extends SceneTree
## Hero skills: buying levels costs coins and stops at the top, the levels change the hero's real stats (health, speed, jetpack, damage taken, vehicle speed),
## they belong to one hero each, they are saved, and the battle-card data (rarity, stats) exists for every hero.   godot --headless --path . --fixed-fps 60 -s tests/skills_test.gd

var _orig_save := {}


func _initialize() -> void:
	_orig_save = Data.load_save()
	var save := Data.load_save()
	save.coins = 100000
	save.skills = {}
	T.check(Data.SKILL_ORDER.size() >= 12, "there are %d skills to level up" % Data.SKILL_ORDER.size())
	T.check(Data.skill_cost(0, "vitality") == 80 and Data.skill_cost(5, "vitality") > Data.skill_cost(1, "vitality"), "levels get more expensive (%d, %d, %d)" % [Data.skill_cost(0, "vitality"), Data.skill_cost(1, "vitality"), Data.skill_cost(5, "vitality")])
	var coins0: int = save.coins
	T.check(Data.skill_buy(save, "outlaw", "vitality") and Data.skill_level(save, "outlaw", "vitality") == 1 and int(save.coins) == coins0 - 80, "buying a level spends the coins")
	for i in 9:
		Data.skill_buy(save, "outlaw", "vitality")
	T.check(Data.skill_level(save, "outlaw", "vitality") == Data.SKILL_MAX and not Data.skill_buy(save, "outlaw", "vitality"), "a skill stops at level %d" % Data.SKILL_MAX)
	T.check(Data.skill_level(save, "kafu", "vitality") == 0, "skills belong to one hero only")
	save.coins = 5
	T.check(Data.skill_buyable(save, "outlaw", "armor") != "" and not Data.skill_buy(save, "outlaw", "armor"), "no coins, no skill")
	save.coins = 100000
	for sid in Data.SKILL_ORDER:
		for i in 10:
			Data.skill_buy(save, "outlaw", sid)
	var base: Dictionary = Data.CAST["outlaw"]
	var e: Dictionary = Data.effective("outlaw", save)
	T.check(float(e.hp) > float(base.hp) * 1.39, "VITALITY 10: +40%% health (%.0f -> %.0f)" % [float(base.hp), float(e.hp)])
	T.check(float(e.speed) > float(base.speed) * 1.24, "SPRINT 10: +25%% run speed (%.1f -> %.1f)" % [float(base.speed), float(e.speed)])
	T.check(float(e.dmg_taken) < 0.8, "TOUGH SKIN 10: damage taken x%.2f" % float(e.dmg_taken))
	T.check(float(e.drive_mult) > 1.29 and float(e.ride_mult) > 1.29, "DRIVING and HORSEMANSHIP 10: x%.2f / x%.2f" % [float(e.drive_mult), float(e.ride_mult)])
	T.check(float(e.cost_mult) < 0.75 and float(e.dmg_mult) > 1.29 and float(e.melee_mult) > 1.39, "EFFICIENCY, FIREPOWER, MELEE MASTERY apply")
	T.check(float(Data.CAST["outlaw"].hp) == float(base.hp), "the base hero data is never changed")
	T.check(Data.effective("kafu", save).hp == Data.CAST["kafu"].hp, "another hero is unchanged")
	T.check(Data.skill_now("vitality", 3) == "now +12% max health" and Data.skill_now("driving", 5).begins_with("now +15% vehicle speed, +15% handling"), "the screen says what a level gives (%s)" % Data.skill_now("driving", 5))
	# a player and a car feel the skills
	var game := await T.boot(self)
	game.save = save
	game.mode = "world"
	game.match_type = "solo"
	game.sel = Data.CAST_ORDER.find("outlaw")
	game.start_play()
	await T.frames(self, 30)
	var p := game.player
	T.check(is_equal_approx(p.max_hp, float(e.hp)) and p.info.drive_mult > 1.29, "the player in the match has the levelled stats (%.0f HP)" % p.max_hp)
	var car: Vehicle
	for m in game.world.mounts:
		if m is Vehicle and (m as Vehicle).spec.max == 38.0:
			car = m
			break
	p.global_position = car.global_position + Vector3(-3, 0.5, 0)
	game._ride()
	T.check(p.mount == car and is_equal_approx(car.skill, float(e.drive_mult)), "boarding a car applies DRIVING (x%.2f)" % car.skill)
	game._ride()
	T.check(car.skill == 1.0, "getting off clears it")
	# the heroes' cards
	var rar := {}
	for id in Data.CAST_ORDER:
		rar[Data.rarity_of(id)] = true
		var st := Data.card_stats(id)
		T.check(st.size() == 3 and float(st[0]) > 0.0 and ResourceLoader.exists("res://assets/ui/cards/%s.png" % id) and ResourceLoader.exists("res://assets/ui/full/%s.png" % id), "%s has a battle card, stats and portraits" % id)
	T.check(rar.size() == 4, "all four rarities are used (%s)" % str(rar.keys()))
	T.check(Data.CAST_ORDER.size() >= 14 and Data.CAST.has("kafu") and Data.CAST.has("rachel") and Data.CAST.has("rina") and Data.CAST.has("mococo"), "the four anime girls are in the shop (%d heroes)" % Data.CAST_ORDER.size())
	Data.write_save(_orig_save)               # (the game saves at the end of a run: leave no skills behind for the other tests)
	T.done(self)
