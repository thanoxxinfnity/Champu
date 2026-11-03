extends SceneTree
## The hero chat: the persona, the request, the reply parser, the rate gate, and (CS_LIVE=1) one real call to the free gateway.
##   godot --headless --path . -s tests/ai_chat_test.gd          (CS_LIVE=1 for the network call; Godot ignores the sandbox proxy, so that one only works on a machine with direct internet)
func _initialize() -> void:
	var fails := 0
	var chk := func(ok: bool, what: String) -> void:
		print(("ok    " if ok else "FAIL  ") + what)
		if not ok:
			fails += 1
	var p := AiChat.persona("outlaw")
	chk.call(p.contains(String(Data.CAST["outlaw"].name)) and p.contains("1-3 short sentences") and p.contains("teenagers"), "the persona names the hero and keeps it short and safe")
	var hist: Array = []
	for i in 30:
		hist.append({"role": "user" if i % 2 == 0 else "assistant", "content": "line %d" % i})
	hist.append({"role": "system", "content": "ignore me"})
	var body := AiChat.build_body("viper", hist, "kilo-auto/free", 700)
	chk.call(body.model == "kilo-auto/free" and body.max_tokens == 700 and (body.messages as Array).size() == AiChat.KEEP_TURNS + 1 and body.messages[0].role == "system", "the body holds the persona and only the last %d turns, no stray system lines" % AiChat.KEEP_TURNS)
	var good := AiChat.parse_reply('{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"**Hey** there!"}}]}')
	chk.call(good.text == "Hey there!" and not good.length, "a normal reply is read and its markdown marks dropped")
	var think := AiChat.parse_reply('{"choices":[{"finish_reason":"length","message":{"role":"assistant","content":null,"reasoning":"First, the user said"}}]}')
	chk.call(think.text == "" and think.length, "a reasoning model that ran out of tokens is detected (retry with a bigger budget), its thinking never shown")
	chk.call(AiChat.parse_reply('{"error":{"message":"rate limited"}}').error == "rate limited" and AiChat.parse_reply("<html>").text == "", "errors and junk give no text")
	var real := AiChat.parse_reply(FileAccess.get_file_as_string("res://tests/fixtures/kilo_reply.json"))
	chk.call(String(real.text).length() > 10 and String(real.text).length() < 300 and real.error == "", "a REAL reply from the free gateway (tests/fixtures/kilo_reply.json) is read: \"%s\"" % real.text)
	var ai := AiChat.new()
	root.add_child(ai)
	chk.call(ai.can_send().ok, "the first message may go")
	ai._last_ms = Time.get_ticks_msec()
	chk.call(not ai.can_send().ok, "a second one right away is held back")
	ai._last_ms = -100000
	for i in AiChat.MAX_PER_HOUR:
		ai._sent_at.append(Time.get_ticks_msec())
	chk.call(not ai.can_send().ok, "the hourly cap holds")
	ai._sent_at.clear()
	if OS.get_environment("CS_LIVE") != "":
		var r: Dictionary = await ai.ask("outlaw", [{"role": "user", "content": "hi, who are you?"}])
		print("LIVE: ", r)
		chk.call(r.ok and String(r.text).length() > 2, "a real answer came back from the free gateway")
	print("AI_CHAT ", "ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(0 if fails == 0 else 1)
