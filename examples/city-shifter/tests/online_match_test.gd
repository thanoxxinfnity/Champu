extends SceneTree
## Two real game processes (host and client) play one online match through the matchmaking server and WebRTC. Run both with tests/run_online_match.sh.
##   host:   create a room, wait for the friend, START, check the 2-player match, hit the friend, count the friend's death
##   client: join with the code, play, take a hit from the host, report a death

var role := "host"
var game: Main


func _until(cond: Callable, secs: float) -> bool:
	var t0 := Time.get_ticks_msec()
	while float(Time.get_ticks_msec() - t0) / 1000.0 < secs:
		if cond.call():
			return true
		await process_frame
	return cond.call()


func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a == "--client":
			role = "client"
	var url := OS.get_environment("CS_SERVER")
	var code_file := OS.get_environment("CS_CODE_FILE")
	game = await T.boot(self, "outlaw" if role == "host" else "ninja")
	game.online._url = url
	game.save.name = "HostBot" if role == "host" else "ClientBot"
	game.sel = maxi(0, Data.CAST_ORDER.find("outlaw" if role == "host" else "ninja"))
	var infos := []
	game.online.room_info.connect(func(i: Dictionary) -> void: infos.append(i))
	if OS.get_environment("CS_QUICK") == "1":
		game._online_request("quick", "solo", "")
	elif role == "host":
		game._online_request("create", "solo", "")
		T.check(await _until(func() -> bool: return not infos.is_empty(), 15.0), "host: room made (%s)" % (String(infos[0].code) if not infos.is_empty() else "?"))
		var f := FileAccess.open(code_file, FileAccess.WRITE)
		f.store_string(String(infos[0].code))
		f.close()
		T.check(await _until(func() -> bool: return not infos.is_empty() and (infos[-1].players as Array).size() == 2, 40.0), "host: friend joined the room")
		game._online_start()
	else:
		T.check(await _until(func() -> bool: return FileAccess.file_exists(code_file) and FileAccess.get_file_as_string(code_file).length() >= 4, 40.0), "client: got the code")
		game._online_request("join", "solo", FileAccess.get_file_as_string(code_file))
	var t_go := Time.get_ticks_msec()
	game.online.status.connect(func(s: String) -> void: print("[%5.1f s] status: %s" % [float(Time.get_ticks_msec() - t_go) / 1000.0, s]))
	T.check(await _until(func() -> bool: return game.state == Main.State.PLAY and game.mc != null, 120.0), "%s: the match started (%.1f s)" % [role, float(Time.get_ticks_msec() - t_go) / 1000.0])
	T.check(await _until(func() -> bool: return game.remotes.size() == 1, 30.0), "%s: I see the other player (%.1f s)" % [role, float(Time.get_ticks_msec() - t_go) / 1000.0])
	await T.frames(self, 30)
	var mc: MatchController = game.mc
	var other: PlayerController = game.remotes.values()[0] if not game.remotes.is_empty() else null
	T.check(mc.actors.size() == 2 and other != null, "%s: two players in the match, no bots (%d)" % [role, mc.actors.size()])
	T.check(other != null and other.display_name == ("ClientBot" if role == "host" else "HostBot"), "%s: the other's name arrived (%s)" % [role, other.display_name if other != null else "?"])
	T.check(mc.team_score.size() == 2 and game.player.team != other.team, "%s: solo means different teams" % role)
	T.check(mc.is_authority == (role == "host"), "%s: only the host counts the score" % role)
	await T.frames(self, 600)
	if role == "host":
		# hit the client: its phone judges, and its hp drops
		var before := other.hp
		Combat.hurt(game.player, other, 30.0)
		await T.frames(self, 10)
		# the client reports its death (it kills itself below); the host counts the kill for the host
		T.check(await _until(func() -> bool: return game.player.kills == 1, 40.0), "host: the friend's death was counted as my kill")
		T.check(await _until(func() -> bool: return other.deaths >= 1, 5.0), "host: and as the friend's death (%d)" % other.deaths)
		# drop and take: the host picks up a weapon that lies close, the client must see it vanish
		T.check(await _until(func() -> bool: return other.hp > 0.0 and other.alive, 60.0), "host: the friend is back after the respawn")
		FileAccess.open(OS.get_environment("CS_CODE_FILE") + ".done", FileAccess.WRITE).store_string("1")
	else:
		T.check(await _until(func() -> bool: return game.player.hp < game.player.max_hp, 45.0), "client: the host's hit lowered my hp (%.0f)" % game.player.hp)
		game.player.shield = 0.0
		game.player.take_damage(9999.0, other)
		T.check(not game.player.alive, "client: I died")
		T.check(await _until(func() -> bool: return other.kills == 1, 15.0), "client: the host's kill count reached me (%d)" % other.kills)
		T.check(await _until(func() -> bool: return game.player.alive, 60.0), "client: I respawned after 4 s")
		await _until(func() -> bool: return FileAccess.file_exists(code_file + ".done"), 40.0)
		other = null   # the host quits next; do not touch its freed actor
	T.done(self)
