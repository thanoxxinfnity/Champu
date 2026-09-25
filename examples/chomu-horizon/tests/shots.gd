extends SceneTree
## Renders the real game and saves screenshots + render stats.
## Run (needs a display, e.g. xvfb-run):
##   godot --path . --rendering-driver opengl3 --fixed-fps 60 -s tests/shots.gd -- <out_dir>

var game: Node
var frame := 0
var out := "user://shots"
var plan: Array = []
var step := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	plan = [
		[40, func() -> void: pass, "garage"],
		[20, func() -> void: game.showroom.toggle_doors(), ""],
		[50, func() -> void: pass, "garage_doors"],
		[5, func() -> void: game.ui.next_car.emit(), ""],
		[60, func() -> void: pass, "garage_car2"],
		[5, func() -> void:
			var cfg: Dictionary = game.ui.config.duplicate()
			cfg.color = PaintCustomizer.PALETTE[5]
			cfg.finish = 2
			cfg.underglow = true
			cfg.glow = 0
			game.ui.config = cfg
			game.ui.config_changed.emit(cfg), ""],
		[20, func() -> void: pass, "garage_pearl_glow"],
		[5, func() -> void: game.ui.next_car.emit(), ""],
		[60, func() -> void: pass, "garage_car3"],
		[5, func() -> void: game.ui.drive.emit(), ""],
		[70, func() -> void: pass, "drive_start"],
		[5, func() -> void: _hold(1.0, 0.0, false), ""],
		[300, func() -> void: pass, "drive_speed"],
		[5, func() -> void: _hold(0.0, -1.0, true), ""],
		[30, func() -> void: _hold(0.8, 0.4, false), ""],
		[25, func() -> void: pass, "drive_drift"],
		[5, func() -> void: game.cam.cycle_mode(), ""],
		[40, func() -> void: pass, "drive_near_cam"],
		[5, func() -> void:
			game.world.set_time_of_day("night")
			game._set_headlights(true)
			_hold(1.0, 0.0, false), ""],
		[60, func() -> void: pass, "drive_night"],
	]


func _hold(th: float, st: float, hb: bool) -> void:
	# Bypass the touch layer: it would overwrite these every frame.
	game.input.visible = false
	game.input.vehicle = null
	game.vehicle.in_throttle = th
	game.vehicle.in_steer = st
	game.vehicle.in_handbrake = hb
	game.hud.visible = true


func _process(_d: float) -> bool:
	frame += 1
	if step >= plan.size():
		return true
	var item: Array = plan[step]
	if frame >= item[0]:
		(item[1] as Callable).call()
		if item[2] != "":
			var img := root.get_texture().get_image()
			img.save_png(out.path_join(item[2] + ".png"))
			var dc := RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)
			var prims := RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)
			var objs := RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME)
			print("%-18s draw_calls=%d primitives=%d objects=%d fps=%d" % [item[2], dc, prims, objs, Engine.get_frames_per_second()])
		frame = 0
		step += 1
	return false
