extends SceneTree
## A short, portrait photo shoot for promo material: the garage, a fast drive, a drift.
##   xvfb-run godot --path . --rendering-driver opengl3 --resolution 900x1600 --fixed-fps 60 -s tests/promo_shots.gd -- <out_dir>

var game: Node
var frame := 0
var out := "user://promo"
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
		[40, func() -> void: pass, "h_garage"],
		[5, func() -> void: game.ui.drive.emit(), ""],
		[70, func() -> void: _hold(0.0, 0.0, false), "h_drive_start"],
		[5, func() -> void: _hold(1.0, 0.0, false), ""],
		[150, func() -> void: pass, "h_drive_speed"],
		[5, func() -> void: _hold(0.8, 0.5, true), ""],
		[24, func() -> void: pass, "h_drift"],
		[5, func() -> void: game.cam.cycle_mode(), ""],
		[40, func() -> void: pass, "h_low_cam"],
	]


func _hold(th: float, st: float, hb: bool) -> void:
	game.input.visible = false
	game.input.vehicle = null
	game.vehicle.in_throttle = th
	game.vehicle.in_steer = st
	game.vehicle.in_handbrake = hb
	game.hud.visible = false


func _process(_d: float) -> bool:
	frame += 1
	if step >= plan.size():
		return true
	var item: Array = plan[step]
	if frame >= item[0]:
		(item[1] as Callable).call()
		if item[2] != "":
			root.get_texture().get_image().save_png(out.path_join(item[2] + ".png"))
			print("shot ", item[2])
		frame = 0
		step += 1
	return false
