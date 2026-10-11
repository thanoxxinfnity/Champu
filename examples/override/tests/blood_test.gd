extends SceneTree
## godot --headless --fixed-fps 60 -s tests/blood_test.gd
## Blood on the set: the pictures exist and have an alpha, every room gets splatters, hand prints and (when big enough) a pane of
## observation glass, none of them in a doorway, and the count per room stays small enough for a phone.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	root.add_child(game)
	for i in range(6):
		await physics_frame
	game._begin()
	for i in range(6):
		await physics_frame
	print("-- the pictures")
	var names := ["splat_0", "splat_5", "hand_0", "hand_3", "smear_0", "smear_2", "drip_0", "drip_1"]
	for n in names:
		var t := Blood.texture(n)
		check(t != null, "%s loads" % n)
		if t != null:
			var img := t.get_image()
			check(img.get_pixel(0, img.get_height() - 1).a == 0.0 or n.begins_with("drip"), "%s has a transparent background" % n)
	print("-- every room")
	var w := game.world
	for id in Rooms.LIST:
		var r: Array = Rooms.LIST[id].r
		game.player.global_position = Vector3((r[0] + r[1]) * 0.5, 0, (r[2] + r[3]) * 0.5)
		for i in range(6):
			await physics_frame
		var holder: Node = w.loaded[id].get_node_or_null("Blood") if w.loaded.has(id) else null
		check(holder != null, "%s has blood" % id)
		if holder == null:
			continue
		var panes := 0
		var draws := 0
		var in_door := 0
		for c in holder.get_children():
			if c is MeshInstance3D:
				draws += 1
			elif c is Node3D:
				panes += 1
				draws += 2
		var recs: Array = Blood.records.get(id, [])
		var decals := recs.size()
		for d in recs:
			var p: Vector3 = d.pos
			var q: Vector3 = d.normal
			if absf(q.y) < 0.2 and p.y > 0.4:
				# a decal on a wall: which wall, and how far along it
				var wall := ""
				var along := 0.0
				if absf(p.x - r[0]) < 0.08:
					wall = "w"
					along = p.z
				elif absf(p.x - r[1]) < 0.08:
					wall = "e"
					along = p.z
				elif absf(p.z - r[2]) < 0.08:
					wall = "s"
					along = p.x
				elif absf(p.z - r[3]) < 0.08:
					wall = "n"
					along = p.x
				if wall != "" and Blood._at_door(id, wall, 0.0, along, 0.0):
					in_door += 1
		var wd: float = r[1] - r[0]
		var dp: float = r[3] - r[2]
		check(decals >= 4 and decals <= 30, "%s: %d decals (4..30)" % [id, decals])
		check(draws <= 5, "%s: its blood costs %d draw calls (at most 5)" % [id, draws])
		check(in_door == 0, "%s: nothing painted across a doorway (%d)" % [id, in_door])
		if wd * dp >= 40.0:
			check(panes >= 1, "%s: a big room has observation glass" % id)
	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
