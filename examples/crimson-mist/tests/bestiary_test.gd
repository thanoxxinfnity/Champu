extends SceneTree
## The bestiary: 35 kinds, men and women, each spawns, has a trait, and the special ones do their special thing (spit, scream, lunge, burn, armor, burst, run).

func _initialize() -> void:
	T.check(Bestiary.count() >= 30 and Bestiary.count() <= 35, "between 30 and 35 kinds (%d)" % Bestiary.count())
	var men := 0
	var women := 0
	for id in Bestiary.ids():
		if Bestiary.sex_of(id) == "M":
			men += 1
		else:
			women += 1
	T.check(men >= 12 and women >= 12, "both sexes are well represented (%d men, %d women)" % [men, women])
	var names := {}
	for id in Bestiary.ids():
		var d := Bestiary.def(id)
		T.check(d.has("hp") and d.has("speed") and d.has("dmg") and d.has("reach") and d.has("cd") and d.has("sight") and d.has("hear") and d.has("tint"), "%s has every stat" % id)
		T.check(not names.has(d.name), "%s: the name is its own (%s)" % [id, d.name])
		names[d.name] = true
	# every kind is placed somewhere in the chapter
	var placed := {}
	for z in Story.SPAWNS:
		for s in Story.SPAWNS[z]:
			placed[s[0]] = true
	for id in Bestiary.ids():
		T.check(placed.has(id), "%s appears in the chapter" % id)

	var game := await T.boot(self)
	await T.start(self, game)
	game.world.power_on()
	game.story.finished = true
	var p := game.player
	p.max_hp = 2000.0
	p.hp = 2000.0
	p.global_position = Vector3(0, 0, -30)
	# every kind can be spawned and gets the stats of its trait
	var made: Array = []
	for id in Bestiary.ids():
		var e := game.spawn_enemy(id, Vector3(30 + made.size() * 0.1, 0, -400), "x")
		made.append(e)
	await T.frames(self, 3)
	for e in made:
		T.check(is_instance_valid(e) and e.def.name != "" and e.trait_id != "", "%s spawned with trait %s" % [e.kind, e.trait_id])
		e.queue_free()
	await T.frames(self, 2)

	# armor: the same hit hurts an armored kind less than a plain walker
	var plain := game.spawn_enemy("mist_walker", Vector3(0, 0, -300), "x")
	var tank := game.spawn_enemy("ashen_trooper", Vector3(0, 0, -302), "x")
	plain.take_damage(40.0, Vector3(0, 0, -290), 0.0)
	tank.take_damage(40.0, Vector3(0, 0, -290), 0.0)
	T.check((tank.max_hp - tank.hp) < (plain.max_hp - plain.hp) * 0.6, "armor soaks a hit (%.1f vs %.1f)" % [tank.max_hp - tank.hp, plain.max_hp - plain.hp])
	plain.queue_free()
	tank.queue_free()

	# runner outpaces a shambler
	T.check(float(Bestiary.def("night_jogger").speed) > float(Bestiary.def("mist_walker").speed) * 2.0, "the jogger is much faster than a walker")

	# spitter: from range it winds up and a glob flies; the player is hurt and slowed
	p.global_position = Vector3(0, 0, -30)
	var sp := game.spawn_enemy("plague_doctor", Vector3(0, 0, -41), "market")
	sp.wake()
	var hp0 := p.hp
	var globs := 0
	for i in 420:
		await process_frame
		globs = maxi(globs, game.get_children().filter(func(n): return n is Glob).size())
		if p.hp < hp0:
			break
	T.check(globs > 0, "the spitter lobs acid from range")
	T.check(p.hp < hp0, "the acid lands (%.0f damage)" % (hp0 - p.hp))
	sp.take_damage(999.0, p.global_position)

	# screamer: its scream wakes sleepers nearby
	p.global_position = Vector3(0, 0, -30)
	var sc := game.spawn_enemy("pale_bride", Vector3(0, 0, -42), "church")
	var sleeper := game.spawn_enemy("mist_walker", Vector3(8, 0, -60), "church")
	T.check(sleeper.state == Enemy.S.DORMANT, "a sleeper sleeps")
	sc.wake()
	for i in 240:
		await process_frame
		if sleeper.state != Enemy.S.DORMANT:
			break
	T.check(sleeper.state != Enemy.S.DORMANT, "the scream woke the sleeper")
	sc.take_damage(999.0, p.global_position)
	sleeper.take_damage(999.0, p.global_position)

	# leaper: closes distance faster than walking speed during the lunge
	p.global_position = Vector3(0, 0, -30)
	var lp := game.spawn_enemy("hungry_waitress", Vector3(0, 0, -37), "market")
	lp.wake()
	var peak := 0.0
	var hp1 := p.hp
	for i in 300:
		await process_frame
		peak = maxf(peak, Vector2(lp.velocity.x, lp.velocity.z).length())
		if p.hp < hp1:
			break
	T.check(peak > 9.0, "the leaper lunges (peak speed %.1f)" % peak)
	lp.take_damage(999.0, p.global_position)

	# burning: standing next to one hurts
	p.global_position = Vector3(0, 0, -30)
	var bn := game.spawn_enemy("cinder_fighter", Vector3(0, 0, -31.6), "road")
	bn.wake()
	var hp2 := p.hp
	await T.frames(self, 90)
	T.check(p.hp < hp2, "the burning one scorches whoever stands close (%.0f)" % (hp2 - p.hp))
	bn.take_damage(999.0, p.global_position)

	# burst: a swollen kind bursts when it dies and slows the player
	p.global_position = Vector3(0, 0, -30)
	var bm := game.spawn_enemy("spore_mother", Vector3(0, 0, -31.5), "church")
	bm.take_damage(999.0, p.global_position)
	T.check(bm.is_dead() and p._slow_t > 0.0, "a spore mother bursts into slowing spores")
	T.done(self)
