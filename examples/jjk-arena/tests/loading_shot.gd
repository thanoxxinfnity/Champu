extends SceneTree
func _init() -> void:
	get_root().size = Vector2i(1280, 720)
	var ls := LoadingScreen.new()
	ls.min_show_time = 30.0
	get_root().add_child(ls)
	ls.size = Vector2(1280, 720)
	await create_timer(4.6).timeout
	get_root().get_texture().get_image().save_png("/tmp/cm/loading_shot.png")
	quit()
