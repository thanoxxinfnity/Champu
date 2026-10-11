extends SceneTree
## godot --headless --path . -s tools/make_blood.gd
## Draws the blood textures in assets/blood/ (alpha PNGs): splatters, bloody hand prints (and slid-down ones), smears and drips.
## No renderer is needed, so it runs anywhere; the same seeds always give the same pictures.

const N := 256


func _init() -> void:
	DirAccess.make_dir_recursive_absolute("res://assets/blood")
	for i in range(6):
		_save(_splat(i), "splat_%d" % i)
	for i in range(4):
		_save(_hand(i, i % 2 == 0, i >= 2), "hand_%d" % i)
	for i in range(3):
		_save(_smear(i), "smear_%d" % i)
	for i in range(2):
		_save(_drips(i), "drip_%d" % i)
	_atlas()
	print("blood textures done")
	quit()


## All the world pictures on one 1024 px sheet (4 x 4 cells of 256), so a room's blood is a single draw call. The cell order is
## Blood.ATLAS_ORDER: splat 0-5, hand 0-3, smear 0-2, drip 0-1.
func _atlas() -> void:
	var order := ["splat_0", "splat_1", "splat_2", "splat_3", "splat_4", "splat_5", "hand_0", "hand_1", "hand_2", "hand_3", "smear_0", "smear_1", "smear_2", "drip_0", "drip_1"]
	var sheet := Image.create(1024, 1024, false, Image.FORMAT_RGBA8)
	sheet.fill(Color(0.4, 0.03, 0.03, 0.0))
	for i in range(order.size()):
		var img := Image.load_from_file(ProjectSettings.globalize_path("res://assets/blood/%s.png" % order[i]))
		img.convert(Image.FORMAT_RGBA8)
		sheet.blit_rect(img, Rect2i(0, 0, img.get_width(), img.get_height()), Vector2i((i % 4) * 256, (i / 4) * 256))
	sheet.save_png("res://assets/blood/atlas.png")


func _save(img: Image, name: String) -> void:
	img.save_png("res://assets/blood/%s.png" % name)


## Soft blob stamp on a float mask.
func _stamp(mask: PackedFloat32Array, w: int, h: int, c: Vector2, r: float, amount := 1.0) -> void:
	var x0 := maxi(0, int(c.x - r - 2))
	var x1 := mini(w - 1, int(c.x + r + 2))
	var y0 := maxi(0, int(c.y - r - 2))
	var y1 := mini(h - 1, int(c.y + r + 2))
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var d := Vector2(x, y).distance_to(c)
			if d < r + 1.5:
				var a := clampf((r + 1.0 - d) / 2.0, 0.0, 1.0) * amount
				mask[y * w + x] = maxf(mask[y * w + x], a)


func _capsule(mask: PackedFloat32Array, w: int, h: int, a: Vector2, b: Vector2, r0: float, r1: float, amount := 1.0) -> void:
	var steps := int(a.distance_to(b) / 1.5) + 1
	for i in range(steps + 1):
		var t := float(i) / steps
		_stamp(mask, w, h, a.lerp(b, t), lerpf(r0, r1, t), amount)


## Turns a mask into dark-red wet blood: thicker parts darker, a few bright wet highlights, soft rim.
func _paint(mask: PackedFloat32Array, w: int, h: int, seed_v: int, strength := 0.93) -> Image:
	var noise := FastNoiseLite.new()
	noise.seed = seed_v
	noise.frequency = 0.045
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in range(h):
		for x in range(w):
			var m := mask[y * w + x]
			if m <= 0.0:
				img.set_pixel(x, y, Color(0.4, 0.03, 0.03, 0.0))     # clear, but blood-coloured, so mip-maps do not darken the edges
				continue
			var n := noise.get_noise_2d(x, y) * 0.5 + 0.5
			var dark := Color(0.22, 0.01, 0.01)
			var wet := Color(0.55, 0.03, 0.03)
			var col := dark.lerp(wet, n)
			if n > 0.78:
				col = col.lerp(Color(0.8, 0.12, 0.1), (n - 0.78) * 3.0)     # a wet gleam
			img.set_pixel(x, y, Color(col.r, col.g, col.b, clampf(m, 0.0, 1.0) * strength))
	return img


func _splat(seed_v: int) -> Image:
	var rng := RandomNumberGenerator.new()
	rng.seed = 100 + seed_v
	var mask := PackedFloat32Array()
	mask.resize(N * N)
	var c := Vector2(N * 0.5, N * 0.5)
	_stamp(mask, N, N, c, rng.randf_range(32.0, 48.0))
	for i in range(rng.randi_range(5, 9)):
		var a := rng.randf() * TAU
		var d := rng.randf_range(20.0, 40.0)
		_stamp(mask, N, N, c + Vector2.from_angle(a) * d, rng.randf_range(12.0, 24.0))
	# Spikes and flung drops, further out and smaller.
	for i in range(rng.randi_range(8, 14)):
		var a := rng.randf() * TAU
		var d0 := rng.randf_range(40.0, 60.0)
		var d1 := d0 + rng.randf_range(15.0, 45.0)
		_capsule(mask, N, N, c + Vector2.from_angle(a) * d0, c + Vector2.from_angle(a) * d1, rng.randf_range(4.0, 7.0), rng.randf_range(1.0, 2.5))
		_stamp(mask, N, N, c + Vector2.from_angle(a) * (d1 + rng.randf_range(4.0, 14.0)), rng.randf_range(2.0, 4.5))
	for i in range(rng.randi_range(14, 26)):
		_stamp(mask, N, N, c + Vector2.from_angle(rng.randf() * TAU) * rng.randf_range(55.0, 118.0), rng.randf_range(1.2, 3.8))
	return _paint(mask, N, N, seed_v)


## A bloody hand: palm, four fingers, a thumb; gaps in the print where the skin did not touch; slid down the glass if `smeared`.
func _hand(seed_v: int, left: bool, smeared: bool) -> Image:
	var rng := RandomNumberGenerator.new()
	rng.seed = 400 + seed_v
	var mask := PackedFloat32Array()
	mask.resize(N * N)
	var sx := -1.0 if left else 1.0
	var palm := Vector2(N * 0.5, N * 0.62)
	var slides := 1 if not smeared else 14
	var slide_len := 0.0 if not smeared else rng.randf_range(40.0, 70.0)
	for k in range(slides):
		var off := Vector2(rng.randf_range(-2.0, 2.0), slide_len * float(k) / maxf(slides - 1, 1) * 0.55)
		var amt := 1.0 if k == 0 else clampf(0.85 - float(k) * 0.05, 0.25, 0.8)
		var p := palm + off
		for s in range(10):
			var a := float(s) / 9.0 * TAU
			_stamp(mask, N, N, p + Vector2(cos(a) * 30.0, sin(a) * 34.0), 14.0, amt)
		_stamp(mask, N, N, p, 30.0, amt)
		var angles := [-0.38, -0.12, 0.12, 0.34]
		var lens := [64.0, 78.0, 72.0, 56.0]
		for i in range(4):
			var base := p + Vector2((float(i) - 1.5) * 17.0 * sx * -1.0, -22.0)
			var ang: float = float(angles[i]) * sx * -1.0 + rng.randf_range(-0.05, 0.05)
			var tip := base + Vector2(sin(ang), -cos(ang)) * (float(lens[i]) + rng.randf_range(-4.0, 4.0))
			_capsule(mask, N, N, base, tip, 9.0, 7.5, amt)
		var tb := p + Vector2(28.0 * sx, 8.0)
		_capsule(mask, N, N, tb, tb + Vector2(26.0 * sx, -34.0), 11.0, 8.5, amt)
	# The skin does not touch everywhere: nibble the mask with noise.
	var nz := FastNoiseLite.new()
	nz.seed = 700 + seed_v
	nz.frequency = 0.09
	for y in range(N):
		for x in range(N):
			var v := mask[y * N + x]
			if v > 0.0:
				var g := nz.get_noise_2d(x, y)
				if g > 0.38:
					mask[y * N + x] = v * 0.35
	return _paint(mask, N, N, seed_v + 30, 0.92)


## A long wet smear down a surface: a dragged thick streak with ragged edges.
func _smear(seed_v: int) -> Image:
	var rng := RandomNumberGenerator.new()
	rng.seed = 900 + seed_v
	var w := 128
	var h := 256
	var mask := PackedFloat32Array()
	mask.resize(w * h)
	var x := 64.0 + rng.randf_range(-14.0, 14.0)
	for y in range(16, h - 16, 3):
		x += rng.randf_range(-1.6, 1.6)
		var r := lerpf(16.0, 5.0, float(y) / h) + rng.randf_range(-2.0, 2.0)
		_stamp(mask, w, h, Vector2(x, y), r, clampf(1.1 - float(y) / h, 0.3, 1.0))
	for i in range(rng.randi_range(2, 4)):
		var sx := 64.0 + rng.randf_range(-22.0, 22.0)
		_capsule(mask, w, h, Vector2(sx, 30.0), Vector2(sx + rng.randf_range(-6.0, 6.0), rng.randf_range(120.0, 230.0)), 3.5, 1.4, 0.8)
	return _paint(mask, w, h, seed_v + 50, 0.9)


## Drips running down from a top edge, each ending in a fat drop.
func _drips(seed_v: int) -> Image:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1200 + seed_v
	var w := 192
	var h := 256
	var mask := PackedFloat32Array()
	mask.resize(w * h)
	for y in range(0, 12):
		for x in range(0, w):
			mask[y * w + x] = 0.9
	var x := 14.0
	while x < w - 10.0:
		var len := rng.randf_range(40.0, 220.0)
		var r := rng.randf_range(2.2, 4.5)
		_capsule(mask, w, h, Vector2(x, 8.0), Vector2(x + rng.randf_range(-2.0, 2.0), len), r, r * 0.7)
		_stamp(mask, w, h, Vector2(x, len + r), r * 1.6)
		x += rng.randf_range(14.0, 30.0)
	return _paint(mask, w, h, seed_v + 80, 0.9)
