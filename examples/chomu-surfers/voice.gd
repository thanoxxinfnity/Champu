extends Node
## Spoken audio.
##
## Kept apart from `audio.gd` for one reason: voice has to duck the music, not
## compete with it. Two things at the same volume are two things nobody can make
## out, and a line the player cannot hear is worse than silence because they
## know they missed something.
##
## Which file plays when is this dictionary and nothing else — swap a filename
## here and that moment says something different, no other edit.

const LINES := {
	"intro": "res://voice/narration.wav",
	"stage": "res://voice/voice_a.wav",
	"gameover": "res://voice/voice_b.wav",
}

## How far the music drops while someone is speaking, in dB.
@export var duck_db: float = -14.0
## A line has to be worth interrupting for; two in quick succession is noise.
@export var min_gap: float = 6.0

@onready var _player: AudioStreamPlayer = $Player

var _music: Node
var _clips := {}
var _last: float = -999.0
var _ducked := false


func _ready() -> void:
	_music = get_parent().get_node_or_null("Audio")
	for key in LINES:
		# A missing voice file is not fatal: the game is still playable silent,
		# and a hard load would take it down for a cosmetic asset.
		var stream: AudioStream = load(LINES[key]) as AudioStream
		if stream != null:
			_clips[key] = stream
	_player.finished.connect(_unduck)


## Says a line, unless one is already playing or one just finished.
func say(key: String, interrupt: bool = false) -> bool:
	if not _clips.has(key):
		return false
	var now := Time.get_ticks_msec() / 1000.0
	if _player.playing and not interrupt:
		return false
	if now - _last < min_gap and not interrupt:
		return false

	_last = now
	_player.stream = _clips[key]
	_player.play()
	_duck()
	return true


func stop() -> void:
	_player.stop()
	_unduck()


func _duck() -> void:
	if _ducked or _music == null:
		return
	_ducked = true
	_music.duck(duck_db)


func _unduck() -> void:
	if not _ducked or _music == null:
		return
	_ducked = false
	_music.duck(0.0)
