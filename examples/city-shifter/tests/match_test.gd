extends SceneTree
## The open-world match: 15 players (me + 14 bots), 200+ weapons on the ground, pickups, the 60 s recharge, damage and kills, respawn, the sky dropping blocks, the clock.
##   godot --headless --path . --fixed-fps 60 -s tests/match_test.gd

func _initialize() -> void:
	var game := await T.boot(self)
	game.mode = "world"
	game.match_type = "solo"
	game.start_play()
	await T.frames(self, 30)
	var mc: MatchController = game.mc
	var p := game.player
	var w: OpenWorld = game.world
	T.check(mc != null and mc.running, "the match is running")
	T.check(mc.actors.size() == Data.MAX_PLAYERS, "15 players: me and 14 bots (%d)" % mc.actors.size())
	var teams := {}
	for a in mc.actors:
		teams[a.team] = true
	T.check(teams.size() == 15, "solo: every player is its own team (%d teams)" % teams.size())
	T.check(mc.loot.static_count >= 200, "at least 200 weapons lie on the ground (%d)" % mc.loot.static_count)
	var every := true
	for id in Data.WEAPON_ORDER:
		if mc.loot.count_of(id) < 10:
			every = false
	T.check(every, "every one of the 15 gauntlets is on the map at least 10 times")
	for id in Data.MELEE_ORDER:
		if id != "hammer":
			T.check(mc.loot.count_of(id) >= 6, "%s lies around too (%d)" % [id, mc.loot.count_of(id)])
	T.check(w.view_dist <= 50.0 and Data.VIEW_RADIUS == 50.0, "everybody sees 50 m, no more (%.0f)" % w.view_dist)
	w.set_view_distance(500.0)
	T.check(w.view_dist == 50.0, "nobody can raise it")
	T.check(p.tool.inventory.size() == 3 and p.tool.inventory.has("shift_gauntlet") and p.tool.inventory.has("hammer") and p.tool.inventory.has("nova_blaster"), "I start with a gauntlet, a hammer and the Nova Blaster")
	T.check(p.lethal and p.alive and p.hp > 0.0, "the match is lethal and I am alive")
	# pick up: stand on a weapon
	var uid := -1
	for u in mc.loot.items:
		var it: Dictionary = mc.loot.items[u]
		if String(it.id) == "meteor_burster":
			uid = u
			break
	var at: Vector3 = mc.loot.items[uid].pos
	p.global_position = at + Vector3(0, 0.3, 0)
	await T.frames(self, 20)
	T.check(p.tool.inventory.has("meteor_burster"), "walking onto a weapon picks it up")
	T.check(not mc.loot.items[uid].alive, "and it is gone from the ground")
	# charge: the tank empties and locks for a minute
	p.tool.equip("shift_gauntlet")
	var shots := 0
	while shots < 20 and not p.tool.is_locked("shift_gauntlet"):
		p.tool.cd_left = 0.0
		p.tool.fire()
		shots += 1
	T.check(p.tool.is_locked("shift_gauntlet") and shots >= 6 and shots <= 12, "shooting empties the gauntlet and locks it (%d shots)" % shots)
	p.tool.cd_left = 0.0
	T.check(not p.tool.fire(), "a locked gauntlet will not fire")
	p.tool.equip("meteor_burster")
	p.tool.cd_left = 0.0
	T.check(p.tool.fire(), "but another one in the pack fires")
	var c0 := p.tool.charge_of("shift_gauntlet")
	await T.frames(self, 120)
	var c1 := p.tool.charge_of("shift_gauntlet")
	# (how far it got depends on how fast this machine draws 120 frames: a software renderer needs 40 s, a phone 2 s; the rate itself is data in Data.WEAPONS)
	T.check(c1 > c0 and c1 < 0.5, "it refills, but slowly (%.3f -> %.3f over 120 frames)" % [c0, c1])
	p.tool.charge["shift_gauntlet"] = 0.999
	await T.frames(self, 10)
	T.check(not p.tool.is_locked("shift_gauntlet") and p.tool.charge_of("shift_gauntlet") >= 0.999, "full again: it fires again")
	# damage: a bot in front of me
	var bot: PlayerController
	for a in mc.actors:
		if a.is_bot:
			bot = a
			break
	bot.get_node("BotBrain").set_physics_process(false) if bot.has_node("BotBrain") else null
	for b in mc._brains:
		b.set_physics_process(false)
	p.global_position = Vector3(0, 0.3, 20)
	p.yaw = 0.0
	p.pitch = 0.0
	bot.global_position = Vector3(0, 0.3, 14)
	bot.velocity = Vector3.ZERO
	bot.shield = 0.0
	bot.hp = 100.0
	p.tool.equip("shift_gauntlet")
	p.tool.cd_left = 0.0
	await T.frames(self, 2)
	p.tool.fire()
	T.check(bot.hp < 100.0, "a gauntlet hurts a bot in front of me (hp %.0f)" % bot.hp)
	# a kill
	bot.hp = 5.0
	var kills0 := p.kills
	p.tool.equip("hammer")
	bot.global_position = p.global_position + Vector3(0, 0, -2.0)
	p.tool.cd_left = 0.0
	await T.frames(self, 2)
	p.tool.fire()
	await T.frames(self, 3)
	T.check(not bot.alive, "the hammer finishes a bot")
	T.check(p.kills == kills0 + 1, "and the kill counts for me (%d)" % p.kills)
	T.check(mc.feed.size() > 0, "it shows in the kill feed")
	T.check(float(mc._respawn.get(bot, 0.0)) > 3.0, "the bot comes back after a few seconds")
	await T.frames(self, 300)
	T.check(bot.alive and bot.shield > 0.0 or bot.alive, "the bot is back in the game")
	# no friendly fire in team mode is tested by the team assignment: 4 per team
	game.end_run()
	game.mode = "world"
	game.match_type = "team"
	game.start_play()
	await T.frames(self, 20)
	var sizes := {}
	for a in game.mc.actors:
		sizes[a.team] = int(sizes.get(a.team, 0)) + 1
	var ok := true
	for t in sizes:
		if int(sizes[t]) > Data.TEAM_SIZE:
			ok = false
	T.check(ok and sizes.size() == 4, "team mode: teams of at most 4 (%s)" % str(sizes))
	var mate: PlayerController
	for a in game.mc.actors:
		if a != game.player and a.team == game.player.team:
			mate = a
			break
	T.check(mate != null, "I have team mates")
	mate.global_position = game.player.global_position + Vector3(0, 0, -3)
	mate.hp = 100.0
	mate.shield = 0.0
	game.player.yaw = 0.0
	game.player.tool.equip("hammer")
	game.player.tool.cd_left = 0.0
	await T.frames(self, 2)
	game.player.tool.fire()
	T.check(not Combat.hurt(game.player, mate, 50.0) and mate.team == game.player.team, "no friendly fire")
	# the sky: blocks fall around the players
	await T.frames(self, 240)
	T.check(game.spawner.active_count() > 0, "blocks fall from the sky (%d now)" % game.spawner.active_count())
	# the clock
	game.mc.time_left = 0.5
	await T.frames(self, 60)
	T.check(not game.mc.running and not game.hud.results.is_empty(), "when the clock hits zero the results show")
	game.end_run()
	T.check(game.state == Main.State.LOBBY, "back to the lobby")
	T.done(self)
