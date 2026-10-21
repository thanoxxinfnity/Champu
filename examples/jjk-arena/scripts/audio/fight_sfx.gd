class_name FightSfx
extends Node
## Every sound in Cursed Clash, synthesised at start-up on a thread: no audio files, nothing licensed, nothing added to the APK.
## Autoloaded as `Sound`: `Sound.play("punch")`, `Sound.play_at("boom", pos)`. A sound asked for before the build finishes is skipped.
##
## Punches and kicks are a pitched thump plus a noise crack; slashes are a bright noise burst with metallic rings ("shing");
## Red is a charge then a boom, Blue a falling suction, Purple a long rising chord into a huge blast; Fuga an ignition roar;
## the domains are a deep drone with glassy shimmer (Infinite Void) or taiko hits and a gong (Malevolent Shrine).
## The battle music is an 8-bar loop at 140 BPM: kick/snare/hats, a D-minor bass riff and a soft pad.

const RATE := 24000

var ready_ok := false
var music_db := -15.0
var _streams := {}
var _thread: Thread
var _voices: Array[AudioStreamPlayer] = []
var _vi := 0
var _music: AudioStreamPlayer
var _wind: AudioStreamPlayer
var _rng := RandomNumberGenerator.new()
var _want_music := false
var listener: Node3D          ## sounds placed in the world get quieter with distance from this (the camera)

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# a limiter on the master bus: Purple + collapse + music together never clip on phone speakers
	if AudioServer.get_bus_effect_count(0) == 0:
		var lim := AudioEffectHardLimiter.new()
		lim.ceiling_db = -1.0
		lim.pre_gain_db = -2.0
		AudioServer.add_bus_effect(0, lim)
	for i in 16:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_voices.append(p)
	_music = AudioStreamPlayer.new()
	_wind = AudioStreamPlayer.new()
	add_child(_music)
	add_child(_wind)
	if OS.has_feature("web"):
		_build_all()
		_finish()
	else:
		_thread = Thread.new()
		_thread.start(_build_all)

func _exit_tree() -> void:
	if _thread != null:
		_thread.wait_to_finish()
		_thread = null

func _process(_delta: float) -> void:
	if not ready_ok and _thread != null and not _thread.is_alive():
		_thread.wait_to_finish()
		_thread = null
		_finish()

func _finish() -> void:
	ready_ok = true
	_music.stream = _streams["music"]
	_music.volume_db = music_db
	_wind.stream = _streams["wind"]
	_wind.volume_db = -80.0
	if _want_music:
		_music.play()

func music(on: bool) -> void:
	_want_music = on
	if not ready_ok:
		return
	if on and not _music.playing:
		_music.play()
	elif not on:
		_music.stop()

## Lower the music under a cutscene or a domain, then bring it back.
func duck(db: float, secs: float) -> void:
	if not ready_ok:
		return
	var t := create_tween()
	t.tween_property(_music, "volume_db", music_db + db, 0.25)
	t.tween_interval(secs)
	t.tween_property(_music, "volume_db", music_db, 0.8)

## Flight wind: 0 = silent, 1 = full speed.
func wind(amount: float) -> void:
	if not ready_ok:
		return
	if amount <= 0.02:
		if _wind.playing:
			_wind.stop()
		return
	if not _wind.playing:
		_wind.play()
	_wind.volume_db = lerpf(-30.0, -6.0, clampf(amount, 0.0, 1.0))
	_wind.pitch_scale = lerpf(0.8, 1.25, clampf(amount, 0.0, 1.0))

func has(sound: String) -> bool:
	return _streams.has(sound)

func play(sound: String, db := 0.0, pitch := 1.0) -> void:
	if not ready_ok or not _streams.has(sound):
		return
	var p: AudioStreamPlayer = null
	for v in _voices:
		if not v.playing:
			p = v
			break
	if p == null:
		_vi = (_vi + 1) % _voices.size()
		p = _voices[_vi]
	p.stream = _streams[sound]
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()

## A sound from a place in the world: quieter the farther it is from the listener (the camera).
func play_at(sound: String, pos: Vector3, db := 0.0, pitch := 1.0) -> void:
	var d := 0.0
	if listener != null and is_instance_valid(listener) and listener.is_inside_tree():
		d = listener.global_position.distance_to(pos)
	if d > 140.0:
		return
	play(sound, db - clampf(d * 0.18, 0.0, 24.0), pitch)

## A random pitch around 1 so repeated hits do not sound machine-made.
func vary(amount := 0.08) -> float:
	return 1.0 + _rng.randf_range(-amount, amount)

# ── synthesis ────────────────────────────────────────────────────────────────

func _build_all() -> void:
	_rng.seed = 7
	_streams["click"] = _click()
	_streams["swing"] = _swing(0.2, 900.0, 2600.0)
	_streams["swing_heavy"] = _swing(0.32, 500.0, 1700.0)
	_streams["punch"] = _punch(0.18, 120.0, 0.7)
	_streams["heavy"] = _punch(0.4, 72.0, 1.0)
	_streams["block"] = _block()
	_streams["step"] = _step(0.11, 140.0)
	_streams["land"] = _step(0.3, 70.0)
	_streams["slash"] = _slash(0.45, 1.0)
	_streams["cleave"] = _cleave()
	_streams["charge"] = _charge(0.7, 180.0, 520.0)
	_streams["red"] = _boom(1.3, 1.0)
	_streams["blue"] = _suction(1.1)
	_streams["purple_charge"] = _purple_charge(1.6)
	_streams["purple"] = _boom(2.8, 1.6)
	_streams["fuga"] = _fuga(1.8)
	_streams["world_slash"] = _world_slash(2.4)
	_streams["boom"] = _boom(2.2, 1.2)
	_streams["collapse"] = _collapse(3.2)
	_streams["takeoff"] = _swing(0.7, 300.0, 1800.0)
	_streams["domain_void"] = _domain_void(4.5)
	_streams["domain_shrine"] = _domain_shrine(4.5)
	_streams["ko"] = _gong(2.6, 0.9)
	_streams["round"] = _bell(1.4)
	_streams["wind"] = _wind_loop(2.5)
	_streams["music"] = _music_loop()

func _buf(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(seconds * RATE))
	return b

func _stream(b: PackedFloat32Array, loop := false, gain := 1.0) -> AudioStreamWAV:
	if not loop and b.size() > 8:
		var fade := mini(int(0.003 * RATE), b.size() / 2)
		for i in fade:
			var k := float(i) / float(fade)
			b[i] *= k
			b[b.size() - 1 - i] *= k
	var data := PackedByteArray()
	data.resize(b.size() * 2)
	for i in b.size():
		data.encode_s16(i * 2, int(clampf(tanh(b[i] * gain), -1.0, 1.0) * 32000.0))
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

func _n() -> float:
	return _rng.randf() * 2.0 - 1.0

func _click() -> AudioStreamWAV:
	var b := _buf(0.05)
	for i in b.size():
		var t := float(i) / RATE
		b[i] = sin(TAU * 1800.0 * t) * exp(-t * 90.0) * 0.6
	return _stream(b)

## Air being cut: noise through a band-pass that sweeps from lo to hi Hz.
func _swing(dur: float, lo: float, hi: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var y1 := 0.0
	var y2 := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		var f := lerpf(lo, hi, k)
		var w := TAU * f / RATE
		var r := 0.94
		var y := _n() * 0.25 + 2.0 * r * cos(w) * y1 - r * r * y2
		y2 = y1
		y1 = y
		b[i] = y * sin(PI * k) * 0.35
	return _stream(b)

## A body hit: a dropping sine thump, a low-passed noise crack and a click on top.
func _punch(dur: float, hz: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	var ph := 0.0
	for i in b.size():
		var t := float(i) / RATE
		ph += TAU * hz * (1.0 + 2.5 * exp(-t * 30.0)) / RATE
		lp += (_n() - lp) * 0.35
		b[i] = (sin(ph) * exp(-t * (6.0 / dur)) * 1.1 + lp * exp(-t * 45.0) * 0.9 + _n() * exp(-t * 400.0) * 0.6) * amp
	return _stream(b, false, 1.4)

func _block() -> AudioStreamWAV:
	var b := _buf(0.22)
	var bp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		bp += (_n() - bp) * 0.6
		b[i] = sin(TAU * 230.0 * t) * exp(-t * 28.0) * 0.6 + bp * exp(-t * 60.0) * 0.5 + sin(TAU * 1250.0 * t) * exp(-t * 40.0) * 0.15
	return _stream(b)

func _step(dur: float, hz: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += (_n() - lp) * 0.15
		b[i] = (sin(TAU * hz * t * exp(-t * 10.0)) * 0.7 + lp * 0.6) * exp(-t * (7.0 / dur)) * 0.5
	return _stream(b)

## A blade: a bright noise burst and a few metallic rings that hang in the air ("shing").
func _slash(dur: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var hp := 0.0
	var prev := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var x := _n()
		hp = 0.85 * (hp + x - prev)
		prev = x
		var ring := sin(TAU * 3150.0 * t) * 0.3 * exp(-t * 9.0) + sin(TAU * 4720.0 * t) * 0.2 * exp(-t * 12.0) + sin(TAU * 6200.0 * t) * 0.12 * exp(-t * 16.0)
		var swish := hp * exp(-t * 22.0) * 0.8 * minf(1.0, t * 400.0)
		b[i] = (swish + ring) * amp
	return _stream(b)

func _cleave() -> AudioStreamWAV:
	var b := _buf(0.7)
	var s1: AudioStreamWAV = _slash(0.45, 1.0)
	var src := PackedFloat32Array()
	for i in s1.data.size() / 2:
		src.append(s1.data.decode_s16(i * 2) / 32000.0)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var v := 0.0
		if i < src.size():
			v += src[i] * 0.8
		var j := i - int(0.12 * RATE)
		if j >= 0 and j < src.size():
			v += src[j] * 0.9
		lp += (_n() - lp) * 0.2
		v += (sin(TAU * 65.0 * t) * 0.8 + lp * 0.4) * exp(-maxf(0.0, t - 0.12) * 14.0) * (1.0 if t > 0.12 else 0.0)
		b[i] = v
	return _stream(b)

## Cursed energy gathering: a rising hum with a tremble.
func _charge(dur: float, f0: float, f1: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var ph := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		ph += TAU * lerpf(f0, f1, k * k) / RATE
		var trem := 0.75 + 0.25 * sin(TAU * (8.0 + 20.0 * k) * t)
		b[i] = (sin(ph) * 0.5 + sin(ph * 2.01) * 0.25 + _n() * 0.12 * k) * trem * k * 0.8
	return _stream(b)

## An explosion: a sub-bass sweep, a fat low-passed noise body and crackle in the tail.
func _boom(dur: float, size: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	var lp2 := 0.0
	var ph := 0.0
	for i in b.size():
		var t := float(i) / RATE
		ph += TAU * (38.0 + 90.0 * exp(-t * 6.0)) / RATE
		lp += (_n() - lp) * 0.08
		lp2 += (lp - lp2) * 0.3
		var crack := (_n() if _rng.randf() < 0.004 * exp(-t * 2.0) else 0.0) * 0.7
		var env := exp(-t * (3.2 / size))
		b[i] = (sin(ph) * 1.2 * exp(-t * (2.5 / size)) + lp2 * 3.5 * env + _n() * exp(-t * 60.0) * 0.8 + crack) * 0.9
	return _stream(b, false, 1.3)

## Lapse: Blue — air rushing inward: noise swelling with a falling band and a low warble.
func _suction(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var y1 := 0.0
	var y2 := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		var w := TAU * lerpf(2400.0, 300.0, k) / RATE
		var r := 0.97
		var y := _n() * 0.15 + 2.0 * r * cos(w) * y1 - r * r * y2
		y2 = y1
		y1 = y
		var swell := pow(k, 1.6) * (1.0 - smoothstep(0.85, 1.0, k))
		b[i] = (y * 0.35 + sin(TAU * 70.0 * t + sin(TAU * 6.0 * t) * 2.0) * 0.5) * swell
	return _stream(b)

## Hollow Purple wind-up: two tones (Blue and Red) sliding together into one, getting louder and brighter.
func _purple_charge(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var pa := 0.0
	var pb := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		pa += TAU * lerpf(160.0, 220.0, k) / RATE
		pb += TAU * lerpf(330.0, 221.0, k) / RATE
		var shimmer := sin(TAU * 2200.0 * t) * 0.06 * k
		b[i] = (sin(pa) * 0.45 + sin(pb) * 0.45 + sin(pa * 3.0) * 0.1 + _n() * 0.15 * k * k + shimmer) * (0.2 + 0.8 * k)
	return _stream(b)

## Fuga: ignition — a noise roar whose filter opens, then a crackling fire tail.
func _fuga(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		var cut := lerpf(0.04, 0.5, minf(1.0, t * 3.0)) * (1.0 - 0.6 * k)
		lp += (_n() - lp) * cut
		var crackle := (_n() if _rng.randf() < 0.01 else 0.0) * 0.8 * k
		var env := minf(1.0, t * 6.0) * (1.0 - k * 0.7)
		b[i] = (lp * 1.6 + sin(TAU * 55.0 * t) * 0.4 + crackle) * env
	return _stream(b, false, 1.2)

func _world_slash(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var hp := 0.0
	var prev := 0.0
	var ph := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var x := _n()
		hp = 0.9 * (hp + x - prev)
		prev = x
		ph += TAU * (40.0 + 50.0 * exp(-t * 4.0)) / RATE
		var ring := sin(TAU * 2600.0 * t) * 0.35 * exp(-t * 2.5) + sin(TAU * 3911.0 * t) * 0.25 * exp(-t * 3.5) + sin(TAU * 5870.0 * t) * 0.15 * exp(-t * 5.0)
		b[i] = hp * exp(-t * 12.0) * 0.9 + ring + sin(ph) * exp(-t * 2.0) * 0.9
	return _stream(b, false, 1.2)

func _collapse(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		lp += (_n() - lp) * 0.05
		var debris := (_n() * 0.6 if _rng.randf() < 0.02 * exp(-t * 0.8) else 0.0)
		var env := minf(1.0, t * 3.0) * exp(-t * 0.9)
		b[i] = (lp * 4.0 + sin(TAU * 32.0 * t) * 0.4) * env + debris
	return _stream(b, false, 1.2)

## Infinite Void: a deep drone that swells, with glassy high partials shimmering in and out.
func _domain_void(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var partials := [1046.5, 1318.5, 1568.0, 2093.0, 2637.0]
	for i in b.size():
		var t := float(i) / RATE
		var k := t / dur
		var env := smoothstep(0.0, 0.25, k) * (1.0 - smoothstep(0.75, 1.0, k))
		var drone := sin(TAU * 55.0 * t) * 0.6 + sin(TAU * 82.5 * t) * 0.3 + sin(TAU * 110.0 * t + sin(TAU * 0.5 * t)) * 0.2
		var glass := 0.0
		for j in partials.size():
			glass += sin(TAU * partials[j] * t) * (0.5 + 0.5 * sin(TAU * (0.6 + j * 0.37) * t + j)) * 0.07
		b[i] = (drone + glass) * env
	return _stream(b)

## Malevolent Shrine: four taiko hits, a gong, and a low growl underneath.
func _domain_shrine(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	var hits := [0.0, 0.42, 0.84, 1.1]
	for i in b.size():
		var t := float(i) / RATE
		var v := 0.0
		for h in hits:
			var dt: float = t - h
			if dt >= 0.0 and dt < 0.6:
				v += sin(TAU * (60.0 + 60.0 * exp(-dt * 25.0)) * dt) * exp(-dt * 7.0) * 0.9
		var g := t - 1.5
		if g >= 0.0:
			v += (sin(TAU * 98.0 * g) * 0.5 + sin(TAU * 151.3 * g) * 0.3 + sin(TAU * 233.7 * g) * 0.2 + sin(TAU * 349.1 * g) * 0.12) * exp(-g * 1.1) * minf(1.0, g * 40.0)
		v += sin(TAU * 41.0 * t + sin(TAU * 3.0 * t) * 1.5) * 0.25 * smoothstep(0.0, 1.0, t / dur)
		b[i] = v
	return _stream(b)

func _gong(dur: float, amp: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in b.size():
		var t := float(i) / RATE
		b[i] = (sin(TAU * 87.0 * t) * 0.6 + sin(TAU * 134.2 * t) * 0.35 + sin(TAU * 211.9 * t) * 0.22 + sin(TAU * 318.4 * t) * 0.12 + _n() * exp(-t * 50.0) * 0.6) * exp(-t * 1.3) * amp
	return _stream(b)

func _bell(dur: float) -> AudioStreamWAV:
	var b := _buf(dur)
	for i in b.size():
		var t := float(i) / RATE
		b[i] = (sin(TAU * 880.0 * t) * 0.5 + sin(TAU * 1760.0 * t) * 0.2 + sin(TAU * 2637.0 * t) * 0.12) * exp(-t * 3.0) * 0.8
	return _stream(b)

## Flight wind: low-passed noise whose two ends are cross-faded so the loop has no seam.
func _wind_loop(dur: float) -> AudioStreamWAV:
	var n := int(dur * RATE)
	var raw := PackedFloat32Array()
	raw.resize(n)
	var lp := 0.0
	var lp2 := 0.0
	for i in n:
		var t := float(i) / RATE
		lp += (_n() - lp) * (0.05 + 0.03 * sin(TAU * 0.8 * t))
		lp2 += (lp - lp2) * 0.2
		raw[i] = lp2 * 3.0
	var fade := int(0.4 * RATE)
	var b := PackedFloat32Array()
	b.resize(n - fade)
	for i in b.size():
		b[i] = raw[i]
		if i < fade:
			var k := float(i) / fade
			b[i] = raw[i] * k + raw[n - fade + i] * (1.0 - k)
	return _stream(b, true)

## Battle music: 8 bars of 4/4 at 140 BPM in D minor (Dm - Bb - C - A, two bars each).
func _music_loop() -> AudioStreamWAV:
	var bpm := 140.0
	var beat := 60.0 / bpm
	var bars := 8
	var b := _buf(bars * 4 * beat)
	var chords := [[146.83, 174.61, 220.0], [116.54, 146.83, 174.61], [130.81, 164.81, 196.0], [110.0, 138.59, 164.81]]
	var roots := [73.42, 58.27, 65.41, 55.0]
	var riff := [0, 0, 12, 0, 10, 0, 7, 5]       # semitone offsets from the bar's root, eighth notes
	var lp := 0.0
	var hat := 0.0
	var bass_lp := 0.0
	for i in b.size():
		var t := float(i) / RATE
		var bt := t / beat                     # position in beats
		var bar := int(bt / 4.0)
		var cidx := (bar / 2) % 4
		var in_beat := fmod(bt, 1.0) * beat     # seconds since the beat
		var eighth := int(bt * 2.0)
		var in_8 := fmod(bt * 2.0, 1.0) * beat * 0.5
		var v := 0.0
		# kick on 1 and 3, plus the "and" of 4 every other bar
		var beat_in_bar := int(fmod(bt, 4.0))
		var kick_here := beat_in_bar == 0 or beat_in_bar == 2
		if kick_here:
			v += sin(TAU * (50.0 + 90.0 * exp(-in_beat * 30.0)) * in_beat) * exp(-in_beat * 9.0) * 0.9
		if bar % 2 == 1 and eighth % 8 == 7:
			v += sin(TAU * (50.0 + 90.0 * exp(-in_8 * 30.0)) * in_8) * exp(-in_8 * 12.0) * 0.6
		# snare on 2 and 4
		if beat_in_bar == 1 or beat_in_bar == 3:
			lp += (_n() - lp) * 0.6
			v += (lp * 0.55 + sin(TAU * 190.0 * in_beat) * 0.3) * exp(-in_beat * 16.0)
		# closed hats on eighths
		var hx := _n()
		hat = 0.6 * (hat + hx) - hx
		v += hat * exp(-in_8 * 60.0) * 0.12
		# bass riff
		var semis: int = riff[eighth % 8]
		var f: float = roots[cidx] * pow(2.0, semis / 12.0)
		var saw := 0.0
		for h in [1, 2, 3, 4]:
			saw += sin(TAU * f * h * t) / h
		bass_lp += (saw - bass_lp) * 0.25
		v += bass_lp * exp(-in_8 * 5.0) * 0.32
		# pad
		var pad := 0.0
		for cf in chords[cidx]:
			pad += sin(TAU * cf * t) + sin(TAU * cf * 1.003 * t) * 0.5
		v += pad * 0.035
		b[i] = v * 0.8
	return _stream(b, true)
