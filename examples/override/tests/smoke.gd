extends SceneTree
func _init() -> void:
	var game := (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	for i in range(8): await process_frame
	game._begin()
	for i in range(30): await physics_frame
	print("room ", game.world.current, " loaded ", game.world.loaded.keys(), " enemies ", game.enemies.size(), " uses ", game.world.uses.size())
	quit()
