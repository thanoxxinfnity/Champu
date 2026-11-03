class_name AiChat
extends Node
## Talk to your hero: a chat with an AI that plays the hero you picked, over Kilo's free, key-less OpenAI-compatible gateway
## (https://api.kilo.ai/api/gateway, 200 requests per hour per IP). Nothing here is a secret: no key is in the game.
## The free models may log prompts, so the screen says so and the player agrees once; the system prompt keeps it friendly, short and in the player's language.

const URL := "https://api.kilo.ai/api/gateway/chat/completions"
const MODELS := ["kilo-auto/free", "nvidia/nemotron-3-super-120b-a12b:free"]    # the router first, one named free model if it fails
const MAX_PER_HOUR := 60                  # the gateway allows 200 per IP per hour; the game keeps well under it
const MIN_GAP_MS := 2500
const KEEP_TURNS := 10                    # the last turns sent with each question (the free models have big windows, the phone has a small data plan)
const CFG := "user://ai_chat.cfg"

var _sent_at: Array[int] = []             # msec of each request in the last hour
var _last_ms := -100000


## The hero's voice. Short, in the player's language, safe for everybody, never asks for personal details.
static func persona(hero_id: String) -> String:
	var h: Dictionary = Data.CAST.get(hero_id, Data.CAST["outlaw"])
	return "You are %s, \"%s\" — %s — a character of the mobile game City Shifter: Sky Siege, a jetpack battle over a jungle, a town and a downtown with up to 15 players. Your perk in the game: %s\n" % [h.get("name", "the hero"), h.get("title", ""), h.get("role", ""), h.get("perk", "")] \
		+ "You are chatting with the player in the lobby, in character: friendly, a little cocky, never rude. Keep every answer to 1-3 short sentences. " \
		+ "Answer in the language the player writes (English, Hindi or Hinglish). Give game tips only when asked. " \
		+ "Everybody plays this game, including teenagers: no sexual content, no hate, no real-world violence, no medical or legal advice; if asked, refuse in one line, in character, and change the subject. " \
		+ "Never ask for or repeat personal details (real name, address, phone, school, passwords, links). Never say you are an AI model from a company; you are %s." % h.get("short", "the hero")


## The request body: the persona, then the last turns (each {"role": "user"|"assistant", "content": ...}).
static func build_body(hero_id: String, history: Array, model: String, max_tokens: int) -> Dictionary:
	var msgs: Array = [{"role": "system", "content": persona(hero_id)}]
	var turns: Array = []
	for m in history:
		var role := String(m.get("role", "user"))
		var text := String(m.get("content", "")).strip_edges()
		if text != "" and (role == "user" or role == "assistant"):
			turns.append({"role": role, "content": text.substr(0, 600)})
	msgs.append_array(turns.slice(maxi(0, turns.size() - KEEP_TURNS)))
	return {"model": model, "messages": msgs, "max_tokens": max_tokens, "temperature": 0.8}


## The reply text of a chat-completions answer, or "" when there is none. Reasoning models can spend the whole budget thinking (content null,
## finish_reason "length"): the caller retries with a bigger budget; the thinking itself is never shown.
static func parse_reply(body: String) -> Dictionary:
	var j: Variant = JSON.parse_string(body)
	if typeof(j) != TYPE_DICTIONARY:
		return {"text": "", "length": false, "error": "not json"}
	var d: Dictionary = j
	if d.has("error"):
		var e: Variant = d["error"]
		return {"text": "", "length": false, "error": String((e as Dictionary).get("message", "error")) if typeof(e) == TYPE_DICTIONARY else str(e)}
	var ch: Array = d.get("choices", [])
	if ch.is_empty():
		return {"text": "", "length": false, "error": "no choices"}
	var c: Dictionary = ch[0]
	var msg: Dictionary = c.get("message", {})
	var text := String(msg.get("content", "") if msg.get("content", null) != null else "").strip_edges()
	return {"text": clean(text), "length": String(c.get("finish_reason", "")) == "length" and text == "", "error": ""}


## Plain text for a small label: no markdown fences or stray emphasis marks, no runaway length.
static func clean(t: String) -> String:
	var s := t.replace("**", "").replace("__", "").replace("```", "").replace("\r", "")
	return s.strip_edges().substr(0, 500)


## Whether a question may go out now (spacing and the hourly cap); `wait_ms` says how long to wait when not.
func can_send() -> Dictionary:
	var now := Time.get_ticks_msec()
	while not _sent_at.is_empty() and now - _sent_at[0] > 3600000:
		_sent_at.pop_front()
	if now - _last_ms < MIN_GAP_MS:
		return {"ok": false, "why": "Easy! One message at a time.", "wait_ms": MIN_GAP_MS - (now - _last_ms)}
	if _sent_at.size() >= MAX_PER_HOUR:
		return {"ok": false, "why": "That is plenty of chatting for this hour. Come back in a bit.", "wait_ms": 60000}
	return {"ok": true}


## Ask. Returns {"ok": bool, "text": String}. On a failure `text` is a line the hero can say, so the screen never shows an error code.
func ask(hero_id: String, history: Array) -> Dictionary:
	var gate := can_send()
	if not gate.ok:
		return {"ok": false, "text": String(gate.why)}
	_last_ms = Time.get_ticks_msec()
	_sent_at.append(_last_ms)
	for model in MODELS:
		for budget in [700, 1600]:
			var r := await _post(build_body(hero_id, history, model, budget))
			if not r.ok:
				break                                     # this model failed: the next one
			var p := parse_reply(String(r.body))
			if String(p.text) != "":
				return {"ok": true, "text": String(p.text)}
			if not bool(p.length):
				break
	return {"ok": false, "text": "The signal is weak up here... the free AI is busy. Try again in a minute."}


func _post(body: Dictionary) -> Dictionary:
	var http := HTTPRequest.new()
	http.timeout = 45.0
	add_child(http)
	var err := http.request(URL, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		http.queue_free()
		return {"ok": false, "body": ""}
	var res: Array = await http.request_completed
	http.queue_free()
	var code := int(res[1])
	if OS.get_environment("CS_LIVE") != "":
		print("HTTP result=", res[0], " code=", code)
	return {"ok": int(res[0]) == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300, "body": (res[3] as PackedByteArray).get_string_from_utf8()}


## The player agreed (once) that their messages go to a free AI service.
static func agreed() -> bool:
	var cf := ConfigFile.new()
	return cf.load(CFG) == OK and bool(cf.get_value("chat", "agreed", false))


static func set_agreed(on: bool) -> void:
	var cf := ConfigFile.new()
	cf.set_value("chat", "agreed", on)
	cf.save(CFG)
