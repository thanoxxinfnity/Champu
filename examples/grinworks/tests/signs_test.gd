extends SceneTree
## godot --headless --path . -s tests/signs_test.gd
## Every word painted or hung on a wall fits that wall and does not sit on top of another word.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	if not ok:
		print("  FAIL " + what)
		fails += 1


## The flat rectangle a wall label covers: its centre, the way its text runs, the way it faces, and its size in metres.
func rect_of(l: Label3D) -> Dictionary:
	var font := ThemeDB.fallback_font
	var w := 0.0
	var lines := l.text.split("\n")
	for line in lines:
		w = maxf(w, font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, l.font_size).x)
	var h := float(lines.size()) * l.font_size * 1.15
	var basis := Basis(Vector3.UP, l.global_rotation.y)
	return {"c": l.global_position, "axis": basis * Vector3.RIGHT, "n": basis * Vector3.BACK, "w": w * l.pixel_size, "h": h * l.pixel_size, "text": l.text.replace("\n", " "), "node": l}


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	for i in range(4):
		await physics_frame
	var rects: Array = []
	for n in game.level.find_children("*", "Label3D", true, false):
		var l := n as Label3D
		if absf(l.global_rotation.x) > 0.01 or l.text == "" or l.text in ["FIRE"] or l.text.length() < 2:
			continue
		# Writing on a poster or a screen is the poster's business; only things on a bare wall are checked here.
		if l.get_parent() != game.level:
			continue
		rects.append(rect_of(l))

	print("-- %d wall labels" % rects.size())
	for r in rects:
		var inward: Vector3 = r.n * 0.4
		var mid: String = game.level.zone_at(r.c + inward)
		for s in [-0.5, 0.5]:
			var end: Vector3 = r.c + r.axis * (r.w * s) + inward
			check(game.level.zone_at(end) == mid, "\"%s\" runs off its wall (%.1f m wide at %s)" % [r.text, r.w, str(r.c)])
		check(r.c.y + r.h * 0.5 <= 4.6 and r.c.y - r.h * 0.5 >= -0.01, "\"%s\" is not fully between floor and ceiling" % r.text)

	print("-- nothing sits on top of anything")
	for i in range(rects.size()):
		for j in range(i + 1, rects.size()):
			var a: Dictionary = rects[i]
			var b: Dictionary = rects[j]
			if (a.n as Vector3).dot(b.n) < 0.99:
				continue
			var plane := absf((a.c - b.c).dot(a.n))
			if plane > 0.4:
				continue
			var d: Vector3 = b.c - a.c
			var dx := absf(d.dot(a.axis))
			var dy := absf(d.y)
			var over_x: bool = dx < (a.w + b.w) * 0.5
			var over_y: bool = dy < (a.h + b.h) * 0.5
			check(not (over_x and over_y), "\"%s\" overlaps \"%s\"" % [a.text, b.text])

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
