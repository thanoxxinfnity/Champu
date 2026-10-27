class_name FirebaseSocialManager
extends Node
## Guest identity, friends and squad invites on the Firebase Realtime Database (REST only, no sign-in):
##   profile     an 8-digit UID made on the first start, kept with the name and the friends in user://player_profile.json (only on the phone)
##   presence/<uid>            {n, ts, room}: a heartbeat every 30 s while the game runs; friends read it to show who is online
##   friend_requests/<uid>/…   "add me back": read and deleted at once
##   lobby_invites/<uid>/…     squad invites: read and deleted at once (accept or decline, nothing stays behind)
## Squad lobbies themselves are FirebaseMatchmaker (lobbies/<code>), which wipes them when the match starts or everybody leaves.

signal friends_changed
signal invite_received(from_uid: int, from_name: String, code: String, mt: String)
signal request_received(from_uid: int, from_name: String)

const FIREBASE_BASE_URL: String = FirebaseRest.FIREBASE_BASE_URL
const PATH := "user://player_profile.json"
const BEAT := 30.0
const POLL := 2.5
const FRIENDS_POLL := 15.0
const ONLINE_FOR := 80.0

var uid := 0
var player_name := "PLAYER"
var friends := {}                    # uid (int) -> {"n": name}
var online := {}                     # uid -> seconds since their last heartbeat
var room_code := ""                  # my open squad (in the heartbeat, so friends see it)
var db: FirebaseRest
var _beat := BEAT
var _poll := 0.0
var _fpoll := FRIENDS_POLL
var _busy_poll := false
var _busy_friends := false
var _enabled := true


func _ready() -> void:
	load_profile()
	db = FirebaseRest.new()
	db.name = "Db"
	add_child(db)
	if DisplayServer.get_name() == "headless" and OS.get_environment("CS_SOCIAL") == "":
		_enabled = false                       # (tests stay off the network unless they ask)


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
	_beat = BEAT


func is_online(u: int) -> bool:
	return online.has(u) and float(online[u]) < ONLINE_FOR


## Add a friend by UID: kept on this phone, and a request goes to them (they get a popup to add me back).
func add_friend(u: int, n := "") -> bool:
	if u < 10000000 or u > 99999999 or u == uid:
		return false
	if not friends.has(u):
		friends[u] = {"n": n if n != "" else "UID %d" % u}
		save_profile()
		friends_changed.emit()
		_fpoll = FRIENDS_POLL
	if _enabled:
		db.post("/friend_requests/%d.json" % u, {"from": uid, "n": player_name, "ts": FirebaseRest.now()})
	return true


func remove_friend(u: int) -> void:
	friends.erase(u)
	online.erase(u)
	save_profile()
	friends_changed.emit()


func invite(u: int, code: String, mt: String) -> void:
	if _enabled and code != "":
		db.post("/lobby_invites/%d.json" % u, {"from": uid, "n": player_name, "code": code, "mt": mt, "ts": FirebaseRest.now()})


func _process(delta: float) -> void:
	if not _enabled:
		return
	for u in online.keys():
		online[u] = float(online[u]) + delta
	_beat += delta
	if _beat >= BEAT:
		_beat = 0.0
		db.put("/presence/%d.json" % uid, {"n": player_name, "ts": FirebaseRest.now(), "room": room_code})
	_poll += delta
	if _poll >= POLL and not _busy_poll:
		_poll = 0.0
		_check_inbox()
	_fpoll += delta
	if _fpoll >= FRIENDS_POLL and not _busy_friends and not friends.is_empty():
		_fpoll = 0.0
		_check_friends()


## Invites and friend requests waiting for me: each is handled and deleted at once.
func _check_inbox() -> void:
	_busy_poll = true
	var inv = await db.get_("/lobby_invites/%d.json" % uid)
	if inv is Dictionary:
		for k in inv:
			var m = inv[k]
			db.delete("/lobby_invites/%d/%s.json" % [uid, k])
			if m is Dictionary and FirebaseRest.now() - int(m.get("ts", 0)) < 120:
				invite_received.emit(int(m.get("from", 0)), String(m.get("n", "PLAYER")), String(m.get("code", "")), String(m.get("mt", "team")))
	var req = await db.get_("/friend_requests/%d.json" % uid)
	if req is Dictionary:
		for k in req:
			var m2 = req[k]
			db.delete("/friend_requests/%d/%s.json" % [uid, k])
			if m2 is Dictionary:
				var from := int(m2.get("from", 0))
				if friends.has(from):
					online[from] = 0.0
					friends_changed.emit()
				elif from != uid:
					request_received.emit(from, String(m2.get("n", "PLAYER")))
	_busy_poll = false


func _check_friends() -> void:
	_busy_friends = true
	var changed := false
	for u in friends.keys():
		var p = await db.get_("/presence/%d.json" % int(u))
		if p is Dictionary:
			var age := float(FirebaseRest.now() - int(p.get("ts", 0)))
			online[int(u)] = maxf(0.0, age)
			var n := String(p.get("n", ""))
			if n != "" and String(friends[u].get("n", "")) != n:
				friends[u]["n"] = n
				save_profile()
			changed = true
		elif online.has(int(u)):
			online.erase(int(u))
			changed = true
	if changed:
		friends_changed.emit()
	_busy_friends = false


## The game is closing: my presence goes (the rest is wiped by the lobby code).
func goodbye() -> void:
	if _enabled:
		await db.delete("/presence/%d.json" % uid)
