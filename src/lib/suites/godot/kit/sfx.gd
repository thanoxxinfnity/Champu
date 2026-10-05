extends Node
## Sound and music, looked up by name from res://audio/ — a missing file is silence, never an error.
##   Sfx.play("coin")        -> audio/sfx_coin.wav, audio/coin.wav, .ogg or .mp3
##   Sfx.music("zone_0")     -> loops audio/zone_0.wav ("" picks the first track it finds)
## Autoload name: Sfx

const POOL := 10
const FOLDERS := ["res://audio/"]
const EXTENSIONS := ["wav", "ogg", "mp3"]
## Names a game may ask for that have a close stand-in when the exact file is missing.
const ALIASES := {"win": "levelup", "lose": "crash", "hit": "crash", "pickup": "coin", "tick": "ui", "go": "levelup", "boost": "jump", "click": "ui"}

var sfx_on := true
var music_on := true
var _players: Array[AudioStreamPlayer] = []
var _cache := {}
var _music: AudioStreamPlayer
var _music_name := ""
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rng.randomize()
	for i in POOL:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_music = AudioStreamPlayer.new()
	_music.volume_db = -9.0
	add_child(_music)
	_music.finished.connect(_on_music_finished)
	sfx_on = bool(Save.get_setting("sfx", true))
	music_on = bool(Save.get_setting("music", true))


func _find(name: String) -> AudioStream:
	if _cache.has(name):
		return _cache[name]
	var found: AudioStream = null
	for folder in FOLDERS:
		for stem in ["sfx_" + name, name]:
			for ext in EXTENSIONS:
				var path := "%s%s.%s" % [folder, stem, ext]
				if found == null and ResourceLoader.exists(path):
					found = load(path) as AudioStream
	if found == null and ALIASES.has(name):
		found = _find(ALIASES[name])
	_cache[name] = found
	return found


func has_sound(name: String) -> bool:
	return _find(name) != null


## Plays a one-shot. `pitch_jitter` keeps repeated sounds from sounding machine-made.
func play(name: String, volume_db: float = 0.0, pitch_jitter: float = 0.07) -> void:
	if not sfx_on:
		return
	var stream := _find(name)
	if stream == null:
		return
	var chosen: AudioStreamPlayer = null
	for p in _players:
		if not p.playing:
			chosen = p
			break
	if chosen == null:
		chosen = _players[0]
	chosen.stream = stream
	chosen.volume_db = volume_db
	chosen.pitch_scale = 1.0 + _rng.randf_range(-pitch_jitter, pitch_jitter)
	chosen.play()


func music(name: String = "", fade_seconds: float = 0.8) -> void:
	var wanted := name
	if wanted == "":
		for candidate in ["zone_0", "music", "theme", "track_0"]:
			if _find(candidate) != null:
				wanted = candidate
				break
	if wanted == "" or wanted == _music_name and _music.playing:
		return
	var stream := _find(wanted)
	if stream == null:
		return
	_music_name = wanted
	_music.stream = stream
	if music_on:
		_music.volume_db = -40.0
		_music.play()
		create_tween().tween_property(_music, "volume_db", -9.0, fade_seconds)


func stop_music(fade_seconds: float = 0.6) -> void:
	if not _music.playing:
		return
	var tween := create_tween()
	tween.tween_property(_music, "volume_db", -40.0, fade_seconds)
	tween.tween_callback(_music.stop)
	_music_name = ""


func _on_music_finished() -> void:
	if music_on and _music_name != "":
		_music.play()


func set_sfx(enabled: bool) -> void:
	sfx_on = enabled
	Save.set_setting("sfx", enabled)


func set_music(enabled: bool) -> void:
	music_on = enabled
	Save.set_setting("music", enabled)
	if not enabled:
		_music.stop()
	elif _music_name != "" and _music.stream != null:
		_music.volume_db = -9.0
		_music.play()
