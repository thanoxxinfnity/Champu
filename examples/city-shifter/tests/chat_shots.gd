extends SceneTree
## The hero chat screen under xvfb: the first view (agreement), then a short conversation with canned lines.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/chat_shots.gd -- /tmp/out
func _initialize() -> void:
	var out := OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp/chat"
	DirAccess.make_dir_recursive_absolute(out)
	root.size = Vector2i(1280, 720)
	var game: Main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	for i in 30:
		await process_frame
	AiChat.set_agreed(false)
	game.lobby.show_screen("chat")
	for i in 20:
		await process_frame
	root.get_texture().get_image().save_png("%s/chat0_agree.png" % out)
	AiChat.set_agreed(true)
	game.lobby._refresh_chat()
	game.lobby._chat_bubble("YOU", "hi, kaun ho tum? kya tip hai jetpack ke liye?", true)
	game.lobby._chat_bubble("RYO", "Main Ryo Kagami hoon. Jetpack ka fuel bachakar chalayein aur hoshiyar rahein!", false)
	for i in 20:
		await process_frame
	root.get_texture().get_image().save_png("%s/chat1_talk.png" % out)
	print("CHAT_SHOTS done")
	quit()
