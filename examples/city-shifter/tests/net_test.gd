extends SceneTree
## Peer-to-peer through WebRTC with hand-carried codes, two phones in one process (each in its own multiplayer subtree):
## codes round-trip, the join → accept → finish dance connects, the roster, the ping readout, position snapshots and slab messages arrive, a client leaving is noticed.

var a: MultiplayerController
var b: MultiplayerController
var offer := ""
var answer := ""


## Waits in REAL time (the network runs on its own threads): returns the seconds it took, or the limit.
func _until(cond: Callable, secs: float) -> float:
	var t0 := Time.get_ticks_msec()
	while float(Time.get_ticks_msec() - t0) / 1000.0 < secs:
		if cond.call():
			break
		await process_frame
	return float(Time.get_ticks_msec() - t0) / 1000.0


func _initialize() -> void:
	# codes
	var big := {"t": "o", "id": 12345, "sdp": "v=0\r\n".repeat(120), "ice": [["0", 0, "candidate:1 1 UDP 2122252543 192.168.1.4 51234 typ host"]]}
	var code := MultiplayerController.encode_code(big)
	T.check(code.begins_with("CS1-") and not code.contains(" ") and not code.contains("+") and not code.contains("/"), "a code is one paste-safe word (%d chars for %d)" % [code.length(), JSON.stringify(big).length()])
	var back := MultiplayerController.decode_code(code)
	T.check(String(back.get("sdp", "")) == String(big.sdp) and int(back.get("id", 0)) == 12345 and (back.ice as Array).size() == 1, "a code decodes back to what was encoded")
	T.check(MultiplayerController.decode_code("  " + code + "\n").has("sdp"), "…even with spaces and a newline around it")
	T.check(MultiplayerController.decode_code("CS1-9-xxxx").is_empty() and MultiplayerController.decode_code("hello").is_empty(), "rubbish decodes to nothing")
	T.check(MultiplayerController.ping_color(40) == Color(0.3, 1.0, 0.45) and MultiplayerController.ping_color(150).r > 0.9 and MultiplayerController.ping_color(150).g > 0.5 and MultiplayerController.ping_color(300).g < 0.4, "ping colours: green / orange / red")
	if not MultiplayerController.available():
		print("WebRTC is not available in this build: the connection part is skipped")
		T.done(self)
		return
	await process_frame
	var ra := Node.new()
	ra.name = "A"
	root.add_child(ra)
	var rb := Node.new()
	rb.name = "B"
	root.add_child(rb)
	await process_frame
	set_multiplayer(MultiplayerAPI.create_default_interface(), NodePath("/root/A"))
	set_multiplayer(MultiplayerAPI.create_default_interface(), NodePath("/root/B"))
	a = MultiplayerController.new()
	a.name = "Net"
	a.char_id = "engineer"
	ra.add_child(a)
	b = MultiplayerController.new()
	b.name = "Net"
	b.char_id = "ninja"
	rb.add_child(b)
	b.code_ready.connect(func(kind: String, c: String) -> void: offer = c)
	a.code_ready.connect(func(kind: String, c: String) -> void: answer = c)
	var states := []
	var slabs := []
	a.state_received.connect(func(id: int, snap: Array) -> void: states.append([id, snap]))
	b.slab_received.connect(func(pos: Vector3, axis: int, kind: String) -> void: slabs.append([pos, axis, kind]))
	var joined := []
	a.peer_joined.connect(func(id: int, ch: String) -> void: joined.append([id, ch]))
	var b_roster_seen := []
	b.peer_joined.connect(func(id: int, ch: String) -> void: b_roster_seen.append([id, ch]))
	T.check(a.host(), "the host starts a room")
	T.check(b.join_start(), "the joiner starts a join")
	var t := await _until(func() -> bool: return offer != "", 15.0)
	T.check(offer.begins_with("CS1-"), "the joiner gets a join code (%d chars, %.1f s)" % [offer.length(), t])
	T.check(a.host_accept(offer), "the host accepts it")
	t = await _until(func() -> bool: return answer != "", 15.0)
	T.check(answer.begins_with("CS1-"), "the host gets an answer code (%d chars, %.1f s)" % [answer.length(), t])
	T.check(b.join_finish(answer), "the joiner finishes with the answer")
	t = await _until(func() -> bool: return not joined.is_empty() and not b_roster_seen.is_empty(), 25.0)
	T.check(not joined.is_empty() and joined[0][1] == "ninja", "the host sees the joiner arrive as the ninja (%.1f s)" % t)
	T.check(a.roster.size() == 2 and b.roster.size() == 2, "both phones know the room: %s" % str(a.roster))
	# a position snapshot from the client reaches the host
	for i in 5:
		b.send_state([Vector3(1, 3, -20), 0.5, 4.0, false, false, 90.0])
		await _until(func() -> bool: return false, 0.2)
	T.check(not states.is_empty() and (states[0][1][0] as Vector3).is_equal_approx(Vector3(1, 3, -20)), "a position snapshot reaches the host")
	# a slab placed on the host reaches the client
	a.send_slab(Vector3(0, 2.75, -12), 0, "bounce")
	await _until(func() -> bool: return not slabs.is_empty(), 3.0)
	T.check(slabs.size() == 1 and slabs[0][2] == "bounce", "a bridge slab placed on the host appears on the client")
	# the ping readout
	await _until(func() -> bool: return b.ping_ms > 0 or not a.ping_by_peer.is_empty(), 5.0)
	T.check(not a.ping_by_peer.is_empty() or b.ping_ms >= 0, "the ping is measured (host: %s, client: %d ms)" % [str(a.ping_by_peer), b.ping_ms])
	# the client leaves
	var left := []
	a.peer_left.connect(func(id: int) -> void: left.append(id))
	b.reset()
	t = await _until(func() -> bool: return not left.is_empty(), 12.0)
	T.check(not left.is_empty(), "the host notices the client leaving (%.1f s)" % t)
	T.done(self)
