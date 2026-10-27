class_name FirebaseRest
extends Node
## The Firebase Realtime Database over its plain REST API: one HTTPRequest per call (awaited, then freed). `call_db` returns the parsed JSON
## (null for "nothing there"), or the String "ERR" when the request failed.

const FIREBASE_BASE_URL: String = "https://city-shifter-game-default-rtdb.firebaseio.com"


func call_db(method: int, path: String, body: Variant = null) -> Variant:
	var http := HTTPRequest.new()
	http.timeout = 10.0
	add_child(http)
	var data := "" if body == null else JSON.stringify(body)
	var err := http.request(FIREBASE_BASE_URL + path, ["Content-Type: application/json"], method, data)
	if err != OK:
		http.queue_free()
		return "ERR"
	var res: Array = await http.request_completed
	http.queue_free()
	if int(res[0]) != HTTPRequest.RESULT_SUCCESS or int(res[1]) >= 400:
		return "ERR"
	var txt := (res[3] as PackedByteArray).get_string_from_utf8()
	return JSON.parse_string(txt) if txt != "" else null


func get_(path: String) -> Variant:
	return await call_db(HTTPClient.METHOD_GET, path)


func put(path: String, body: Variant) -> Variant:
	return await call_db(HTTPClient.METHOD_PUT, path, body)


func patch(path: String, body: Variant) -> Variant:
	return await call_db(HTTPClient.METHOD_PATCH, path, body)


func post(path: String, body: Variant) -> Variant:
	return await call_db(HTTPClient.METHOD_POST, path, body)


func delete(path: String) -> Variant:
	return await call_db(HTTPClient.METHOD_DELETE, path)


static func now() -> int:
	return int(Time.get_unix_time_from_system())
