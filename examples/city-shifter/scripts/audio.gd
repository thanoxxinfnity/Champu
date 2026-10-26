class_name Audio
extends Node
## Every sound is synthesised at start-up on a thread (no audio files): the train's rumble and rail clack (loop), the jetpack roar (loop), gauntlet zaps,
## booms, shatter, coin, block placing, hurt. A sound asked for before the build has finished is skipped.

const RATE := 16000
var ready_ok := false
var _streams := {}
var _thread: Thread
var _flat: Array[AudioStreamPlayer] = []
var _i := 0
var _rumble: AudioStreamPlayer
var _jet: AudioStreamPlayer
var _rng := RandomNumberGenerator.new()
var master := 1.0
var muted := false


func _ready() -> void:
	for k in 8:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_flat.append(p)
	_rumble = AudioStreamPlayer.new()
	_jet = AudioStreamPlayer.new()
	add_child(_rumble)
	add_child(_jet)
	_thread = Thread.new()
	_thread.start(_build)


func _exit_tree() -> void:
	if _thread != null:
		_thread.wait_to_finish()
		_thread = null


func _process(_d: float) -> void:
	if not ready_ok and _thread != null and not _thread.is_alive():
		_thread.wait_to_finish()
		_thread = null
		ready_ok = true
		_rumble.stream = _streams["rumble"]
		_rumble.volume_db = -14.0
		_jet.stream = _streams["jet"]
		_jet.volume_db = -80.0
		if not muted:
			_rumble.play()
			_jet.play()


func play(name: String, db := 0.0, pitch := 1.0) -> void:
	if not ready_ok or muted or not _streams.has(name):
		return
	_i = (_i + 1) % _flat.size()
	var p := _flat[_i]
	p.stream = _streams[name]
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()


## 0..1: how hard the jetpack is burning (own player only).
func set_jet(level: float) -> void:
	if ready_ok and not muted:
		_jet.volume_db = -80.0 if level < 0.02 else lerpf(-26.0, -9.0, clampf(level, 0.0, 1.0))
		_jet.pitch_scale = 0.85 + level * 0.4


func set_muted(on: bool) -> void:
	muted = on
	if on:
		_rumble.stop()
		_jet.stop()
	elif ready_ok:
		_rumble.play()
		_jet.play()


# ── synthesis ────────────────────────────────────────────────────────────────

func _build() -> void:
	_rng.seed = 3
	_streams["rumble"] = _rumble_loop(4.0)
	_streams["jet"] = _jet_loop(1.5)
	_streams["zap"] = _zap(0.22, 900.0, 220.0)
	_streams["zap_low"] = _zap(0.3, 360.0, 90.0)
	_streams["boom"] = _boom(0.9)
	_streams["shatter"] = _shatter(0.35)
	_streams["coin"] = _coin()
	_streams["place"] = _thud(0.18, 150.0, 0.9)
	_streams["hurt"] = _thud(0.3, 95.0, 1.0)
	_streams["ping"] = _tone(0.1, 1200.0)
	_streams["whoosh"] = _whoosh(0.4)
	_streams["ui"] = _tone(0.06, 800.0)


func _buf(sec: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(sec * RATE))
	return b


func _wav(b: PackedFloat32Array, loop := false) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(b.size() * 2)
	for i in b.size():
		data.encode_s16(i * 2, int(clampf(tanh(b[i] * 1.2), -1.0, 1.0) * 30000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.data = data
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = b.size()
	return w


func _rumble_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.02
		var clack := pow(maxf(0.0, sin(TAU * 4.0 * t / dur * dur)), 40.0)     # four clacks per loop
		b[i] = (lp * 3.2 + sin(TAU * 38.0 * t) * 0.18) * 0.7 + clack * 0.35 * sin(TAU * 220.0 * t) * exp(-fmod(t, dur / 4.0) * 18.0)
	return _wav(b, true)


func _jet_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.22
		b[i] = lp * (0.7 + 0.3 * sin(TAU * 31.0 * t)) * 0.9
	return _wav(b, true)


func _zap(dur: float, f0: float, f1: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var ph := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var f := lerpf(f0, f1, t / dur)
		ph += f / RATE
		b[i] = (sin(TAU * ph) * 0.5 + (fmod(ph, 1.0) * 2.0 - 1.0) * 0.25 + (_rng.randf() * 2.0 - 1.0) * 0.1) * exp(-t * (4.0 / dur)) * 0.9
	return _wav(b)


func _boom(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.06
		b[i] = (sin(TAU * 56.0 * t * exp(-t * 2.5)) * 1.1 + lp * 1.6) * exp(-t * 3.4)
	return _wav(b)


func _shatter(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in b.size():
		var t := float(i) / RATE
		var n := _rng.randf() * 2.0 - 1.0
		b[i] = n * exp(-t * 14.0) * 0.6 + sin(TAU * (1800.0 + 900.0 * sin(t * 60.0)) * t) * exp(-t * 22.0) * 0.25
	return _wav(b)


func _coin() -> AudioStreamWAV:
	var b := _buf(0.22)
	for i in b.size():
		var t := float(i) / RATE
		var f := 1318.0 if t < 0.07 else 1760.0
		b[i] = sin(TAU * f * t) * exp(-fmod(t, 0.07) * 22.0) * 0.45 * (1.0 - t / 0.22)
	return _wav(b)


func _thud(dur: float, hz: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.12
		b[i] = (sin(TAU * hz * t * exp(-t * 8.0)) * 0.9 + lp * 0.5) * exp(-t * (7.0 / dur)) * amp
	return _wav(b)


func _tone(dur: float, hz: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in b.size():
		var t := float(i) / RATE
		b[i] = sin(TAU * hz * t) * exp(-t * (6.0 / dur)) * 0.4
	return _wav(b)


func _whoosh(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * (0.05 + 0.4 * t / dur)
		b[i] = lp * sin(PI * t / dur) * 1.4
	return _wav(b)
