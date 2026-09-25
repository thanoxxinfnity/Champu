class_name EngineAudio
extends Node
## Engine note, tyre squeal and nitro, driven by the vehicle's state.
## The loops are short synthesized samples (audio/) pitched by RPM, which is
## far cheaper on a phone than synthesizing samples in script every frame.

var vehicle: VehicleController
var _engine: AudioStreamPlayer
var _screech: AudioStreamPlayer
var _whoosh: AudioStreamPlayer
var _was_nitro := false


static func _looped(path: String) -> AudioStreamWAV:
	var s := (load(path) as AudioStreamWAV).duplicate() as AudioStreamWAV
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_begin = 0
	s.loop_end = int(s.get_length() * s.mix_rate)
	return s


func setup(v: VehicleController) -> void:
	vehicle = v
	_engine = AudioStreamPlayer.new()
	_engine.stream = _looped("res://audio/engine_loop.wav")
	_engine.volume_db = -8.0
	add_child(_engine)
	_screech = AudioStreamPlayer.new()
	_screech.stream = _looped("res://audio/tire_screech.wav")
	_screech.volume_db = -60.0
	add_child(_screech)
	_whoosh = AudioStreamPlayer.new()
	_whoosh.stream = load("res://audio/nitro_whoosh.wav")
	_whoosh.volume_db = -4.0
	add_child(_whoosh)
	_engine.play()
	_screech.play()


func stop() -> void:
	for p in [_engine, _screech, _whoosh]:
		if p:
			p.stop()


func _process(delta: float) -> void:
	if vehicle == null or not is_instance_valid(vehicle):
		return
	var target_pitch := clampf(vehicle.rpm / 1900.0, 0.45, 4.2)
	_engine.pitch_scale = lerpf(_engine.pitch_scale, target_pitch, 1.0 - exp(-delta * 12.0))
	var th := vehicle.in_throttle
	_engine.volume_db = lerpf(_engine.volume_db, lerpf(-11.0, -3.0, th), 1.0 - exp(-delta * 6.0))

	var slide := 0.0
	for s in vehicle.rear_wheel_slides():
		slide = maxf(slide, s[1])
	if vehicle.speed_kmh < 12.0:
		slide = 0.0
	var sv := lerpf(-50.0, -5.0, clampf((slide - 0.35) / 0.5, 0.0, 1.0))
	_screech.volume_db = lerpf(_screech.volume_db, sv, 1.0 - exp(-delta * 10.0))
	_screech.pitch_scale = 0.9 + clampf(vehicle.speed_kmh / 250.0, 0.0, 0.3)

	if vehicle.nitro_active and not _was_nitro:
		_whoosh.play()
	_was_nitro = vehicle.nitro_active
