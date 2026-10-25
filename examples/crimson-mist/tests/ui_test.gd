extends SceneTree
## UI bounds at the phone sizes we ship: every visible label sits on screen and its text fits its box; nothing in the HUD overlaps a button;
## the dialogue banner clears the thumb buttons; screen buttons fit.

func label_fits(l: Label) -> bool:
	var font := l.get_theme_font("font")
	var fs := l.get_theme_font_size("font_size")
	var lines := l.get_line_count()
	return lines * (font.get_height(fs) + l.get_theme_constant("line_spacing")) <= l.size.y + 2.0


func check_screen(game: Game, label: String, size: Vector2i) -> void:
	var hud := game.hud
	var view := Rect2(Vector2.ZERO, Vector2(size))
	for l in hud._labels:
		if not l.visible or l.text == "":
			continue
		var r := Rect2(l.position, l.size)
		T.check(view.encloses(r), "%s %dx%d: label '%s' is on screen" % [label, size.x, size.y, l.text.left(24)])
		T.check(label_fits(l), "%s %dx%d: text fits its box '%s' (%d lines)" % [label, size.x, size.y, l.text.left(24), l.get_line_count()])
	for b in hud._screen_buttons:
		T.check(view.encloses(b.rect), "%s %dx%d: button %s is on screen" % [label, size.x, size.y, b.id])


func _initialize() -> void:
	var game := await T.boot(self)
	for size in [Vector2i(1280, 720), Vector2i(1600, 720)]:
		root.size = size
		await T.frames(self, 3)
		game.hud._layout()
		game.hud.show_lobby()
		await T.frames(self, 2)
		check_screen(game, "lobby", size)
	await T.start(self, game)
	game.story.finished = true
	var p := game.player
	p.has_pistol = true
	p.inventory = {"scrap": 3, "cloth": 2, "alcohol": 1, "fuel": 1, "bandage": 2, "flare": 2, "ammo": 20}
	for size in [Vector2i(1280, 720), Vector2i(1600, 720)]:
		root.size = size
		await T.frames(self, 3)
		var hud := game.hud
		hud._layout()
		# worst case HUD: longest goal, long toast, long dialogue line, use button, boss bar
		var goal := ""
		for m in Data.MISSIONS:
			if String(m.goal).length() > goal.length():
				goal = String(m.goal).replace("{ally1}", "Mococo")
		hud.set_objective("6 · The Bellkeeper", goal)
		hud.toast("CAN'T CARRY ANY MORE REINFORCED CROWBAR")
		hud.say([["Mococo Abyssgard", "Quiet… the Bellkeeper sleeps in the bell. Every toll wakes the mist. The road to the tower is blocked — burn the barricade."]], 30.0)
		hud.boss_show("The Bellkeeper")
		hud.chapter_card("6 · The Bellkeeper", goal)
		hud._buttons["use"].show = true
		hud._buttons["shoot"].show = true
		hud._buttons["reload"].show = true
		await T.frames(self, 3)
		hud._buttons["use"].show = true
		check_screen(game, "hud", size)
		# overlap: dialogue banner vs thumb buttons, goal text vs top-right buttons
		var banner := Rect2(Vector2(size.x * 0.5 - 290, size.y - 136), Vector2(580, 118))
		for id in hud._buttons:
			var b: Dictionary = hud._buttons[id]
			if not b.show:
				continue
			var rr := Rect2(b.c - Vector2(b.r, b.r), Vector2(b.r, b.r) * 2.0)
			T.check(view_encloses(size, rr), "hud %dx%d: button %s on screen" % [size.x, size.y, id])
			T.check(not banner.intersects(rr), "hud %dx%d: dialogue banner clears button %s" % [size.x, size.y, id])
			T.check(not Rect2(hud.lbl_goal.position, hud.lbl_goal.size).intersects(rr), "hud %dx%d: objective text clears button %s" % [size.x, size.y, id])
		# modal screens
		for which in ["pause", "death", "win", "craft", "note"]:
			match which:
				"pause": hud.show_pause(true)
				"death": hud.show_death()
				"win": hud.show_win("Harrow Cove is still under the mist.\nNext: Chapter 2 — The Lighthouse.\n\nTIME  12:34      DEFEATED  88")
				"craft": hud.show_craft(true)
				"note": hud.read_note(Data.NOTES[0])
			await T.frames(self, 2)
			check_screen(game, which, size)
		hud.hide_all_screens()
	T.done(self)


func view_encloses(size: Vector2i, r: Rect2) -> bool:
	return Rect2(Vector2.ZERO, Vector2(size)).encloses(r)
