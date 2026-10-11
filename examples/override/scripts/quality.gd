class_name Quality
extends RefCounted
## Three picture qualities. A phone with a weak GPU (a Redmi Note 8 class: Adreno 610, 4 GB) cannot draw a 2340 x 1080 frame with MSAA, glow,
## dozens of lights and light cones, so it starts on LOW: the 3D picture is drawn at 854 x 480 (the whole screen is then stretched, which
## is a quarter of the pixels of the phone's real resolution or less), no MSAA, no glow, no light cones, half the particles, no glow on
## pick-ups, 30 frames a second. The pack screen has a button to change it; the choice is saved.
##   LOW      854 x 480 drawn, 30 fps cap, nothing extra         (default on a phone)
##   MEDIUM   1280 x 720 drawn, light cones, 60 fps
##   HIGH     the screen's own resolution, 2x MSAA, glow          (default on a computer)

enum { LOW, MEDIUM, HIGH }

const PATH := "user://quality.json"
const NAMES := ["low", "medium", "high"]

static var level := HIGH
static var shafts := true            # the light cones under the lamps
static var pickup_lights := true     # the little glow around a pick-up
static var particle_scale := 1.0


static func default_level() -> int:
	if OS.has_feature("mobile") or OS.has_feature("android") or OS.has_feature("ios"):
		return LOW
	if OS.has_feature("web") and DisplayServer.is_touchscreen_available():
		return LOW
	if OS.has_feature("web"):
		return MEDIUM
	return HIGH


static func load_level() -> int:
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f != null:
		var d = JSON.parse_string(f.get_as_text())
		if typeof(d) == TYPE_DICTIONARY and d.has("level"):
			return clampi(int(d.level), LOW, HIGH)
	return default_level()


static func save_level(l: int) -> void:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({"level": l}))


## Set everything the level controls, on the running game (also what the button in the pack calls).
static func apply(game: Game, l: int) -> void:
	level = clampi(l, LOW, HIGH)
	shafts = level != LOW
	pickup_lights = level != LOW
	particle_scale = 0.5 if level == LOW else 1.0
	var tree := game.get_tree()
	var win := game.get_window()
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	match level:
		LOW:
			win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
			win.content_scale_size = Vector2i(854, 480)
			win.msaa_3d = Viewport.MSAA_DISABLED
			Engine.max_fps = 30
			Engine.physics_ticks_per_second = 30
		MEDIUM:
			win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
			win.content_scale_size = Vector2i(1280, 720)
			win.msaa_3d = Viewport.MSAA_DISABLED
			Engine.max_fps = 60
			Engine.physics_ticks_per_second = 60
		_:
			win.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
			win.content_scale_size = Vector2i(1280, 720)
			win.msaa_3d = Viewport.MSAA_2X
			Engine.max_fps = 0
			Engine.physics_ticks_per_second = 60
	game.env.glow_enabled = level == HIGH
	tree.call_group("shaft", "set_visible", shafts)
	tree.call_group("pickup_light", "set_visible", pickup_lights)
	if game.player != null:
		game.player.torch.spot_range = 12.0 if level == LOW else 16.0
	if game.ui != null:
		game.ui.set_low_fx(level == LOW)
