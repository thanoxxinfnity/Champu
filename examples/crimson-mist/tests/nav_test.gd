extends SceneTree
## The walkable grid connects every place of Chapter 1 once the doors are open, and refuses paths through walls.

func _initialize() -> void:
	var game := await T.boot(self)
	await T.start(self, game)
	var w := game.world
	var s := w.spots
	T.check(not w.nav.path(s.spawn, s.fuel).is_empty(), "ward -> storage room (fuel)")
	T.check(not w.nav.path(s.spawn, s.fuse).is_empty(), "ward -> nurse office (fuse)")
	T.check(not w.nav.path(s.spawn, s.generator).is_empty(), "ward -> generator room")
	T.check(w.nav.path(s.generator, Vector3(0, 0, -30)).is_empty() or not w.nav.walkable(Vector3(0, 0, -26)), "exit door blocks the way out while unpowered")
	w.power_on()
	T.check(not w.nav.path(s.generator, Vector3(0, 0, -30)).is_empty(), "powered exit door opens the way to the street")
	T.check(not w.nav.path(Vector3(0, 0, -30), s.shop_door).is_empty(), "street -> radio shop door")
	T.check(w.nav.path(Vector3(0, 0, -30), s.ally1).is_empty() or not w.nav.walkable(s.storeroom), "storeroom is sealed until the door is broken")
	w.open_storeroom()
	T.check(not w.nav.path(Vector3(0, 0, -30), s.ally1).is_empty(), "broken storeroom door -> prisoner")
	T.check(not w.nav.path(Vector3(0, 0, -30), s.church_door).is_empty(), "street -> church door")
	T.check(not w.nav.path(s.church_door, s.ally2).is_empty(), "church door -> second survivor")
	T.check(not w.nav.path(Vector3(0, 0, -30), Vector3(0, 0, -118)).is_empty(), "market -> plaza")
	T.check(w.nav.path(Vector3(0, 0, -118), s.arena).is_empty(), "the barricade blocks the bell road")
	w.burn_barricade()
	T.check(not w.nav.path(Vector3(0, 0, -118), s.arena).is_empty(), "burned barricade opens the bell road to the arena")
	T.check(not w.nav.walkable(Vector3(-20.0, 0, -50)), "buildings are not walkable")
	T.done(self)
