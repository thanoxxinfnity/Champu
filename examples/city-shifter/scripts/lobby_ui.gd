class_name LobbyUI
extends Control
## The menu, drawn like an anime game: a profile and coin bar on top, the hero on a stage in the middle (the 3D preview behind this Control), three tabs at the
## bottom (HOME, HEROES, SHOP) and the mode buttons on the right of the home screen: SOLO and TEAM against bots, ONLINE (quick match or a room with a code, up to 15 players,
## teams of 4), the classic TRAIN RUN. The HEROES tab picks a hero you own, the SHOP tab buys new ones with coins. Everything is made of UIKit pieces.

signal play_offline(mode: String, match_type: String)         # mode "world" | "train", match_type "solo" | "team"
signal play_online(kind: String, match_type: String, code: String)   # kind "quick" | "create" | "join"
signal leave_online
signal start_room
signal open_armory
signal char_preview(id: String)
signal char_selected(id: String)
signal char_bought(id: String)
signal name_changed(new_name: String)
signal sound_toggled(muted: bool)

var save: Dictionary = {}
var browsing := "outlaw"                 # the hero shown on the stage
var screen := "home"
var screens := {}
var _top_name: Label
var _top_sub: Label
var _top_coins: Label
var _level_badge: Control
var _tabs := {}
var _char_cards := {}                    # screen name -> {id: card}
var _info := {}                          # screen name -> {name, role, perk, bars, button}
var _room_box: VBoxContainer
var _status: Label
var _match_pick := "solo"
var _match_chips := {}
var _code_in: LineEdit
var _name_in: LineEdit
var _room := {}
var _petal_t := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_top()
	_build_tabs()
	screens["home"] = _build_home()
	screens["chars"] = _build_chars(false)
	screens["shop"] = _build_chars(true)
	screens["online"] = _build_online()
	screens["settings"] = _build_settings()
	for k in screens:
		add_child(screens[k])
	show_screen("home")


# ── pieces ───────────────────────────────────────────────────────────────────

func _build_top() -> void:
	var bar := HBoxContainer.new()
	bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	bar.offset_left = 18
	bar.offset_right = -18
	bar.offset_top = 12
	bar.offset_bottom = 92
	bar.add_theme_constant_override("separation", 12)
	add_child(bar)
	# profile
	var prof := UIKit.panel(bar, Color(0.99, 0.95, 0.88, 0.97), 22)
	prof.custom_minimum_size = Vector2(340, 74)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	prof.add_child(h)
	_level_badge = Control.new()
	_level_badge.custom_minimum_size = Vector2(54, 54)
	_level_badge.draw.connect(func() -> void:
		var c := Vector2(27, 27)
		_level_badge.draw_circle(c, 25.0, UIKit.PURPLE)
		_level_badge.draw_arc(c, 25.0, 0, TAU, 24, UIKit.INK, 4.0)
		UIKit.draw_text(_level_badge, str(Data.level_for(float(save.get("best", 0.0)))), Vector2(0, 36), 26, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, 54.0))
	h.add_child(_level_badge)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", -2)
	h.add_child(v)
	_top_name = UIKit.label("PLAYER", v, 24, UIKit.INK, true)
	_top_name.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	_top_name.add_theme_constant_override("outline_size", 0)
	_top_sub = UIKit.label("", v, 13, Color(0.35, 0.28, 0.5))
	_top_sub.add_theme_constant_override("outline_size", 0)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(sp)
	# coins
	var cp := UIKit.panel(bar, Color(0.99, 0.95, 0.88, 0.97), 22)
	cp.custom_minimum_size = Vector2(210, 74)
	var ch := HBoxContainer.new()
	ch.add_theme_constant_override("separation", 10)
	cp.add_child(ch)
	var coin := Control.new()
	coin.custom_minimum_size = Vector2(44, 44)
	coin.draw.connect(func() -> void: UIKit.draw_icon(coin, "coin", Vector2(22, 22), 40.0, UIKit.YELLOW))
	ch.add_child(coin)
	_top_coins = UIKit.label("0", ch, 32, UIKit.INK, true)
	_top_coins.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	_top_coins.add_theme_constant_override("outline_size", 0)
	# settings
	var gear := UIKit.button("", bar, "gear", UIKit.SKY, Vector2(74, 74))
	gear.pressed.connect(func() -> void: show_screen("settings"))


func _build_tabs() -> void:
	var row := HBoxContainer.new()
	row.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	row.anchor_top = 1.0
	row.anchor_bottom = 1.0
	row.offset_left = 18
	row.offset_top = -86
	row.offset_bottom = -14
	row.offset_right = 760
	row.add_theme_constant_override("separation", 12)
	add_child(row)
	for t in [["home", "HOME", "home", UIKit.PINK], ["chars", "HEROES", "user", UIKit.SKY], ["shop", "SHOP", "shop", UIKit.YELLOW]]:
		var b := UIKit.button(String(t[1]), row, String(t[2]), t[3], Vector2(210, 72), 28)
		b.pressed.connect(func() -> void: show_screen(String(t[0])))
		_tabs[String(t[0])] = b


func _build_home() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# the title, top right
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	col.anchor_left = 1.0
	col.anchor_right = 1.0
	col.offset_left = -420
	col.offset_right = -18
	col.offset_top = 104
	col.add_theme_constant_override("separation", 10)
	root.add_child(col)
	var t := UIKit.label("CITY SHIFTER", col, 62, UIKit.YELLOW, true)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var s := UIKit.label("SKY SIEGE", col, 30, UIKit.PINK, true)
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var b1 := UIKit.button("SOLO", col, "play", UIKit.PINK, Vector2(380, 74), 34, "You vs 14 bots")
	b1.pressed.connect(func() -> void: play_offline.emit("world", "solo"))
	var b2 := UIKit.button("TEAM", col, "team", UIKit.SKY, Vector2(380, 74), 34, "Squads of 4 vs bots")
	b2.pressed.connect(func() -> void: play_offline.emit("world", "team"))
	var b3 := UIKit.button("ONLINE", col, "globe", UIKit.MINT, Vector2(380, 74), 34, "Up to 15 players, rooms")
	b3.pressed.connect(func() -> void: show_screen("online"))
	var b4 := UIKit.button("TRAIN RUN", col, "train", UIKit.ORANGE, Vector2(380, 66), 30, "The classic roof run")
	b4.pressed.connect(func() -> void: play_offline.emit("train", "solo"))
	var b5 := UIKit.button("WEAPONS", col, "sword", UIKit.PURPLE, Vector2(380, 56), 24, "Unlock gauntlets for the train run")
	b5.pressed.connect(func() -> void: open_armory.emit())
	# the hero name tag, bottom centre-left
	var tag := VBoxContainer.new()
	tag.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	tag.anchor_top = 1.0
	tag.anchor_bottom = 1.0
	tag.offset_left = 18
	tag.offset_top = -200
	tag.offset_bottom = -96
	tag.offset_right = 520
	root.add_child(tag)
	var hn := UIKit.label("", tag, 44, UIKit.CREAM, true)
	var hr := UIKit.label("", tag, 18, UIKit.YELLOW)
	var hp := UIKit.label("", tag, 15, UIKit.CREAM)
	hp.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hp.custom_minimum_size = Vector2(440, 0)
	_info["home"] = {"name": hn, "role": hr, "perk": hp}
	return root


func _stat_bar(parent: Control, label_text: String, frac: float, col: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var l := UIKit.label(label_text, row, 14, UIKit.INK)
	l.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	l.add_theme_constant_override("outline_size", 0)
	l.custom_minimum_size = Vector2(70, 0)
	var bar := Control.new()
	bar.custom_minimum_size = Vector2(190, 20)
	bar.set_meta("v", frac)
	bar.draw.connect(func() -> void:
		bar.draw_style_box(UIKit.box(Color(0.82, 0.78, 0.86), UIKit.INK, 8, 3, 0), Rect2(0, 2, 190, 16))
		var f: float = bar.get_meta("v")
		if f > 0.02:
			bar.draw_style_box(UIKit.box(col, UIKit.INK, 8, 3, 0), Rect2(0, 2, maxf(14.0, 190.0 * f), 16)))
	row.add_child(bar)
	_info[screen_stack_key(parent)]["bars"].append(bar)


func screen_stack_key(parent: Node) -> String:
	return String(parent.get_meta("key"))


func _build_chars(shop: bool) -> Control:
	var key := "shop" if shop else "chars"
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# the grid, left
	var gp := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	gp.set_anchors_preset(Control.PRESET_TOP_LEFT)
	gp.offset_left = 18
	gp.offset_top = 104
	gp.offset_right = 590
	gp.offset_bottom = 628
	var gv := VBoxContainer.new()
	gv.add_theme_constant_override("separation", 8)
	gp.add_child(gv)
	var title := UIKit.label("SHOP: NEW HEROES" if shop else "YOUR HEROES", gv, 34, UIKit.PINK if not shop else UIKit.ORANGE, true)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	gv.add_child(sc)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	sc.add_child(grid)
	_char_cards[key] = {}
	grid.set_meta("key", key)
	for id in Data.CAST_ORDER:
		var card := _make_card(id, key)
		grid.add_child(card)
		_char_cards[key][id] = card
	# the info panel, right
	var ip := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	ip.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	ip.anchor_left = 1.0
	ip.anchor_right = 1.0
	ip.offset_left = -430
	ip.offset_right = -18
	ip.offset_top = 104
	ip.offset_bottom = 628
	var iv := VBoxContainer.new()
	iv.add_theme_constant_override("separation", 8)
	iv.set_meta("key", key)
	ip.add_child(iv)
	_info[key] = {"bars": []}
	var nm := UIKit.label("", iv, 44, UIKit.PINK, true)
	var rl := UIKit.label("", iv, 18, UIKit.INK)
	rl.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	rl.add_theme_constant_override("outline_size", 0)
	var pk := UIKit.label("", iv, 16, Color(0.3, 0.2, 0.45))
	pk.add_theme_constant_override("outline_size", 0)
	pk.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	pk.custom_minimum_size = Vector2(380, 70)
	_stat_bar(iv, "SPEED", 0.5, UIKit.SKY)
	_stat_bar(iv, "JETPACK", 0.5, UIKit.ORANGE)
	_stat_bar(iv, "HEALTH", 0.5, UIKit.MINT)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	iv.add_child(spacer)
	var act := UIKit.button("SELECT", iv, "check", UIKit.MINT, Vector2(380, 74), 34)
	act.pressed.connect(func() -> void: _on_action(key))
	_info[key].merge({"name": nm, "role": rl, "perk": pk, "button": act}, true)
	return root


func _make_card(id: String, key: String) -> Control:
	var info: Dictionary = Data.CAST[id]
	var b := Button.new()
	b.custom_minimum_size = Vector2(168, 128)
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		b.add_theme_stylebox_override(st, StyleBoxEmpty.new())
	b.draw.connect(func() -> void:
		var owned := Data.char_owned(id, save)
		var picked := browsing == id
		var fill := Color(1.0, 0.97, 0.9) if owned else Color(0.86, 0.82, 0.92)
		b.draw_style_box(UIKit.box(fill, UIKit.PINK if picked else UIKit.INK, 16, 5 if picked else 3, 4), Rect2(2, 2, 164, 118))
		var c := Vector2(84, 52)
		var tint := UIKit.SKY if bool(info.male) else UIKit.PINK
		b.draw_circle(c, 34.0, tint.lerp(Color.WHITE, 0.2) if owned else tint.darkened(0.4))
		b.draw_arc(c, 34.0, 0, TAU, 24, UIKit.INK, 4.0)
		UIKit.draw_text(b, String(info.name).substr(0, 1), c + Vector2(-30, 14), 40, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, 60.0)
		UIKit.draw_text(b, String(info.name), Vector2(4, 108), 17, UIKit.INK if owned else Color(0.35, 0.3, 0.5), false, HORIZONTAL_ALIGNMENT_CENTER, 160.0)
		if not owned:
			UIKit.draw_icon(b, "lock", Vector2(140, 22), 26.0, UIKit.YELLOW)
			UIKit.draw_text(b, "$%d" % int(info.price), Vector2(10, 28), 16, UIKit.YELLOW)
		elif String(save.get("char", "outlaw")) == id:
			UIKit.draw_icon(b, "check", Vector2(142, 22), 26.0, UIKit.MINT))
	b.pressed.connect(func() -> void:
		browsing = id
		char_preview.emit(id)
		_refresh()
		for k in _char_cards:
			for cid in _char_cards[k]:
				(_char_cards[k][cid] as Control).queue_redraw())
	return b


func _on_action(key: String) -> void:
	var id := browsing
	if Data.char_owned(id, save):
		save["char"] = id
		char_selected.emit(id)
	elif Data.char_buyable(id, save) == "":
		char_bought.emit(id)
	_refresh()


func _build_online() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var p := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 26)
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.anchor_left = 0.5
	p.anchor_right = 0.5
	p.anchor_top = 0.5
	p.anchor_bottom = 0.5
	p.offset_left = -430
	p.offset_right = 430
	p.offset_top = -270
	p.offset_bottom = 250
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	var hdr := HBoxContainer.new()
	v.add_child(hdr)
	var tl := UIKit.label("ONLINE  ·  up to 15 players", hdr, 40, UIKit.MINT, true)
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var back := UIKit.button("", hdr, "back", UIKit.PINK, Vector2(70, 56))
	back.pressed.connect(func() -> void:
		leave_online.emit()
		show_screen("home"))
	# quick match
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	v.add_child(row)
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_theme_constant_override("separation", 8)
	row.add_child(left)
	var l1 := UIKit.label("QUICK MATCH", left, 26, UIKit.PINK, true)
	var chips := HBoxContainer.new()
	chips.add_theme_constant_override("separation", 8)
	left.add_child(chips)
	for m in [["solo", "SOLO  1 v 1", "user"], ["team", "TEAM  4 v 4", "team"]]:
		var c := UIKit.button(String(m[1]), chips, String(m[2]), UIKit.SKY if m[0] == _match_pick else Color(0.6, 0.6, 0.75), Vector2(190, 56), 20)
		c.pressed.connect(func() -> void:
			_match_pick = String(m[0])
			_refresh_chips())
		_match_chips[String(m[0])] = c
	var find := UIKit.button("FIND PLAYERS", left, "globe", UIKit.MINT, Vector2(392, 70), 32, "Random players join until the room is full")
	find.pressed.connect(func() -> void: play_online.emit("quick", _match_pick, ""))
	# custom room
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 8)
	row.add_child(right)
	var l2 := UIKit.label("CUSTOM ROOM", right, 26, UIKit.ORANGE, true)
	var create := UIKit.button("CREATE ROOM", right, "plus", UIKit.ORANGE, Vector2(392, 60), 28, "You get a 4-letter code to share")
	create.pressed.connect(func() -> void: play_online.emit("create", _match_pick, ""))
	var jr := HBoxContainer.new()
	jr.add_theme_constant_override("separation", 8)
	right.add_child(jr)
	_code_in = LineEdit.new()
	_code_in.placeholder_text = "CODE"
	_code_in.max_length = 4
	_code_in.custom_minimum_size = Vector2(120, 56)
	_code_in.add_theme_font_override("font", UIKit.title_font())
	_code_in.add_theme_font_size_override("font_size", 32)
	_code_in.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_code_in.add_theme_stylebox_override("normal", UIKit.box(Color.WHITE, UIKit.INK, 12, 3, 0))
	_code_in.add_theme_stylebox_override("focus", UIKit.box(Color(1, 0.98, 0.85), UIKit.PINK, 12, 4, 0))
	_code_in.add_theme_color_override("font_color", UIKit.INK)
	jr.add_child(_code_in)
	var join := UIKit.button("JOIN", jr, "key", UIKit.PURPLE, Vector2(260, 56), 26)
	join.pressed.connect(func() -> void: play_online.emit("join", _match_pick, _code_in.text.strip_edges().to_upper()))
	# the room
	_status = UIKit.label("", v, 20, UIKit.INK)
	_status.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	_status.add_theme_constant_override("outline_size", 0)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_room_box = VBoxContainer.new()
	_room_box.add_theme_constant_override("separation", 4)
	v.add_child(_room_box)
	return root


func _build_settings() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var p := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 26)
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.anchor_left = 0.5
	p.anchor_right = 0.5
	p.anchor_top = 0.5
	p.anchor_bottom = 0.5
	p.offset_left = -300
	p.offset_right = 300
	p.offset_top = -230
	p.offset_bottom = 200
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	var hdr := HBoxContainer.new()
	v.add_child(hdr)
	var tl := UIKit.label("SETTINGS", hdr, 44, UIKit.SKY, true)
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var back := UIKit.button("", hdr, "back", UIKit.PINK, Vector2(70, 56))
	back.pressed.connect(func() -> void: show_screen("home"))
	var nl := UIKit.label("YOUR NAME", v, 20, UIKit.INK)
	nl.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	nl.add_theme_constant_override("outline_size", 0)
	_name_in = LineEdit.new()
	_name_in.max_length = 12
	_name_in.custom_minimum_size = Vector2(0, 56)
	_name_in.add_theme_font_override("font", UIKit.body_font())
	_name_in.add_theme_font_size_override("font_size", 26)
	_name_in.add_theme_stylebox_override("normal", UIKit.box(Color.WHITE, UIKit.INK, 12, 3, 0))
	_name_in.add_theme_stylebox_override("focus", UIKit.box(Color(1, 0.98, 0.85), UIKit.PINK, 12, 4, 0))
	_name_in.add_theme_color_override("font_color", UIKit.INK)
	_name_in.text_submitted.connect(func(t: String) -> void: name_changed.emit(t.strip_edges()))
	_name_in.focus_exited.connect(func() -> void: name_changed.emit(_name_in.text.strip_edges()))
	v.add_child(_name_in)
	var snd := UIKit.button("SOUND: ON", v, "bolt", UIKit.MINT, Vector2(0, 62), 28)
	snd.pressed.connect(func() -> void:
		var off := snd.text == "SOUND: ON"
		snd.text = "SOUND: OFF" if off else "SOUND: ON"
		sound_toggled.emit(off))
	var r := UIKit.label("Everybody sees 50 m around them: the same for all players, nobody can raise it.", v, 16, UIKit.INK)
	r.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	r.add_theme_constant_override("outline_size", 0)
	r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var rec := UIKit.label("", v, 16, UIKit.INK)
	rec.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	rec.add_theme_constant_override("outline_size", 0)
	rec.name = "Record"
	return root


# ── state ────────────────────────────────────────────────────────────────────

func show_screen(name: String) -> void:
	screen = name
	for k in screens:
		(screens[k] as Control).visible = (k == name)
	for k in _tabs:
		(_tabs[k] as UIKit.AnimeButton).accent = [UIKit.PINK, UIKit.SKY, UIKit.YELLOW][["home", "chars", "shop"].find(k)] if k == name else Color(0.62, 0.58, 0.78)
		(_tabs[k] as Control).queue_redraw()
	if name == "shop":
		# the shop starts on the cheapest hero you do not own
		for id in Data.CAST_ORDER:
			if not Data.char_owned(id, save):
				browsing = id
				break
		char_preview.emit(browsing)
	elif name == "chars":
		browsing = String(save.get("char", "outlaw"))
		char_preview.emit(browsing)
	_refresh()


func set_save(s: Dictionary) -> void:
	save = s
	browsing = String(save.get("char", browsing))
	_refresh()


func _refresh_chips() -> void:
	for k in _match_chips:
		var c := _match_chips[k] as UIKit.AnimeButton
		c.accent = UIKit.SKY if k == _match_pick else Color(0.6, 0.6, 0.75)
		c.queue_redraw()


func _refresh() -> void:
	if _top_name == null or save.is_empty():
		return
	_top_name.text = String(save.get("name", "PLAYER"))
	_top_sub.text = "%d matches · %d wins" % [int(save.get("matches", 0)), int(save.get("wins", 0))]
	_top_coins.text = str(int(save.get("coins", 0)))
	_level_badge.queue_redraw()
	if _name_in != null and not _name_in.has_focus():
		_name_in.text = String(save.get("name", "PLAYER"))
	var sel: Dictionary = Data.CAST[String(save.get("char", "outlaw"))]
	var hi: Dictionary = _info.get("home", {})
	if not hi.is_empty():
		(hi.name as Label).text = String(sel.name)
		(hi.role as Label).text = String(sel.role)
		(hi.perk as Label).text = String(sel.perk)
	for key in ["chars", "shop"]:
		var inf: Dictionary = _info[key]
		var d: Dictionary = Data.CAST[browsing]
		(inf.name as Label).text = String(d.name)
		(inf.role as Label).text = String(d.role)
		(inf.perk as Label).text = String(d.perk)
		var vals := [float(d.speed) / 8.0, float(d.fuel) * float(d.get("fuel_mult", 1.0)) / 140.0, float(d.hp) / 160.0]
		for i in 3:
			(inf.bars[i] as Control).set_meta("v", vals[i])
			(inf.bars[i] as Control).queue_redraw()
		var btn := inf.button as UIKit.AnimeButton
		if Data.char_owned(browsing, save):
			var cur := String(save.get("char", "outlaw")) == browsing
			btn.text = "SELECTED" if cur else "SELECT"
			btn.icon_name = "check"
			btn.accent = UIKit.MINT if not cur else Color(0.6, 0.78, 0.7)
			btn.disabled = cur
		else:
			var why := Data.char_buyable(browsing, save)
			btn.text = "BUY  $%d" % int(d.price)
			btn.icon_name = "coin"
			btn.accent = UIKit.YELLOW
			btn.disabled = why != ""
		btn.queue_redraw()
	for k in _char_cards:
		for cid in _char_cards[k]:
			(_char_cards[k][cid] as Control).queue_redraw()
	var rec := (screens["settings"] as Control).find_child("Record", true, false)
	if rec != null:
		(rec as Label).text = "Best run: %d m   ·   %d matches   ·   %d wins" % [int(save.get("best", 0)), int(save.get("matches", 0)), int(save.get("wins", 0))]


## The online room (or the search): `info` = {state: "none"|"searching"|"room", code, status, players: [{name, team, host, you}], host: bool, max}.
func set_status(text: String) -> void:
	if _status != null:
		_status.text = text


func set_room(info: Dictionary) -> void:
	_room = info
	if _status == null:
		return
	_status.text = String(info.get("status", ""))
	for c in _room_box.get_children():
		c.queue_free()
	if String(info.get("state", "none")) != "room":
		return
	var hdr := UIKit.label("ROOM  %s     %d / %d" % [String(info.get("code", "")), (info.get("players", []) as Array).size(), int(info.get("max", Data.MAX_PLAYERS))], _room_box, 30, UIKit.PINK, true)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 14)
	_room_box.add_child(grid)
	for p in info.get("players", []):
		var col: Color = MatchController.TEAM_COLORS[int(p.team) % MatchController.TEAM_COLORS.size()]
		var t := UIKit.label("%s%s" % [String(p.name), "  ★" if bool(p.get("host", false)) else ""], grid, 18, col)
		t.custom_minimum_size = Vector2(250, 0)
		if bool(p.get("you", false)):
			t.add_theme_color_override("font_color", UIKit.YELLOW)
	var act := HBoxContainer.new()
	act.add_theme_constant_override("separation", 10)
	_room_box.add_child(act)
	if bool(info.get("host", false)):
		var go := UIKit.button("START MATCH", act, "play", UIKit.MINT, Vector2(300, 60), 28, "" if (info.get("players", []) as Array).size() >= 2 else "needs 2+ players")
		go.disabled = (info.get("players", []) as Array).size() < 2
		go.pressed.connect(func() -> void: start_room.emit())
	var lv := UIKit.button("LEAVE", act, "back", UIKit.PINK, Vector2(200, 60), 26)
	lv.pressed.connect(func() -> void:
		leave_online.emit()
		set_room({"state": "none", "status": ""}))


func _process(delta: float) -> void:
	_petal_t += delta
