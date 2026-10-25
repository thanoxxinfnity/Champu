class_name T
extends RefCounted
## Tiny test helpers: boot the game, teleport, step frames, tally failures. Every test script ends with `T.done(self)` which prints ALL OK or FAILED n.

static var fails := 0


static func check(cond: bool, what: String) -> void:
	if cond:
		print("ok    ", what)
	else:
		fails += 1
		print("FAIL  ", what)


static func boot(tree: SceneTree, character := "rachel") -> Game:
	var game: Game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	game.selected = maxi(0, Data.CAST_ORDER.find(character))
	tree.root.add_child(game)
	await tree.process_frame
	return game


static func start(tree: SceneTree, game: Game, continue_save := false) -> void:
	game.start_game(continue_save)
	for i in 6:
		await tree.process_frame


static func frames(tree: SceneTree, n: int) -> void:
	for i in n:
		await tree.process_frame


static func done(tree: SceneTree) -> void:
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	tree.quit(1 if fails > 0 else 0)
