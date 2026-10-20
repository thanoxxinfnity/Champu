extends SceneTree
## godot --headless --path . -s tests/graphics_test.gd   (prints ALL OK)

var fails := 0

func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL "), what)
	if not ok:
		fails += 1

func _init() -> void:
	print("graphics settings test")
	var names := GraphicsSettings.mode_names()
	check(names.size() == 6 and names[0] == "Low" and names[4] == "Max", "six modes: Low Standard High Ultra Max Auto")
	var prev_scale := 0.0
	var ok := true
	for m in [GraphicsSettings.Mode.LOW, GraphicsSettings.Mode.STANDARD, GraphicsSettings.Mode.HIGH, GraphicsSettings.Mode.ULTRA, GraphicsSettings.Mode.MAX]:
		var p := GraphicsSettings.preset(m)
		ok = ok and p["scale"] >= prev_scale
		prev_scale = p["scale"]
	check(ok, "render scale never goes down from Low to Max")
	check(GraphicsSettings.PRESETS[GraphicsSettings.Mode.LOW]["character_lod"] == 6000 and GraphicsSettings.PRESETS[GraphicsSettings.Mode.STANDARD]["character_lod"] == 12000, "Low uses the 6k character, the rest the 12k")
	check(GraphicsSettings.character_model("a12", "a6", GraphicsSettings.Mode.LOW) == "a6" and GraphicsSettings.character_model("a12", "a6", GraphicsSettings.Mode.MAX) == "a12", "character model follows the mode")
	check(GraphicsSettings.use_cloth_sway(GraphicsSettings.Mode.LOW) and GraphicsSettings.use_cloth_sway(GraphicsSettings.Mode.HIGH), "cloth sway runs on every mode, Low included")
	check(float(GraphicsSettings.PRESETS[GraphicsSettings.Mode.LOW]["lod"]) > float(GraphicsSettings.PRESETS[GraphicsSettings.Mode.STANDARD]["lod"]), "Low switches to coarse mesh LODs soonest")
	var tex_default: Dictionary = ProjectSettings.get_setting("importer_defaults/texture", {})
	check(int(tex_default.get("compress/mode", 0)) == 2, "textures import VRAM-compressed by default (ETC2 on phones)")
	var root := Node3D.new()
	get_root().add_child(root)
	var env := Environment.new()
	var sun := DirectionalLight3D.new()
	root.add_child(sun)
	var dm := DestructionManager.new()
	root.add_child(dm)
	await process_frame
	var p := GraphicsSettings.apply(GraphicsSettings.Mode.MAX, get_root(), env, sun, dm)
	check(is_equal_approx(get_root().scaling_3d_scale, 1.0) and env.glow_enabled and sun.shadow_enabled, "Max: full resolution, glow and shadows on")
	check(dm.quality == DestructionManager.Quality.HIGH and Engine.max_fps == 90, "Max: most debris, 90 fps cap")
	GraphicsSettings.apply(GraphicsSettings.Mode.LOW, get_root(), env, sun, dm)
	check(get_root().scaling_3d_scale < 0.7 and not env.glow_enabled and not sun.shadow_enabled, "Low: lower resolution, no glow, no shadows")
	check(dm.quality == DestructionManager.Quality.LOW and Engine.max_fps == 30, "Low: least debris, 30 fps cap")
	var auto := GraphicsSettings.auto_mode()
	check(auto >= GraphicsSettings.Mode.LOW and auto <= GraphicsSettings.Mode.ULTRA, "Auto picks a real mode (%s)" % GraphicsSettings.mode_names()[auto])
	Engine.max_fps = 0
	print("ALL OK" if fails == 0 else "FAILED: %d" % fails)
	quit(fails)
