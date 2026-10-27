extends SceneTree
## Two phones over the internet relay: B adds A by UID (A gets a friend request and adds B back), A creates a squad and invites B, B accepts,
## readies up, A starts: both are in one match. Run with tests/run_social.sh (CS_SOCIAL=1 turns the relay on in tests).

var role := "a"


func _until(cond: Callable, secs: float) -> bool:
	var t0 := Time.get_ticks_msec()
	while float(Time.get_ticks_msec() - t0) / 1000.0 < secs:
		if cond.call():
			return true
		await process_frame
	return cond.call()


func _initialize() -> void:
	for x in OS.get_cmdline_user_args():
		if x == "--b":
			role = "b"
	var f := OS.get_environment("CS_UID_FILE")
	var game: Main = await T.boot(self, "outlaw" if role == "a" else "ninja")
	var so: FirebaseSocialManager = game.social
	so.uid = 10000000 + randi() % 89999999
	so.friends.clear()
	so.set_player_name("ALPHA" if role == "a" else "BRAVO")
	game.online.guest_uid = so.uid
	T.check(so.uid >= 10000000 and so.uid <= 99999999, "%s: an 8-digit guest UID (%d)" % [role, so.uid])
	if role == "a":
		FileAccess.open(f, FileAccess.WRITE).store_string(str(so.uid))
		var req := []
		so.request_received.connect(func(u: int, n: String) -> void: req.append([u, n]))
		T.check(await _until(func() -> bool: return not req.is_empty(), 40.0), "a: a friend request arrived")
		var b_uid: int = req[0][0]
		so.add_friend(b_uid, String(req[0][1]))
		T.check(await _until(func() -> bool: return so.is_online(b_uid), 70.0), "a: my friend shows online")
		game.lobby.show_screen("online")
		game._online_request("create", "team", "")
		T.check(await _until(func() -> bool: return String(game.lobby._room.get("code", "")).length() == 6, 20.0), "a: squad made (%s)" % String(game.lobby._room.get("code", "")))
		T.check(game.lobby.screen == "squad" and game._squad_nodes.size() == 1, "a: the squad screen with my hero on the first pedestal")
		so.invite(b_uid, String(game.lobby._room.code), "team")
		T.check(await _until(func() -> bool: return (game.lobby._room.get("players", []) as Array).size() == 2, 60.0), "a: my friend came in by the invite")
		T.check(await _until(func() -> bool: return game._squad_nodes.size() == 2, 5.0), "a: two heroes stand on the pedestals")
		T.check(await _until(func() -> bool: return bool(game.lobby._room.get("all_ready", false)), 40.0), "a: everybody is READY, START opens")
		game.lobby.start_room.emit()
	else:
		T.check(await _until(func() -> bool: return FileAccess.file_exists(f) and FileAccess.get_file_as_string(f).length() == 8, 30.0), "b: got A's UID")
		var a_uid := int(FileAccess.get_file_as_string(f))
		var inv := []
		so.invite_received.connect(func(u: int, n: String, code: String, mt: String) -> void: inv.append([u, n, code, mt]))
		T.check(so.add_friend(a_uid), "b: added A by UID")
		T.check(await _until(func() -> bool: return not inv.is_empty(), 120.0), "b: the squad invite arrived")
		game.lobby.show_screen("online")
		game._online_request("join", String(inv[0][3]), String(inv[0][2]))
		T.check(await _until(func() -> bool: return game.lobby.screen == "squad" and (game.lobby._room.get("players", []) as Array).size() == 2, 40.0), "b: I am in A's squad")
		game.lobby.squad_ready.emit(true)
	T.check(await _until(func() -> bool: return game.state == Main.State.PLAY and game.mc != null, 150.0), "%s: the match started" % role)
	T.check(await _until(func() -> bool: return game.remotes.size() == 1, 60.0), "%s: I see my friend in the match" % role)
	T.check(game.match_type == "team", "%s: a team match" % role)
	FileAccess.open(f + "." + role, FileAccess.WRITE).store_string("1")
	var other := "b" if role == "a" else "a"
	await _until(func() -> bool: return FileAccess.file_exists(f + "." + other), 60.0)     # (stay until my friend has seen me too)
	if role == "a":
		var code := String(game.lobby._room.get("code", ""))
		var lob = await game.social.db.get_("/lobbies/%s.json" % code)
		T.check(lob == null, "a: the squad lobby was wiped from Firebase when the match started (%s)" % code)
		var box = await game.social.db.get_("/lobby_invites/%d.json" % game.social.uid)
		T.check(box == null, "a: no invites left behind")
		await T.frames(self, 120)
		var sg = await game.social.db.get_("/signal/%s.json" % code)
		T.check(sg == null, "a: the handshake node was wiped once connected")
	T.done(self)
