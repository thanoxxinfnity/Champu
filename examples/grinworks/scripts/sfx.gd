class_name Sfx
extends Node
## Every sound in the game, synthesised at startup — no audio files. Built on a thread while the
## title screen is up; a sound asked for before it is ready is skipped.

const RATE := 16000

var ready_ok := false
var _streams := {}
var _thread: Thread
var _flat: Array[AudioStreamPlayer] = []
var _spatial: Array[AudioStreamPlayer3D] = []
var _flat_i := 0
var _spatial_i := 0
var _hum: AudioStreamPlayer
var _amb: AudioStreamPlayer
var _heart: AudioStreamPlayer
var _breath: AudioStreamPlayer3D
var _box: AudioStreamPlayer3D
var _heart_t := 0.0
var heart_rate := 0.0     # beats per second; 0 = silent
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	for i in range(8):
		var p := AudioStreamPlayer.new()
		add_child(p)
		_flat.append(p)
	for i in range(8):
		var q := AudioStreamPlayer3D.new()
		q.unit_size = 5.0
		q.max_distance = 60.0
		q.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		add_child(q)
		_spatial.append(q)
	_hum = AudioStreamPlayer.new()
	_amb = AudioStreamPlayer.new()
	_heart = AudioStreamPlayer.new()
	_box = AudioStreamPlayer3D.new()
	_box.unit_size = 5.0
	_box.max_distance = 45.0
	add_child(_box)
	_breath = AudioStreamPlayer3D.new()
	_breath.unit_size = 4.0
	_breath.max_distance = 30.0
	for p in [_hum, _amb, _heart, _breath]:
		add_child(p)
	_thread = Thread.new()
	_thread.start(_build_all)


func _exit_tree() -> void:
	if _thread != null:
		_thread.wait_to_finish()
		_thread = null


func _process(delta: float) -> void:
	if not ready_ok and _thread != null and not _thread.is_alive():
		_thread.wait_to_finish()
		_thread = null
		ready_ok = true
		_hum.stream = _streams["hum"]
		_hum.volume_db = -20.0
		_amb.stream = _streams["amb"]
		_amb.volume_db = -22.0
		_breath.stream = _streams["breath"]
		_breath.volume_db = -80.0
		_box.stream = _streams["musicbox"]
		_box.volume_db = -80.0
	if heart_rate > 0.0 and ready_ok:
		_heart_t += delta * heart_rate
		if _heart_t >= 1.0:
			_heart_t = 0.0
			_heart.stream = _streams["heart"]
			_heart.volume_db = -3.0
			_heart.play()


## Tension thickens the room tone and darkens the hum.
func set_dread(t: float) -> void:
	if not ready_ok:
		return
	_amb.volume_db = lerpf(-24.0, -10.0, t)
	_hum.volume_db = lerpf(-20.0, -14.0, t)
	_hum.pitch_scale = lerpf(1.0, 0.82, t)


func start_ambience() -> void:
	while not ready_ok:
		await get_tree().create_timer(0.4).timeout
	if not _hum.playing:
		_hum.play()
		_amb.play()


## The creature's breathing, following it. `db` is -80 when it is far or gone.
func breath_at(pos: Vector3, db: float) -> void:
	if not ready_ok:
		return
	# Mr. Grin carries a music box. You hear the tune before you see the smile.
	_box.global_position = pos
	_box.volume_db = clampf(db + 6.0, -80.0, 4.0) if db > -60.0 else -80.0
	if db > -60.0 and not _box.playing:
		_box.play()
	elif db <= -60.0 and _box.playing:
		_box.stop()
	_breath.global_position = pos
	_breath.volume_db = db
	if db > -60.0 and not _breath.playing:
		_breath.play()
	elif db <= -60.0 and _breath.playing:
		_breath.stop()


func play(sound: String, db := 0.0, pitch := 1.0) -> void:
	if not ready_ok or not _streams.has(sound):
		return
	_flat_i = (_flat_i + 1) % _flat.size()
	var p := _flat[_flat_i]
	p.stream = _streams[sound]
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()


func play_at(sound: String, pos: Vector3, db := 0.0, pitch := 1.0) -> void:
	if not ready_ok or not _streams.has(sound):
		return
	_spatial_i = (_spatial_i + 1) % _spatial.size()
	var p := _spatial[_spatial_i]
	p.stream = _streams[sound]
	p.global_position = pos
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()


# ── synthesis ────────────────────────────────────────────────────────────────

func _build_all() -> void:
	_rng.seed = 9
	_streams["step"] = _thud(0.12, 150.0, 0.5, 0.35)
	_streams["step2"] = _thud(0.12, 120.0, 0.5, 0.35)
	_streams["run"] = _thud(0.16, 95.0, 0.9, 0.55)
	_streams["soft"] = _thud(0.09, 200.0, 0.2, 0.2)
	_streams["drip"] = _drip()
	_streams["creak"] = _creak(1.1)
	_streams["click"] = _click(0.1, 1)
	_streams["torch"] = _click(0.14, 2)
	_streams["pickup"] = _pips()
	_streams["note"] = _pips_low()
	_streams["door"] = _door(1.2)
	_streams["locker"] = _locker(0.5)
	_streams["crank"] = _crank(0.5)
	_streams["valve"] = _valve(0.7)
	_streams["hammer"] = _hammer(1.6)
	_streams["error"] = _buzz(0.4)
	_streams["win"] = _chime()
	_streams["poweron"] = _power_on(2.4)
	_streams["growl"] = _growl(1.8)
	_streams["screech"] = _screech(1.3)
	_streams["hollow_step"] = _thud(0.18, 70.0, 0.6, 0.6)
	_streams["jump"] = _jumpscare(1.6)
	_streams["heart"] = _heart_beat()
	_streams["hum"] = _hum_loop(6.0)
	_streams["amb"] = _amb_loop(8.0)
	_streams["breath"] = _breath_loop(3.0)
	_streams["launch"] = _rumble(3.0)
	_streams["beep"] = _beep()
	_streams["musicbox"] = _musicbox(9.6)


func _buf(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(seconds * RATE))
	return b


func _stream(b: PackedFloat32Array, loop := false) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(b.size() * 2)
	for i in range(b.size()):
		var v := tanh(b[i] * 1.2)
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 32000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = b.size()
	return w


func _noise() -> float:
	return _rng.randf() * 2.0 - 1.0


func _thud(dur: float, hz: float, amp: float, grit: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.2
		b[i] = (sin(TAU * hz * t * exp(-t * 9.0)) * 0.9 + lp * grit) * exp(-t * (8.0 / dur)) * amp
	return _stream(b)


func _drip() -> AudioStreamWAV:
	var b := _buf(0.35)
	for i in range(b.size()):
		var t := float(i) / RATE
		var f := 1500.0 + 900.0 * exp(-t * 40.0)
		b[i] = sin(TAU * f * t) * exp(-t * 26.0) * 0.35
	return _stream(b)


func _creak(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var ph := 0.0
	for i in range(b.size()):
		var t := float(i) / float(b.size())
		var f := 180.0 + 120.0 * sin(t * 9.0) * (1.0 - t) + _noise() * 25.0
		ph += f / RATE
		b[i] = (fmod(ph, 1.0) * 2.0 - 1.0) * 0.18 * sin(PI * t)
	return _stream(b)


func _click(dur: float, n: int) -> AudioStreamWAV:
	var b := _buf(dur)
	for c in range(n):
		var start := int(float(c) * dur / float(n) * RATE)
		for i in range(int(0.012 * RATE)):
			if start + i < b.size():
				b[start + i] += _noise() * exp(-float(i) / (0.003 * RATE)) * 0.6
	return _stream(b)


func _pips() -> AudioStreamWAV:
	var b := _buf(0.3)
	for i in range(b.size()):
		var t := float(i) / RATE
		var f := 880.0 if t < 0.1 else 1320.0
		b[i] = sin(TAU * f * t) * exp(-fmod(t, 0.1) * 28.0) * 0.35
	return _stream(b)


func _pips_low() -> AudioStreamWAV:
	var b := _buf(0.5)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] = (sin(TAU * 330.0 * t) + sin(TAU * 497.0 * t) * 0.6) * exp(-t * 7.0) * 0.26
	return _stream(b)


func _chime() -> AudioStreamWAV:
	var b := _buf(1.4)
	for k in range(3):
		var f: float = [523.0, 659.0, 784.0][k]
		var start := int(float(k) * 0.14 * RATE)
		for i in range(b.size() - start):
			var t := float(i) / RATE
			b[start + i] += sin(TAU * f * t) * exp(-t * 3.0) * 0.28
	return _stream(b)


func _beep() -> AudioStreamWAV:
	var b := _buf(0.18)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] = sin(TAU * 1000.0 * t) * (1.0 if t < 0.12 else exp(-(t - 0.12) * 60.0)) * 0.3
	return _stream(b)


func _door(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.07
		var env := sin(PI * t / dur)
		b[i] = (lp * 0.9 + sin(TAU * (90.0 + 40.0 * t) * t) * 0.35) * env * 0.8
	return _stream(b)


func _locker(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] = (sin(TAU * 410.0 * t) * 0.4 + sin(TAU * 690.0 * t) * 0.3 + _noise() * exp(-t * 80.0)) * exp(-t * 9.0) * 0.5
	return _stream(b)


func _crank(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for tick in range(4):
		var start := int(float(tick) * dur / 4.0 * RATE)
		for i in range(int(0.04 * RATE)):
			if start + i < b.size():
				var t := float(i) / RATE
				b[start + i] += (_noise() * 0.5 + sin(TAU * 340.0 * t) * 0.4) * exp(-t * 70.0)
	return _stream(b)


func _valve(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var ph := 0.0
	for i in range(b.size()):
		var t := float(i) / float(b.size())
		ph += (230.0 + 90.0 * t + _noise() * 18.0) / RATE
		b[i] = (fmod(ph, 1.0) * 2.0 - 1.0) * 0.22 * sin(PI * t) + _noise() * 0.04 * sin(PI * t)
	return _stream(b)


func _hammer(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for k in range(4):
		var start := int([0.0, 0.32, 0.56, 0.9][k] * RATE)
		for i in range(int(0.5 * RATE)):
			if start + i < b.size():
				var t := float(i) / RATE
				b[start + i] += (sin(TAU * 130.0 * t) * 0.8 + sin(TAU * 420.0 * t) * 0.5 + _noise() * exp(-t * 90.0)) * exp(-t * 6.0) * 0.8
	return _stream(b)


func _buzz(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		var sq := 1.0 if fmod(t * 140.0, 1.0) < 0.5 else -1.0
		b[i] = sq * 0.22 * (1.0 - t / dur)
	return _stream(b)


func _power_on(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		var f := 50.0 + 130.0 * (1.0 - exp(-t * 1.6))
		var thunk := exp(-pow(t - 0.05, 2.0) * 900.0) * 1.2
		b[i] = (sin(TAU * f * t) * 0.5 + sin(TAU * f * 2.0 * t) * 0.18 + _noise() * 0.04) * minf(t * 3.0, 1.0) * exp(-maxf(0.0, t - 1.6) * 3.0) + thunk * sin(TAU * 70.0 * t)
	return _stream(b)


func _vocal(b: PackedFloat32Array, f0: float, f1: float, vib: float, breath: float, f_a: float, f_b: float, amp: float) -> void:
	var n := b.size()
	var ph := 0.0
	var s1 := 0.0
	var s2 := 0.0
	var d1 := 0.0
	var d2 := 0.0
	var ca := 2.0 * sin(PI * f_a / RATE)
	var cb := 2.0 * sin(PI * f_b / RATE)
	for i in range(n):
		var t := float(i) / float(n)
		var f := lerpf(f0, f1, t) * (1.0 + vib * sin(TAU * 5.5 * float(i) / RATE))
		ph += f / RATE
		ph -= floorf(ph)
		var src := (ph * 2.0 - 1.0) * 0.6 + _noise() * breath
		d1 += ca * s1
		var h1 := src - d1 - 0.35 * s1
		s1 += ca * h1
		d2 += cb * s2
		var h2 := src - d2 - 0.5 * s2
		s2 += cb * h2
		var env := sin(PI * t) * sin(PI * t)
		b[i] += (s1 * 0.9 + s2 * 0.5) * env * amp


func _growl(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, 70.0, 42.0, 0.09, 0.45, 280.0, 640.0, 1.0)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] *= 0.6 + 0.4 * sin(TAU * 24.0 * t)
	return _stream(b)


func _screech(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, 520.0, 880.0, 0.06, 0.4, 1100.0, 2600.0, 0.6)
	_vocal(b, 130.0, 70.0, 0.08, 0.3, 400.0, 900.0, 0.7)
	return _stream(b)


func _jumpscare(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, 640.0, 300.0, 0.07, 0.5, 1300.0, 3000.0, 0.9)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.08
		b[i] += (sin(TAU * 48.0 * t * exp(-t * 1.5)) * 1.4 + lp * 1.2) * exp(-t * 2.4)
	return _stream(b)


func _heart_beat() -> AudioStreamWAV:
	var b := _buf(0.7)
	for beat in [[0.0, 1.0], [0.26, 0.7]]:
		var start := int(float(beat[0]) * RATE)
		for i in range(int(0.2 * RATE)):
			if start + i < b.size():
				var t := float(i) / RATE
				b[start + i] += sin(TAU * 58.0 * t * exp(-t * 4.0)) * exp(-t * 18.0) * float(beat[1]) * 0.9
	return _stream(b)


func _hum_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		var m := 0.5 + 0.5 * sin(TAU * t / dur * 2.0)
		b[i] = (sin(TAU * 50.0 * t) * 0.5 + sin(TAU * 100.5 * t) * 0.25 + sin(TAU * 150.0 * t) * 0.1 * m) * 0.55
	return _stream(b, true)


func _amb_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	var lp2 := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.03
		lp2 += (lp - lp2) * 0.15
		var win := 0.5 - 0.5 * cos(TAU * t / dur)
		var swell := 0.5 + 0.5 * sin(TAU * t / dur * 3.0)
		b[i] = lp2 * 2.6 * (0.3 + 0.7 * win) * (0.5 + 0.5 * swell)
	return _stream(b, true)


func _breath_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.12
		var cyc := pow(maxf(0.0, sin(TAU * t / dur * 2.0)), 2.0)
		b[i] = lp * cyc * 1.4 + sin(TAU * 42.0 * t) * 0.1 * cyc
	return _stream(b, true)


func _rumble(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += (_noise() - lp) * 0.05
		b[i] = (lp * 1.6 + sin(TAU * 38.0 * t) * 0.5) * (0.5 + 0.5 * sin(PI * t / dur))
	return _stream(b)


## A slow, slightly flat music-box lullaby (an original tune) that loops.
func _musicbox(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var notes: Array = [392.0, 330.0, 392.0, 523.0, 494.0, 392.0, 330.0, 294.0, 330.0, 392.0, 330.0, 262.0, 294.0, 247.0, 262.0, 0.0]
	var step := dur / float(notes.size())
	for k in range(notes.size()):
		var f: float = notes[k]
		if f <= 0.0:
			continue
		var start := int(float(k) * step * RATE)
		for i in range(int(minf(step * 1.9, dur) * RATE)):
			if start + i >= b.size():
				break
			var t := float(i) / RATE
			var detune := 1.0 + 0.004 * sin(float(k) * 1.7)   # a little out of tune, like a worn comb
			var tone := sin(TAU * f * detune * t) + 0.35 * sin(TAU * f * 2.01 * t) + 0.18 * sin(TAU * f * 3.97 * t)
			b[start + i] += tone * exp(-t * 3.2) * 0.22
	return _stream(b, true)
