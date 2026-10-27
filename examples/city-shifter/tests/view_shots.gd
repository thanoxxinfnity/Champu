extends SceneTree
## The 360 viewer: a hero, a weapon from the side and from behind (after a drag), the new guns, a car and the horse.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/view_shots.gd -- /tmp/out

var out := "/tmp/vs"
var game: Main


func snap(name: String, frames := 25) -> void:
	for i in frames:
		await process_frame
	root.get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("shot ", name)


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	await process_frame
	game.lobby.show_screen("view")
	await snap("v0_hero")
	game.lobby.view_drag.emit(Vector2(120, 0))
	await snap("v1_hero_dragged", 10)
	game.lobby.view_cat.emit("weapons")
	game.view_i = Data.WEAPON_ORDER.find("nova_blaster")
	game._view_show()
	await snap("v2_nova")
	game.lobby.view_drag.emit(Vector2(200, 0))
	await snap("v3_nova_dragged", 10)
	game.view_i = Data.WEAPON_ORDER.find("genesis_cannon")
	game._view_show()
	await snap("v4_cannon")
	game.view_i = Data.WEAPON_ORDER.size() + Data.MELEE_ORDER.find("katana")
	game._view_show()
	await snap("v5_katana")
	game.lobby.view_cat.emit("rides")
	await snap("v6_ride")
	game.lobby.view_zoom.emit(1.4)
	game.lobby.view_step.emit(3)
	await snap("v7_ride_zoom")
	game.view_i = game._view_ids().size() - 1
	game._view_show()
	await snap("v8_horse")
	T.check(game.view_pivot != null, "the viewer shows a model")
	game.lobby.show_screen("home")
	await process_frame
	T.check(game.view_pivot == null, "leaving the viewer removes the model")
	T.done(self)
