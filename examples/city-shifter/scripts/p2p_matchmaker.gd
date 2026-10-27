class_name P2PMatchmaker
extends Matchmaker
## Matchmaking with no server of our own: the phones find each other through ntfy.sh (a free public publish/subscribe relay over HTTPS) and then talk
## directly over WebRTC (Google's free STUN server punches through the NAT of mobile data and home Wi-Fi). It speaks the same signals as Matchmaker,
## so OnlineSession runs unchanged.
##   quick match  every searching phone says "seek" on the quick topic every few seconds; the one searching longest leads; after WAIT seconds (or with a
##                full room) the leader says GO with the list. Nobody else came: "alone" (the match starts with bots).
##   custom room  the creator picks a 6-digit code and leads; friends type it and say "join"; the creator presses START.
##   handshake    the WebRTC offer and answer codes travel on the room topic, addressed to one player.

const RELAY := "https://ntfy.sh/"
const WS_RELAY := "wss://ntfy.sh/"
const APP := "cshift7k2q"            # topic prefix: only City Shifter phones use these topics
const WAIT := 90.0                    # a quick match waits this long for players, then starts with whoever is there
const SEEK_EVERY := 6.0
const STALE := 16.0
const MAX_MSG := 3900

var uid := 0
var _seek_ts := 0                    # when I started searching (ms): the oldest searcher leads
var _mode := ""                      # "" | quick | host | guest | match
var _mt := "solo"
var _code := ""
var _seen := {}                      # uid -> {n, c, ts, t (seconds since heard)}
var _beat := 0.0
var _clock := 0.0
var _sub: WebSocketPeer
var _sub_topic := ""
var _http: HTTPRequest
var _outbox: Array = []              # [topic, text]
var _busy := false
var _members := {}                   # my room as the host sees it: uid -> {n, c}
var _go_sent := false
var _ids := {}                       # uid -> room id (1 = host)
var _guest_wait := 0.0


func open(_server_url: String, pname: String, cid: String) -> void:
	close()
	user_name = pname
	char_id = cid
	uid = randi_range(2, 1 << 28)
	if _http == null:
		_http = HTTPRequest.new()
		_http.timeout = 10.0
		add_child(_http)
		_http.request_completed.connect(func(_r: int, _code_: int, _h: PackedStringArray, _b: PackedByteArray) -> void:
			_busy = false)
	ready_ok = true
	set_process(true)
	connected_ok.emit.call_deferred()


func close() -> void:
	if _sub != null:
		_sub.close()
	_sub = null
	_sub_topic = ""
	_mode = ""
	_seen.clear()
	_members.clear()
	_ids.clear()
	_outbox.clear()
	_go_sent = false
	ready_ok = false
	in_room = false
	room = {}
	set_process(false)


func is_open() -> bool:
	return ready_ok


func quick(mt: String) -> void:
	_mt = mt
	_mode = "quick"
	_seek_ts = int(Time.get_unix_time_from_system() * 1000.0)
	_seen = {uid: {"n": user_name, "c": char_id, "ts": _seek_ts, "t": 0.0}}
	_listen("%s-q-%s" % [APP, mt], int(Time.get_unix_time_from_system()) - 2)
	_beat = SEEK_EVERY
	_room_from_seekers()


func create(mt: String) -> void:
	_mt = mt
	_mode = "host"
	_code = "%06d" % randi_range(0, 999999)
	_members = {uid: {"n": user_name, "c": char_id}}
	_listen("%s-c-%s" % [APP, _code], int(Time.get_unix_time_from_system()) - 2)
	_beat = SEEK_EVERY
	_host_room()


func join(code: String) -> void:
	_mode = "guest"
	_guest_wait = 0.0
	_code = code
	_listen("%s-c-%s" % [APP, _code], int(Time.get_unix_time_from_system()) - 30)
	_beat = SEEK_EVERY


func start() -> void:
	if _mode == "host" and _members.size() >= 2:
		_send_go(_members.keys())


func leave() -> void:
	if _mode in ["quick", "guest", "host"] and _sub_topic != "":
		_publish(_sub_topic, {"t": "bye", "u": uid})
		_pump_out()
	in_room = false
	room = {}


func sig(to: int, d: Dictionary) -> void:
	var to_uid := _uid_of(to)
	var msg := {"t": "sig", "from": _ids.get(uid, 0), "to_u": to_uid, "d": d}
	var text := JSON.stringify(msg)
	if text.length() > MAX_MSG and d.has("code"):
		status_text("handshake code too long for the relay")
	_publish(_topic(), msg)


func status_text(s: String) -> void:
	push_warning("P2PMatchmaker: " + s)


# ── internals ────────────────────────────────────────────────────────────────

func _topic() -> String:
	return "%s-c-%s" % [APP, _code] if _code != "" else _sub_topic


func _uid_of(room_id: int) -> int:
	for u in _ids:
		if int(_ids[u]) == room_id:
			return int(u)
	return 0


func _listen(topic: String, since: int) -> void:
	if _sub != null:
		_sub.close()
	_sub_topic = topic
	_sub = WebSocketPeer.new()
	_sub.inbound_buffer_size = 1 << 18
	if _sub.connect_to_url("%s%s/ws?since=%d" % [WS_RELAY, topic, since]) != OK:
		_sub = null
		failed.emit("Could not reach the match relay. Check your internet.")


func _publish(topic: String, msg: Dictionary) -> void:
	_outbox.append([topic, JSON.stringify(msg)])
	if OS.get_environment("CS_P2P_DEBUG") != "":
		print("[p2p %.1f] out %s (%d queued)" % [_clock, String(msg.get("t", "")) + ("/" + String((msg.get("d", {}) as Dictionary).get("k", "")) if msg.has("d") else ""), _outbox.size()])


func _pump_out() -> void:
	if _busy or _outbox.is_empty() or _http == null:
		return
	var item: Array = _outbox.pop_front()
	_busy = true
	if _http.request(RELAY + String(item[0]), ["Content-Type: text/plain"], HTTPClient.METHOD_POST, String(item[1])) != OK:
		_busy = false


func _process(delta: float) -> void:
	_clock += delta
	_pump_out()
	if _sub != null:
		_sub.poll()
		var st := _sub.get_ready_state()
		if st == WebSocketPeer.STATE_CLOSED and _mode != "":
			_listen(_sub_topic, int(Time.get_unix_time_from_system()) - 5)    # dropped: listen again (the last seconds are fetched again)
		while _sub != null and _sub.get_available_packet_count() > 0:
			var ev = JSON.parse_string(_sub.get_packet().get_string_from_utf8())
			if ev is Dictionary and String(ev.get("event", "")) == "message":
				var m = JSON.parse_string(String(ev.get("message", "")))
				if m is Dictionary:
					_on_relay(m)
	for u in _seen.keys():
		if int(u) != uid:
			_seen[u].t = float(_seen[u].t) + delta
			if float(_seen[u].t) > STALE:
				_seen.erase(u)
	_beat += delta
	match _mode:
		"quick":
			if _beat >= SEEK_EVERY:
				_beat = 0.0
				_publish(_sub_topic, {"t": "seek", "u": uid, "ts": _seek_ts, "n": user_name, "c": char_id, "left": _left()})
				_room_from_seekers()
			if _leader() == uid and not _go_sent:
				var ids := _seekers()
				if ids.size() >= Data.MAX_PLAYERS or _left() <= 0.0:
					if ids.size() < 2:
						_mode = ""
						alone.emit()
					else:
						_code = "%06d" % randi_range(0, 999999)
						_send_go(ids)
		"host":
			if _beat >= SEEK_EVERY:
				_beat = 0.0
				_host_room()
		"guest":
			_guest_wait += delta
			if not in_room and _guest_wait > 25.0:
				_mode = ""
				failed.emit("No room with that code (the host must keep the room open)")
			if _beat >= SEEK_EVERY:
				_beat = 0.0
				_publish(_sub_topic, {"t": "join", "u": uid, "n": user_name, "c": char_id})


func _wait_s() -> float:
	var e := OS.get_environment("CS_P2P_WAIT")          # (tests shorten the wait)
	return float(e) if e != "" else WAIT


func _left() -> float:
	var lead := _leader()
	var ts: int = int(_seen.get(lead, {"ts": _seek_ts}).ts)
	return _wait_s() - (Time.get_unix_time_from_system() * 1000.0 - float(ts)) / 1000.0


func _seekers() -> Array:
	var ids: Array = _seen.keys()
	ids.sort_custom(func(a, b) -> bool:
		var ta: int = int(_seen[a].ts)
		var tb: int = int(_seen[b].ts)
		return ta < tb or (ta == tb and int(a) < int(b)))
	return ids.slice(0, Data.MAX_PLAYERS)


func _leader() -> int:
	var s := _seekers()
	return int(s[0]) if not s.is_empty() else uid


func _team_of(i: int) -> int:
	return i if _mt == "solo" else i / Data.TEAM_SIZE


## Room ids: the leader is 1 (the WebRTC star needs the host at 1), the others keep their own random numbers.
func _assign(ids: Array) -> void:
	_ids.clear()
	for i in ids.size():
		_ids[int(ids[i])] = 1 if i == 0 else int(ids[i])


func _players_of(ids: Array, info: Dictionary) -> Array:
	var out := []
	for i in ids.size():
		var u := int(ids[i])
		out.append({"id": int(_ids[u]), "name": String(info.get(u, {}).get("n", "PLAYER")), "team": _team_of(i), "host": i == 0})
	return out


func _room_from_seekers() -> void:
	var ids := _seekers()
	_assign(ids)
	var players := _players_of(ids, _seen)
	room = {"t": "room", "code": "QUICK", "mt": _mt, "you": int(_ids.get(uid, 0)), "host": _leader() == uid, "players": players,
		"max": Data.MAX_PLAYERS, "countdown": maxf(0.0, _left())}
	in_room = true
	room_changed.emit(room)


func _host_room() -> void:
	var ids: Array = _members.keys()
	ids.erase(uid)
	ids.push_front(uid)
	_assign(ids)
	var players := _players_of(ids, _members)
	room = {"t": "room", "code": _code, "mt": _mt, "you": 1, "host": true, "players": players, "max": Data.MAX_PLAYERS}
	in_room = true
	room_changed.emit(room)
	_publish(_sub_topic, {"t": "room", "code": _code, "mt": _mt, "list": ids, "names": _members})


func _send_go(ids: Array) -> void:
	_go_sent = true
	_assign(ids)
	var info := _seen if _mode == "quick" else _members
	var players := _players_of(ids, info)
	var go_msg := {"t": "go", "code": _code, "mt": _mt, "list": ids, "players": players}
	_publish(_sub_topic, go_msg)
	_enter_match(go_msg)


func _enter_match(m: Dictionary) -> void:
	_code = String(m.get("code", _code))
	var ids: Array = m.get("list", [])
	_assign(ids)
	_mode = "match"
	var topic := "%s-c-%s" % [APP, _code]
	if topic != _sub_topic:
		_listen(topic, int(Time.get_unix_time_from_system()) - 20)
	var players: Array = m.get("players", [])
	go.emit(players, String(m.get("mt", _mt)))


static func _ints(a) -> Array:
	var out := []
	if a is Array:
		for x in a:
			out.append(int(x))
	return out


func _on_relay(m: Dictionary) -> void:
	var from_u := int(m.get("u", 0))
	if OS.get_environment("CS_P2P_DEBUG") != "":
		print("[p2p %.1f] in  %s" % [_clock, String(m.get("t", "")) + ("/" + String((m.get("d", {}) as Dictionary).get("k", "")) if m.has("d") else "")])
	if m.has("list"):
		m["list"] = _ints(m["list"])
	match String(m.get("t", "")):
		"seek":
			if _mode == "quick" and from_u != uid:
				_seen[from_u] = {"n": String(m.get("n", "PLAYER")), "c": String(m.get("c", "outlaw")), "ts": int(m.get("ts", 0)), "t": 0.0}
				_room_from_seekers()
		"bye":
			if _seen.has(from_u):
				_seen.erase(from_u)
				if _mode == "quick":
					_room_from_seekers()
			if _mode == "host" and _members.has(from_u):
				_members.erase(from_u)
				_host_room()
		"join":
			if _mode == "host" and from_u != uid and not _members.has(from_u) and _members.size() < Data.MAX_PLAYERS:
				_members[from_u] = {"n": String(m.get("n", "PLAYER")), "c": String(m.get("c", "outlaw"))}
				_host_room()
		"room":
			if _mode == "guest":
				var ids: Array = m.get("list", [])
				if not ids.has(uid):
					return
				var names: Dictionary = m.get("names", {})
				var info := {}
				for k in names:
					info[int(k)] = names[k]
				_mt = String(m.get("mt", _mt))
				_assign(ids)
				room = {"t": "room", "code": _code, "mt": _mt, "you": int(_ids.get(uid, 0)), "host": false, "players": _players_of(ids, info), "max": Data.MAX_PLAYERS}
				in_room = true
				room_changed.emit(room)
		"go":
			if (_mode == "quick" or _mode == "guest") and (m.get("list", []) as Array).has(uid):
				_enter_match(m)
		"sig":
			if _mode == "match" and int(m.get("to_u", 0)) == uid:
				sig_received.emit(int(m.get("from", 0)), m.get("d", {}) if m.get("d") is Dictionary else {})
