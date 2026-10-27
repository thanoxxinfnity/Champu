class_name T
extends RefCounted
## Tiny test helpers: tally checks, wait frames, boot the game. Every test script ends with `T.done(self)` which prints ALL OK or FAILED n.

static var fails := 0


static func check(cond: bool, what: String) -> void:
	if cond:
		print("ok    ", what)
	else:
		fails += 1
		print("FAIL  ", what)


static func frames(tree: SceneTree, n: int) -> void:
	for i in n:
		await tree.process_frame


static func boot(tree: SceneTree, character := "outlaw") -> Main:
	var game: Main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	tree.root.add_child(game)
	game.sel = maxi(0, Data.CAST_ORDER.find(character))
	game.skydive = OS.get_environment("CS_SKYDIVE") == "1"
	await tree.process_frame
	return game


static func done(tree: SceneTree) -> void:
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	tree.quit(0 if fails == 0 else 1)
