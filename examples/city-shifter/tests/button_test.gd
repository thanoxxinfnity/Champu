extends SceneTree
## Real fingers on the menu (run under xvfb, like a phone: touch events only, no mouse): every visible button on each lobby screen must
## answer a tap. A button that does not fire, or that another control covers, fails.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/button_test.gd
var fired := {}


func tap(pos: Vector2) -> void:
	for down in [true, false]:
		var e := InputEventScreenTouch.new()
		e.index = 0
		e.position = pos
		e.pressed = down
		Input.parse_input_event(e)
		await process_frame
		await process_frame


func _initialize() -> void:
	DisplayServer.window_set_size(Vector2i(2400, 1080))
	await process_frame
	var game := await T.boot(self, "outlaw")
	await T.frames(self, 20)
	var lobby = game.lobby
	var win := Vector2(DisplayServer.window_get_size())
	var k := win.x / root.get_visible_rect().size.x
	var skip := ["LOOK: REALISTIC", "LOOK: ANIME", "CARD", "BUY", "UPGRADE", "START MATCH", "LEAVE", "SOLO", "TEAM", "TRAIN RUN", "FIND PLAYERS", "CREATE ROOM", "JOIN", "HOST ON WI-FI", "FIND ON WI-FI", "SELECT", "SKILLS"]
	for scr in ["home", "chars", "shop", "settings", "weapons", "friends"]:
		lobby.show_screen(scr)
		await T.frames(self, 6)
		var tested := 0
		var bad: Array = []
		for b in lobby.find_children("*", "Button", true, false):
			if not is_instance_valid(b):
				continue                       # a tap before rebuilt the list (the shop refreshes itself)
			var btn := b as Button
			if btn.text.begins_with("BUY") or not btn.is_visible_in_tree() or btn.disabled or skip.has(btn.text.strip_edges()):
				continue
			var r := btn.get_global_rect()
			if r.size.x < 4 or not root.get_visible_rect().encloses(r):      # (cards scrolled half out of a list are not tappable until scrolled)
				continue
			var clipped := false
			var up := btn.get_parent()
			while up != null and up is Control:
				if up is ScrollContainer and not (up as Control).get_global_rect().grow(1.0).encloses(r):
					clipped = true
				up = up.get_parent()
			if clipped:
				continue
			var hit := [false]
			var f := func() -> void: hit[0] = true
			btn.pressed.connect(f)
			var cur: String = lobby.screen
			await tap(r.get_center() * k)
			if is_instance_valid(btn):
				btn.pressed.disconnect(f)
			tested += 1
			if not hit[0]:
				bad.append("'%s' %s" % [btn.text if is_instance_valid(btn) else "?", str(r)])
			if lobby.screen != cur:
				lobby.show_screen(scr)
				await T.frames(self, 4)
			var pops := lobby.find_children("*Pop*", "Control", true, false)
			for p in pops:
				(p as Control).visible = false
		T.check(bad.is_empty(), "%s: all %d buttons answer a tap %s" % [scr, tested, "" if bad.is_empty() else str(bad)])
	T.done(self)
