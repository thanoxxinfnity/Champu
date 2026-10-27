extends SceneTree
## Three phones, one real matchmaking server (server/server.py, started by the caller, URL in CS_SERVER) and real WebRTC: a custom room is made, two friends
## join with its code, the host starts, the handshake codes travel through the server, and all three end up connected with names and teams of 4.

var phones: Array = []          # [Node root, MultiplayerController, OnlineSession]
var rooms := []
var ready_hosts := []


func _until(cond: Callable, secs: float) -> float:
	var t0 := Time.get_ticks_msec()
	while float(Time.get_ticks_msec() - t0) / 1000.0 < secs:
		if cond.call():
			break
		await process_frame
	return float(Time.get_ticks_msec() - t0) / 1000.0


func _initialize() -> void:
	var url := OS.get_environment("CS_SERVER")
	if url == "" or not MultiplayerController.available():
		print("no server / WebRTC: skipped")
		T.done(self)
		return
	for nm in ["A", "B", "C"]:
		var r := Node.new()
		r.name = nm
		root.add_child(r)
	await process_frame
	for nm in ["A", "B", "C"]:
		set_multiplayer(MultiplayerAPI.create_default_interface(), NodePath("/root/" + nm))
		var r := root.get_node(nm)
		var net := MultiplayerController.new()
		net.name = "Net"
		r.add_child(net)
		var on := OnlineSession.new()
		on.name = "On"
		r.add_child(on)
		on.setup(net, url)
		phones.append([r, net, on])
	var a: OnlineSession = phones[0][2]
	var b: OnlineSession = phones[1][2]
	var c: OnlineSession = phones[2][2]
	var infos := {}
	var failed := []
	for i in 3:
		var ii := i
		(phones[i][2] as OnlineSession).room_info.connect(func(info: Dictionary) -> void: infos[ii] = info)
		(phones[i][2] as OnlineSession).failed.connect(func(m: String) -> void: failed.append(m))
	a.match_ready.connect(func() -> void: ready_hosts.append(1))
	a.begin("create", "team", "", "Alice", "outlaw")
	var t := await _until(func() -> bool: return infos.has(0), 15.0)
	T.check(infos.has(0) and String(infos[0].code).length() == 4 and bool(infos[0].host), "host gets a room code (%.1f s): %s" % [t, str(infos.get(0, {}).get("code", ""))])
	var code := String(infos[0].code)
	b.begin("join", "team", code, "Bob", "ninja")
	c.begin("join", "team", code, "Cleo", "engineer")
	await _until(func() -> bool: return infos.has(0) and (infos[0].players as Array).size() == 3, 15.0)
	T.check((infos[0].players as Array).size() == 3, "the host's room lists 3 players")
	T.check(infos.has(1) and not bool(infos[1].host), "a joiner is not the host")
	var teams := []
	for p in infos[0].players:
		teams.append(int(p.team))
	T.check(teams == [0, 0, 0], "team match: 3 players share team 0 (%s)" % str(teams))
	a.start_room()
	t = await _until(func() -> bool: return not ready_hosts.is_empty() or not failed.is_empty(), 40.0)
	T.check(failed.is_empty(), "nobody failed: %s" % str(failed))
	T.check(not ready_hosts.is_empty(), "the host is told every phone is connected (%.1f s)" % t)
	var na: MultiplayerController = phones[0][1]
	var nb: MultiplayerController = phones[1][1]
	var nc: MultiplayerController = phones[2][1]
	await _until(func() -> bool: return nb.roster.size() == 3 and nc.roster.size() == 3, 10.0)
	T.check(na.roster.size() == 3 and nb.roster.size() == 3 and nc.roster.size() == 3, "all three phones know the room: %s" % str(na.roster))
	T.check(nb.local_id == 2 and nc.local_id == 3, "joiners got the ids the server gave them (%d, %d)" % [nb.local_id, nc.local_id])
	T.check(a.names.get(2, "") == "Bob" and a.names.get(3, "") == "Cleo" and b.names.get(1, "") == "Alice", "names travel with the room")
	T.check(String(na.roster.get(2, "")) == "ninja" and String(na.roster.get(3, "")) == "engineer", "the host knows their heroes")
	a.finish()
	b.finish()
	c.finish()
	T.check(not a.mm.is_open(), "the server link is closed once the match starts")
	T.done(self)
