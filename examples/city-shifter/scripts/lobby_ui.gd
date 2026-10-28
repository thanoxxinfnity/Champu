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
signal skill_bought(hero: String, skill: String)
signal screen_changed(name: String)
signal hero_tapped
signal squad_ready(on: bool)
signal squad_invite(uid: int)
signal friend_add(uid: int)
signal friend_remove(uid: int)
signal lan_host                            # host a game on this Wi-Fi / hotspot (no server)
signal lan_find
signal lan_join(ip: String)
signal weapon_action(id: String)           # unlock or equip (the train-run gauntlet)
signal weapon_view(id: String)             # open the 360 viewer on it
signal gfx_changed(level: int)                        # Gfx.NAMES: 0 smooth, 1 standard, 2 ultra
signal debug_toggled(on: bool)
signal settings_changed(sens: float, assist: int)      # look sensitivity 0.5..2.0, aim assist 0 off / 1 low / 2 full lock
signal view_drag(delta: Vector2)           # a finger or mouse dragging over the 3D model (the 360 view)
signal view_zoom(factor: float)            # a pinch or the mouse wheel
signal view_cat(cat: String)               # "heroes" | "weapons" | "rides"
signal view_step(d: int)

var save: Dictionary = {}
var browsing := "outlaw"                 # the hero shown on the stage
var screen := "home"
var screens := {}
var _top_name: Label
var social: FirebaseSocialManager                       # set by Main: my UID and friends
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
var _sens_in: HSlider
var _sens_val: Label
var _assist_btn: UIKit.AnimeButton
var _assist := 2
var _gfx_btn: UIKit.AnimeButton
var _gfx := 1
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
	screens["skills"] = _build_skills()
	screens["online"] = _build_online()
	screens["settings"] = _build_settings()
	screens["view"] = _build_view()
	screens["weapons"] = _build_weapons()
	screens["friends"] = _build_friends()
	screens["squad"] = _build_squad()
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
	_level_badge.custom_minimum_size = Vector2(62, 62)
	_level_badge.draw.connect(func() -> void:
		var hid := String(save.get("char", "outlaw"))
		var rc: Dictionary = HeroCard.RARITY[Data.rarity_of(hid)]
		_level_badge.draw_style_box(UIKit.box(rc.bot, UIKit.INK, 14, 3, 0), Rect2(0, 0, 62, 62))
		HeroCard.draw_art(_level_badge, hid, Rect2(4, 4, 54, 54), 11.0, Color.WHITE, Rect2(0.12, 0.02, 0.76, 0.57))
		_level_badge.draw_circle(Vector2(50, 50), 13.0, UIKit.PURPLE)
		_level_badge.draw_arc(Vector2(50, 50), 13.0, 0, TAU, 20, UIKit.INK, 3.0)
		UIKit.draw_text(_level_badge, str(Data.level_for(float(save.get("best", 0.0)))), Vector2(37, 57), 17, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, 26.0))
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
	# friends
	var fr := UIKit.button("FRIENDS", bar, "people", UIKit.MINT, Vector2(176, 74), 24)
	fr.pressed.connect(func() -> void: show_screen("friends"))
	# the battle card
	var mycard := UIKit.button("CARD", bar, "star", UIKit.ORANGE, Vector2(150, 74), 26)
	mycard.pressed.connect(_open_my_card)
	# settings
	var gear := UIKit.button("", bar, "gear", UIKit.SKY, Vector2(74, 74))
	gear.pressed.connect(func() -> void: show_screen("settings"))


var _card_pop: Control
var _card_view: HeroCard


## The player's own battle card, in a pop-up.
func _open_my_card() -> void:
	if _card_pop == null:
		_card_pop = Control.new()
		_card_pop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_card_pop.mouse_filter = Control.MOUSE_FILTER_STOP
		var dim := ColorRect.new()
		dim.color = Color(0.05, 0.03, 0.15, 0.78)
		dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_card_pop.add_child(dim)
		_card_view = HeroCard.new()
		_card_view.mode = "player"
		_card_view.set_anchors_preset(Control.PRESET_CENTER)
		_card_view.anchor_left = 0.5
		_card_view.anchor_right = 0.5
		_card_view.anchor_top = 0.5
		_card_view.anchor_bottom = 0.5
		_card_view.offset_left = -165
		_card_view.offset_right = 165
		_card_view.offset_top = -285
		_card_view.offset_bottom = 255
		_card_pop.add_child(_card_view)
		var close := UIKit.button("CLOSE", _card_pop, "back", UIKit.PINK, Vector2(220, 56), 24)
		close.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		close.anchor_left = 0.5
		close.anchor_right = 0.5
		close.anchor_top = 1.0
		close.anchor_bottom = 1.0
		close.offset_left = -110
		close.offset_right = 110
		close.offset_top = -72
		close.offset_bottom = -16
		close.pressed.connect(func() -> void: _card_pop.visible = false)
		add_child(_card_pop)
	_card_view.hero_id = String(save.get("char", "outlaw"))
	_card_view.player = {"name": String(save.get("name", "PLAYER")), "level": Data.level_for(float(save.get("best", 0.0))), "matches": int(save.get("matches", 0)), "wins": int(save.get("wins", 0))}
	_card_view.queue_redraw()
	_card_pop.visible = true


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
	var b5 := UIKit.button("WEAPONS", col, "sword", UIKit.PURPLE, Vector2(380, 56), 24, "Every weapon: numbers, 3D view, unlock")
	b5.pressed.connect(func() -> void: show_screen("weapons"))
	# tapping the hero makes it do an emote
	var tap := Button.new()
	tap.flat = true
	tap.focus_mode = Control.FOCUS_NONE
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		tap.add_theme_stylebox_override(st, StyleBoxEmpty.new())
	tap.set_anchors_preset(Control.PRESET_CENTER)
	tap.anchor_left = 0.5
	tap.anchor_right = 0.5
	tap.anchor_top = 0.5
	tap.anchor_bottom = 0.5
	tap.offset_left = -220
	tap.offset_right = 130
	tap.offset_top = -250
	tap.offset_bottom = 230
	var dragged := [0.0]
	tap.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			dragged[0] = 0.0
		elif ev is InputEventMouseMotion and (ev.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			dragged[0] += absf(ev.relative.x) + absf(ev.relative.y)
			view_drag.emit(ev.relative))           # (a finger arrives here as an emulated mouse drag too: no separate ScreenDrag branch, or it turned twice)
	tap.pressed.connect(func() -> void:
		if dragged[0] < 14.0:
			hero_tapped.emit())
	root.add_child(tap)
	var vb := UIKit.button("3D VIEW", null, "cube", UIKit.SKY, Vector2(210, 58), 24)
	vb.position = Vector2(18, 108)
	vb.size = Vector2(210, 58)
	vb.pressed.connect(func() -> void: show_screen("view"))
	root.add_child(vb)
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
	# the grid of portraits, left
	var gp := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	gp.set_anchors_preset(Control.PRESET_TOP_LEFT)
	gp.offset_left = 18
	gp.offset_top = 104
	gp.offset_right = 486
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
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	sc.add_child(grid)
	_char_cards[key] = {}
	grid.set_meta("key", key)
	for id in Data.CAST_ORDER:
		var card := _make_card(id, key)
		grid.add_child(card)
		_char_cards[key][id] = card
	# the big battle card, middle
	var hc := HeroCard.new()
	hc.set_anchors_preset(Control.PRESET_TOP_LEFT)
	hc.offset_left = 504
	hc.offset_top = 104
	hc.offset_right = 504 + 320
	hc.offset_bottom = 104 + 524
	root.add_child(hc)
	# the details, right
	var ip := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	ip.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	ip.anchor_left = 1.0
	ip.anchor_right = 1.0
	ip.offset_left = -424
	ip.offset_right = -18
	ip.offset_top = 104
	ip.offset_bottom = 628
	var iv := VBoxContainer.new()
	iv.add_theme_constant_override("separation", 8)
	iv.set_meta("key", key)
	ip.add_child(iv)
	_info[key] = {"bars": []}
	var nm := UIKit.label("", iv, 40, UIKit.PINK, true)
	nm.custom_minimum_size = Vector2(380, 0)
	nm.clip_text = true
	var rl := UIKit.label("", iv, 18, UIKit.INK)
	rl.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	rl.add_theme_constant_override("outline_size", 0)
	rl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rl.custom_minimum_size = Vector2(380, 0)
	var pk := UIKit.label("", iv, 16, Color(0.3, 0.2, 0.45))
	pk.add_theme_constant_override("outline_size", 0)
	pk.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	pk.custom_minimum_size = Vector2(380, 62)
	_stat_bar(iv, "SPEED", 0.5, UIKit.SKY)
	_stat_bar(iv, "JETPACK", 0.5, UIKit.ORANGE)
	_stat_bar(iv, "HEALTH", 0.5, UIKit.MINT)
	var pts := UIKit.label("", iv, 16, UIKit.INK)
	pts.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	pts.add_theme_constant_override("outline_size", 0)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	iv.add_child(spacer)
	var sk := UIKit.button("SKILLS", iv, "bolt", UIKit.PURPLE, Vector2(380, 66), 30, "Level up this hero")
	sk.pressed.connect(func() -> void: show_screen("skills"))
	var act := UIKit.button("SELECT", iv, "check", UIKit.MINT, Vector2(380, 70), 32)
	act.pressed.connect(func() -> void: _on_action(key))
	_info[key].merge({"name": nm, "role": rl, "perk": pk, "button": act, "card": hc, "skills": sk, "pts": pts}, true)
	return root


func _make_card(id: String, key: String) -> Control:
	var info: Dictionary = Data.CAST[id]
	var b := Button.new()
	b.custom_minimum_size = Vector2(140, 150)
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		b.add_theme_stylebox_override(st, StyleBoxEmpty.new())
	var tex: Texture2D = load("res://assets/ui/cards/%s.png" % id) as Texture2D if ResourceLoader.exists("res://assets/ui/cards/%s.png" % id) else null
	b.draw.connect(func() -> void:
		var owned := Data.char_owned(id, save)
		var picked := browsing == id
		var rc: Dictionary = HeroCard.RARITY[Data.rarity_of(id)]
		var top: Color = rc.top
		var bot: Color = rc.bot
		b.draw_style_box(UIKit.box(bot, UIKit.PINK if picked else UIKit.INK, 14, 5 if picked else 3, 3), Rect2(2, 2, 136, 138))
		if not HeroCard.draw_art(b, id, Rect2(6, 6, 128, 128), 11.0, Color.WHITE if owned else Color(0.55, 0.5, 0.72), Rect2(0.0, 0.0, 1.0, 0.75)):
			b.draw_polygon(PackedVector2Array([Vector2(8, 8), Vector2(132, 8), Vector2(132, 132), Vector2(8, 132)]), PackedColorArray([top, top, bot, bot]))
			if tex != null:
				var ts := tex.get_size()
				var k := 118.0 / ts.y
				b.draw_texture_rect(tex, Rect2(Vector2(70.0 - ts.x * k * 0.5, 12.0), ts * k), false, Color.WHITE if owned else Color(0.2, 0.17, 0.32))
		b.draw_style_box(UIKit.box(Color(UIKit.INK.r, UIKit.INK.g, UIKit.INK.b, 0.88), UIKit.INK, 8, 2, 0), Rect2(8, 112, 124, 24))
		UIKit.draw_text(b, String(info.get("short", info.name)), Vector2(10, 130), 18, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, 120.0)
		if not owned:
			UIKit.draw_icon(b, "lock", Vector2(118, 26), 28.0, UIKit.YELLOW)
			UIKit.draw_text(b, "$%d" % int(info.price), Vector2(10, 28), 16, UIKit.YELLOW, true, HORIZONTAL_ALIGNMENT_LEFT, 70.0)
		elif String(save.get("char", "outlaw")) == id:
			UIKit.draw_icon(b, "check", Vector2(118, 26), 28.0, UIKit.MINT))
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


# ── skills ───────────────────────────────────────────────────────────────────

var _skill_rows := {}                    # skill id -> {row, button}
var _skill_card: HeroCard
var _skill_head: Label


func _build_skills() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_skill_card = HeroCard.new()
	_skill_card.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_skill_card.offset_left = 18
	_skill_card.offset_top = 104
	_skill_card.offset_right = 18 + 300
	_skill_card.offset_bottom = 104 + 524
	root.add_child(_skill_card)
	var p := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 24)
	p.set_anchors_preset(Control.PRESET_TOP_LEFT)
	p.offset_left = 336
	p.offset_right = 1262
	p.offset_top = 104
	p.offset_bottom = 628
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	p.add_child(v)
	var hdr := HBoxContainer.new()
	v.add_child(hdr)
	_skill_head = UIKit.label("SKILLS", hdr, 40, UIKit.PURPLE, true)
	_skill_head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_skill_head.clip_text = true
	var back := UIKit.button("", hdr, "back", UIKit.PINK, Vector2(70, 52))
	back.pressed.connect(func() -> void: show_screen("chars"))
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 14)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(cols)
	var left := VBoxContainer.new()
	var right := VBoxContainer.new()
	for c in [left, right]:
		c.add_theme_constant_override("separation", 6)
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cols.add_child(c)
	for i in Data.SKILL_ORDER.size():
		var sid: String = Data.SKILL_ORDER[i]
		var row := _skill_row(sid)
		(left if i < 7 else right).add_child(row)
	return root


func _skill_row(sid: String) -> Control:
	var row := Control.new()
	row.custom_minimum_size = Vector2(430, 62)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var btn := UIKit.button("UPGRADE", row, "", UIKit.MINT, Vector2(128, 50), 18)
	btn.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	btn.anchor_left = 1.0
	btn.anchor_right = 1.0
	btn.anchor_top = 0.5
	btn.anchor_bottom = 0.5
	btn.offset_left = -132
	btn.offset_right = -2
	btn.offset_top = -27
	btn.offset_bottom = 27
	btn.pressed.connect(func() -> void:
		if Data.skill_buy(save, browsing, sid):
			skill_bought.emit(browsing, sid)
			_refresh())
	row.draw.connect(func() -> void:
		var d: Dictionary = Data.SKILLS[sid]
		var lv := Data.skill_level(save, browsing, sid)
		row.draw_style_box(UIKit.box(Color(1, 0.98, 0.93), UIKit.INK, 14, 3, 2), Rect2(0, 0, row.size.x - 2, 58))
		row.draw_circle(Vector2(32, 29), 21, UIKit.PURPLE.lerp(Color.WHITE, 0.25))
		row.draw_arc(Vector2(32, 29), 21, 0, TAU, 20, UIKit.INK, 3.0)
		UIKit.draw_icon(row, String(d.icon), Vector2(32, 29), 26, UIKit.CREAM)
		var tw := row.size.x - 64.0 - 136.0
		UIKit.draw_text(row, String(d.name), Vector2(62, 22), 22, UIKit.INK, true, HORIZONTAL_ALIGNMENT_LEFT, tw - 70.0)
		UIKit.draw_text(row, "LV %d/%d" % [lv, Data.SKILL_MAX], Vector2(62 + tw - 66.0, 22), 17, UIKit.PURPLE if lv < Data.SKILL_MAX else UIKit.ORANGE, true, HORIZONTAL_ALIGNMENT_RIGHT, 66.0)
		for i in Data.SKILL_MAX:
			var on := i < lv
			row.draw_style_box(UIKit.box(UIKit.YELLOW if on else Color(0.85, 0.82, 0.9), UIKit.INK, 3, 2, 0), Rect2(62 + i * (tw / float(Data.SKILL_MAX)), 29, tw / float(Data.SKILL_MAX) - 3.0, 9))
		var now := Data.skill_now(sid, lv) if lv > 0 else String(d.per) + " per level"
		UIKit.draw_text(row, now, Vector2(62, 53), 15, Color(0.3, 0.2, 0.45), false, HORIZONTAL_ALIGNMENT_LEFT, tw)
		pass)
	_skill_rows[sid] = {"row": row, "button": btn}
	return row


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
	p.offset_left = -626
	p.offset_right = 626
	p.offset_top = -258
	p.offset_bottom = 266
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
		var c := UIKit.button(String(m[1]), chips, String(m[2]), UIKit.SKY if m[0] == _match_pick else Color(0.6, 0.6, 0.75), Vector2(180, 56), 20)
		c.pressed.connect(func() -> void:
			_match_pick = String(m[0])
			_refresh_chips())
		_match_chips[String(m[0])] = c
	var find := UIKit.button("FIND PLAYERS", left, "globe", UIKit.MINT, Vector2(368, 70), 30, "Random players join until the room is full")
	find.pressed.connect(func() -> void: play_online.emit("quick", _match_pick, ""))
	# custom room
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 8)
	row.add_child(right)
	var l2 := UIKit.label("CUSTOM ROOM", right, 26, UIKit.ORANGE, true)
	var create := UIKit.button("CREATE ROOM", right, "plus", UIKit.ORANGE, Vector2(368, 60), 28, "You get a 6-digit code to share")
	create.pressed.connect(func() -> void: play_online.emit("create", _match_pick, ""))
	var jr := HBoxContainer.new()
	jr.add_theme_constant_override("separation", 8)
	right.add_child(jr)
	_code_in = LineEdit.new()
	_code_in.placeholder_text = "CODE"
	_code_in.max_length = 6
	_code_in.custom_minimum_size = Vector2(140, 56)
	_code_in.add_theme_font_override("font", UIKit.title_font())
	_code_in.add_theme_font_size_override("font_size", 32)
	_code_in.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_code_in.add_theme_stylebox_override("normal", UIKit.box(Color.WHITE, UIKit.INK, 12, 3, 0))
	_code_in.add_theme_stylebox_override("focus", UIKit.box(Color(1, 0.98, 0.85), UIKit.PINK, 12, 4, 0))
	_code_in.add_theme_color_override("font_color", UIKit.INK)
	jr.add_child(_code_in)
	var join := UIKit.button("JOIN", jr, "key", UIKit.PURPLE, Vector2(220, 56), 26)
	join.pressed.connect(func() -> void: play_online.emit("join", _match_pick, _code_in.text.strip_edges().to_upper()))
	# the same Wi-Fi or hotspot: no internet server needed
	var wifi := VBoxContainer.new()
	wifi.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wifi.add_theme_constant_override("separation", 8)
	row.add_child(wifi)
	UIKit.label("SAME WI-FI / HOTSPOT", wifi, 26, UIKit.SKY, true)
	var lh := UIKit.button("HOST ON WI-FI", wifi, "people", UIKit.SKY, Vector2(368, 60), 26, "Friends on your Wi-Fi or hotspot join")
	lh.pressed.connect(func() -> void: lan_host.emit())
	var lf := UIKit.button("FIND ON WI-FI", wifi, "globe", UIKit.PURPLE, Vector2(368, 56), 26)
	lf.pressed.connect(func() -> void: lan_find.emit())
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
	p.offset_top = -258
	p.offset_bottom = 272
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
	var sl := UIKit.label("LOOK SPEED", v, 20, UIKit.INK)
	sl.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	sl.add_theme_constant_override("outline_size", 0)
	_sens_val = sl
	_sens_in = HSlider.new()
	_sens_in.min_value = 0.5
	_sens_in.max_value = 2.0
	_sens_in.step = 0.05
	_sens_in.value = 1.0
	_sens_in.custom_minimum_size = Vector2(0, 40)
	_sens_in.value_changed.connect(func(x: float) -> void:
		_sens_val.text = "LOOK SPEED  x%.2f" % x
		settings_changed.emit(x, _assist))
	v.add_child(_sens_in)
	_assist_btn = UIKit.button("AIM ASSIST: FULL LOCK", v, "bolt", UIKit.ORANGE, Vector2(0, 62), 26)
	_assist_btn.pressed.connect(func() -> void:
		_assist = (_assist + 1) % 3
		_assist_btn.text = _assist_text()
		settings_changed.emit(_sens_in.value, _assist))
	var row := HBoxContainer.new()               # graphics and sound side by side: the panel has no room for another full row
	row.add_theme_constant_override("separation", 10)
	v.add_child(row)
	_gfx_btn = UIKit.button("GRAPHICS: STANDARD", row, "bolt", UIKit.PINK, Vector2(0, 56), 22)
	_gfx_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_gfx_btn.pressed.connect(func() -> void:
		_gfx = (_gfx + 1) % 3
		_gfx_btn.text = "GRAPHICS: " + Gfx.NAMES[_gfx]
		gfx_changed.emit(_gfx))
	var dbg := UIKit.button("DEBUG INFO: OFF", v, "bolt", UIKit.PURPLE, Vector2(0, 50), 22)
	dbg.pressed.connect(func() -> void:
		var on := dbg.text.ends_with("OFF")
		dbg.text = "DEBUG INFO: ON" if on else "DEBUG INFO: OFF"
		debug_toggled.emit(on))
	var snd := UIKit.button("SOUND: ON", row, "bolt", UIKit.MINT, Vector2(0, 56), 22)
	snd.size_flags_horizontal = Control.SIZE_EXPAND_FILL
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


func _assist_text() -> String:
	return "AIM ASSIST: " + ["OFF", "LOW", "FULL LOCK"][_assist]


# ── friends, squad, popups ───────────────────────────────────────────────────

var _friend_list: VBoxContainer
var _uid_label: Label
var _add_in: LineEdit
var _squad := {}
var _squad_friends: VBoxContainer
var _popup: Control


func _friend_row(parent: Control, u: int, n: String, on: bool, invite: bool) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	parent.add_child(row)
	var dot := Control.new()
	dot.custom_minimum_size = Vector2(22, 40)
	dot.draw.connect(func() -> void: dot.draw_circle(Vector2(11, 20), 8.0, UIKit.MINT if on else Color(0.6, 0.58, 0.66)))
	row.add_child(dot)
	var l := UIKit.label(n, row, 20, UIKit.INK)
	l.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	l.add_theme_constant_override("outline_size", 0)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.clip_text = true
	l.custom_minimum_size = Vector2(120, 0)
	if invite:
		var b := UIKit.button("+ INVITE", row, "", UIKit.MINT if on else Color(0.65, 0.62, 0.8), Vector2(130, 44), 18)
		b.disabled = not on
		b.pressed.connect(func() -> void:
			squad_invite.emit(u)
			b.text = "SENT"
			b.disabled = true)
	else:
		var x := UIKit.button("REMOVE", row, "", UIKit.PINK, Vector2(120, 44), 16)
		x.pressed.connect(func() -> void: friend_remove.emit(u))


func _build_friends() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var p := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 26)
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.anchor_left = 0.5
	p.anchor_right = 0.5
	p.anchor_top = 0.5
	p.anchor_bottom = 0.5
	p.offset_left = -360
	p.offset_right = 360
	p.offset_top = -258
	p.offset_bottom = 266
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	var hdr := HBoxContainer.new()
	v.add_child(hdr)
	var tl := UIKit.label("FRIENDS", hdr, 40, UIKit.MINT, true)
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var back := UIKit.button("", hdr, "back", UIKit.PINK, Vector2(70, 56))
	back.pressed.connect(func() -> void: show_screen("home"))
	var me := HBoxContainer.new()
	me.add_theme_constant_override("separation", 10)
	v.add_child(me)
	_uid_label = UIKit.label("YOUR UID  --------", me, 26, UIKit.PURPLE, true)
	_uid_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var cp := UIKit.button("COPY", me, "check", UIKit.SKY, Vector2(140, 50), 20)
	cp.pressed.connect(func() -> void:
		if social != null:
			DisplayServer.clipboard_set(str(social.uid))
			cp.text = "COPIED")
	var add := HBoxContainer.new()
	add.add_theme_constant_override("separation", 10)
	v.add_child(add)
	_add_in = LineEdit.new()
	_add_in.placeholder_text = "FRIEND'S UID (8 digits)"
	_add_in.max_length = 8
	_add_in.custom_minimum_size = Vector2(420, 54)
	_add_in.add_theme_font_override("font", UIKit.body_font())
	_add_in.add_theme_font_size_override("font_size", 24)
	_add_in.add_theme_stylebox_override("normal", UIKit.box(Color.WHITE, UIKit.INK, 12, 3, 0))
	_add_in.add_theme_stylebox_override("focus", UIKit.box(Color(1, 0.98, 0.85), UIKit.PINK, 12, 4, 0))
	_add_in.add_theme_color_override("font_color", UIKit.INK)
	_add_in.virtual_keyboard_type = LineEdit.KEYBOARD_TYPE_NUMBER
	add.add_child(_add_in)
	var ab := UIKit.button("ADD", add, "plus", UIKit.MINT, Vector2(200, 54), 24)
	ab.pressed.connect(func() -> void:
		var t := _add_in.text.strip_edges()
		if t.is_valid_int() and t.length() == 8:
			friend_add.emit(int(t))
			_add_in.text = "")
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(0, 250)
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(sc)
	_friend_list = VBoxContainer.new()
	_friend_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_friend_list.add_theme_constant_override("separation", 6)
	sc.add_child(_friend_list)
	return root


## The friends list on both screens (with INVITE in the squad drawer).
func refresh_friends() -> void:
	if social == null:
		return
	if _uid_label != null:
		_uid_label.text = "YOUR UID  %d" % social.uid
	for box in [_friend_list, _squad_friends]:
		if box == null:
			continue
		for c in box.get_children():
			c.queue_free()
		var ids: Array = social.friends.keys()
		ids.sort_custom(func(a, b) -> bool: return social.is_online(int(a)) and not social.is_online(int(b)))
		if ids.is_empty():
			var e := UIKit.label("No friends yet. Share your UID, or type a friend's UID above.", box, 17, UIKit.INK)
			e.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
			e.add_theme_constant_override("outline_size", 0)
			e.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			e.custom_minimum_size = Vector2(280, 0)
		for u in ids:
			_friend_row(box, int(u), String(social.friends[u].get("n", "UID %d" % int(u))), social.is_online(int(u)), box == _squad_friends)


func _build_squad() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# the code, top centre
	var cp := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 22)
	cp.position = Vector2(380, 104)
	cp.custom_minimum_size = Vector2(500, 70)
	var ch := HBoxContainer.new()
	ch.add_theme_constant_override("separation", 10)
	cp.add_child(ch)
	var code := UIKit.label("SQUAD  ------", ch, 34, UIKit.PINK, true)
	code.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var copy := UIKit.button("COPY", ch, "check", UIKit.SKY, Vector2(130, 50), 20)
	copy.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(String(_room.get("code", "")))
		copy.text = "COPIED")
	# friends drawer, right
	var fp := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 22)
	fp.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	fp.anchor_left = 1.0
	fp.anchor_right = 1.0
	fp.offset_left = -360
	fp.offset_right = -18
	fp.offset_top = 104
	fp.offset_bottom = 520
	var fv := VBoxContainer.new()
	fv.add_theme_constant_override("separation", 6)
	fp.add_child(fv)
	UIKit.label("INVITE FRIENDS", fv, 24, UIKit.MINT, true)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	fv.add_child(sc)
	_squad_friends = VBoxContainer.new()
	_squad_friends.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_squad_friends.add_theme_constant_override("separation", 6)
	sc.add_child(_squad_friends)
	# ready / start / leave, bottom right
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.position = Vector2(690, 548)
	root.add_child(row)
	var go := UIKit.button("START MATCH", row, "play", UIKit.MINT, Vector2(330, 72), 30)
	go.pressed.connect(func() -> void:
		if bool(_room.get("host", false)):
			start_room.emit()
		else:
			var on := go.text == "READY"
			squad_ready.emit(on)
			go.text = "CANCEL" if on else "READY")
	var lv := UIKit.button("LEAVE", row, "back", UIKit.PINK, Vector2(220, 72), 26)
	lv.pressed.connect(func() -> void:
		leave_online.emit()
		set_room({"state": "none", "status": ""})
		show_screen("online"))
	var st := UIKit.label("", root, 18, UIKit.CREAM)
	st.position = Vector2(380, 184)
	st.custom_minimum_size = Vector2(500, 0)
	st.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_squad = {"code": code, "go": go, "status": st, "copy": copy}
	return root


func refresh_squad() -> void:
	if _squad.is_empty():
		return
	var host := bool(_room.get("host", false))
	(_squad.code as Label).text = "SQUAD  %s" % String(_room.get("code", ""))
	var go: UIKit.AnimeButton = _squad.go
	var n := (_room.get("players", []) as Array).size()
	if host:
		go.text = "START MATCH"
		go.disabled = n < 2 or not bool(_room.get("all_ready", true))
		(_squad.status as Label).text = "%d / 4 in the squad — %s" % [n, "everybody is ready" if not go.disabled else ("waiting for READY" if n >= 2 else "invite friends or share the code")]
	else:
		if go.text == "START MATCH":
			go.text = "READY"
		go.disabled = false
		(_squad.status as Label).text = "%d / 4 in the squad — tap READY, the host starts" % n
	go.accent = UIKit.MINT if not go.disabled else Color(0.65, 0.62, 0.8)
	go.queue_redraw()
	refresh_friends()


## A question over everything: an invite, a friend request.
func ask(text: String, yes: String, no: String, on_answer: Callable) -> void:
	if _popup != null:
		_popup.queue_free()
	_popup = Control.new()
	_popup.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_popup.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_popup)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.45)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_popup.add_child(dim)
	var p := UIKit.panel(_popup, Color(0.99, 0.95, 0.88, 0.98), 24)
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.anchor_left = 0.5
	p.anchor_right = 0.5
	p.anchor_top = 0.5
	p.anchor_bottom = 0.5
	p.offset_left = -330
	p.offset_right = 330
	p.offset_top = -95
	p.offset_bottom = 95
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 16)
	p.add_child(v)
	var l := UIKit.label(text, v, 24, UIKit.INK, true)
	l.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	l.add_theme_constant_override("outline_size", 0)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(600, 0)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(row)
	var y := UIKit.button(yes, row, "check", UIKit.MINT, Vector2(260, 64), 26)
	var n := UIKit.button(no, row, "back", UIKit.PINK, Vector2(220, 64), 24)
	var pop := _popup
	y.pressed.connect(func() -> void:
		pop.queue_free()
		on_answer.call(true))
	n.pressed.connect(func() -> void:
		pop.queue_free()
		on_answer.call(false))


## The weapons: every gauntlet and melee weapon as a tile with its drawn icon; the panel on the right shows the picked one big, with its numbers,
## what it does, a 360 view and (for the gauntlets of the train run) unlock or equip.
var _wpick := "nova_blaster"
var _wtiles := {}
var _wdetail := {}


func _weapon_stats(id: String) -> Array:
	var dmg: float = float(Data.DAMAGE.get(id, {"dmg": 0.0}).dmg)
	if Data.MELEE.has(id):
		var m: Dictionary = Data.MELEE[id]
		return [dmg / 90.0, clampf(1.0 - (float(m.cd) - 0.3) / 1.1, 0.05, 1.0), float(m.reach) / 4.6, 0.0]
	var w: Dictionary = Data.WEAPONS[id]
	var cd := 0.25 + float(w.cd) * 1.1
	return [dmg / 90.0, clampf(1.0 - (cd - 0.4) / 1.0, 0.05, 1.0), float(w.range), float(Data.DAMAGE.get(id, {"cost": 0.0}).cost) / 0.75]


func _build_weapons() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var gp := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	gp.set_anchors_preset(Control.PRESET_TOP_LEFT)
	gp.offset_left = 18
	gp.offset_top = 104
	gp.offset_right = 700
	gp.offset_bottom = 704                  # (the bottom tabs are hidden on this screen)
	var gv := VBoxContainer.new()
	gv.add_theme_constant_override("separation", 8)
	gp.add_child(gv)
	UIKit.label("WEAPONS", gv, 34, UIKit.PURPLE, true)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	gv.add_child(sc)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	sc.add_child(grid)
	for id in Data.WEAPON_ORDER + Data.MELEE_ORDER:
		var t := Button.new()
		t.custom_minimum_size = Vector2(150, 132)
		t.focus_mode = Control.FOCUS_NONE
		t.flat = true
		for st in ["normal", "hover", "pressed", "disabled", "focus"]:
			t.add_theme_stylebox_override(st, StyleBoxEmpty.new())
		var tex: Texture2D = load("res://assets/ui/weapons/%s.png" % id) if ResourceLoader.exists("res://assets/ui/weapons/%s.png" % id) else null
		var wid: String = id
		t.draw.connect(func() -> void:
			var r := Rect2(Vector2(2, 2), t.size - Vector2(4, 4))
			var col: Color = Data.MELEE[wid].color if Data.MELEE.has(wid) else Data.WEAPONS[wid].color
			var picked := wid == _wpick
			t.draw_style_box(UIKit.box(Color(1, 1, 1) if not picked else Color(1.0, 0.95, 0.75), UIKit.INK if not picked else UIKit.PINK, 14, 4 if picked else 3, 3), r)
			t.draw_rect(Rect2(r.position + Vector2(6, 6), Vector2(r.size.x - 12, 6)), col)
			if tex != null:
				t.draw_texture_rect(tex, Rect2(r.position + Vector2(r.size.x * 0.5 - 44, 12), Vector2(88, 88)), false)
			var nm: String = Data.MELEE[wid].name if Data.MELEE.has(wid) else Data.WEAPONS[wid].name
			UIKit.draw_text(t, nm, r.position + Vector2(6, r.size.y - 10), 15, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, r.size.x - 12)
			if not save.is_empty() and not Data.MELEE.has(wid) and not Data.weapon_unlocked(wid, save):
				UIKit.draw_icon(t, "lock", r.position + Vector2(r.size.x - 20, 26), 13, UIKit.YELLOW))
		t.pressed.connect(func() -> void:
			_wpick = wid
			_refresh_weapons())
		grid.add_child(t)
		_wtiles[id] = t
	var ip := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.95), 24)
	ip.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	ip.anchor_left = 1.0
	ip.anchor_right = 1.0
	ip.offset_left = -560
	ip.offset_right = -18
	ip.offset_top = 104
	ip.offset_bottom = 628
	var iv := VBoxContainer.new()
	iv.add_theme_constant_override("separation", 6)
	ip.add_child(iv)
	var big := Control.new()
	big.custom_minimum_size = Vector2(0, 150)
	big.draw.connect(func() -> void:
		var tex2: Texture2D = load("res://assets/ui/weapons/%s.png" % _wpick) if ResourceLoader.exists("res://assets/ui/weapons/%s.png" % _wpick) else null
		var col2: Color = Data.MELEE[_wpick].color if Data.MELEE.has(_wpick) else Data.WEAPONS[_wpick].color
		big.draw_circle(Vector2(big.size.x * 0.5, 75), 70, Color(col2.r, col2.g, col2.b, 0.25))
		if tex2 != null:
			big.draw_texture_rect(tex2, Rect2(Vector2(big.size.x * 0.5 - 75, 0), Vector2(150, 150)), false))
	iv.add_child(big)
	var nm2 := UIKit.label("", iv, 32, UIKit.PINK, true)
	nm2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm2.clip_text = true
	var kind := UIKit.label("", iv, 16, UIKit.PURPLE)
	kind.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	kind.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	kind.add_theme_constant_override("outline_size", 0)
	var bars := Control.new()
	bars.custom_minimum_size = Vector2(0, 104)
	bars.draw.connect(func() -> void:
		var v := _weapon_stats(_wpick)
		var labels := ["DAMAGE", "FIRE RATE", "RANGE", "CHARGE USE"]
		var cols := [UIKit.PINK, UIKit.ORANGE, UIKit.SKY, UIKit.MINT]
		for i in 4:
			var y := 6.0 + i * 25.0
			UIKit.draw_text(bars, labels[i], Vector2(10, y + 16), 15, UIKit.INK, false, HORIZONTAL_ALIGNMENT_LEFT, 120)
			var r := Rect2(Vector2(140, y + 3), Vector2(bars.size.x - 160, 16))
			bars.draw_style_box(UIKit.box(Color(0.85, 0.82, 0.9), UIKit.INK, 8, 3, 0), r)
			var f: float = clampf(float(v[i]), 0.0, 1.0)
			if i == 3 and Data.MELEE.has(_wpick):
				UIKit.draw_text(bars, "NO AMMO", r.position + Vector2(8, 13), 13, UIKit.INK, false, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 16)
			elif f > 0.02:
				bars.draw_style_box(UIKit.box(cols[i], UIKit.INK, 8, 3, 0), Rect2(r.position, Vector2(maxf(16.0, r.size.x * f), r.size.y))))
	iv.add_child(bars)
	var note := UIKit.label("", iv, 16, UIKit.INK)
	note.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	note.add_theme_constant_override("outline_size", 0)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(500, 62)
	note.max_lines_visible = 3
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	iv.add_child(row)
	var vb := UIKit.button("3D VIEW", row, "cube", UIKit.SKY, Vector2(200, 60), 24)
	vb.pressed.connect(func() -> void: weapon_view.emit(_wpick))
	var act := UIKit.button("", row, "check", UIKit.MINT, Vector2(300, 60), 22)
	act.pressed.connect(func() -> void: weapon_action.emit(_wpick))
	_wdetail = {"big": big, "name": nm2, "kind": kind, "bars": bars, "note": note, "act": act}
	return root


func _refresh_weapons() -> void:
	if _wdetail.is_empty():
		return
	var id := _wpick
	var melee := Data.MELEE.has(id)
	(_wdetail.name as Label).text = String(Data.MELEE[id].name if melee else Data.WEAPONS[id].name)
	(_wdetail.kind as Label).text = ("Melee  ·  everybody can pick it up" if melee else "Gauntlet  ·  %s  ·  level %d" % [String(Data.WEAPONS[id].kind), int(Data.WEAPONS[id].level)])
	(_wdetail.note as Label).text = String(Data.MELEE[id].note if melee else Data.WEAPONS[id].note)
	var act: UIKit.AnimeButton = _wdetail.act
	if melee:
		act.text = "FOUND IN MATCHES"
		act.disabled = true
	else:
		var why := Data.weapon_buyable(id, save) if not save.is_empty() else ""
		if why == "owned":
			act.text = "EQUIPPED" if String(save.get("weapon", "")) == id else "EQUIP"
			act.disabled = false
		elif why == "":
			act.text = "UNLOCK  $%d" % int(Data.WEAPONS[id].price)
			act.disabled = false
		else:
			act.text = why.to_upper()
			act.disabled = true
	act.accent = UIKit.MINT if not act.disabled else Color(0.65, 0.62, 0.8)
	for k in _wdetail:
		if _wdetail[k] is Control:
			(_wdetail[k] as Control).queue_redraw()
	for t in _wtiles.values():
		(t as Control).queue_redraw()


## The 360 viewer: the model stands on the stage behind this screen; drag to turn it, pinch or wheel to zoom, the arrows step through the list.
func _build_view() -> Control:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var pad := Control.new()
	pad.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	pad.mouse_filter = Control.MOUSE_FILTER_STOP
	var touches := {}
	pad.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseMotion and (ev.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
			view_drag.emit(ev.relative)
		elif ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_WHEEL_UP:
			view_zoom.emit(1.1)
		elif ev is InputEventMouseButton and ev.pressed and ev.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			view_zoom.emit(0.91)
		elif ev is InputEventMagnifyGesture:
			view_zoom.emit(ev.factor)
		elif ev is InputEventScreenTouch:
			if ev.pressed:
				touches[ev.index] = ev.position
			else:
				touches.erase(ev.index)
		elif ev is InputEventScreenDrag:
			if touches.size() >= 2 and touches.has(ev.index):
				var before := (touches.values()[0] as Vector2).distance_to(touches.values()[1])
				touches[ev.index] = ev.position
				var after := (touches.values()[0] as Vector2).distance_to(touches.values()[1])
				if before > 20.0:
					view_zoom.emit(clampf(after / before, 0.8, 1.25))
			else:
				touches[ev.index] = ev.position
				view_drag.emit(ev.relative))
	root.add_child(pad)
	var cats := HBoxContainer.new()
	cats.position = Vector2(18, 108)
	cats.add_theme_constant_override("separation", 10)
	root.add_child(cats)
	var cb := {}
	for c in [["heroes", "HEROES", "user", UIKit.PINK], ["weapons", "WEAPONS", "sword", UIKit.PURPLE], ["rides", "RIDES", "wheel", UIKit.ORANGE]]:
		var b := UIKit.button(String(c[1]), cats, String(c[2]), c[3], Vector2(190, 56), 22)
		b.pressed.connect(func() -> void: view_cat.emit(String(c[0])))
		cb[String(c[0])] = b
	_info["view"] = {"cats": cb}
	var p := UIKit.panel(root, Color(0.99, 0.95, 0.88, 0.96), 22)
	p.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	p.anchor_left = 1.0
	p.anchor_right = 1.0
	p.anchor_top = 1.0
	p.anchor_bottom = 1.0
	p.offset_left = -560
	p.offset_right = -18
	p.offset_top = -190
	p.offset_bottom = -14
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	p.add_child(v)
	var hdr := HBoxContainer.new()
	hdr.add_theme_constant_override("separation", 8)
	v.add_child(hdr)
	var prev := UIKit.button("", hdr, "back", UIKit.SKY, Vector2(64, 52))
	prev.pressed.connect(func() -> void: view_step.emit(-1))
	var nm := UIKit.label("", hdr, 28, UIKit.PINK, true)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.clip_text = true
	nm.custom_minimum_size = Vector2(300, 0)
	var nxt := UIKit.button("", hdr, "next", UIKit.SKY, Vector2(64, 52))
	nxt.pressed.connect(func() -> void: view_step.emit(1))
	var kind := UIKit.label("", v, 16, UIKit.PURPLE)
	kind.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	kind.add_theme_constant_override("outline_size", 0)
	var note := UIKit.label("", v, 16, UIKit.INK)
	note.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0))
	note.add_theme_constant_override("outline_size", 0)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(500, 66)
	note.max_lines_visible = 3
	_info["view"]["name"] = nm
	_info["view"]["kind"] = kind
	_info["view"]["note"] = note
	return root


## What the viewer shows now: a name, a line about its kind and a description.
func set_view_info(cat: String, title: String, kind: String, note: String) -> void:
	var v: Dictionary = _info.get("view", {})
	if v.is_empty():
		return
	(v.name as Label).text = title
	(v.kind as Label).text = kind
	(v.note as Label).text = note
	for k in v.cats:
		(v.cats[k] as UIKit.AnimeButton).accent = [UIKit.PINK, UIKit.PURPLE, UIKit.ORANGE][["heroes", "weapons", "rides"].find(k)] if k == cat else Color(0.62, 0.58, 0.78)
		(v.cats[k] as Control).queue_redraw()


# ── state ────────────────────────────────────────────────────────────────────

func show_screen(name: String) -> void:
	screen = name
	screen_changed.emit(name)
	for k in screens:
		(screens[k] as Control).visible = (k == name)
	if not _tabs.is_empty():
		# the bottom tabs belong to the three main screens; the others have their own back button and the tabs covered their lists
		(_tabs.values()[0] as Control).get_parent().visible = name in ["home", "chars", "shop"]
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
	if name == "weapons":
		_refresh_weapons()
	if name == "friends" or name == "squad":
		refresh_friends()


func _skill_points(id: String) -> int:
	var n := 0
	for sid in Data.SKILL_ORDER:
		n += Data.skill_level(save, id, sid)
	return n


func _refresh_skills() -> void:
	if _skill_card == null or save.is_empty():
		return
	_skill_card.hero_id = browsing
	_skill_card.skill_total = _skill_points(browsing)
	_skill_head.text = "%s: SKILLS" % String(Data.CAST[browsing].get("short", Data.CAST[browsing].name))
	for sid in _skill_rows:
		var lv := Data.skill_level(save, browsing, sid)
		var why := Data.skill_buyable(save, browsing, sid)
		var btn: UIKit.AnimeButton = _skill_rows[sid].button
		btn.text = "MAX" if lv >= Data.SKILL_MAX else "$%d" % Data.skill_cost(lv, sid)
		btn.disabled = why != ""
		btn.accent = UIKit.MINT if why == "" else Color(0.65, 0.62, 0.8)
		btn.queue_redraw()
		(_skill_rows[sid].row as Control).queue_redraw()


func set_save(s: Dictionary) -> void:
	save = s
	browsing = String(save.get("char", browsing))
	_refresh()
	_refresh_weapons()


func _refresh_chips() -> void:
	for k in _match_chips:
		var c := _match_chips[k] as UIKit.AnimeButton
		c.accent = UIKit.SKY if k == _match_pick else Color(0.6, 0.6, 0.75)
		c.queue_redraw()


func _refresh() -> void:
	if _top_name == null or save.is_empty():
		return
	_top_name.text = String(save.get("name", "PLAYER"))
	_top_sub.text = ("UID %d  ·  " % social.uid if social != null else "") + "%d matches · %d wins" % [int(save.get("matches", 0)), int(save.get("wins", 0))]
	_top_coins.text = str(int(save.get("coins", 0)))
	_level_badge.queue_redraw()
	if _name_in != null and not _name_in.has_focus():
		_name_in.text = String(save.get("name", "PLAYER"))
		var st: Dictionary = save.get("settings", {})
		_assist = clampi(int(st.get("assist", 2)), 0, 2)
		_assist_btn.text = _assist_text()
		_gfx = clampi(int(st.get("gfx", 1)), 0, 2)
		_gfx_btn.text = "GRAPHICS: " + Gfx.NAMES[_gfx]
		_sens_in.set_value_no_signal(float(st.get("sens", 1.0)))
		_sens_val.text = "LOOK SPEED  x%.2f" % _sens_in.value
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
		(inf.role as Label).text = "%s  ·  %s" % [String(d.get("title", "")), String(d.role)]
		(inf.card as HeroCard).hero_id = browsing
		(inf.card as HeroCard).locked = not Data.char_owned(browsing, save)
		(inf.card as HeroCard).skill_total = _skill_points(browsing)
		(inf.skills as UIKit.AnimeButton).disabled = not Data.char_owned(browsing, save)
		(inf.skills as Control).queue_redraw()
		(inf.pts as Label).text = "Skill levels: %d / %d" % [_skill_points(browsing), Data.SKILL_MAX * Data.SKILL_ORDER.size()]
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
	_refresh_skills()
	var rec := (screens["settings"] as Control).find_child("Record", true, false)
	if rec != null:
		(rec as Label).text = "Best run: %d m   ·   %d matches   ·   %d wins" % [int(save.get("best", 0)), int(save.get("matches", 0)), int(save.get("wins", 0))]


## The online room (or the search): `info` = {state: "none"|"searching"|"room", code, status, players: [{name, team, host, you}], host: bool, max}.
func set_status(text: String) -> void:
	if _status != null:
		_status.text = text


func set_room(info: Dictionary) -> void:
	_room = info
	if String(info.get("state", "")) == "room" and not bool(info.get("quick", false)) and String(info.get("code", "")) != "WI-FI":
		if screen != "squad":
			show_screen("squad")
		refresh_squad()
	if _status == null:
		return
	_status.text = String(info.get("status", ""))
	for c in _room_box.get_children():
		c.queue_free()
	if String(info.get("state", "none")) == "lan":
		var hosts: Array = info.get("hosts", [])
		var hl := HBoxContainer.new()
		hl.add_theme_constant_override("separation", 10)
		_room_box.add_child(hl)
		for h in hosts.slice(0, 3):
			var ip: String = h.ip
			var b := UIKit.button("JOIN %s" % String(h.name), hl, "play", UIKit.MINT, Vector2(300, 60), 22, "%s  ·  %d players" % [ip, int(h.players)])
			b.pressed.connect(func() -> void: lan_join.emit(ip))
		return
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
