extends SceneTree
## godot --headless --path . -s tests/sound_test.gd   (prints ALL OK)
## Every synthesised sound is built, is not silent, loops where it should, and the whole set builds quickly enough for a phone.

var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func _init() -> void:
	print("sound test")
	var t0 := Time.get_ticks_msec()
	var s := FightSfx.new()
	s._build_all()
	var ms := Time.get_ticks_msec() - t0
	check(ms < 20000, "all sounds synthesised in %d ms (on a thread at start-up)" % ms)
	var names := ["click", "swing", "swing_heavy", "punch", "heavy", "block", "step", "land", "slash", "cleave", "charge", "red", "blue",
		"purple_charge", "purple", "fuga", "world_slash", "boom", "collapse", "takeoff", "domain_void", "domain_shrine", "ko", "round", "wind", "music"]
	for n in names:
		var w: AudioStreamWAV = s._streams.get(n)
		if w == null:
			check(false, "%s exists" % n)
			continue
		var peak := 0
		for i in range(0, w.data.size() / 2, 7):
			peak = maxi(peak, absi(w.data.decode_s16(i * 2)))
		check(peak > 3000, "%s is audible (%.2f s, peak %d)" % [n, w.get_length(), peak])
	check(s._streams["music"].loop_mode == AudioStreamWAV.LOOP_FORWARD and s._streams["music"].get_length() > 13.0, "battle music is a looping 8-bar track")
	check(s._streams["wind"].loop_mode == AudioStreamWAV.LOOP_FORWARD, "flight wind loops")
	s.free()
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
