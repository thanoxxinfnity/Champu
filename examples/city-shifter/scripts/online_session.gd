class_name OnlineSession
extends Node
## Turns the matchmaking server (Matchmaker) and the WebRTC star (MultiplayerController) into one online match:
##   lobby   quick match / custom room — the server lists the players and teams, the host presses START (a public room starts by itself)
##   go      the server says GO: the host opens the star, tells every joiner "ready"; each joiner makes an offer code, the server relays it to the host,
##           the host answers, the server relays the answer back — the same codes people used to paste by hand
##   ready   everybody is connected (or the wait ran out): the host starts the match and sends "start" to the others

signal room_info(info: Dictionary)
signal status(text: String)
signal match_ready
signal failed(msg: String)
signal offline_instead(mt: String)

const CONNECT_WAIT := 32.0

var mm: Matchmaker
var net: MultiplayerController
var phase := "idle"                 # idle | lobby | connecting | playing
var mt := "solo"
var my_id := 0
var names := {}                     # peer id -> display name
var teams := {}                     # peer id -> team
var expected := 0
var user_name := "PLAYER"
var char_id := "outlaw"
var _wait := 0.0
var _listing := ""
var _pending_offers: Array = []
var _linked := false                # a joiner whose direct link to the host is open


func setup(n: MultiplayerController, server_url := "") -> void:
	net = n
	_url = server_url if server_url != "" else Data.MATCH_SERVER
	_make_mm("p2p" if not _url.begins_with("ws") else "server")
	net.code_ready.connect(_on_code)
	net.peer_joined.connect(func(_id: int, _c: String) -> void: _check_all())
	net.connected.connect(func() -> void:
		_linked = true
		status.emit("Connected — waiting for the host to start…"))
	set_process(false)


## The finder: our own matchmaking server (a ws:// address) or, with no server, the phones find each other through a free public relay (P2PMatchmaker).
## kind: "server" (our own server.py), "p2p" (quick match on the public relay) or "firebase" (squad lobbies on the Firebase database).
func _make_mm(kind: String) -> void:
	if mm != null:
		var have := "firebase" if mm is FirebaseMatchmaker else ("p2p" if mm is P2PMatchmaker else "server")
		if have == kind:
			return
		mm.close()
		mm.queue_free()
	match kind:
		"firebase":
			mm = FirebaseMatchmaker.new()
			(mm as FirebaseMatchmaker).uid = guest_uid
		"p2p":
			mm = P2PMatchmaker.new()
		_:
			mm = Matchmaker.new()
	mm.name = "Matchmaker"
	add_child(mm)
	mm.failed.connect(_on_failed)
	mm.room_changed.connect(_on_room)
	mm.go.connect(_on_go)
	mm.sig_received.connect(_on_sig)
	mm.alone.connect(func() -> void:
		var m := mt
		_reset()
		offline_instead.emit(m))
	mm.closed.connect(func(why: String) -> void:
		if phase == "playing" or _linked:
			return                                  # (the host closes its server link once everybody is connected: the players already talk directly)
		_reset()
		failed.emit("The room was closed (%s)" % why))


var _url := ""
var guest_uid := 0                   # my 8-digit UID (FirebaseSocialManager): the squad lobby knows me by it
var _kind := ""
var _arg := ""


func active() -> bool:
	return phase != "idle"


## kind: "quick" | "create" | "join".
func begin(kind: String, match_type: String, code: String, pname: String, cid: String) -> void:
	_reset()
	_make_mm("server" if _url.begins_with("ws") else ("p2p" if kind == "quick" else "firebase"))
	phase = "lobby"
	mt = match_type
	user_name = pname
	char_id = cid
	_kind = kind
	_arg = code
	status.emit("Connecting to the server…")
	mm.connected_ok.connect(_send_request, Object.CONNECT_ONE_SHOT)
	mm.open(_url, pname, cid)


func _send_request() -> void:
	status.emit("Looking for players…")
	match _kind:
		"quick":
			mm.quick(mt)
		"create":
			mm.create(mt)
		_:
			mm.join(_arg)


func start_room() -> void:
	mm.start()


func set_ready(r: bool) -> void:
	mm.set_ready(r)


func leave() -> void:
	_reset()


func _reset() -> void:
	if mm != null:
		if mm.connected_ok.is_connected(_send_request):
			mm.connected_ok.disconnect(_send_request)
		mm.leave()
		mm.close()
	if net != null and phase != "idle" and net.online():
		net.reset()
	phase = "idle"
	_listing = ""
	_linked = false
	names.clear()
	teams.clear()
	expected = 0
	_pending_offers.clear()
	set_process(false)


## The match has really begun: the server is no longer needed.
func finish() -> void:
	phase = "playing"
	if mm != null:
		mm.close()
	set_process(false)


func _on_failed(msg: String) -> void:
	if phase == "idle":
		return
	_reset()
	failed.emit(msg)


func _on_room(m: Dictionary) -> void:
	if phase != "lobby":
		return
	my_id = int(m.get("you", 0))
	mt = String(m.get("mt", mt))
	var list: Array = []
	for p in m.get("players", []):
		list.append({"id": int(p.id), "name": String(p.name), "team": int(p.team), "host": bool(p.host), "you": int(p.id) == my_id,
			"char": String(p.get("char", "outlaw")), "ready": bool(p.get("ready", true))})
	var key := JSON.stringify([m.get("code"), list, m.get("host")])
	var cd = m.get("countdown")
	var st := ""
	if cd != null:
		st = "Match starts in %d s" % int(ceil(float(cd)))
	elif bool(m.get("host", false)):
		st = "You are the host — START when your friends are in"
	else:
		st = "Waiting for the host to start"
	if key != _listing:
		_listing = key
		room_info.emit({"state": "room", "code": String(m.get("code", "")), "players": list, "max": int(m.get("max", Data.MAX_PLAYERS)), "host": bool(m.get("host", false)), "status": st,
			"all_ready": bool(m.get("all_ready", true)), "quick": String(m.get("code", "")) == "QUICK"})
	else:
		status.emit(st)


func _on_go(players: Array, match_type: String) -> void:
	if phase != "lobby":
		return
	phase = "connecting"
	mt = match_type
	_wait = 0.0
	set_process(true)
	expected = players.size()
	for p in players:
		names[int(p.id)] = String(p.name)
		teams[int(p.id)] = int(p.team)
	status.emit("Match found — connecting the players…")
	if my_id == 1:
		net.char_id = char_id
		if not net.host():
			_on_failed("WebRTC is not available on this device")
			return
		for p in players:
			if int(p.id) != 1:
				mm.sig(int(p.id), {"k": "ready"})
		_check_all()


func _on_sig(from: int, d: Dictionary) -> void:
	if phase != "connecting":
		return
	match String(d.get("k", "")):
		"ready":
			if my_id != 1 and from == 1:
				net.char_id = char_id
				net.join_start(my_id)
		"offer":
			if my_id == 1:
				net.host_accept(String(d.get("code", "")))
		"answer":
			if my_id != 1 and from == 1:
				net.join_finish(String(d.get("code", "")))


func _on_code(kind: String, code: String) -> void:
	if phase != "connecting":
		return
	if kind == "offer":
		mm.sig(1, {"k": "offer", "code": code})
	else:
		var to := int(MultiplayerController.decode_code(code).get("id", 0))
		if to >= 2:
			mm.sig(to, {"k": "answer", "code": code})


func _check_all() -> void:
	if phase == "connecting" and my_id == 1 and net.roster.size() >= expected:
		_ready_now()


func _ready_now() -> void:
	if mm.has_method("done_connecting"):
		mm.done_connecting()
	phase = "playing"
	mm.close()
	set_process(false)
	match_ready.emit()


func _process(delta: float) -> void:
	if phase != "connecting":
		return
	_wait += delta
	if _wait > CONNECT_WAIT:
		if my_id == 1 and net.roster.size() >= 2:
			_ready_now()          # start with whoever made it
		else:
			_on_failed("Could not connect to the other players")
