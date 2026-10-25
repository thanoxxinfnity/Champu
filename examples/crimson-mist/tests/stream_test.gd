extends SceneTree
## Streaming: only the zones near the player are drawn; far ones are hidden and come back; at most six lamp lights are on.

func lit_lamps(game: Game) -> int:
	var n := 0
	for l in game.world.lamps:
		if l.visible:
			n += 1
	return n


func _initialize() -> void:
	var game := await T.boot(self)
	await T.start(self, game)
	var w := game.world
	var p := game.player
	w.update_streaming(p.global_position)
	var near := w.loaded_zones()
	T.check(near.has("clinic") and near.has("ground"), "at the clinic: clinic + ground drawn %s" % [near])
	T.check(not near.has("arena") and not near.has("road"), "far zones (arena, bell road) are hidden at the clinic")
	for stop in [["market", Vector3(0, 0, -60)], ["church", Vector3(0, 0, -105)], ["road", Vector3(0, 0, -160)], ["arena", Vector3(0, 0, -205)]]:
		p.global_position = stop[1]
		w.update_streaming(p.global_position)
		var z := w.loaded_zones()
		T.check(z.has(stop[0]), "walking to %s draws it" % stop[0])
		T.check(lit_lamps(game) <= 6, "at %s no more than 6 lamp lights are on (%d)" % [stop[0], lit_lamps(game)])
	T.check(not w.loaded_zones().has("clinic"), "the clinic is hidden again at the tower")
	p.global_position = Vector3(0, 0, 8)
	w.update_streaming(p.global_position)
	T.check(w.loaded_zones().has("clinic") and not w.loaded_zones().has("arena"), "going back brings the clinic back and hides the arena")
	T.done(self)
