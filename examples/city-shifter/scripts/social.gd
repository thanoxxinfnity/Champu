class_name Social
extends Node
## Guest identity and friends with no sign-in and no database:
##   profile   an 8-digit UID made on the first start, kept with the name and the friends in user://player_profile.json (on the phone only)
##   presence  while the game runs, a heartbeat goes to my presence topic on the free public relay (ntfy.sh) every 30 s; my friends listen to it
##   inbox     friend requests and squad invites are sent to the friend's inbox topic; I listen to mine
## Nothing is stored anywhere but the phones: relay messages expire by themselves (there is nothing to clean up).

signal friends_changed
signal invite_received(from_uid: int, from_name: String, code: String, mt: String)
signal request_received(from_uid: int, from_name: String)

const PATH := "user://player_profile.json"
const RELAY := "https://ntfy.sh/"
const WS_RELAY := "wss://ntfy.sh/"
const APP := "cshift7k2q"
const BEAT := 30.0
const ONLINE_FOR := 80.0

var uid := 0
var player_name := "PLAYER"
var friends := {}                    # uid (int) -> {"n": name}
var online := {}                     # uid -> seconds since the last heartbeat
var room_code := ""                  # my open squad room (sent in the heartbeat, so friends can join)
var _sub: WebSocketPeer
var _sub_url := ""
var _http: HTTPRequest
var _outbox: Array = []
var _busy := false
var _beat := BEAT
var _enabled := true


func _ready() -> void:
	load_profile()
	_http = HTTPRequest.new()
	_http.timeout = 10.0
	add_child(_http)
	_http.request_completed.connect(func(_a: int, _b: int, _c: PackedStringArray, _d: PackedByteArray) -> void: _busy = false)
	if DisplayServer.get_name() == "headless" and OS.get_environment("CS_SOCIAL") == "":
		_enabled = false                       # (tests stay off the relay unless they ask for it)
	_resubscribe()


func load_profile() -> void:
	if FileAccess.file_exists(PATH):
		var d = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if d is Dictionary:
			uid = int(d.get("uid", 0))
			player_name = String(d.get("name", "PLAYER"))
			var f = d.get("friends", {})
			if f is Dictionary:
				for k in f:
					friends[int(k)] = f[k]
	if uid < 10000000:
		uid = randi_range(10000000, 99999999)
		save_profile()


func save_profile() -> void:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({"uid": uid, "name": player_name, "friends": friends}))


func set_player_name(n: String) -> void:
	player_name = n if n != "" else "PLAYER"
	save_profile()


func is_online(u: int) -> bool:
	return online.has(u) and float(online[u]) < ONLINE_FOR


## Add a friend by UID: kept on this phone, and a request goes to them (they get a popup to add me back).
func add_friend(u: int, n := "") -> bool:
	if u < 10000000 or u == uid:
		return false
	if not friends.has(u):
		friends[u] = {"n": n if n != "" else "UID %d" % u}
		save_profile()
		_resubscribe()
		friends_changed.emit()
	_publish("%s-i-%d" % [APP, u], {"t": "req", "u": uid, "n": player_name})
	return true


func remove_friend(u: int) -> void:
	friends.erase(u)
	online.erase(u)
	save_profile()
	_resubscribe()
	friends_changed.emit()


func invite(u: int, code: String, mt: String) -> void:
	_publish("%s-i-%d" % [APP, u], {"t": "inv", "u": uid, "n": player_name, "code": code, "mt": mt})


func _resubscribe() -> void:
	if not _enabled:
		return
	var topics := ["%s-i-%d" % [APP, uid]]
	for f in friends:
		topics.append("%s-p-%d" % [APP, int(f)])
	var url := "%s%s/ws?since=%d" % [WS_RELAY, ",".join(topics), int(Time.get_unix_time_from_system()) - 90]
	if url == _sub_url and _sub != null:
		return
	if _sub != null:
		_sub.close()
	_sub_url = url
	_sub = WebSocketPeer.new()
	if _sub.connect_to_url(url) != OK:
		_sub = null
	_beat = BEAT


func _publish(topic: String, msg: Dictionary) -> void:
	if _enabled:
		_outbox.append([topic, JSON.stringify(msg)])


func _process(delta: float) -> void:
	if not _enabled:
		return
	if not _busy and not _outbox.is_empty():
		var it: Array = _outbox.pop_front()
		_busy = true
		if _http.request(RELAY + String(it[0]), ["Content-Type: text/plain"], HTTPClient.METHOD_POST, String(it[1])) != OK:
			_busy = false
	_beat += delta
	if _beat >= BEAT:
		_beat = 0.0
		_publish("%s-p-%d" % [APP, uid], {"t": "hb", "u": uid, "n": player_name, "room": room_code})
	for u in online.keys():
		online[u] = float(online[u]) + delta
	if _sub == null:
		return
	_sub.poll()
	if _sub.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		_sub = null
		_sub_url = ""
		_resubscribe.call_deferred()
		return
	while _sub != null and _sub.get_available_packet_count() > 0:
		var ev = JSON.parse_string(_sub.get_packet().get_string_from_utf8())
		if not (ev is Dictionary) or String(ev.get("event", "")) != "message":
			continue
		var m = JSON.parse_string(String(ev.get("message", "")))
		if not (m is Dictionary):
			continue
		var from := int(m.get("u", 0))
		var age := Time.get_unix_time_from_system() - float(ev.get("time", 0))
		match String(m.get("t", "")):
			"hb":
				if friends.has(from):
					online[from] = maxf(0.0, age)
					var n := String(m.get("n", ""))
					if n != "" and String(friends[from].get("n", "")) != n:
						friends[from]["n"] = n
						save_profile()
					friends_changed.emit()
			"req":
				if from != uid and age < 600.0:
					if friends.has(from):
						online[from] = 0.0
						friends_changed.emit()
					else:
						request_received.emit(from, String(m.get("n", "PLAYER")))
			"inv":
				if from != uid and age < 120.0:
					invite_received.emit(from, String(m.get("n", "PLAYER")), String(m.get("code", "")), String(m.get("mt", "team")))


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		room_code = ""
