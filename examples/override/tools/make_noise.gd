extends SceneTree
## godot --headless --path . -s tools/make_noise.gd
## Bakes assets/noise.png: a seamless 256 px noise sheet that shaders/station.gdshader reads instead of computing noise per pixel
## (the phone-killer: dozens of hashes for every pixel of every wall and floor). R = three-octave cloud (damp patches, scuffs),
## G = fine grain, B = a second single-octave noise (streaks, drips). One feature per 16 px in every channel.

func _init() -> void:
	var cloud := FastNoiseLite.new()
	cloud.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	cloud.seed = 11
	cloud.frequency = 0.0625
	cloud.fractal_type = FastNoiseLite.FRACTAL_FBM
	cloud.fractal_octaves = 3
	var grain := FastNoiseLite.new()
	grain.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	grain.seed = 23
	grain.frequency = 0.0625
	var streak := FastNoiseLite.new()
	streak.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	streak.seed = 37
	streak.frequency = 0.0625
	var a := cloud.get_seamless_image(256, 256, false, false, 0.15, true)
	var b := grain.get_seamless_image(256, 256, false, false, 0.15, true)
	var c := streak.get_seamless_image(256, 256, false, false, 0.15, true)
	var out := Image.create(256, 256, false, Image.FORMAT_RGB8)
	for y in range(256):
		for x in range(256):
			out.set_pixel(x, y, Color(a.get_pixel(x, y).r, b.get_pixel(x, y).r, c.get_pixel(x, y).r))
	out.save_png("res://assets/noise.png")
	print("noise baked")
	quit()
