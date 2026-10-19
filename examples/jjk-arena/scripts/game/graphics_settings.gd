class_name GraphicsSettings
extends RefCounted
## Six graphics modes, from Low to Max plus Auto. `apply()` pushes one preset into the viewport, the environment, the sun and the arena's
## effect managers, so a player can trade looks for frame rate on whatever phone they have.
##
## Everything here uses features the GL Compatibility renderer actually has: render scaling, MSAA, anisotropy, shadow atlas size, glow and
## fog. There is no SSAO/SSR/volumetric knob because that renderer has none.

enum Mode { LOW, STANDARD, HIGH, ULTRA, MAX, AUTO }

## Destruction quality levels, mirrored as plain ints so this file does not depend on DestructionManager's enum.
const Q_LOW := 0
const Q_MEDIUM := 1
const Q_HIGH := 2

const PRESETS := {
	Mode.LOW: {"name": "Low", "scale": 0.60, "msaa": 0, "shadow_size": 0, "shadows": false, "glow": false,
		"particles": 0.35, "debris": 0.25, "character_lod": 6000, "tex_cap": 512, "fps": 30, "aniso": 1, "sway": false, "fog": false},
	Mode.STANDARD: {"name": "Standard", "scale": 0.75, "msaa": 0, "shadow_size": 1024, "shadows": true, "glow": false,
		"particles": 0.60, "debris": 0.50, "character_lod": 12000, "tex_cap": 1024, "fps": 45, "aniso": 2, "sway": true, "fog": true},
	Mode.HIGH: {"name": "High", "scale": 0.90, "msaa": 1, "shadow_size": 2048, "shadows": true, "glow": true,
		"particles": 0.80, "debris": 0.75, "character_lod": 12000, "tex_cap": 2048, "fps": 60, "aniso": 4, "sway": true, "fog": true},
	Mode.ULTRA: {"name": "Ultra", "scale": 1.00, "msaa": 2, "shadow_size": 4096, "shadows": true, "glow": true,
		"particles": 1.00, "debris": 1.00, "character_lod": 12000, "tex_cap": 2048, "fps": 60, "aniso": 8, "sway": true, "fog": true},
	Mode.MAX: {"name": "Max", "scale": 1.00, "msaa": 3, "shadow_size": 4096, "shadows": true, "glow": true,
		"particles": 1.00, "debris": 1.00, "character_lod": 12000, "tex_cap": 4096, "fps": 90, "aniso": 16, "sway": true, "fog": true},
}

static var current := Mode.STANDARD

static func mode_names() -> PackedStringArray:
	return PackedStringArray(["Low", "Standard", "High", "Ultra", "Max", "Auto"])

static func preset(mode: int) -> Dictionary:
	if mode == Mode.AUTO:
		return PRESETS[auto_mode()]
	return PRESETS[mode]

## Guess a mode from the device: core count and the adapter name. Known weak mobile GPUs drop straight to Low.
static func auto_mode() -> int:
	var cores := OS.get_processor_count()
	var gpu := RenderingServer.get_video_adapter_name().to_lower()
	for weak in ["mali-g5", "mali-g3", "adreno (tm) 5", "powervr"]:
		if gpu.contains(weak):
			return Mode.LOW
	if cores <= 4:
		return Mode.LOW
	if cores <= 6:
		return Mode.STANDARD
	if cores <= 8:
		return Mode.HIGH
	return Mode.ULTRA

## Apply a mode. `destruction` is a DestructionManager (untyped here so this file stays dependency-free); its `quality` is set to match.
static func apply(mode: int, viewport: Viewport, env: Environment = null, sun: DirectionalLight3D = null,
		destruction: Node = null) -> Dictionary:
	var p := preset(mode)
	current = mode
	viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	viewport.scaling_3d_scale = p["scale"]
	viewport.msaa_3d = int(p["msaa"]) as Viewport.MSAA
	# anisotropy is a project setting in 4.3, not a Viewport property
	ProjectSettings.set_setting("rendering/textures/default_filters/anisotropic_filtering_level", _aniso_level(int(p["aniso"])))
	Engine.max_fps = int(p["fps"])
	if env != null:
		env.glow_enabled = p["glow"]
		env.glow_intensity = 0.6
		env.fog_enabled = p["fog"]
		env.fog_density = 0.002 if p["fog"] else 0.0
	if sun != null:
		sun.shadow_enabled = p["shadows"]
		if p["shadows"]:
			RenderingServer.directional_shadow_atlas_set_size(int(p["shadow_size"]), true)
			sun.directional_shadow_max_distance = 40.0 if int(p["shadow_size"]) <= 2048 else 80.0
	if destruction != null and "quality" in destruction:
		destruction.set("quality", destruction_quality(mode))
	return p

## Which character mesh to load for this mode: the cheap 6k build or the 12k one.
static func character_model(path_12k: String, path_6k: String, mode: int) -> String:
	return path_6k if int(preset(mode)["character_lod"]) <= 6000 else path_12k

static func use_cloth_sway(mode: int) -> bool:
	return preset(mode)["sway"]

static func particle_ratio(mode: int) -> float:
	return preset(mode)["particles"]

static func destruction_quality(mode: int) -> int:
	var d: float = preset(mode)["debris"]
	if d <= 0.3:
		return Q_LOW
	return Q_MEDIUM if d <= 0.75 else Q_HIGH

static func _aniso_level(level: int) -> int:
	# project setting values: 0 = off, 1 = 2x, 2 = 4x, 3 = 8x, 4 = 16x
	match level:
		1: return 0
		2: return 1
		4: return 2
		8: return 3
		_: return 4
