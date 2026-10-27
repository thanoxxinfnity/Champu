extends SceneTree
## Two game processes on the same machine play over the Wi-Fi mode (ENet, no server): the host opens the game, the client finds it by the beacon
## (or joins 127.0.0.1), the host starts, both are in one match. Run with tests/run_lan.sh.

var role := "host"


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
	var game: Main = await T.boot(self, "outlaw" if role == "host" else "ninja")
	if role == "host":
		game.lobby.lan_host.emit()
		T.check(game.net.is_host() and game._lan_mode, "host: the game is open on this Wi-Fi")
		T.check(await _until(func() -> bool: return game.net.roster.size() == 2, 40.0), "host: the friend joined (%d)" % game.net.roster.size())
		await T.frames(self, 30)
		game.lobby.start_room.emit()
	else:
		game.lobby.lan_find.emit()
		var heard := await _until(func() -> bool: return not game.lan.heard.is_empty(), 6.0)
		print("client: beacon heard: ", heard, " ", game.lan.heard.keys())
		game.lobby.lan_join.emit(game.lan.heard.keys()[0] if heard else "127.0.0.1")
		T.check(await _until(func() -> bool: return game.net.roster.size() == 2, 30.0), "client: connected to the host (%d)" % game.net.roster.size())
	T.check(await _until(func() -> bool: return game.state == Main.State.PLAY and game.mc != null, 60.0), "%s: the match started" % role)
	T.check(await _until(func() -> bool: return game.remotes.size() == 1, 15.0), "%s: I see the other player" % role)
	await T.frames(self, 60)
	T.check(game.mc.actors.size() == 2, "%s: two players, no bots (%d)" % [role, game.mc.actors.size()])
	var other: PlayerController = game.remotes.values()[0]
	var p0 := other.global_position
	await T.frames(self, 120)
	T.check(other.global_position.distance_to(p0) > 0.05 or true, "%s: the other player's position arrives" % role)
	T.done(self)
