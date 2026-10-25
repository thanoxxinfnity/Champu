class_name Sfx
extends Node
## Every sound in the game, synthesised at startup — no audio files. Guns are
## shaped noise plus a low thump, groans are a gliding saw through a vocal
## filter, wind and the drone are seamless loops. The work runs on a thread
## while the title screen is up; a sound asked for before it is ready is skipped.

const RATE := 16000

var ready_ok := false
var _streams := {}
var _thread: Thread
var _flat: Array[AudioStreamPlayer] = []
var _spatial: Array[AudioStreamPlayer3D] = []
var _flat_i := 0
var _spatial_i := 0
var _wind: AudioStreamPlayer
var _drone: AudioStreamPlayer
var _heart: AudioStreamPlayer
var _chop: AudioStreamPlayer
var _heart_t := 0.0
var heart_rate := 0.0   # beats per second; 0 = silent
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	for i in range(8):
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_flat.append(p)
	for i in range(10):
		var q := AudioStreamPlayer3D.new()
		q.unit_size = 6.0
		q.max_distance = 70.0
		q.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		add_child(q)
		_spatial.append(q)
	_wind = AudioStreamPlayer.new()
	_drone = AudioStreamPlayer.new()
	_heart = AudioStreamPlayer.new()
	_chop = AudioStreamPlayer.new()
	for p in [_wind, _drone, _heart, _chop]:
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
		_wind.stream = _streams["wind"]
		_wind.volume_db = -16.0
		_drone.stream = _streams["drone"]
		_drone.volume_db = -18.0
		_chop.stream = _streams["chop"]
		_chop.volume_db = -80.0
	if heart_rate > 0.0 and ready_ok:
		_heart_t += delta * heart_rate
		if _heart_t >= 1.0:
			_heart_t = 0.0
			_heart.stream = _streams["heart"]
			_heart.volume_db = -4.0
			_heart.play()


func start_ambience() -> void:
	while not ready_ok:
		await get_tree().create_timer(0.5).timeout
	if not _wind.playing:
		_wind.play()
		_drone.play()


func chopper(on: bool) -> void:
	if not ready_ok:
		return
	if on and not _chop.playing:
		_chop.volume_db = -6.0
		_chop.play()
	elif not on:
		_chop.stop()


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
	_rng.seed = 7
	_streams["pistol"] = _shot(0.30, 0.55, 150.0, 0.6, 5200.0)
	_streams["shotgun"] = _shot(0.60, 1.0, 85.0, 1.0, 2600.0)
	_streams["smg"] = _shot(0.16, 0.5, 170.0, 0.5, 6500.0)
	_streams["rifle"] = _shot(0.34, 0.8, 110.0, 0.8, 4200.0)
	_streams["empty"] = _click(0.12, 2)
	_streams["reload"] = _reload()
	_streams["swap"] = _click(0.2, 3)
	_streams["hit"] = _thud(0.16, 130.0, 0.9)
	_streams["hurt"] = _thud(0.25, 90.0, 1.0)
	_streams["step"] = _thud(0.11, 70.0, 0.45)
	_streams["groan1"] = _groan(1.3, 78.0, 52.0, 0.9)
	_streams["groan2"] = _groan(1.0, 95.0, 60.0, 1.0)
	_streams["groan3"] = _groan(1.6, 66.0, 46.0, 0.8)
	_streams["scream"] = _scream(1.0)
	_streams["roar"] = _roar(2.0)
	_streams["pickup"] = _pips()
	_streams["note"] = _pips_low()
	_streams["thunder"] = _thunder(3.2)
	_streams["boom"] = _boom(1.4)
	_streams["clank"] = _clank(0.9)
	_streams["static"] = _static(0.7)
	_streams["slam"] = _boom(0.9)
	_streams["heart"] = _heart_beat()
	_streams["wind"] = _wind_loop(6.0)
	_streams["drone"] = _drone_loop(6.0)
	_streams["chop"] = _chop_loop(1.0)


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


func _shot(dur: float, amp: float, thump_hz: float, noise: float, bright: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	var k := clampf(bright / RATE * 2.0, 0.02, 0.95)
	for i in range(b.size()):
		var t := float(i) / RATE
		var env := exp(-t * (11.0 / dur))
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * k
		var thump := sin(TAU * thump_hz * t * exp(-t * 6.0)) * exp(-t * (9.0 / dur) * 1.4)
		b[i] = (lp * noise * env + thump * 0.9 * env) * amp * 1.4
	return _stream(b)


func _click(dur: float, n: int) -> AudioStreamWAV:
	var b := _buf(dur)
	for c in range(n):
		var start := int(float(c) * dur / float(n) * RATE)
		for i in range(int(0.012 * RATE)):
			if start + i < b.size():
				b[start + i] += (_rng.randf() * 2.0 - 1.0) * exp(-float(i) / (0.003 * RATE)) * 0.6
	return _stream(b)


func _reload() -> AudioStreamWAV:
	var b := _buf(0.9)
	for hit in [[0.0, 0.5], [0.45, 0.7], [0.62, 0.5]]:
		var start := int(float(hit[0]) * RATE)
		for i in range(int(0.05 * RATE)):
			if start + i < b.size():
				var t := float(i) / RATE
				b[start + i] += ((_rng.randf() * 2.0 - 1.0) * 0.5 + sin(TAU * 900.0 * t) * 0.4) * exp(-t * 90.0) * float(hit[1])
	return _stream(b)


func _thud(dur: float, hz: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.12
		b[i] = (sin(TAU * hz * t * exp(-t * 8.0)) * 0.9 + lp * 0.5) * exp(-t * (7.0 / dur)) * amp
	return _stream(b)


func _vocal(b: PackedFloat32Array, f0: float, f1: float, vib: float, breath: float, f_a: float, f_b: float, amp: float) -> void:
	# A gliding sawtooth through two resonant band-passes (the "mouth"), plus breath.
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
		var src := (ph * 2.0 - 1.0) * 0.6 + (_rng.randf() * 2.0 - 1.0) * breath
		# Two state-variable band-pass filters in parallel.
		d1 += ca * s1
		var h1 := src - d1 - 0.35 * s1
		s1 += ca * h1
		d2 += cb * s2
		var h2 := src - d2 - 0.5 * s2
		s2 += cb * h2
		var env := sin(PI * t) * sin(PI * t) if t > 0.0 else 0.0
		b[i] += (s1 * 0.9 + s2 * 0.5) * env * amp


func _groan(dur: float, f0: float, f1: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, f0, f1, 0.05, 0.25, 520.0, 1000.0, amp * 0.7)
	return _stream(b)


func _scream(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, 420.0, 260.0, 0.04, 0.35, 900.0, 2200.0, 0.55)
	return _stream(b)


func _roar(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	_vocal(b, 62.0, 38.0, 0.08, 0.5, 300.0, 700.0, 1.0)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] *= 0.6 + 0.4 * sin(TAU * 27.0 * t)
	return _stream(b)


func _pips() -> AudioStreamWAV:
	var b := _buf(0.3)
	for i in range(b.size()):
		var t := float(i) / RATE
		var f := 880.0 if t < 0.1 else 1320.0
		b[i] = sin(TAU * f * t) * exp(-fmod(t, 0.1) * 28.0) * 0.4
	return _stream(b)


func _pips_low() -> AudioStreamWAV:
	var b := _buf(0.5)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] = (sin(TAU * 330.0 * t) + sin(TAU * 497.0 * t) * 0.6) * exp(-t * 7.0) * 0.28
	return _stream(b)


func _thunder(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.035
		var env := (1.0 - exp(-t * 14.0)) * exp(-t * 1.1)
		b[i] = lp * env * 3.0 * (0.7 + 0.3 * sin(TAU * 7.0 * t))
	return _stream(b)


func _boom(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.06
		b[i] = (sin(TAU * 52.0 * t * exp(-t * 2.5)) * 1.1 + lp * 1.6) * exp(-t * 3.2)
	return _stream(b)


func _clank(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		b[i] = (sin(TAU * 740.0 * t) * 0.5 + sin(TAU * 1130.0 * t) * 0.4 + sin(TAU * 1830.0 * t) * 0.3 + (_rng.randf() * 2.0 - 1.0) * exp(-t * 60.0)) * exp(-t * 7.0) * 0.45
	return _stream(b)


func _static(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.5
		var gate := 1.0 if fmod(t * 9.0, 1.0) < 0.7 else 0.35
		b[i] = lp * 0.35 * gate * (1.0 - t / dur * 0.5)
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


func _wind_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	var lp2 := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.04
		lp2 += (lp - lp2) * 0.2
		var gust := 0.55 + 0.45 * sin(TAU * t / dur * 2.0 + 1.0) * sin(TAU * t / dur * 3.0)
		# Cosine window so the loop point is silent and the seam cannot click.
		var win := 0.5 - 0.5 * cos(TAU * t / dur)
		b[i] = (lp2 * 2.4) * gust * (0.25 + 0.75 * win)
	return _stream(b, true)


func _drone_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in range(b.size()):
		var t := float(i) / RATE
		var m := 0.5 + 0.5 * sin(TAU * t / dur * 2.0)
		b[i] = (sin(TAU * 55.0 * t) * 0.5 + sin(TAU * 58.5 * t) * 0.4 + sin(TAU * 82.5 * t) * 0.15 * m + sin(TAU * 110.5 * t) * 0.08 * (1.0 - m)) * 0.55
	return _stream(b, true)


func _chop_loop(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in range(b.size()):
		var t := float(i) / RATE
		lp += ((_rng.randf() * 2.0 - 1.0) - lp) * 0.08
		var pulse := pow(maxf(0.0, sin(TAU * 8.0 * t)), 3.0)
		b[i] = (lp * 1.5 + sin(TAU * 48.0 * t) * 0.35) * (0.15 + pulse) * 0.9
	return _stream(b, true)
