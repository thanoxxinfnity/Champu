extends Node
## Music and sound.
##
## One player per zone would mean five streams loaded at once on a phone; one
## player whose stream is swapped means a hard cut mid-bar. So there are two
## music players and the zone change crossfades between them, which is both
## cheap and the only version that does not sound like a mistake.

const FADE := 1.2

@onready var _a: AudioStreamPlayer = $MusicA
@onready var _b: AudioStreamPlayer = $MusicB
@onready var _sfx: AudioStreamPlayer = $Sfx

var _active: AudioStreamPlayer
var _idle: AudioStreamPlayer
var _fade: float = 0.0
var _volume_db: float = -8.0
## Ducking is an offset rather than a second volume, so it composes with a
## crossfade instead of fighting it — and it eases, because an instant drop of
## fourteen decibels is audible as a click.
var _duck_db: float = 0.0
var _duck_target: float = 0.0

var _tracks: Array[AudioStream] = []
var _effects: Dictionary = {}


func _ready() -> void:
	_active = _a
	_idle = _b

	# Loaded by name, and a missing file is not fatal: a silent game is worse
	# than no game only if it also crashes.
	for i in 5:
		var stream: AudioStream = load("res://audio/zone_%d.wav" % i) as AudioStream
		if stream != null:
			if stream is AudioStreamWAV:
				(stream as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_FORWARD
				(stream as AudioStreamWAV).loop_end = (stream as AudioStreamWAV).data.size() / 2
			_tracks.append(stream)

	for name in ["coin", "jump", "crash", "levelup"]:
		var s: AudioStream = load("res://audio/sfx_%s.wav" % name) as AudioStream
		if s != null:
			_effects[name] = s


func _process(delta: float) -> void:
	if not is_equal_approx(_duck_db, _duck_target):
		_duck_db = move_toward(_duck_db, _duck_target, delta * 40.0)
		if _fade <= 0.0:
			_active.volume_db = _volume_db + _duck_db

	if _fade <= 0.0:
		return
	_fade = maxf(_fade - delta, 0.0)
	var t := 1.0 - (_fade / FADE)
	_active.volume_db = lerpf(-40.0, _volume_db + _duck_db, t)
	_idle.volume_db = lerpf(_volume_db + _duck_db, -40.0, t)
	if _fade <= 0.0 and _idle.playing:
		_idle.stop()


## Starts, or crossfades to, the track for a zone.
func play_zone(index: int) -> void:
	if index < 0 or index >= _tracks.size():
		return
	var stream: AudioStream = _tracks[index]
	if _active.stream == stream and _active.playing:
		return

	# Swap the roles, start the new one silent, and let _process bring it up.
	var next := _idle
	_idle = _active
	_active = next

	_active.stream = stream
	_active.volume_db = -40.0
	_active.play()
	_fade = FADE


func play(effect: String) -> void:
	if not _effects.has(effect):
		return
	_sfx.stream = _effects[effect]
	_sfx.play()


func set_music_volume(db: float) -> void:
	_volume_db = db
	if _fade <= 0.0:
		_active.volume_db = db + _duck_db


## Drops the music under a voice line. 0.0 restores it.
##
## Separate from set_music_volume so the two cannot overwrite each other: the
## user's volume and "someone is talking" are different facts about the same
## number, and storing them in one variable loses whichever was set second.
func duck(db: float) -> void:
	_duck_target = db


func is_ducked() -> bool:
	return _duck_target < -0.5
