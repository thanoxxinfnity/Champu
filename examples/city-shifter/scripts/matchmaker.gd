class_name Matchmaker
extends Node
## The WebSocket link to the matchmaking server (server/server.py): rooms (max 15), quick match, custom room codes, and the relay of the WebRTC handshake.
## It only talks to the server; OnlineSession turns what it says into a connected match.

signal connected_ok
signal failed(msg: String)
signal room_changed(info: Dictionary)
signal go(players: Array, mt: String)
signal sig_received(from: int, d: Dictionary)
signal alone
signal closed(why: String)

const CONNECT_TIMEOUT := 9.0

var url := ""
var user_name := "PLAYER"
var char_id := "outlaw"
var ws: WebSocketPeer
var ready_ok := false
var in_room := false
var my_id := 0
var room := {}
var _t := 0.0
var _queue: Array = []              # messages to send once the socket is open
var _sent_hello := false


func open(server_url: String, pname: String, cid: String) -> void:
	close()
	url = server_url
	user_name = pname
	char_id = cid
	ws = WebSocketPeer.new()
	_t = 0.0
	ready_ok = false
	_sent_hello = false
	var err := ws.connect_to_url(url)
	if err != OK:
		ws = null
		failed.emit("Could not reach the server")
	else:
		set_process(true)


func close() -> void:
	if ws != null:
		ws.close()
	ws = null
	ready_ok = false
	in_room = false
	room = {}
	_queue.clear()
	set_process(false)


func is_open() -> bool:
	return ws != null and ws.get_ready_state() == WebSocketPeer.STATE_OPEN


func send(msg: Dictionary) -> void:
	if is_open() and ready_ok:
		ws.send_text(JSON.stringify(msg))
	else:
		_queue.append(msg)


func quick(mt: String) -> void:
	send({"t": "quick", "mt": mt})


func create(mt: String) -> void:
	send({"t": "create", "mt": mt})


func join(code: String) -> void:
	send({"t": "join", "code": code})


func start() -> void:
	send({"t": "start"})


func leave() -> void:
	if is_open() and ready_ok:
		ws.send_text(JSON.stringify({"t": "leave"}))
	in_room = false
	room = {}


func sig(to: int, d: Dictionary) -> void:
	send({"t": "sig", "to": to, "d": d})


func _process(delta: float) -> void:
	if ws == null:
		return
	ws.poll()
	var st := ws.get_ready_state()
	if st == WebSocketPeer.STATE_CONNECTING:
		_t += delta
		if _t > CONNECT_TIMEOUT:
			ws.close()
			ws = null
			set_process(false)
			failed.emit("Server did not answer. Check your internet or try again.")
		return
	if st == WebSocketPeer.STATE_CLOSED:
		var was_ready := ready_ok
		ws = null
		set_process(false)
		ready_ok = false
		failed.emit("Connection to the server was lost" if was_ready else "Could not connect to the server")
		return
	if st != WebSocketPeer.STATE_OPEN:
		return
	if not ready_ok and not _sent_hello:
		_sent_hello = true
		ws.send_text(JSON.stringify({"t": "hello", "name": user_name, "char": char_id}))
	while ws != null and ws.get_available_packet_count() > 0:
		var txt := ws.get_packet().get_string_from_utf8()
		var m = JSON.parse_string(txt)
		if m is Dictionary:
			_on_message(m)



func _on_message(m: Dictionary) -> void:
	match String(m.get("t", "")):
		"hi":
			ready_ok = true
			connected_ok.emit()
			for q in _queue:
				ws.send_text(JSON.stringify(q))
			_queue.clear()
		"room":
			in_room = true
			room = m
			my_id = int(m.get("you", 0))
			room_changed.emit(m)
		"go":
			go.emit(m.get("players", []), String(m.get("mt", "solo")))
		"sig":
			sig_received.emit(int(m.get("from", 0)), m.get("d", {}) if m.get("d") is Dictionary else {})
		"alone":
			in_room = false
			alone.emit()
		"closed":
			in_room = false
			closed.emit(String(m.get("why", "")))
		"err":
			failed.emit(String(m.get("m", "Error")))
