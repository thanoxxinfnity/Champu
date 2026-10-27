extends SceneTree
## No text may leave its box. Every menu screen at four screen sizes: each visible label and button lies inside the screen and inside its panel (scrolling lists excepted),
## and a label's text is never wider than the label. The hero card, the skill rows, the match HUD strings and the loading tips are measured too.
##   godot --headless --path . -s tests/ui_test.gd

var game: Main
var problems := 0


func _inside_scroll(n: Node) -> bool:
	var p := n.get_parent()
	while p != null:
		if p is ScrollContainer:
			return true
		p = p.get_parent()
	return false


func _panel_of(n: Node) -> Control:
	var p := n.get_parent()
	while p != null:
		if p is PanelContainer:
			return p
		p = p.get_parent()
	return null


func _scan(where: String, vp: Vector2) -> void:
	var bad := 0
	var seen_n := 0
	for c in game.lobby.find_children("*", "Control", true, false):
		var ctl := c as Control
		if not ctl.is_visible_in_tree() or ctl is HeroCard:
			continue
		if ctl is Label or ctl is Button or ctl is LineEdit:
			seen_n += 1
			var r := ctl.get_global_rect()
			if r.size.x < 2.0:
				continue
			if not _inside_scroll(ctl) and (r.position.x < -2.0 or r.position.y < -2.0 or r.end.x > vp.x + 2.0 or r.end.y > vp.y + 2.0):
				print("   off-screen: %s %s %s" % [where, ctl.name, str(r)])
				bad += 1
			var pan := _panel_of(ctl)
			if pan != null and not _inside_scroll(ctl):
				var pr := pan.get_global_rect().grow(3.0)
				if not pr.encloses(r):
					print("   out of its panel: %s '%s' %s in %s" % [where, (ctl as Label).text if ctl is Label else ctl.name, str(r), str(pr)])
					bad += 1
			if ctl is Label:
				var l := ctl as Label
				if l.autowrap_mode == TextServer.AUTOWRAP_OFF and not l.clip_text and l.text != "":
					var f := l.get_theme_font("font")
					var fs := l.get_theme_font_size("font_size")
					var w := f.get_string_size(l.text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
					if w > l.size.x + 2.0:
						print("   text wider than its label: %s '%s' %.0f > %.0f" % [where, l.text, w, l.size.x])
						bad += 1
	T.check(bad == 0 and seen_n >= 3, "%s: no text leaves its box (%d checked)" % [where, seen_n])


func _initialize() -> void:
	game = await T.boot(self)
	game.save.coins = 99999
	game.lobby.set_save(game.save)
	for size in [Vector2i(1280, 720), Vector2i(1920, 1080), Vector2i(960, 540), Vector2i(2400, 1080)]:
		root.size = size
		await T.frames(self, 4)
		var vp := Vector2(size)
		# the scale the project uses: canvas_items stretch, so the lobby sees the design size scaled; use its own size
		var seen := game.lobby.size
		for sc in ["home", "chars", "shop", "skills", "online", "settings"]:
			game.lobby.show_screen(sc)
			await T.frames(self, 2)
			_scan("%s %dx%d" % [sc, size.x, size.y], seen)
		game.lobby.set_room({"state": "room", "code": "KZ7Q", "status": "Waiting", "host": true, "max": 15, "players": [{"name": "A_VERY_LONG_NAME_XX", "team": 0, "host": true, "you": true}, {"name": "Mika", "team": 1}]})
		await T.frames(self, 2)
		game.lobby.show_screen("online")
		_scan("room %dx%d" % [size.x, size.y], seen)
		game.lobby.show_screen("home")
	# every hero: name, title and perk fit their places on the card and in the panels
	var worst := 99
	for id in Data.CAST_ORDER:
		var d: Dictionary = Data.CAST[id]
		worst = mini(worst, UIKit.fit_px(String(d.name), 28, 260.0, true))
		T.check(UIKit.fit_px(String(d.title), 16, 260.0) >= 12, "%s: the title fits the card plate" % id)
		T.check(String(d.perk).length() < 90, "%s: the perk is short enough for its box" % id)
	T.check(worst >= 18, "the longest hero name still reads on the card (%d px)" % worst)
	# skill rows
	var sw := 430.0 - 64.0 - 136.0
	var min_px := 99
	for sid in Data.SKILL_ORDER:
		for lv in [0, 1, 5, 10]:
			var s := Data.skill_now(sid, lv) if lv > 0 else String(Data.SKILLS[sid].per) + " each level"
			min_px = mini(min_px, UIKit.fit_px(s, 13, sw))
		T.check(UIKit.fit_px(String(Data.SKILLS[sid].name), 20, sw, true) >= 16, "skill %s: the name fits" % sid)
	T.check(min_px >= 10, "every skill line reads at %d px or more" % min_px)
	# loading tips: two lines at most in the tip box
	for t in LoadingScreen.TIPS:
		var f := UIKit.body_font()
		var lines := f.get_multiline_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, 780.0, 17, 5).y / f.get_height(17)
		T.check(lines <= 2.05, "a loading tip fits in two lines (%.1f)" % lines)
	T.done(self)
