class_name MultiplayerController
extends Node
## Peer-to-peer play over WebRTC (Godot's WebRTCMultiplayerPeer: a star with the host in the middle, so every phone makes ONE connection).
##
## There is no signalling server, so the handshake is done by hand with codes people can send each other in any chat app:
##   1. the joiner taps JOIN: a code "CS1-…" appears (their offer + the ICE candidates found through Google's STUN server) → send it to the host;
##   2. the host pastes it under ADD PLAYER: an answer code appears → send it back;
##   3. the joiner pastes the answer under FINISH → the data channels open and everybody spawns on the train.
## The host owns the world: the debris rain, the block physics and the weapon effects on blocks. Clients get position snapshots (~15 Hz, smoothed in
## PlayerController) and debris snapshots (~8 Hz) and send their shots to the host. A ping/pong pair every 1.5 s gives the PING readout.

signal status_changed(text: String)
signal code_ready(kind: String, code: String)       # "offer" (joiner) or "answer" (host)
signal peer_joined(id: int, char_id: String)
signal peer_left(id: int)
signal connected                                   # joiner: the channel to the host is open
signal ping_updated(ms: int)
signal state_received(id: int, snap: Array)
signal debris_received(packed: PackedFloat32Array)
signal shot_received(id: int, weapon: String, yaw: float, pitch: float)
signal fx_received(id: int, weapon: String, origin: Vector3, point: Vector3)
signal slab_received(pos: Vector3, axis: int, kind: String)
signal event_received(kind: String, data: Dictionary)
signal hit_received(target: int, amount: float, knock: Vector3, slow: float, from: int)
signal report_received(from: int, kind: String, data: Dictionary)

const STUN := "stun:stun.l.google.com:19302"
const GATHER_MAX := 6.0

var role := "none"                  # "none" | "host" | "client"
var peer: WebRTCMultiplayerPeer
var local_id := 1
var char_id := "outlaw"
var roster := {}                    # id -> char_id (host and clients)
var ping_ms := 0
var ping_by_peer := {}              # host: id -> ms
var _conns := {}                    # id -> WebRTCPeerConnection (while connecting)
var _cands := {}                    # id -> Array of [media, index, name]
var _sdp := {}                      # id -> {type, sdp}
var _gather_t := {}                 # id -> seconds since the SDP was made
var _kind := {}                     # id -> "offer" | "answer"
var _idle := {}                     # id -> seconds since the last candidate was found
var _ping_t := 0.0
var _clock := 0.0


static func available() -> bool:
	return ClassDB.class_exists("WebRTCPeerConnection") and ClassDB.can_instantiate("WebRTCPeerConnection")


# ── codes ────────────────────────────────────────────────────────────────────

## A handshake blob as text a person can paste: "CS1-<json size>-<base64 of the deflated json>".
static func encode_code(data: Dictionary) -> String:
	var raw := JSON.stringify(data).to_utf8_buffer()
	var packed := raw.compress(FileAccess.COMPRESSION_DEFLATE)
	return "CS1-%d-%s" % [raw.size(), Marshalls.raw_to_base64(packed).replace("+", "-").replace("/", "_").replace("=", "")]


static func decode_code(code: String) -> Dictionary:
	var s := code.strip_edges().replace("\n", "").replace(" ", "")
	if not s.begins_with("CS1-"):
		return {}
	var parts := s.split("-", true, 2)
	if parts.size() < 3 or not parts[1].is_valid_int():
		return {}
	var b64 := String(parts[2]).replace("-", "+").replace("_", "/")
	while b64.length() % 4 != 0:
		b64 += "="
	var packed := Marshalls.base64_to_raw(b64)
	if packed.is_empty():
		return {}
	var raw := packed.decompress(int(parts[1]), FileAccess.COMPRESSION_DEFLATE)
	if raw.is_empty():
		return {}
	var d = JSON.parse_string(raw.get_string_from_utf8())
	return d if d is Dictionary else {}


# ── starting ─────────────────────────────────────────────────────────────────

func _new_conn() -> WebRTCPeerConnection:
	var c := WebRTCPeerConnection.new()
	c.initialize({"iceServers": [{"urls": [STUN]}]})
	return c


func host() -> bool:
	if not available():
		status_changed.emit("WebRTC is not available in this build")
		return false
	reset()
	role = "host"
	local_id = 1
	roster = {1: char_id}
	peer = WebRTCMultiplayerPeer.new()
	peer.create_server()
	multiplayer.multiplayer_peer = peer
	_hook()
	status_changed.emit("HOSTING — send the room code to a friend, then paste their code")
	return true


## Joiner: makes the offer code (asynchronously: `code_ready("offer", …)`).
func join_start() -> bool:
	if not available():
		status_changed.emit("WebRTC is not available in this build")
		return false
	reset()
	role = "client"
	local_id = randi_range(2, 1 << 28)
	peer = WebRTCMultiplayerPeer.new()
	peer.create_client(local_id)
	multiplayer.multiplayer_peer = peer
	_hook()
	var c := _new_conn()
	_wire(c, 1, "offer")
	peer.add_peer(c, 1)
	c.create_offer()
	status_changed.emit("Making your join code…")
	return true


## Host: takes a joiner's offer code, makes the answer (asynchronously: `code_ready("answer", …)`).
func host_accept(code: String) -> bool:
	var d := decode_code(code)
	if role != "host" or d.get("t", "") != "o" or not d.has("sdp"):
		status_changed.emit("That is not a join code")
		return false
	var id := int(d.get("id", 0))
	if id < 2 or _conns.has(id) or roster.has(id):
		status_changed.emit("That player is already in")
		return false
	var c := _new_conn()
	_wire(c, id, "answer")
	peer.add_peer(c, id)
	c.set_remote_description("offer", String(d.sdp))
	_add_ice(c, d.get("ice", []))
	status_changed.emit("Making the answer code for player %d…" % id)
	return true


## Joiner: takes the host's answer code.
func join_finish(code: String) -> bool:
	var d := decode_code(code)
	if role != "client" or d.get("t", "") != "a" or not _conns.has(1):
		status_changed.emit("That is not an answer code")
		return false
	var c: WebRTCPeerConnection = _conns[1]
	c.set_remote_description("answer", String(d.sdp))
	_add_ice(c, d.get("ice", []))
	status_changed.emit("Connecting to the host…")
	return true


func _add_ice(c: WebRTCPeerConnection, list: Array) -> void:
	for e in list:
		c.add_ice_candidate(String(e[0]), int(e[1]), String(e[2]))


func _wire(c: WebRTCPeerConnection, id: int, kind: String) -> void:
	_conns[id] = c
	_cands[id] = []
	_gather_t[id] = -1.0
	_idle[id] = 0.0
	_kind[id] = kind
	c.session_description_created.connect(func(type: String, sdp: String) -> void:
		c.set_local_description(type, sdp)
		_sdp[id] = {"type": type, "sdp": sdp}
		_gather_t[id] = 0.0)
	c.ice_candidate_created.connect(func(media: String, index: int, cand_name: String) -> void:
		(_cands[id] as Array).append([media, index, cand_name])
		_idle[id] = 0.0)


func _hook() -> void:
	if not multiplayer.peer_connected.is_connected(_on_peer_connected):
		multiplayer.peer_connected.connect(_on_peer_connected)
		multiplayer.peer_disconnected.connect(_on_peer_disconnected)
		multiplayer.connected_to_server.connect(_on_connected)


func reset() -> void:
	if peer != null:
		peer.close()
	multiplayer.multiplayer_peer = null
	peer = null
	role = "none"
	roster = {}
	_conns.clear()
	_cands.clear()
	_sdp.clear()
	_gather_t.clear()
	_kind.clear()
	_idle.clear()
	ping_ms = 0
	ping_by_peer.clear()


func is_host() -> bool:
	return role == "host"


func online() -> bool:
	return role != "none" and peer != null


func _process(delta: float) -> void:
	_clock += delta
	# a code is ready when the candidates have been gathered
	for id in _gather_t.keys():
		var t: float = _gather_t[id]
		if t < 0.0:
			continue
		_gather_t[id] = t + delta
		_idle[id] = float(_idle.get(id, 0.0)) + delta
		var c: WebRTCPeerConnection = _conns.get(id)
		var done := c != null and c.get_gathering_state() == WebRTCPeerConnection.GATHERING_STATE_COMPLETE
		var settled := not (_cands[id] as Array).is_empty() and float(_idle[id]) > 1.4      # candidates stopped coming (a slow STUN answer is not waited for)
		if (done and t > 0.2) or settled or t > GATHER_MAX:
			_gather_t[id] = -2.0
			var sdp: Dictionary = _sdp[id]
			var code := encode_code({"t": "o" if _kind[id] == "offer" else "a", "id": local_id if _kind[id] == "offer" else id, "sdp": sdp.sdp, "ice": _cands[id]})
			code_ready.emit(String(_kind[id]), code)
			status_changed.emit("Code ready — copy it and send it" if _kind[id] == "offer" else "Answer ready — send it back")
	if not online() or multiplayer.multiplayer_peer == null or multiplayer.multiplayer_peer.get_connection_status() == MultiplayerPeer.CONNECTION_DISCONNECTED:
		return
	_ping_t -= delta
	if _ping_t <= 0.0:
		_ping_t = 1.5
		if role == "client" and roster.has(1):
			rpc_ping.rpc_id(1, Time.get_ticks_msec())
		elif role == "host":
			for id in roster.keys():
				if id != 1:
					rpc_ping.rpc_id(id, Time.get_ticks_msec())


func _on_connected() -> void:
	connected.emit()
	status_changed.emit("Connected")
	rpc_hello.rpc_id(1, char_id)


func _on_peer_connected(id: int) -> void:
	_conns.erase(id)
	if role == "host":
		status_changed.emit("Player %d connected" % id)


func _on_peer_disconnected(id: int) -> void:
	roster.erase(id)
	ping_by_peer.erase(id)
	peer_left.emit(id)
	status_changed.emit("Player %d left" % id)


# ── messages ─────────────────────────────────────────────────────────────────

@rpc("any_peer", "reliable")
func rpc_hello(their_char: String) -> void:
	if role != "host":
		return
	var id := multiplayer.get_remote_sender_id()
	roster[id] = their_char
	rpc_welcome.rpc_id(id, roster)
	for other in roster.keys():
		if other != 1 and other != id:
			rpc_joined.rpc_id(other, id, their_char)
	peer_joined.emit(id, their_char)


@rpc("authority", "reliable")
func rpc_welcome(full_roster: Dictionary) -> void:
	roster = full_roster
	for id in full_roster.keys():
		if id != local_id:
			peer_joined.emit(id, String(full_roster[id]))


@rpc("authority", "reliable")
func rpc_joined(id: int, their_char: String) -> void:
	roster[id] = their_char
	peer_joined.emit(id, their_char)


@rpc("any_peer", "unreliable_ordered")
func rpc_state(id: int, snap: Array) -> void:
	state_received.emit(id, snap)
	if role == "host":
		for other in roster.keys():
			if other != 1 and other != id and other != multiplayer.get_remote_sender_id():
				rpc_state.rpc_id(other, id, snap)


func send_state(snap: Array) -> void:
	if not online() or multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
		return
	if role == "host":
		for other in roster.keys():
			if other != 1:
				rpc_state.rpc_id(other, 1, snap)
	elif roster.has(1):
		rpc_state.rpc_id(1, local_id, snap)


@rpc("authority", "unreliable_ordered")
func rpc_debris(packed: PackedFloat32Array) -> void:
	debris_received.emit(packed)


func send_debris(packed: PackedFloat32Array) -> void:
	if role == "host":
		for other in roster.keys():
			if other != 1:
				rpc_debris.rpc_id(other, packed)


@rpc("any_peer", "reliable")
func rpc_shot(weapon: String, yaw: float, pitch: float) -> void:
	if role == "host":
		shot_received.emit(multiplayer.get_remote_sender_id(), weapon, yaw, pitch)


@rpc("any_peer", "reliable")
func rpc_fx(id: int, weapon: String, origin: Vector3, point: Vector3) -> void:
	fx_received.emit(id, weapon, origin, point)
	if role == "host":
		for other in roster.keys():
			if other != 1 and other != id:
				rpc_fx.rpc_id(other, id, weapon, origin, point)


## A local shot: the host runs it on the real debris; everybody else just draws it.
func send_shot(weapon: String, yaw: float, pitch: float, origin: Vector3, point: Vector3) -> void:
	if not online() or multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
		return
	if role == "client":
		rpc_shot.rpc_id(1, weapon, yaw, pitch)
		rpc_fx.rpc_id(1, local_id, weapon, origin, point)
	else:
		for other in roster.keys():
			if other != 1:
				rpc_fx.rpc_id(other, 1, weapon, origin, point)


@rpc("any_peer", "reliable")
func rpc_slab(pos: Vector3, axis: int, kind: String) -> void:
	slab_received.emit(pos, axis, kind)
	if role == "host":
		for other in roster.keys():
			if other != 1 and other != multiplayer.get_remote_sender_id():
				rpc_slab.rpc_id(other, pos, axis, kind)


func send_slab(pos: Vector3, axis: int, kind: String) -> void:
	if not online() or multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
		return
	if role == "client":
		rpc_slab.rpc_id(1, pos, axis, kind)
	else:
		for other in roster.keys():
			if other != 1:
				rpc_slab.rpc_id(other, pos, axis, kind)


@rpc("authority", "reliable")
func rpc_event(kind: String, data: Dictionary) -> void:
	event_received.emit(kind, data)


func send_event(kind: String, data: Dictionary) -> void:
	if role == "host":
		for other in roster.keys():
			if other != 1:
				rpc_event.rpc_id(other, kind, data)


@rpc("any_peer", "unreliable")
func rpc_ping(t_ms: int) -> void:
	rpc_pong.rpc_id(multiplayer.get_remote_sender_id(), t_ms)


@rpc("any_peer", "unreliable")
func rpc_pong(t_ms: int) -> void:
	var ms := maxi(0, Time.get_ticks_msec() - t_ms)
	var from := multiplayer.get_remote_sender_id()
	if role == "client":
		ping_ms = ms if ping_ms == 0 else int(lerpf(float(ping_ms), float(ms), 0.35))
		ping_updated.emit(ping_ms)
	else:
		ping_by_peer[from] = ms if not ping_by_peer.has(from) else int(lerpf(float(ping_by_peer[from]), float(ms), 0.35))
		var worst := 0
		for k in ping_by_peer:
			worst = maxi(worst, int(ping_by_peer[k]))
		ping_ms = worst
		ping_updated.emit(ping_ms)


## A hit on another phone's player (or a bot, which lives on the host): this phone is the judge of its own player, the host relays.
@rpc("any_peer", "reliable")
func rpc_hit(target: int, amount: float, knock: Vector3, slow: float, from: int) -> void:
	if target == local_id or (role == "host" and target >= 100):
		hit_received.emit(target, amount, knock, slow, from)
	elif role == "host" and roster.has(target):
		rpc_hit.rpc_id(target, target, amount, knock, slow, from)


func send_hit(target: int, amount: float, knock: Vector3, slow: float) -> void:
	if not online() or multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
		return
	if role == "client":
		rpc_hit.rpc_id(1, target, amount, knock, slow, local_id)
	elif target >= 100:
		hit_received.emit(target, amount, knock, slow, 1)
	elif roster.has(target):
		rpc_hit.rpc_id(target, target, amount, knock, slow, 1)


## A client tells the host something it must decide (my player died, I took a weapon, I am ready): the host reads it as `report_received`.
@rpc("any_peer", "reliable")
func rpc_report(kind: String, data: Dictionary) -> void:
	if role == "host":
		report_received.emit(multiplayer.get_remote_sender_id(), kind, data)


func send_report(kind: String, data: Dictionary) -> void:
	if not online() or multiplayer.multiplayer_peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
		return
	if role == "client":
		rpc_report.rpc_id(1, kind, data)
	else:
		report_received.emit(1, kind, data)


## Colour of the PING readout: green under 100 ms, orange to 200, red above.
static func ping_color(ms: int) -> Color:
	if ms < 100:
		return Color(0.3, 1.0, 0.45)
	if ms <= 200:
		return Color(1.0, 0.65, 0.15)
	return Color(1.0, 0.3, 0.25)
