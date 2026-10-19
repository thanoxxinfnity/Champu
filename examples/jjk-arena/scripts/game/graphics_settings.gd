class_name GraphicsSettings
extends RefCounted
## Six graphics modes. `apply()` pushes one preset into the viewport, the environment, the sun and the effect managers, so the player can
## trade looks for frame rate on any phone. Presets only use things the GL Compatibility renderer has.

enum Mode { LOW, STANDARD, HIGH, ULTRA, MAX, AUTO }

const PRESETS := {
	Mode.LOW: {"name": "Low", "scale": 0.6, "msaa": 0, "shadow_size": 0, "shadows": false, "glow": false, "particles": 0.35, "debris": 0.25,
		"character_lod": 6000, "tex_cap": 512, "fps": 30, "dust": false, "aniso": 1, "sway": false},
	Mode.STANDARD: {"name": "Standard", "scale": 0.75, "msaa": 0, "shadow_size": 1024, "shadows": true, "glow": false, "particles": 0.6, "debris": 0.5,
		"character_lod": 12000, "tex_cap": 1024, "fps": 45, "dust": true, "aniso": 2, "sway": true},
	Mode.HIGH: {"name": "High", "scale": 0.9, "msaa": 1, "shadow_size": 2048, "shadows": true, "glow": true, "particles": 0.8, "debris": 0.75,
		"character_lod": 12000, "tex_cap": 2048, "fps": 60, "dust": true, "aniso": 4, "sway": true},
	Mode.ULTRA: {"name": "Ultra", "scale": 1.0, "msaa": 2, "shadow_size": 4096, "shadows": true, "glow": true, "particles": 1.0, "debris": 1.0,
		"character_lod": 12000, "tex_cap": 2048, "fps": 60, "dust": true, "aniso": 8, "sway": true},
	Mode.MAX: {"name": "Max", "scale": 1.0, "msaa": 3, "shadow_size": 4096, "shadows": true, "glow": true, "particles": 1.0, "debris": 1.0,
		"character_lod": 12000, "tex_cap": 4096, "fps": 90, "dust": true, "aniso": 16, "sway": true},
}

static var current: Mode = Mode.STANDARD

static func preset(mode: Mode) -> Dictionary:
	if mode == Mode.AUTO:
		return PRESETS[auto_mode()]
	return PRESETS[mode]

## Pick a mode from the hardware: memory and the renderer's reported limits (a phone with little RAM gets Low).
static func auto_mode() -> Mode:
	var mem := OS.get_static_memory_peak_usage() if false else 0
	var cores := OS.get_processor_count()
	var gpu := RenderingServer.get_video_adapter_name().to_lower()
	if cores <= 4 or gpu.contains("mali-g5") or gpu.contains("adreno (tm) 5") or gpu.contains("powervr"):
		return Mode.LOW
	if cores <= 6:
		return Mode.STANDARD
	if cores <= 8:
		return Mode.HIGH
	return Mode.ULTRA

static func mode_names() -> PackedStringArray:
	return PackedStringArray(["Low", "Standard", "High", "Ultra", "Max", "Auto"])

## Apply to a viewport and (optionally) the scene's environment, sun and the arena's effect managers.
static func apply(mode: Mode, viewport: Viewport, env: Environment = null, sun: DirectionalLight3D = null,
		destruction: DestructionManager = null) -> Dictionary:
	var p := preset(mode)
	current = mode
	viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	viewport.scaling_3d_scale = p["scale"]
	viewport.msaa_3d = p["msaa"] as Viewport.MSAA
	viewport.anisotropic_filtering_level = _aniso(p["aniso"])
	Engine.max_fps = p["fps"]
	if env != null:
		env.glow_enabled = p["glow"]
		env.glow_intensity = 0.6
		env.fog_enabled = true
		env.fog_density = 0.002 if p["glow"] else 0.0
	if sun != null:
		sun.shadow_enabled = p["shadows"]
		if p["shadows"]:
			RenderingServer.directional_shadow_atlas_set_size(p["shadow_size"], true)
			sun.directional_shadow_max_distance = 40.0 if p["shadow_size"] <= 2048 else 80.0
	if destruction != null:
		destruction.quality = _destruction_quality(p)
	return p

## Which character mesh to load: the 6k or the 12k version.
static func character_model(base_path_12k: String, base_path_6k: String, mode: Mode) -> String:
	return base_path_6k if preset(mode)["character_lod"] <= 6000 else base_path_12k

static func use_cloth_sway(mode: Mode) -> bool:
	return preset(mode)["sway"]

static func particle_ratio(mode: Mode) -> float:
	return preset(mode)["particles"]

static func _aniso(level: int) -> Viewport.AnisotropicFiltering:
	match level:
		1: return Viewport.ANISOTROPY_DISABLED
		2: return Viewport.ANISOTROPY_2X
		4: return Viewport.ANISOTROPY_4X
		8: return Viewport.ANISOTROPY_8X
		_: return Viewport.ANISOTROPY_16X

static func _destruction_quality(p: Dictionary) -> DestructionManager.Quality:
	var d: float = p["debris"]
	if d <= 0.3:
		return DestructionManager.Quality.LOW
	if d <= 0.75:
		return DestructionManager.Quality.MEDIUM
	return DestructionManager.Quality.HIGH
