extends SceneTree
## godot --headless --path . -s tests/ui_test.gd
## Words on the glass stay on the glass and out from under the thumbs: the longest toast, subtitle, objective and
## chapter card are laid out at the smallest screen the game supports, and none leaves the screen or sits on a button.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


## The box the words really fill: the label's width (or as much as the words take, when centred) and the height the wrapped text needs.
func text_rect(l: Label) -> Rect2:
	var r := Rect2(l.global_position, Vector2(l.size.x, maxf(l.size.y, l.get_minimum_size().y)))
	if l.horizontal_alignment == HORIZONTAL_ALIGNMENT_CENTER:
		var w := minf(l.size.x, ThemeDB.fallback_font.get_string_size(l.text, HORIZONTAL_ALIGNMENT_LEFT, -1, l.get_theme_font_size("font_size")).x)
		r = Rect2(Vector2(r.position.x + (l.size.x - w) * 0.5, r.position.y), Vector2(w, r.size.y))
	return r


func _init() -> void:
	DisplayServer.window_set_size(Vector2i(1280, 720))
	root.size = Vector2i(1280, 720)
	root.content_scale_size = Vector2i(1280, 720)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	root.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	for i in range(6):
		await process_frame
	game._begin()
	for i in range(6):
		await process_frame
	game.ui.close_modal()
	var ui := game.ui
	ui.screen_override = Vector2(1280, 720)
	ui._root.set_anchors_preset(Control.PRESET_TOP_LEFT)
	ui._root.size = Vector2(1280, 720)
	ui._hud.size = Vector2(1280, 720)
	var vp: Vector2 = ui._hud.size
	print("  screen the HUD lays out on: ", vp)
	var screen := Rect2(Vector2.ZERO, vp)
	var buttons: Array[Rect2] = []
	var lay := ui._layout()
	for k in lay:
		var d: Dictionary = lay[k]
		buttons.append(Rect2(d.c - Vector2(d.r, d.r), Vector2(d.r, d.r) * 2.0))
	buttons.append(Rect2(Vector2(60, vp.y - 190), Vector2(150, 150)))   # the stick

	var longest_hint := ""
	for k in Data.HINTS:
		if Data.HINTS[k].length() > longest_hint.length():
			longest_hint = Data.HINTS[k]
	ui.toast(longest_hint, 30.0)
	ui.subtitle("The gate is opening. Do stay for the party. There is always cake.", "MR. GRIN")
	ui.card("THE FACTORY FLOOR", "Every road leads through here")
	ui.set_objective("MASCOT OFFICE: decode the word on the intercom (toy lab whiteboard + the note in cubby 7).")
	ui.set_countdown("GATE OPENS IN 25")
	ui.whisper("HOLD YOUR BREATH")
	for i in range(240):
		await process_frame

	var labels := {
		"toast": ui._toast, "subtitle": ui._sub, "card": ui._card, "card line": ui._card_sub,
		"objective": ui._objective, "countdown": ui._count, "whisper": ui._whisper, "prompt": ui._prompt,
	}
	for name in labels:
		var l: Label = labels[name]
		var r := text_rect(l)
		check(screen.encloses(r), "%s stays on the screen (%s)" % [name, str(r)])
		if name in ["toast", "subtitle", "card", "card line", "countdown", "whisper", "prompt"]:
			var hit := false
			for b in buttons:
				if r.intersects(b):
					hit = true
			check(not hit, "%s keeps clear of the buttons" % name)

	# What can be on the glass together must not be printed over itself (the whisper is a one-blink flash, left out).
	var together := ["toast", "subtitle", "card", "card line", "countdown", "objective"]
	for i in range(together.size()):
		for j in range(i + 1, together.size()):
			var a: Label = labels[together[i]]
			var b: Label = labels[together[j]]
			var ra := text_rect(a)
			var rb := text_rect(b)
			check(not ra.intersects(rb), "%s and %s do not print over each other" % [together[i], together[j]])

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
