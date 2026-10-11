extends SceneTree
## godot --headless --path . -s tests/ui_test.gd
## Words stay on their paper: every quest paper is laid out at the smallest and the usual screen, the text lies inside the sheet with
## 20 px of margin, wraps by word and clips. The pack is a 5x5 grid (25 slots) on the screen, crafts by tap and by drag, and freezes the world.
## Buttons stay on the screen and off each other.

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
		await process_frame
	game._begin()
	for i in range(6):
		await process_frame
	var ui := game.ui

	for size in [Vector2(1280, 720), Vector2(854, 480)]:
		ui.screen_override = size
		ui._root.set_anchors_preset(Control.PRESET_TOP_LEFT)
		ui._root.size = size
		print("-- papers at %dx%d" % [size.x, size.y])
		var screen := Rect2(Vector2.ZERO, size)
		for id in Data.PAPERS:
			var p: Dictionary = Data.PAPERS[id]
			ui.show_paper(p.title, p.body)
			await process_frame
			await process_frame
			var sheet := ui._modal.get_node("Sheet") as TextureRect
			var margin := sheet.get_node("Margin") as MarginContainer
			var rt := margin.get_node("Text") as RichTextLabel
			var rect := Rect2(sheet.position, sheet.size)
			check(screen.encloses(rect), "%s: the sheet is on the screen" % id)
			check(margin.get_theme_constant("margin_left") >= 20 and margin.get_theme_constant("margin_top") >= 20 and margin.get_theme_constant("margin_right") >= 20 and margin.get_theme_constant("margin_bottom") >= 20, "%s: 20 px of margin on every side" % id)
			check(rt.autowrap_mode == TextServer.AUTOWRAP_WORD and rt.clip_contents, "%s: the text wraps by word and clips" % id)
			# The label lies inside the sheet's own rectangle, 20 px in.
			var inner := Rect2(Vector2(20, 20), sheet.size - Vector2(40, 40))
			var lab := Rect2(margin.position + rt.position, rt.size)
			check(inner.grow(0.5).encloses(lab) or lab.position.x >= 19.5 and lab.end.x <= sheet.size.x - 19.5, "%s: the text box is inside the margins (%s in %s)" % [id, str(lab), str(inner)])
			# Either all of it fits, or it scrolls: nothing is simply cut off.
			var content_h := rt.get_content_height()
			check(content_h <= rt.size.y + 1.0 or rt.scroll_active, "%s: %dpx of text in a %dpx box fits or scrolls" % [id, content_h, rt.size.y])
			ui.close_modal()
			await process_frame
		check(Engine.time_scale == 1.0, "closing a paper starts the world again")

	print("-- the pack")
	ui.screen_override = Vector2(1280, 720)
	ui._root.size = Vector2(1280, 720)
	game.s.inv = ["wiring", "timer", "gel", "fuse"]
	ui.show_pack()
	await process_frame
	check(Engine.time_scale == 0.0, "opening the pack freezes the world (time_scale 0)")
	check(ui._slots.size() == 25, "twenty-five slots")
	var grid := ui._modal.get_node("Grid") as GridContainer
	check(grid.columns == 5, "five columns")
	check(Rect2(Vector2.ZERO, Vector2(1280, 720)).encloses(Rect2(grid.position, grid.size)), "the grid is on the screen")
	var cell_ok := true
	for sl in ui._slots:
		if (sl as Control).custom_minimum_size.x < 56.0:
			cell_ok = false
	check(cell_ok, "every cell is big enough to hit with a thumb")
	check(Rect2(Vector2.ZERO, Vector2(1280, 720)).encloses(Rect2(ui._dropzone.position, ui._dropzone.size)) and ui._dropzone.position.y >= grid.position.y + grid.size.y, "the drop button is on the screen, under the grid")
	check(ui._modal.get_child(0).material is ShaderMaterial, "behind it is the frosted-glass shader")
	ui.slot_tap(0)
	ui.slot_tap(1)
	check(game.s.inv == ["gel", "fuse", "detonator"], "tapping wiring then timer makes a detonator (%s)" % str(game.s.inv))
	ui.slot_combine(2, 0)
	check(game.s.inv == ["fuse", "mega_bomb"], "dragging the detonator onto the gel makes the mega-bomb (%s)" % str(game.s.inv))
	var before: Array = game.s.inv.duplicate()
	ui.slot_combine(0, 1)
	check(game.s.inv == before, "two things that do not go together are left alone")
	ui.close_modal()
	check(Engine.time_scale == 1.0 and not ui.modal_open, "closing the pack starts the world again")

	print("-- item pictures")
	for item in Data.ITEMS:
		var tex := Ui.item_icon(item)
		check(tex != null, "%s has a picture" % item)
		if tex != null:
			var img := tex.get_image()
			var opaque := 0
			for y in range(0, img.get_height(), 8):
				for x in range(0, img.get_width(), 8):
					if img.get_pixel(x, y).a > 0.9:
						opaque += 1
			check(img.get_pixel(0, 0).a == 0.0 and img.get_pixel(img.get_width() - 1, img.get_height() - 1).a == 0.0 and opaque > 20, "%s: transparent corners, a solid middle (%d samples)" % [item, opaque])

	print("-- the pack on the low-quality screen (854 x 480)")
	ui.screen_override = Vector2(854, 480)
	ui._root.size = Vector2(854, 480)
	game.s.inv = ["fuse", "gel"]
	for i in range(20):
		await process_frame
	ui.show_pack()
	await process_frame
	var g2 := ui._modal.get_node("Grid") as GridContainer
	check(Rect2(Vector2.ZERO, Vector2(854, 480)).encloses(Rect2(g2.position, g2.size)), "the grid fits 854 x 480")
	check(Rect2(Vector2.ZERO, Vector2(854, 480)).encloses(Rect2(ui._dropzone.position, ui._dropzone.size)), "so does the drop button")
	var cell_small := true
	for sl in ui._slots:
		if (sl as Control).custom_minimum_size.x < 56.0:
			cell_small = false
	check(cell_small, "cells are still big enough to hit (>= 56 px)")
	ui.close_modal()
	ui.screen_override = Vector2(1280, 720)
	ui._root.size = Vector2(1280, 720)

	print("-- dropping from the pack")
	game.s.inv = ["fuse", "gel"]
	game.player.yaw = 0.0
	ui.show_pack()
	await process_frame
	ui.slot_tap(1)
	check(ui._selected == 1, "a picked item lights the drop button")
	ui._dropzone._drop_data(Vector2.ZERO, {"slot": 1})
	check(game.s.inv == ["fuse"] and game.s.dropped.size() == 1 and game.s.dropped[0].item == "gel", "dropping the gel takes it out of the pack (%s)" % str(game.s.inv))
	check(ui._selected == -1 and ui.slot_item(1) == "", "and the cell is empty again")
	ui.close_modal()
	game.s.dropped.clear()

	print("-- the pack takes 25 things and no more")
	game.s.inv = []
	for i in range(Data.PACK_SLOTS):
		game.s.inv.append("scrap")
	ui.show_pack()
	await process_frame
	var all_filled := true
	for i in range(25):
		if ui.slot_item(i) != "scrap":
			all_filled = false
	check(all_filled, "all 25 cells show what they hold")
	var tap_ok := true
	ui.slot_tap(24)
	tap_ok = ui._selected == 24
	ui.slot_tap(24)
	check(tap_ok and ui._selected == -1, "the last cell can be picked and put back")
	ui.close_modal()
	var full_before := game.s.inv.size()
	var u := Use.new()
	var holder := Node3D.new()
	game.add_child(holder)
	game.pick_up(u, "fuse_x", holder)
	check(game.s.inv.size() == full_before, "a full pack refuses a 26th thing")
	u.free()
	holder.free()
	game.s.inv = []

	print("-- the buttons")
	for size in [Vector2(1280, 720), Vector2(960, 540), Vector2(1600, 720), Vector2(854, 480), Vector2(1040, 480)]:
		ui.screen_override = size
		var lay := ui._layout()
		var keys := lay.keys()
		var ok := true
		for k in keys:
			var d: Dictionary = lay[k]
			if d.c.x - d.r < 0 or d.c.y - d.r < 0 or d.c.x + d.r > size.x or d.c.y + d.r > size.y:
				ok = false
		check(ok, "at %dx%d every button is on the screen" % [size.x, size.y])
		var apart := true
		for i in range(keys.size()):
			for j in range(i + 1, keys.size()):
				var a: Dictionary = lay[keys[i]]
				var b: Dictionary = lay[keys[j]]
				if a.c.distance_to(b.c) < a.r + b.r + 4.0:
					apart = false
		var hand := ui._hand_center()
		for k in keys:
			var d: Dictionary = lay[k]
			if hand.distance_to(d.c) < 46.0 * ui.hud_scale() + d.r + 4.0:
				apart = false
		check(apart, "at %dx%d no button touches another, nor the hand icon" % [size.x, size.y])
		# _hit() gives each button an extra 10px of forgiving tap slop on top of its drawn radius — the
		# real test of "does a tap land on the right button" is whether those two fuzzy zones stay apart,
		# not just the drawn circles (a gap that looked fine here once still let a tap near the boundary
		# resolve to the wrong button).
		var tap_apart := true
		for i in range(keys.size()):
			for j in range(i + 1, keys.size()):
				var a: Dictionary = lay[keys[i]]
				var b: Dictionary = lay[keys[j]]
				if a.c.distance_to(b.c) < a.r + 10.0 + b.r + 10.0:
					tap_apart = false
		check(tap_apart, "at %dx%d no button's tap zone (its radius + 10px of slop) reaches another's" % [size.x, size.y])

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
