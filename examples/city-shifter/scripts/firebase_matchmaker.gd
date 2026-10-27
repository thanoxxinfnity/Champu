class_name FirebaseMatchmaker
extends Matchmaker
## Squad lobbies (custom rooms) on the Firebase Realtime Database, REST only. It speaks Matchmaker's signals, so OnlineSession runs unchanged.
##   lobbies/<code>            {host, mt, created_at, updated_at, members: {uid: {n, c, ready, ts}}}   (polled every second)
##   signal/<code>/go          the start order (the lobby itself is deleted the moment the host presses START)
##   signal/<code>/msgs/…      the WebRTC offer/answer codes, one message per player, deleted once read
## Cleanup with no one doing anything: START deletes the lobby, leaving (or closing the game) deletes my member slot (the host leaving deletes the
## lobby), the signal node goes once the match is connected, and making a new room deletes every lobby or signal older than 10 minutes.

const POLL := 1.0
const BEAT := 5.0
const MEMBER_STALE := 20
const ROOM_TTL := 600
const SQUAD_MAX := 4

var db: FirebaseRest
var uid := 0
var _mode := ""                      # "" | host | guest | match
var _mt := "team"
var _code := ""
var _poll := 0.0
var _beat := 0.0
var _busy := false
var _members := {}                   # uid -> {n, c, ready, ts}
var _ids := {}                       # uid -> room id (host = 1)
var _host_uid := 0
var _seen_msgs := {}
var _guest_wait := 0.0
var _gone := false


func _ready() -> void:
	db = FirebaseRest.new()
	add_child(db)


func open(_server_url: String, pname: String, cid: String) -> void:
	close()
	user_name = pname
	char_id = cid
	if uid == 0:
		uid = randi_range(10000000, 99999999)
	ready_ok = true
	set_process(true)
	connected_ok.emit.call_deferred()


func close() -> void:
	_mode = ""
	_members.clear()
	_ids.clear()
	_seen_msgs.clear()
	ready_ok = false
	in_room = false
	room = {}
	set_process(false)


func is_open() -> bool:
	return ready_ok


func quick(mt: String) -> void:
	failed.emit("Quick match runs on the relay")       # (OnlineSession uses P2PMatchmaker for quick matches)


func create(mt: String) -> void:
	_mt = mt
	_code = P2PMatchmaker.make_code()
	_mode = "host"
	_host_uid = uid
	_sweep_old()
	var now := FirebaseRest.now()
	_members = {uid: {"n": user_name, "c": char_id, "ready": true, "ts": now, "j": now}}
	await db.put("/lobbies/%s.json" % _code, {"host": uid, "mt": mt, "created_at": now, "updated_at": now, "members": {str(uid): _members[uid]}})
	_emit_room()


func join(code: String) -> void:
	_code = code.strip_edges().to_upper()
	_mode = "guest"
	_guest_wait = 0.0
	var lob = await db.get_("/lobbies/%s.json" % _code)
	if not (lob is Dictionary):
		_mode = ""
		failed.emit("No squad with the code %s" % _code)
		return
	var members: Dictionary = lob.get("members", {}) if lob.get("members") is Dictionary else {}
	if members.size() >= SQUAD_MAX and not members.has(str(uid)):
		_mode = ""
		failed.emit("That squad is full (4 / 4)")
		return
	var now := FirebaseRest.now()
	await db.put("/lobbies/%s/members/%d.json" % [_code, uid], {"n": user_name, "c": char_id, "ready": false, "ts": now, "j": now})
	_poll = POLL


func set_ready(r: bool) -> void:
	if _mode == "guest":
		db.patch("/lobbies/%s/members/%d.json" % [_code, uid], {"ready": r, "ts": FirebaseRest.now()})
		if _members.has(uid):
			_members[uid]["ready"] = r


func all_ready() -> bool:
	if _members.size() < 2:
		return false
	for u in _members:
		if int(u) != _host_uid and not bool(_members[u].get("ready", false)):
			return false
	return true


## START: the go order is written next to the lobby, then the lobby is deleted right away (before the loading screen).
func start() -> void:
	if _mode != "host" or not all_ready():
		return
	var ids := _order()
	_assign(ids)
	var players := _players(ids)
	var go_msg := {"code": _code, "mt": _mt, "list": ids, "players": players, "ts": FirebaseRest.now()}
	await db.put("/signal/%s/go.json" % _code, go_msg)
	db.delete("/lobbies/%s.json" % _code)
	_mode = "match"
	go.emit(players, _mt)


func leave() -> void:
	wipe_me()
	in_room = false
	room = {}


## Leaving or closing the game: my slot goes; the host takes the whole lobby with it.
func wipe_me() -> void:
	if _code == "" or _gone:
		return
	if _mode == "host":
		db.delete("/lobbies/%s.json" % _code)
		db.delete("/signal/%s.json" % _code)
	elif _mode == "guest":
		db.delete("/lobbies/%s/members/%d.json" % [_code, uid])
	_mode = ""


## The match is connected: the handshake messages are no longer needed.
func done_connecting() -> void:
	if _code != "" and _host_uid == uid:
		db.delete("/signal/%s.json" % _code)


func sig(to: int, d: Dictionary) -> void:
	var to_u := _uid_of(to)
	db.post("/signal/%s/msgs.json" % _code, {"from": int(_ids.get(uid, 0)), "to_u": to_u, "d": d, "ts": FirebaseRest.now()})


func _uid_of(room_id: int) -> int:
	for u in _ids:
		if int(_ids[u]) == room_id:
			return int(u)
	return 0


func _order() -> Array:
	var ids: Array = _members.keys()
	ids.sort_custom(func(a, b) -> bool:
		if int(a) == _host_uid:
			return true
		if int(b) == _host_uid:
			return false
		return int(_members[a].get("j", 0)) < int(_members[b].get("j", 0)))
	return ids


func _assign(ids: Array) -> void:
	_ids.clear()
	for i in ids.size():
		_ids[int(ids[i])] = 1 if i == 0 else int(ids[i])


func _players(ids: Array) -> Array:
	var out := []
	for i in ids.size():
		var u := int(ids[i])
		var m: Dictionary = _members.get(u, {})
		out.append({"id": int(_ids[u]), "name": String(m.get("n", "PLAYER")), "team": 0 if _mt == "team" else i, "host": i == 0,
			"char": String(m.get("c", "outlaw")), "ready": i == 0 or bool(m.get("ready", false))})
	return out


func _emit_room() -> void:
	var ids := _order()
	_assign(ids)
	room = {"t": "room", "code": _code, "mt": _mt, "you": int(_ids.get(uid, 0)), "host": _host_uid == uid, "players": _players(ids),
		"max": SQUAD_MAX, "all_ready": all_ready()}
	in_room = true
	room_changed.emit(room)


func _process(delta: float) -> void:
	if _mode == "":
		return
	_beat += delta
	if _beat >= BEAT and (_mode == "host" or _mode == "guest"):
		_beat = 0.0
		var now := FirebaseRest.now()
		if _mode == "host":
			db.patch("/lobbies/%s.json" % _code, {"updated_at": now})
		db.patch("/lobbies/%s/members/%d.json" % [_code, uid], {"ts": now})
	_poll += delta
	if _poll >= (POLL if _mode != "match" else 0.6) and not _busy:
		_poll = 0.0
		_sync()


func _sync() -> void:
	_busy = true
	if _mode == "host" or _mode == "guest":
		var lob = await db.get_("/lobbies/%s.json" % _code)
		if lob is Dictionary:
			_host_uid = int(lob.get("host", _host_uid))
			_mt = String(lob.get("mt", _mt))
			var mem: Dictionary = lob.get("members", {}) if lob.get("members") is Dictionary else {}
			_members.clear()
			var now := FirebaseRest.now()
			for k in mem:
				var m = mem[k]
				if not (m is Dictionary):
					continue
				if _mode == "host" and int(k) != uid and now - int(m.get("ts", now)) > MEMBER_STALE:
					db.delete("/lobbies/%s/members/%s.json" % [_code, k])      # a phone that vanished (no network): its slot goes
					continue
				_members[int(k)] = m
			if _mode == "guest" and not _members.has(uid):
				_guest_wait += POLL
				if _guest_wait > 6.0:
					_mode = ""
					failed.emit("You were removed from the squad")
			else:
				_emit_room()
		elif _mode == "guest":
			# the lobby is gone: either the host started (go is waiting) or the squad was closed
			var g = await db.get_("/signal/%s/go.json" % _code)
			if g is Dictionary and (g.get("list", []) as Array).map(func(x) -> int: return int(x)).has(uid):
				var ids: Array = (g.get("list", []) as Array).map(func(x) -> int: return int(x))
				_assign(ids)
				_mode = "match"
				go.emit(g.get("players", []), String(g.get("mt", _mt)))
			elif lob == null:
				_mode = ""
				closed.emit("the host closed the squad")
	elif _mode == "match":
		var msgs = await db.get_("/signal/%s/msgs.json" % _code)
		if msgs is Dictionary:
			for k in msgs:
				var m = msgs[k]
				if _seen_msgs.has(k) or not (m is Dictionary) or int(m.get("to_u", 0)) != uid:
					continue
				_seen_msgs[k] = true
				db.delete("/signal/%s/msgs/%s.json" % [_code, k])
				sig_received.emit(int(m.get("from", 0)), m.get("d", {}) if m.get("d") is Dictionary else {})
	_busy = false


## Making a room cleans the house: every lobby whose host stopped updating it more than 10 minutes ago goes, and old handshake nodes, invites and
## presence beats too.
func _sweep_old() -> void:
	var keys = await db.get_("/lobbies.json?shallow=true")
	var now := FirebaseRest.now()
	if keys is Dictionary:
		for k in (keys as Dictionary).keys().slice(0, 40):
			var t = await db.get_("/lobbies/%s/updated_at.json" % k)
			if t == null or (t is float or t is int) and now - int(t) > ROOM_TTL:
				db.delete("/lobbies/%s.json" % k)
	var sigs = await db.get_("/signal.json?shallow=true")
	if sigs is Dictionary:
		for k in (sigs as Dictionary).keys().slice(0, 40):
			var g = await db.get_("/signal/%s/go/ts.json" % k)
			if g == null or (g is float or g is int) and now - int(g) > ROOM_TTL:
				db.delete("/signal/%s.json" % k)
	var pres = await db.get_("/presence.json")
	if pres is Dictionary:
		for k in (pres as Dictionary).keys().slice(0, 200):
			if not (pres[k] is Dictionary) or now - int(pres[k].get("ts", 0)) > ROOM_TTL:
				db.delete("/presence/%s.json" % k)                  # a phone that stopped without saying goodbye
	var inv = await db.get_("/lobby_invites.json?shallow=true")
	if inv is Dictionary:
		for k in (inv as Dictionary).keys().slice(0, 40):
			var box = await db.get_("/lobby_invites/%s.json" % k)
			if box is Dictionary:
				for j in box:
					if box[j] is Dictionary and now - int(box[j].get("ts", 0)) > ROOM_TTL:
						db.delete("/lobby_invites/%s/%s.json" % [k, j])
