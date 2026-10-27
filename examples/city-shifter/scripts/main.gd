class_name Main
extends Node
## City Shifter: Sky Siege. The lobby (a light 3D scene: a pad, the chosen survivor turning slowly, the menus), the armory (15 weapons), and the run: a train roof
## under a rain of blocks, one to eight players, crossing coupling gaps with bridge slabs and jetpacks, breaking the debris with the gauntlet for coins.
## Only the lobby exists until PLAY: the train world, the debris pool and the effects are built then and freed on the way back.

enum State { LOBBY, ARMORY, PLAY, PAUSE }

var state := State.LOBBY
var save := {}
var audio: Audio
var fx: Fx
var hud: GameHUD
var net: MultiplayerController
var world                              # TrainWorld or OpenWorld (same members)
var online: OnlineSession
var loading: LoadingScreen
var _loading_now := false
var _emote_i := -1
var _start_sent := false
var mc: MatchController                # the open-world match (score, bots, loot, respawns)
var match_type := "solo"               # "solo" or "team" (teams of 4)
var mode := "train"                     # "train" (the roof run) or "world" (the open world with vehicles and horses)
var spawner: OptimizedSkySpawner
var player: PlayerController
var remotes := {}                       # peer id -> PlayerController
var sel := 0
var round_no := 1
var run_coins := 0
var run_start_z := 0.0
var best_run := 0.0
var fps_avg := 60.0
var autostart := false
var bot_mode := false
var skydive := true                     # a match begins in the sky (tests switch it off)
var _shake := 0.0
var _net_t := 0.0
var _debris_t := 0.0
var _fps_t := 0.0
var _fps_n := 0
var _fps_sum := 0.0
var _goal_cd := 0.0
var _slot := 0
var _clock := 0.0
# the lobby
var lobby3d: Node3D
var lobby_env: WorldEnvironment            # taken out of the tree during a run: only one WorldEnvironment may be active
var lobby_cam: Camera3D
var preview: Avatar
var view_pivot: Node3D                  # the model in the 360 viewer
var view_cat := "heroes"
var view_i := 0
var _view_touch_t := 0.0                # >0 while a finger has just turned the model: it stops spinning by itself
var _view_zoom := 1.0
var _view_wheels: Array = []
var ui: CanvasLayer
var lobby_root: Control
var lobby: LobbyUI
var armory_root: Control
var pause_root: Control
var bars := {}
var weapon_cards := {}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a == "--autostart":
			autostart = true
		elif a == "--bot":
			bot_mode = true
		elif a == "--world":
			mode = "world"
		elif a.begins_with("--char="):
			sel = maxi(0, Data.CAST_ORDER.find(a.substr(7)))
	save = Data.load_save()
	if not OS.get_cmdline_user_args().has("--fresh"):
		sel = maxi(sel, Data.CAST_ORDER.find(String(save.get("char", "outlaw"))))
	audio = Audio.new()
	add_child(audio)
	net = MultiplayerController.new()
	net.name = "Net"
	add_child(net)
	net.status_changed.connect(_on_net_status)
	net.code_ready.connect(_on_code_ready)
	net.peer_joined.connect(_on_peer_joined)
	net.peer_left.connect(_on_peer_left)
	net.ping_updated.connect(func(ms: int) -> void: hud.ping_ms = ms)
	net.state_received.connect(_on_state)
	net.debris_received.connect(func(p: PackedFloat32Array) -> void:
		if spawner != null and not spawner.authority:
			spawner.apply_snapshot(p))
	net.shot_received.connect(_on_remote_shot)
	net.fx_received.connect(_on_remote_fx)
	net.slab_received.connect(_on_remote_slab)
	net.event_received.connect(_on_event)
	net.hit_received.connect(_on_hit)
	net.report_received.connect(_on_report)
	lan = LanBeacon.new()
	add_child(lan)
	lan.found.connect(func(_ip: String, _n: String, _c: int) -> void:
		var hosts := []
		for ip in lan.heard:
			hosts.append({"ip": ip, "name": String(lan.heard[ip][0]), "players": int(lan.heard[ip][1])})
		lobby.set_room({"state": "lan", "status": "Games on this Wi-Fi:", "hosts": hosts}))
	net.connected.connect(func() -> void:
		if _lan_mode:
			await get_tree().create_timer(0.4).timeout
			_lan_room())
	online = OnlineSession.new()
	online.name = "Online"
	add_child(online)
	online.setup(net, String(save.get("server", Data.MATCH_SERVER)))
	get_tree().set_auto_accept_quit(false)
	online.match_ready.connect(func() -> void:
		mode = "world"
		match_type = online.mt
		begin_match())
	online.offline_instead.connect(func(mt: String) -> void:
		mode = "world"
		match_type = mt
		await begin_match()
		hud.toast("Nobody else was online — bots will fill the match", 3.6))
	hud = GameHUD.new()
	add_child(hud)
	hud.jump_down.connect(func() -> void:
		if player != null:
			player.jet_held = true
			player.press_jump())
	hud.jump_up.connect(func() -> void:
		if player != null:
			player.jet_held = false)
	hud.fire_down.connect(func() -> void: _fire())
	hud.bridge_pressed.connect(_bridge)
	hud.ride_pressed.connect(_ride)
	hud.results_closed.connect(func() -> void:
		hud.results = {}
		end_run())
	hud.block_pressed.connect(func() -> void:
		if player != null:
			var k := player.tool.cycle_block()
			hud.block_name = String(Data.BLOCKS[k].name)
			hud.block_color = Data.BLOCKS[k].color
			hud.toast("%s — %s" % [Data.BLOCKS[k].name, Data.BLOCKS[k].note]))
	hud.weapon_chosen.connect(_equip)
	hud.pause_pressed.connect(func() -> void: set_pause(state == State.PLAY))
	hud.net_pressed.connect(func() -> void: hud.show_net(not hud.net_panel.visible))
	hud.host_btn.pressed.connect(func() -> void:
		net.char_id = Data.CAST_ORDER[sel]
		if net.host():
			hud.show_code("")
			_refresh_lobby())
	hud.join_btn.pressed.connect(func() -> void:
		net.char_id = Data.CAST_ORDER[sel]
		hud.show_code("")
		net.join_start())
	hud.accept_btn.pressed.connect(func() -> void: net.host_accept(hud.code_in.text))
	hud.finish_btn.pressed.connect(func() -> void: net.join_finish(hud.code_in.text))
	var grade := CanvasLayer.new()           # the anime colour grade over the whole 3D picture (under the HUD and the menus)
	grade.layer = 1
	add_child(grade)
	var cr := ColorRect.new()
	cr.set_anchors_preset(Control.PRESET_FULL_RECT)
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var gm := ShaderMaterial.new()
	gm.shader = load("res://shaders/grade.gdshader") as Shader
	cr.material = gm
	grade.add_child(cr)
	_build_lobby()
	_enter_lobby()
	if autostart:
		await get_tree().process_frame
		start_play()


# ── the lobby ────────────────────────────────────────────────────────────────

func _build_lobby() -> void:
	# the stage: a pastel anime sky, a round platform under the hero, cherry trees, a torii gate and lanterns, petals drifting down
	lobby3d = Node3D.new()
	add_child(lobby3d)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Anime.sky()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 1.0
	env.fog_enabled = true
	env.fog_light_color = Color(1.0, 0.86, 0.9)
	env.fog_density = 0.012
	lobby_env = WorldEnvironment.new()
	lobby_env.environment = env
	lobby3d.add_child(lobby_env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, 35, 0)
	sun.light_color = Color(1.0, 0.92, 0.82)
	sun.light_energy = 1.3
	lobby3d.add_child(sun)
	var rim := OmniLight3D.new()
	rim.position = Vector3(-2.2, 2.0, -1.8)
	rim.light_color = Color(1.0, 0.6, 0.85)
	rim.light_energy = 2.2
	rim.omni_range = 9.0
	lobby3d.add_child(rim)
	var rim2 := OmniLight3D.new()
	rim2.position = Vector3(2.4, 1.8, -1.5)
	rim2.light_color = Color(0.5, 0.8, 1.0)
	rim2.light_energy = 1.8
	rim2.omni_range = 9.0
	lobby3d.add_child(rim2)
	# the ground and the platform
	var ground := MeshInstance3D.new()
	var gm := PlaneMesh.new()
	gm.size = Vector2(120, 120)
	ground.mesh = gm
	var gs := ShaderMaterial.new()
	gs.shader = load("res://shaders/ground.gdshader") as Shader
	ground.material_override = gs
	ground.position.y = -0.16
	lobby3d.add_child(ground)
	Mat.cyl(lobby3d, Vector3(0, -0.06, 0), 1.25, 0.2, Mat.flat(Color(0.98, 0.92, 0.85)))
	Mat.cyl(lobby3d, Vector3(0, 0.045, 0), 1.0, 0.02, Mat.flat(Color(1.0, 0.45, 0.65), 0.7))
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 1.22
	tm.outer_radius = 1.32
	ring.mesh = tm
	ring.position.y = 0.04
	ring.material_override = Mat.unlit(Color(1.0, 0.85, 0.35))
	lobby3d.add_child(ring)
	# scenery from the real world models
	var put := func(path: String, pos: Vector3, length: float, yaw: float) -> void:
		var m := ModelKit.fitted(path, length, "bottom")
		if m != null:
			m.position = pos
			m.rotation.y = yaw
			lobby3d.add_child(m)
			Anime.style(m)
	put.call("res://assets/world/torii.glb", Vector3(0, 0, -7.5), 6.0, 0.0)
	put.call("res://assets/world/stone_lantern.glb", Vector3(-3.0, 0, -3.5), 1.6, 0.3)
	put.call("res://assets/world/stone_lantern.glb", Vector3(3.0, 0, -3.5), 1.6, -0.3)
	for i in 7:
		var a := lerpf(-1.2, 1.2, float(i) / 6.0) + 0.0
		put.call("res://assets/world/cherry_tree.glb", Vector3(sin(a) * 9.0 + (-3.0 if i % 2 == 0 else 3.0), 0, -cos(a) * 9.0 - 1.0 - float(i % 3) * 2.0), 5.0 + float(i % 3), float(i))
	put.call("res://assets/world/pagoda.glb", Vector3(-9.0, 0, -14.0), 9.0, 0.5)
	put.call("res://assets/world/windmill.glb", Vector3(10.0, 0, -13.0), 8.0, -0.4)
	var petals := CPUParticles3D.new()
	petals.amount = 70
	petals.lifetime = 8.0
	petals.preprocess = 8.0
	petals.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	petals.emission_box_extents = Vector3(8, 0.5, 5)
	petals.position = Vector3(0, 6.0, -2.0)
	petals.direction = Vector3(0.5, -1, 0.2)
	petals.spread = 30.0
	petals.initial_velocity_min = 0.5
	petals.initial_velocity_max = 1.2
	petals.gravity = Vector3(0.3, -0.5, 0.1)
	petals.angular_velocity_min = -150.0
	petals.angular_velocity_max = 150.0
	var qm := QuadMesh.new()
	qm.size = Vector2(0.14, 0.09)
	petals.mesh = qm
	petals.material_override = Mat.unlit(Color(1.0, 0.72, 0.82))
	lobby3d.add_child(petals)
	lobby_cam = Camera3D.new()
	lobby_cam.position = Vector3(0.0, 1.25, 3.6)
	lobby_cam.fov = 36.0
	lobby3d.add_child(lobby_cam)
	lobby_cam.look_at(Vector3(0, 1.0, 0))
	lobby_cam.make_current()
	_build_ui()
	_show_preview()


func _style(bg: Color, border := Color(1, 1, 1, 0.6)) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(14)
	s.border_color = border
	s.set_border_width_all(2)
	return s


func _btn(text: String, parent: Control, size := Vector2(300, 64), accent := Color(1, 1, 1, 0.6)) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = size
	b.add_theme_font_size_override("font_size", 22)
	b.add_theme_stylebox_override("normal", _style(Color(1, 1, 1, 0.1), accent))
	b.add_theme_stylebox_override("hover", _style(Color(1, 0.62, 0.25, 0.3), accent))
	b.add_theme_stylebox_override("pressed", _style(Color(1, 0.62, 0.25, 0.5), accent))
	b.add_theme_stylebox_override("disabled", _style(Color(1, 1, 1, 0.04), Color(1, 1, 1, 0.2)))
	b.pressed.connect(func() -> void: audio.play("ui", -6.0))
	parent.add_child(b)
	return b


func _lbl(text: String, parent: Control, size := 20, col := Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	l.add_theme_constant_override("outline_size", 4)
	parent.add_child(l)
	return l


func _build_ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 20
	add_child(ui)
	# ── the lobby screen (the anime menu: scripts/lobby_ui.gd)
	social = FirebaseSocialManager.new()
	social.name = "Social"
	add_child(social)
	if String(save.get("name", "PLAYER")) != "PLAYER":
		social.set_player_name(String(save.name))
	lobby = LobbyUI.new()
	lobby.social = social
	lobby_root = lobby
	ui.add_child(lobby)
	lobby.set_save(save)
	lobby.play_offline.connect(func(m: String, mt: String) -> void:
		mode = m
		match_type = mt
		begin_match())
	lobby.open_armory.connect(func() -> void: _open_armory(true))
	lobby.char_preview.connect(func(id: String) -> void:
		sel = maxi(0, Data.CAST_ORDER.find(id))
		_show_preview())
	lobby.char_selected.connect(func(id: String) -> void:
		sel = maxi(0, Data.CAST_ORDER.find(id))
		save.char = id
		Data.write_save(save)
		audio.play("ui", -4.0)
		_show_preview()
		lobby.set_save(save))
	lobby.char_bought.connect(_buy_char)
	lobby.hero_tapped.connect(func() -> void:
		if preview != null:
			_emote_i = (_emote_i + 1) % CMPoses.EMOTES.size()
			preview.play_emote(CMPoses.EMOTES[_emote_i])
			audio.play("ui", -6.0, 1.0 + 0.1 * float(_emote_i)))
	lobby.skill_bought.connect(func(_hero: String, _skill: String) -> void:
		Data.write_save(save)
		audio.play("coin", -4.0, 1.5)
		lobby.set_save(save))
	lobby.screen_changed.connect(func(n: String) -> void:
		if n != "squad":
			_clear_squad()
		if preview != null:
			preview.visible = n == "home"
		if n == "view":
			view_cat = "heroes"
			view_i = sel
			_view_zoom = 1.0
			_view_show()
		else:
			_view_clear())
	lobby.view_drag.connect(_on_view_drag)
	lobby.weapon_action.connect(func(id: String) -> void:
		if Data.WEAPONS.has(id):
			_card_pressed(id)
			lobby.set_save(save))
	lobby.weapon_view.connect(func(id: String) -> void:
		lobby.show_screen("view")
		view_cat = "weapons"
		view_i = (Data.WEAPON_ORDER + Data.MELEE_ORDER).find(id)
		_view_show())
	lobby.view_zoom.connect(func(f: float) -> void:
		_view_zoom = clampf(_view_zoom * f, 0.5, 2.2)
		if view_pivot != null:
			view_pivot.scale = Vector3.ONE * _view_zoom * float(view_pivot.get_meta("base", 1.0)))
	lobby.view_cat.connect(func(c: String) -> void:
		view_cat = c
		view_i = sel if c == "heroes" else 0
		_view_show())
	lobby.view_step.connect(func(d: int) -> void:
		view_i = posmod(view_i + d, _view_ids().size())
		audio.play("ui", -6.0)
		_view_show())
	lobby.name_changed.connect(func(n: String) -> void:
		save.name = n if n != "" else "PLAYER"
		Data.write_save(save)
		social.set_player_name(String(save.name))
		lobby.set_save(save))
	lobby.friend_add.connect(func(u: int) -> void:
		if social.add_friend(u):
			audio.play("ui", -4.0))
	lobby.friend_remove.connect(func(u: int) -> void: social.remove_friend(u))
	lobby.squad_invite.connect(func(u: int) -> void:
		social.invite(u, String(lobby._room.get("code", "")), match_type))
	lobby.squad_ready.connect(func(on: bool) -> void: online.set_ready(on))
	social.friends_changed.connect(func() -> void: lobby.refresh_friends())
	social.request_received.connect(func(u: int, n: String) -> void:
		lobby.ask("%s (UID %d) added you as a friend. Add them back?" % [n, u], "ADD BACK", "NO", func(yes: bool) -> void:
			if yes:
				social.add_friend(u, n)))
	social.invite_received.connect(func(_u: int, n: String, code: String, mt: String) -> void:
		if state != State.LOBBY or code == "":
			return
		lobby.ask("%s invites you to the Squad Lobby!" % n, "ACCEPT", "DECLINE", func(yes: bool) -> void:
			if yes:
				lobby.show_screen("online")
				_online_request("join", mt, code)))
	lobby.settings_changed.connect(func(sens: float, assist: int) -> void:
		save.settings = {"sens": sens, "assist": assist}
		Data.write_save(save)
		_apply_settings())
	lobby.debug_toggled.connect(func(on: bool) -> void: hud.debug_overlay = on)
	lobby.sound_toggled.connect(func(muted: bool) -> void: audio.set_muted(muted))
	lobby.play_online.connect(_online_request)
	online.room_info.connect(func(info: Dictionary) -> void:
		lobby.set_room(info)
		if String(info.get("state", "")) == "room" and not bool(info.get("quick", false)):
			social.room_code = String(info.get("code", ""))
			_show_squad(info.get("players", [])))
	online.status.connect(lobby.set_status)
	online.failed.connect(func(msg: String) -> void: lobby.set_room({"state": "none", "status": msg}))
	lobby.leave_online.connect(_online_leave)
	lobby.start_room.connect(_online_start)
	lobby.lan_host.connect(_lan_host)
	lobby.lan_find.connect(func() -> void:
		_lan_mode = false
		net.reset()
		lan.start_find()
		lobby.set_room({"state": "lan", "status": "Looking for games on this Wi-Fi… (the host taps HOST ON WI-FI)", "hosts": []}))
	lobby.lan_join.connect(func(ip: String) -> void:
		_lan_mode = true
		lan.stop()
		net.char_id = Data.CAST_ORDER[sel]
		if net.join_lan(ip):
			lobby.set_room({"state": "none", "status": "Joining the game on %s…" % ip}))
	# ── the armory
	armory_root = Control.new()
	armory_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	armory_root.visible = false
	var shade := ColorRect.new()
	shade.color = Color(0.03, 0.05, 0.14, 0.95)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	armory_root.add_child(shade)
	ui.add_child(armory_root)
	var at := _lbl("ARMORY — KINETIC & GRAVITY GAUNTLETS", armory_root, 28, Color(1, 1, 1))
	at.position = Vector2(36, 14)
	var back := _btn("BACK", armory_root, Vector2(150, 50))
	back.position = Vector2(1094, 12)
	back.pressed.connect(func() -> void: _open_armory(false))
	var grid := GridContainer.new()
	grid.columns = 5
	grid.position = Vector2(26, 70)
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	armory_root.add_child(grid)
	for id in Data.WEAPON_ORDER:
		grid.add_child(_make_card(id))
	# ── the pause screen
	pause_root = Control.new()
	pause_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_root.visible = false
	var ps := ColorRect.new()
	ps.color = Color(0.02, 0.04, 0.12, 0.7)
	ps.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_root.add_child(ps)
	ui.add_child(pause_root)
	var pv := VBoxContainer.new()
	pv.position = Vector2(490, 190)
	pv.add_theme_constant_override("separation", 14)
	pause_root.add_child(pv)
	_lbl("PAUSED", pv, 40)
	var resume := _btn("RESUME", pv)
	resume.pressed.connect(func() -> void: set_pause(false))
	var gfx := _btn("GRAPHICS: AUTO", pv)
	gfx.pressed.connect(func() -> void:
		_cycle_view(gfx))
	var snd := _btn("SOUND: ON", pv)
	snd.pressed.connect(func() -> void:
		audio.set_muted(not audio.muted)
		snd.text = "SOUND: OFF" if audio.muted else "SOUND: ON")
	var quit := _btn("LEAVE THE TRAIN", pv)
	quit.pressed.connect(func() -> void: end_run())


func _make_card(id: String) -> Control:
	var w: Dictionary = Data.WEAPONS[id]
	var pc := PanelContainer.new()
	pc.custom_minimum_size = Vector2(238, 196)
	var col: Color = w.color
	pc.add_theme_stylebox_override("panel", _style(Color(0.07, 0.1, 0.22, 0.9), Color(col.r, col.g, col.b, 0.8)))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 3)
	pc.add_child(v)
	_lbl(String(w.name), v, 16, col.lightened(0.3))
	for k in [["RANGE", "range"], ["FORCE", "force"], ["CD", "cd"]]:
		var h := HBoxContainer.new()
		v.add_child(h)
		var kl := _lbl(k[0], h, 11, Color(1, 1, 1, 0.7))
		kl.custom_minimum_size = Vector2(48, 0)
		var pb := ProgressBar.new()
		pb.custom_minimum_size = Vector2(120, 9)
		pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		pb.show_percentage = false
		pb.max_value = 1.0
		pb.value = float(w[k[1]])
		h.add_child(pb)
	var note := _lbl(String(w.note), v, 11, Color(1, 1, 1, 0.65))
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(210, 0)
	var b := _btn("", v, Vector2(210, 40), col)
	b.add_theme_font_size_override("font_size", 15)
	b.pressed.connect(func() -> void: _card_pressed(id))
	weapon_cards[id] = b
	return pc


func _refresh_cards() -> void:
	for id in Data.WEAPON_ORDER:
		var b: Button = weapon_cards[id]
		var why := Data.weapon_buyable(id, save)
		if why == "owned":
			b.text = "EQUIPPED" if String(save.get("weapon", "")) == id else "EQUIP"
			b.disabled = false
		elif why == "":
			b.text = "UNLOCK  $%d" % int(Data.WEAPONS[id].price)
			b.disabled = false
		else:
			b.text = why.to_upper()
			b.disabled = true


func _card_pressed(id: String) -> void:
	var why := Data.weapon_buyable(id, save)
	if why == "":
		save.coins = int(save.coins) - int(Data.WEAPONS[id].price)
		(save.weapons as Array).append(id)
		audio.play("coin")
	if Data.weapon_unlocked(id, save):
		save.weapon = id
	Data.write_save(save)
	_refresh_cards()
	_refresh_lobby()


func _open_armory(on: bool) -> void:
	armory_root.visible = on
	lobby_root.visible = not on
	state = State.ARMORY if on else State.LOBBY
	_refresh_cards()


func _show_preview() -> void:
	if preview != null:
		preview.queue_free()
	preview = Avatar.new()
	lobby3d.add_child(preview)
	preview.setup(Data.CAST_ORDER[sel])
	preview.visible = lobby == null or lobby.screen == "home"


## Look speed and aim assist from the save, on the touch HUD and on my hero.
func _apply_settings() -> void:
	var st: Dictionary = save.get("settings", {})
	if hud != null:
		hud.look_sens = 0.0042 * clampf(float(st.get("sens", 1.0)), 0.5, 2.0)
	if player != null and is_instance_valid(player):
		player.assist_level = clampi(int(st.get("assist", 2)), 0, 2)


func _refresh_lobby() -> void:
	if lobby != null:
		lobby.set_save(save)


## Buy a hero in the shop.
func _buy_char(id: String) -> void:
	if Data.char_buyable(id, save) != "":
		return
	save.coins = int(save.coins) - int(Data.CAST[id].price)
	(save.chars as Array).append(id)
	save.char = id
	Data.write_save(save)
	sel = maxi(0, Data.CAST_ORDER.find(id))
	audio.play("coin", 0.0, 1.2)
	_show_preview()
	lobby.set_save(save)


## ONLINE: the matchmaking server finds the players (quick match) or hosts a custom room; OnlineSession then opens the WebRTC star.
func _online_request(kind: String, mt: String, code: String) -> void:
	match_type = mt
	if not MultiplayerController.available():
		lobby.set_room({"state": "none", "status": "Online play needs WebRTC, which this build does not have. Solo and team matches with bots work offline."})
		return
	if kind == "join" and code.length() < 4:
		lobby.set_room({"state": "none", "status": "Type the room code first"})
		return
	lobby.set_room({"state": "none", "status": "Looking for players over the internet…"})
	online.guest_uid = social.uid
	online.begin(kind, mt, code, String(save.get("name", "PLAYER")), Data.CAST_ORDER[sel])


# ── the squad lobby: up to 4 heroes on pedestals, the host in the middle ───────

var social: FirebaseSocialManager
var _squad_nodes: Array = []
const SQUAD_SLOTS := [Vector3(-0.55, 0, 0.0), Vector3(-1.5, 0, -0.5), Vector3(0.4, 0, -0.5), Vector3(-2.35, 0, -1.0)]


func _show_squad(players: Array) -> void:
	_clear_squad()
	if preview != null:
		preview.visible = false
	for i in mini(4, players.size()):
		var pl: Dictionary = players[i]
		var slot := Node3D.new()
		slot.position = SQUAD_SLOTS[i]
		lobby3d.add_child(slot)
		_squad_nodes.append(slot)
		Mat.cyl(slot, Vector3(0, 0.03, 0), 0.42, 0.06, Mat.flat(Color(1.0, 0.85, 0.35) if bool(pl.get("host", false)) else Color(0.55, 0.8, 1.0), 0.6))
		var a := Avatar.new()
		slot.add_child(a)
		a.setup(String(pl.get("char", "outlaw")))
		a.scale = Vector3.ONE * 0.86
		a.rotation.y = PI + 0.2 * (1.0 if i % 2 == 0 else -1.0)      # facing the camera
		var tag := Label3D.new()
		tag.text = "%s%s" % [String(pl.get("name", "PLAYER")), "  ★" if bool(pl.get("host", false)) else ("  ✔" if bool(pl.get("ready", false)) else "")]
		tag.position = Vector3(0, 1.62, 0)
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.font_size = 32
		tag.pixel_size = 0.0028
		tag.outline_size = 12
		tag.modulate = Color(1, 0.95, 0.6) if bool(pl.get("you", false)) else Color.WHITE
		slot.add_child(tag)


func _clear_squad() -> void:
	for n in _squad_nodes:
		(n as Node).queue_free()
	_squad_nodes.clear()


## Closing the game (or the Android back button on the home screen): my squad slot and my presence are wiped before the app goes.
func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		if online != null and online.mm != null and online.mm.has_method("wipe_me"):
			online.mm.wipe_me()
		if social != null:
			social.goodbye()
		await get_tree().create_timer(1.2).timeout              # (the DELETE requests leave before the app does)
		get_tree().quit()


func _online_leave() -> void:
	_clear_squad()
	social.room_code = ""
	if preview != null and lobby.screen == "home":
		preview.visible = true
	if _lan_mode:
		_lan_mode = false
		lan.stop()
		net.reset()
		return
	online.leave()


func _online_start() -> void:
	if _lan_mode:
		if net.is_host() and net.roster.size() >= 2:
			lan.stop()
			mode = "world"
			match_type = lobby._match_pick
			begin_match()
		return
	online.start_room()


# ── the same Wi-Fi / hotspot (ENet, no server) ───────────────────────────────

var lan: LanBeacon
var _lan_mode := false


func _lan_host() -> void:
	online.leave()
	net.char_id = Data.CAST_ORDER[sel]
	if net.host_lan():
		_lan_mode = true
		lan.start_host(String(save.get("name", "PLAYER")))
		_lan_room()


## The room as everybody in it sees it: who is in, the host can start.
func _lan_room() -> void:
	if not _lan_mode or lobby == null:
		return
	var ids: Array = net.roster.keys()
	ids.sort()
	var players := []
	for i in ids.size():
		var cid := String(net.roster[ids[i]])
		players.append({"name": "YOU" if ids[i] == net.local_id else String(Data.CAST.get(cid, Data.CAST["outlaw"]).get("short", "PLAYER")),
			"team": i, "host": ids[i] == 1, "you": ids[i] == net.local_id})
	lan.players = ids.size()
	lobby.set_room({"state": "room", "code": "WI-FI", "players": players, "host": net.is_host(), "max": Data.MAX_PLAYERS,
		"status": "On this Wi-Fi. The host starts when everybody is in." if net.is_host() else "Connected — waiting for the host to start."})


func _enter_lobby() -> void:
	state = State.LOBBY
	lobby3d.visible = true
	if lobby_env.get_parent() == null:
		lobby3d.add_child(lobby_env)
	lobby_cam.make_current()
	lobby_root.visible = true
	armory_root.visible = false
	pause_root.visible = false
	hud.set_playing(false)
	_refresh_lobby()
	lobby.show_screen("home")


func _process(delta: float) -> void:
	_clock += delta
	_view_touch_t = maxf(0.0, _view_touch_t - delta)
	if state == State.LOBBY and preview != null and _view_touch_t <= 0.0:
		preview.rotation.y += delta * 0.7
	if state == State.LOBBY and view_pivot != null:
		if _view_touch_t <= 0.0:
			view_pivot.rotation.y += delta * 0.6
		for w in _view_wheels:
			(w as Node3D).rotation.x += delta * 4.0


# ── the 360 viewer: heroes, weapons and rides on the lobby stage ─────────────

func _view_ids() -> Array:
	match view_cat:
		"weapons":
			return Data.WEAPON_ORDER + Data.MELEE_ORDER
		"rides":
			var out: Array = VehicleData.SPECS.keys()
			out.sort()
			out.append("horse")
			return out
	return Data.CAST_ORDER


## A finger or the mouse turns the model: sideways spins it, up and down tips it.
func _on_view_drag(delta: Vector2) -> void:
	_view_touch_t = 2.5
	if lobby.screen == "view" and view_pivot != null:
		view_pivot.rotation.y += delta.x * 0.012
		view_pivot.rotation.x = clampf(view_pivot.rotation.x + delta.y * 0.008, -0.7, 0.7)
	elif lobby.screen == "home" and preview != null:
		preview.rotation.y += delta.x * 0.012


func _view_clear() -> void:
	if view_pivot != null:
		view_pivot.queue_free()
		view_pivot = null
	_view_wheels.clear()


func _view_show() -> void:
	_view_clear()
	var ids := _view_ids()
	view_i = clampi(view_i, 0, ids.size() - 1)
	var id: String = ids[view_i]
	view_pivot = Node3D.new()
	lobby3d.add_child(view_pivot)
	var title := id.capitalize()
	var kind := ""
	var note := ""
	var base := 1.0
	match view_cat:
		"heroes":
			var a := Avatar.new()
			view_pivot.add_child(a)
			a.setup(id)
			view_pivot.position = Vector3(-0.35, 0.0, 0.0)
			var info: Dictionary = Data.CAST[id]
			title = String(info.name)
			kind = "%s  ·  %s" % [String(info.get("title", "")), Data.rarity_of(id)]
			note = String(info.get("perk", ""))
		"weapons":
			var m := WeaponModels.build(id, 1.0)
			base = 1.5 / maxf(WeaponModels.held_length(id), 0.3)
			var inner := Node3D.new()
			view_pivot.add_child(inner)
			inner.add_child(m)
			m.rotation.y = PI * 0.5               # turn the barrel sideways so the first view is the side view
			view_pivot.position = Vector3(-0.35, 1.0, 0.0)
			if Data.MELEE.has(id):
				title = String(Data.MELEE[id].name)
				kind = "Melee  ·  no ammo"
				note = String(Data.MELEE[id].note)
			else:
				title = String(Data.WEAPONS[id].name)
				kind = "Gauntlet  ·  %s" % String(Data.WEAPONS[id].kind)
				note = String(Data.WEAPONS[id].note)
		"rides":
			view_pivot.position = Vector3(-0.35, 0.15, 0.0)
			if id == "horse":
				var h := Horse.new()
				view_pivot.add_child(h)
				h.setup(0)
				h.set_physics_process(false)
				base = 0.55
				title = "WAR HORSE"
				kind = "Ride  ·  jump and sprint"
				note = "Fast over rough ground. Horsemanship skill makes it faster."
			else:
				var v := Vehicle.new()
				view_pivot.add_child(v)
				v.setup(0, id)
				v.set_physics_process(false)
				for w in v.wheels:
					_view_wheels.append(w[1])
				base = 1.8 / maxf(float(v.spec.len), 1.0)
				view_pivot.position.x = -0.55
				title = String(v.title).to_upper()
				kind = "Vehicle  ·  %d m long" % int(v.spec.len)
				note = "Hop in with the ride button. Driving skill makes it faster and easier to steer."
	view_pivot.set_meta("base", base)
	view_pivot.scale = Vector3.ONE * base * _view_zoom
	view_pivot.rotation.y = 0.5
	lobby.set_view_info(view_cat, title.to_upper() if view_cat != "heroes" else title, kind, note)


# ── net callbacks ────────────────────────────────────────────────────────────

func _on_net_status(text: String) -> void:
	hud.set_status(text)
	_refresh_lobby()


func _on_code_ready(kind: String, code: String) -> void:
	hud.show_code(code)
	DisplayServer.clipboard_set(code)


func _on_peer_joined(id: int, char_id: String) -> void:
	_refresh_lobby()
	if state == State.LOBBY:
		_lan_room()
	if state == State.PLAY:
		_spawn_remote(id, char_id)
		hud.toast("Player %d joined" % id)


func _on_peer_left(id: int) -> void:
	if remotes.has(id):
		if mc != null:
			mc.drop_actor(remotes[id] as PlayerController)
		(remotes[id] as Node).queue_free()
		remotes.erase(id)
		hud.toast("Player %d left" % id)
	_refresh_lobby()
	if state == State.LOBBY:
		_lan_room()


func _on_state(id: int, snap: Array) -> void:
	if remotes.has(id):
		(remotes[id] as PlayerController).push_snapshot(snap, _clock)


func _on_remote_shot(id: int, weapon: String, yaw: float, pitch: float) -> void:
	if not net.is_host() or not remotes.has(id) or mode == "world":
		return                           # (in the match each phone judges its own shots and sends the hits)
	var p: PlayerController = remotes[id]
	p.yaw = yaw
	p.pitch = pitch
	p.tool.equip(weapon)
	p.tool.cd_left = 0.0
	p.tool.fire()


func _on_remote_fx(id: int, weapon: String, origin: Vector3, point: Vector3) -> void:
	if state != State.PLAY or not Data.WEAPONS.has(weapon):
		return
	var c: Color = Data.WEAPONS[weapon].color
	fx.beam(origin, point, c, 0.1)
	fx.ring(point, c, 3.0)


func _on_remote_slab(pos: Vector3, axis: int, kind: String) -> void:
	if player != null:
		player.tool.place_at(pos, axis, kind, false)


func _on_event(kind: String, data: Dictionary) -> void:
	match kind:
		"start":
			if state != State.PLAY:
				mode = String(data.get("mode", "train"))
				match_type = String(data.get("mt", match_type))
				begin_match()
		"kill":
			if mc != null and not net.is_host():
				_count_kill(int(data.get("k", -1)), int(data.get("v", -1)))
		"take":
			if mc != null and not net.is_host():
				var by := mc.actor_by_id(int(data.get("by", -1)))
				if by != null:
					mc._apply_take(by, int(data.get("u", -1)))
		"drop":
			if mc != null and mc.loot != null and not net.is_host():
				mc.loot.drop(String(data.get("id", "")), Vector3(float(data.x), 0.0, float(data.z)), int(data.get("u", -1)))
		"clock":
			if mc != null and not net.is_host():
				mc.time_left = float(data.get("t", mc.time_left))
				mc.changed.emit()
		"results":
			if mc != null and not net.is_host():
				_client_results(data)
		"dmg":
			if state == State.PLAY and mode == "world" and int(data.get("by", -1)) != net.local_id:
				world.damage_at(Vector3(float(data.x), float(data.y), float(data.z)), float(data.r), float(data.a), false)
		"smash":
			if state == State.PLAY and mode == "world":
				world.smash(Vector3(float(data.x), 0.0, float(data.z)), 2.0, false)
		"round":
			round_no = int(data.get("n", round_no))
			hud.banner("ROUND %d" % round_no)
		"end":
			if state == State.PLAY:
				end_run()


# ── a run ────────────────────────────────────────────────────────────────────

## Start a match behind the loading screen: the world is built a step at a time (the animation keeps running), then the players, the loot and the bots.
func begin_match() -> void:
	if state == State.PLAY or _loading_now:
		return
	_loading_now = true
	if net.is_host():
		net.send_event("start", {"mode": mode, "mt": match_type})
		_start_sent = true
	if loading == null:
		loading = LoadingScreen.new()
		add_child(loading)
	loading.open(Data.CAST_ORDER[sel])
	var t0 := Time.get_ticks_msec()
	await get_tree().process_frame
	await get_tree().process_frame
	if mode == "world":
		var w := OpenWorld.new()
		w.lazy = true
		world = w
		add_child(w)
		await w.build_async(func(p: float) -> void: loading.set_progress(p * 0.8, "Building the world"))
	loading.set_progress(0.84, "Placing 200 weapons and 15 players")
	await get_tree().process_frame
	start_play()
	loading.set_progress(1.0, "Ready")
	var left := 900 - (Time.get_ticks_msec() - t0)
	if left > 0:
		await get_tree().create_timer(float(left) / 1000.0).timeout
	loading.close()
	_loading_now = false


func start_play() -> void:
	if state == State.PLAY:
		return
	if net.is_host() and not _start_sent:
		net.send_event("start", {"mode": mode, "mt": match_type})
	_start_sent = false
	lobby3d.visible = false
	if lobby_env.get_parent() != null:
		lobby3d.remove_child(lobby_env)
	lobby_root.visible = false
	armory_root.visible = false
	if world == null or not is_instance_valid(world):
		world = OpenWorld.new() if mode == "world" else TrainWorld.new()
		add_child(world)
	fx = Fx.new()
	add_child(fx)
	spawner = OptimizedSkySpawner.new()
	spawner.world = world
	spawner.fx = fx
	spawner.authority = net.role != "client"
	if mode == "world":
		spawner.open = true
		spawner.rate = 0.45
	add_child(spawner)
	spawner.broken.connect(_on_broken)
	spawner.incoming.connect(_on_incoming)
	spawner.spawned.connect(func(_id: int, _pos: Vector3, _size: float, _vel: Vector3, _ci: int) -> void: pass)
	# my slot among everybody who is here
	var ids: Array = net.roster.keys() if net.online() else [1]
	ids.sort()
	_slot = maxi(0, ids.find(net.local_id if net.online() else 1))
	player = PlayerController.new()
	world.add_child(player)
	player.display_name = String(save.get("name", "PLAYER")) if mode == "world" else ""
	player.setup(self, world, spawner, Data.CAST_ORDER[sel], net.local_id if net.online() else 1, true)
	player.global_position = world.spawn_points[_slot % world.spawn_points.size()].global_position
	player.last_safe = player.global_position
	_apply_settings()
	player.hurt.connect(func(_a: float) -> void: shake(0.4))
	player.respawned.connect(func(reason: String) -> void:
		hud.toast("Back on the roof" if reason == "fell" else "Stability gone — back on the roof"))
	player.tool.placed.connect(func(pos: Vector3, axis: int, kind: String) -> void: net.send_slab(pos, axis, kind))
	player.tool.fired.connect(func(w: String, o: Vector3, d: Vector3, p: Vector3) -> void:
		net.send_shot(w, player.yaw, player.pitch, o, p))
	for id in ids:
		if id != (net.local_id if net.online() else 1):
			_spawn_remote(int(id), String(net.roster.get(id, "outlaw")))
	hud.world_mode = mode == "world"
	hud.round_label = "LAP" if hud.world_mode else "ROUND"
	hud.strip = not hud.world_mode
	hud.ride_label = ""
	if hud.world_mode:
		world.focus = player
		world.audio = audio
		hud.map_path = world.path
		var gp := PackedVector2Array()
		for g in world.gates:
			gp.append(Vector2((g[0] as Vector3).x, (g[0] as Vector3).z))
		hud.map_gates = gp
		hud.map_river = [OpenWorld.RIVER_AT - OpenWorld.RIVER_DIR * 130.0, OpenWorld.RIVER_AT + OpenWorld.RIVER_DIR * 130.0]
		hud.map_places = [[Vector2(0, 14), "TOWN"], [Vector2(-10, 43), "CAR PARK"], [Vector2(60, 31), "STABLE"], [Vector2(-70, -24), "PAGODA"], [Vector2(40, -30), "WINDMILL"],
			[Vector2(100, -28), "BRIDGE"], [Vector2(-120, -130), "JUNGLE"], [Vector2(-170, 165), "DOWNTOWN"]]
		hud.map_half = OpenWorld.HALF
		hud.map_big = false
		audio.set_rumble(false)
		world.checkpoint.connect(_on_checkpoint)
		world.smashed.connect(_on_smashed)
		world.destroyed.connect(_on_destroyed)
		world.damaged.connect(_on_world_damaged)
		var others: Array = []
		for id in remotes:
			others.append(remotes[id])
		mc = MatchController.new()
		mc.name = "Match"
		add_child(mc)
		mc.setup(self, world, spawner, match_type)
		mc.online = net.online()
		mc.is_authority = not net.online() or net.is_host()
		mc.finished.connect(_on_match_finished)
		mc.begin(player, others, not net.online())
		if skydive:
			for a in mc.actors:
				(a as Node3D).global_position.y += Data.SKYDIVE_Y      # everybody starts together, falling from the sky
			hud.toast("SKYDIVE! Steer with the stick, JUMP opens the jetpack", 4.0)
		hud.match_on = true
		hud.team_mode = match_type == "team"
		hud.results = {}
		hud.show_board = false
		hud.owned = player.tool.inventory.duplicate()
	else:
		_equip(String(save.get("weapon", "shift_gauntlet")))
		hud.owned = _owned()
	hud.ping_ms = 0 if net.online() else -1
	hud.block_name = "STEEL"
	hud.block_color = Data.BLOCKS["steel"].color
	round_no = 1
	run_coins = 0
	run_start_z = world.progress
	if spawner != null:
		spawner.difficulty = 1.0
	state = State.PLAY
	if online.active():
		online.finish()
	hud.set_playing(true)
	if hud.world_mode:
		hud.banner("%s MATCH — most kills wins" % ("TEAM" if match_type == "team" else "SOLO"), 3.4)
		hud.toast("Grab weapons from the ground. Your gauntlets recharge in 60 s.", 3.6)
	else:
		hud.banner("ROUND 1 — reach the engine", 3.2)
		hud.toast("Bridge the gaps: BRIDGE PLACE, or hold JUMP/JET in the air")
	player.cam.make_current()
	_set_effects_level(2)


func _spawn_remote(id: int, char_id: String) -> void:
	if remotes.has(id) or world == null:
		return
	var p := PlayerController.new()
	p.display_name = String(online.names.get(id, ""))
	world.add_child(p)
	p.setup(self, world, spawner, char_id, id, false)
	var ids: Array = net.roster.keys()
	ids.sort()
	p.global_position = world.spawn_points[maxi(0, ids.find(id)) % world.spawn_points.size()].global_position
	remotes[id] = p


## RIDE / DRIVE / GET OFF.
func _ride() -> void:
	if player == null or state != State.PLAY or mode != "world":
		return
	if player.mount != null:
		player.leave()
		return
	var m: Mount = world.nearest_mount(player.global_position)
	if m != null:
		player.board(m)
		audio.play("ui", -4.0, 0.8)
		hud.toast("%s — stick: drive, JUMP: %s, BOOST: nitro" % [m.title, "jump" if m is Horse else "handbrake"], 3.0)


## A tower, house or machine came apart: shards in its colour, dust, a thud (louder up close).
func _on_destroyed(at: Vector3, size: Vector3, color: Color, final: bool) -> void:
	if fx == null:
		return
	var big := clampf(size.length() / 10.0, 0.4, 3.0)
	for k in 3:
		fx.shards(at + Vector3(randf_range(-0.4, 0.4) * size.x, randf_range(-0.4, 0.4) * size.y, randf_range(-0.4, 0.4) * size.z), color, int(10.0 * big) + 6, 5.0 + 2.0 * big)
	fx.ring(Vector3(at.x, 0.1, at.z), Color(0.8, 0.75, 0.7), maxf(size.x, size.z) * 0.9)
	fx.flash(Vector3(at.x, 1.0, at.z), Color(0.75, 0.72, 0.68), 3.0 * big)
	if audio != null:
		audio.play("place", -2.0 + (2.0 if final else 0.0), randf_range(0.4, 0.6))
	if player != null:
		var d := player.global_position.distance_to(at)
		if d < 60.0:
			shake(clampf((1.0 - d / 60.0) * (0.9 if final else 0.45), 0.0, 0.9))


## My hit damaged the world: the other phones must see the same tower fall (the host relays).
func _on_world_damaged(at: Vector3, radius: float, amount: float) -> void:
	if not net.online():
		return
	var d := {"x": at.x, "y": at.y, "z": at.z, "r": radius, "a": amount, "by": net.local_id}
	if net.is_host():
		net.send_event("dmg", d)
	else:
		net.send_report("dmg", d)


func _on_smashed(at: Vector3, count: int) -> void:
	if count > 0 and fx != null:
		fx.shards(at + Vector3(0, 1.0, 0), Color(0.45, 0.85, 0.3), mini(count * 4, 14), 4.0)
		audio.play("place", -8.0, randf_range(0.6, 0.9))
		if net.online():
			net.send_event("smash", {"x": at.x, "z": at.z})


func _on_checkpoint(index: int, total: int, lap: int) -> void:
	var bonus := 25 + 5 * lap
	run_coins += bonus
	round_no = lap
	audio.play("coin", 0.0, 1.0 + 0.04 * float(index))
	hud.banner("GATE %d / %d   +$%d" % [(index + total - 1) % total + 1, total, bonus], 1.8)
	if player != null:
		fx.ring(world.gates[(index + total - 1) % total][0] + Vector3(0, 3, 0), Color(1, 0.85, 0.3), 5.0)


func _owned() -> Array:
	var out: Array = []
	for id in Data.WEAPON_ORDER:
		if Data.weapon_unlocked(id, save):
			out.append(id)
	return out


func _equip(id: String) -> void:
	if player == null:
		return
	if mode == "world":
		if player.tool.inventory.has(id):
			player.tool.equip(id)
		return
	if not Data.weapon_unlocked(id, save):
		return
	player.tool.equip(id)
	hud.weapon_id = id
	hud.toast(String(Data.WEAPONS[id].name))


func _fire() -> void:
	if player != null and state == State.PLAY:
		if not player.tool.fire():
			return
		if net.is_host() or not net.online():
			pass


func _bridge() -> void:
	if player != null and state == State.PLAY:
		player.tool.place_bridge()


func set_pause(on: bool) -> void:
	if state != State.PLAY and state != State.PAUSE:
		return
	state = State.PAUSE if on else State.PLAY
	pause_root.visible = on
	hud.playing = not on
	get_tree().paused = false if net.online() else on        # a shared train does not stop for one phone
	_canvas_redraw()


func _canvas_redraw() -> void:
	hud._canvas.queue_redraw()


func end_run() -> void:
	if state != State.PLAY and state != State.PAUSE:
		return
	if net.is_host() and (mc == null or mc.running):
		net.send_event("end", {})
	var dist: float = (world.progress - run_start_z) if world != null else 0.0
	save.best = maxf(float(save.best), dist)
	save.coins = int(save.coins) + run_coins
	Data.write_save(save)
	get_tree().paused = false
	if online.active():
		online.leave()
	audio.set_rumble(true)
	audio.set_engine(-1.0, 1.0)
	if mc != null:
		mc.stop()
		mc.queue_free()
		mc = null
	hud.match_on = false
	hud.results = {}
	for id in remotes.keys():
		(remotes[id] as Node).queue_free()
	remotes.clear()
	for n in [player, spawner, fx, world]:
		if n != null and is_instance_valid(n):
			(n as Node).queue_free()
	player = null
	spawner = null
	fx = null
	world = null
	_enter_lobby()
	lobby3d.visible = true
	hud.toast("Run over: %d m  ·  +$%d" % [int(dist), run_coins], 3.5)


func _on_broken(pos: Vector3, size: float, _c: Color) -> void:
	var n := int(ceil(size * 2.0))
	n = int(round(float(n) * float(player.info.get("coin_mult", 1.0)))) if player != null else n
	add_coins(n, pos)


func _on_incoming(landing: Vector3, eta: float) -> void:
	if player != null and bool(player.info.get("mark", false)):
		fx.ring(landing + Vector3(0, 0.1, 0), Color(1, 0.3, 0.25), 1.6)


func add_coins(n: int, at := Vector3.ZERO) -> void:
	run_coins += n
	if audio != null:
		audio.play("coin", -10.0, randf_range(0.9, 1.2))


## A short message at the bottom of the screen.
func toast(text: String, secs := 2.2) -> void:
	hud.toast(text, secs)


## The cross-hair flickers and a number floats: my shot landed.
func hit_marker(amount: float, at: Vector3) -> void:
	hud.hit_t = 0.25
	hud.hit_dmg = amount
	audio.play("ping", -8.0, 1.0 + minf(amount, 80.0) * 0.006)
	fx.flash(at, Color(1.0, 0.95, 0.7), 0.7)


## Another phone's player was hit by me: the hit goes to that phone, which keeps its own player's hp. (Overridden by the match: see MatchController.)
func send_hit(target_peer: int, amount: float, knock: Vector3, slow: float) -> void:
	if net.online():
		net.send_hit(target_peer, amount, knock, slow)


func shake(amount: float) -> void:
	_shake = maxf(_shake, amount)


func _cycle_view(btn: Button) -> void:
	if world == null:
		return
	var d: float = world.view_dist + 15.0
	if d > 80.0:
		d = 30.0
	world.set_view_distance(d)
	btn.text = "VIEW DISTANCE: %d m" % int(d)


func _set_effects_level(level: int) -> void:
	if fx != null:
		fx.level = level
	if world != null:
		world.set_far_visible(level > 0)


# ── per frame in a run ───────────────────────────────────────────────────────

func _physics_process(delta: float) -> void:
	if state != State.PLAY:
		return
	world.update(delta)
	var open_world := mode == "world"
	# controls
	if player.mount != null:
		player.move_input = Vector2.ZERO
		player.jet_held = false
		if not bot_mode:
			player.mount.set_input(hud.move.y, hud.move.x, hud.is_held("jet"), hud.is_held("fire"))
	elif not bot_mode:                      # (a test bot drives the player directly)
		player.move_input = hud.move
		player.jet_held = hud.is_held("jet")
	player.look_delta += hud.take_look()
	if hud.is_held("fire") and player.mount == null:
		_fire()
	if open_world:
		_world_frame(delta)
	else:
		_train_frame(delta)
	# network
	if net.online():
		_net_t -= delta
		if _net_t <= 0.0:
			_net_t = 1.0 / 15.0
			net.send_state(player.snapshot())
		if net.is_host() and spawner != null:
			_debris_t -= delta
			if _debris_t <= 0.0:
				_debris_t = 1.0 / 8.0
				net.send_debris(spawner.pack_snapshot())
	# camera shake
	_shake = maxf(0.0, _shake - delta * 2.2)
	if player.cam != null:
		player.cam.rotation = Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * 0.03
	_watch_fps(delta)


func _world_frame(_delta: float) -> void:
	var near: Mount = world.nearest_mount(player.global_position) if player.mount == null else null
	if player.mount != null:
		hud.ride_label = "GET OFF"
	elif near != null:
		hud.ride_label = ("RIDE" if near is Horse else "DRIVE") + "\n" + near.title.get_slice(" ", near.title.get_slice_count(" ") - 1)
	else:
		hud.ride_label = ""
	hud.fire_label = "BOOST" if player.mount != null else "FIRE"
	hud.stability = player.hp / player.max_hp
	hud.fuel = player.jet.fuel_frac()
	hud.heat = player.jet.heat_frac()
	hud.overheated = player.jet.hot
	hud.distance = world.progress
	hud.round_no = world.lap
	hud.coins = run_coins
	hud.minimap = []
	hud.map_you = Vector2(player.global_position.x, player.global_position.z)
	hud.map_yaw = player.yaw
	hud.map_next = world.next_gate
	var others := PackedVector2Array()
	for a in mc.actors:
		if a != player and a.alive and a.team == player.team:
			others.append(Vector2(a.global_position.x, a.global_position.z))
	hud.map_others = others
	var to_gate: Vector3 = world.gate_position() - player.global_position
	to_gate.y = 0.0
	hud.gate_dist = to_gate.length()
	hud.gate_angle = player.flat_forward().signed_angle_to(to_gate.normalized(), Vector3.UP) if to_gate.length() > 0.1 else 0.0
	# the match
	hud.match_on = mc != null and (mc.running or not hud.results.is_empty())
	if mc != null:
		hud.time_left = mc.time_left
		hud.my_kills = player.kills
		hud.team_kills = int(mc.team_score.get(player.team, 0))
		hud.death_t = float(mc._respawn.get(player, 0.0))
		hud.feed = mc.feed
		hud.owned = player.tool.inventory.duplicate()
		hud.weapon_id = player.tool.weapon
		var ch := {}
		for id in player.tool.inventory:
			ch[id] = [player.tool.charge_of(id), player.tool.is_locked(id)]
		hud.charges = ch
		hud.cooldown = (1.0 - player.mount.boost) if player.mount != null else player.tool.cd_left / maxf(player.tool.cooldown_for(player.tool.weapon), 0.01)
		if hud.show_board:
			hud.board = mc.scoreboard()


func _on_match_finished(r: Dictionary) -> void:
	var mine: Dictionary = r.get("me", {})
	var won := bool(mine.get("won", false))
	var coins := 20 + int(mine.get("kills", 0)) * 10 + (80 if won else 0)
	if player != null:
		coins = int(round(float(coins) * float(player.info.get("coin_mult", 1.0))))          # the pirate plunders more
	run_coins += coins
	save.coins = int(save.coins) + run_coins
	save.matches = int(save.get("matches", 0)) + 1
	save.wins = int(save.get("wins", 0)) + (1 if won else 0)
	Data.write_save(save)
	run_coins = 0
	hud.board = r.get("board", [])
	hud.results = {"won": won, "kills": int(mine.get("kills", 0)), "deaths": int(mine.get("deaths", 0)), "coins": coins}
	audio.play("coin", 0.0, 0.8 if not won else 1.2)
	if net.is_host():
		net.send_event("results", {"board": r.get("board", []), "winner": int(r.get("winner_team", -1)), "ts": r.get("team_score", {})})


## A kill the host announced (or my own, as the host): the score, the feed, the victim's death count.
func _count_kill(killer_id: int, victim_id: int) -> void:
	var v := mc.actor_by_id(victim_id)
	if v != null and not v.is_local and not v.is_bot:
		v.deaths += 1
	mc.score_kill(killer_id, victim_id)


## The host says the match is over: show my result from its scoreboard.
func _client_results(d: Dictionary) -> void:
	var board: Array = d.get("board", [])
	var winner := int(d.get("winner", -1))
	var ts: Dictionary = d.get("ts", {})
	mc.running = false
	var me_row := {}
	for row in board:
		if int(row.get("id", -1)) == net.local_id:
			me_row = row
	var best := -1
	for t in ts:
		best = maxi(best, int(ts[t]))
	var r := {"board": board, "winner_team": winner, "team_score": ts,
		"me": {"kills": int(me_row.get("kills", 0)), "deaths": int(me_row.get("deaths", 0)), "team": int(me_row.get("team", -1)), "won": int(me_row.get("team", -2)) == winner and best > 0}}
	_on_match_finished(r)


## A hit from another phone's player lands on my player (I am the judge of my own hp).
func _on_hit(target: int, amount: float, knock: Vector3, slow: float, from: int) -> void:
	if state != State.PLAY or player == null or target != net.local_id:
		return
	var src: PlayerController = mc.actor_by_id(from) if mc != null else null
	player.take_damage(amount, src, knock, slow)


## The host decides what a client reports: a death (the kill count), taking a weapon (first come), dropping one (it gets a shared number).
func _on_report(from: int, kind: String, data: Dictionary) -> void:
	if not net.is_host():
		return
	if kind == "dmg" and world != null and mode == "world":
		world.damage_at(Vector3(float(data.x), float(data.y), float(data.z)), float(data.r), float(data.a), false)
		net.send_event("dmg", data)
		return
	if mc == null:
		return
	match kind:
		"died":
			var k := int(data.get("k", -1))
			_count_kill(k, from)
			net.send_event("kill", {"k": k, "v": from})
		"take":
			var uid := int(data.get("u", -1))
			var a := mc.actor_by_id(from)
			if a != null and mc.loot != null and mc.loot.items.has(uid) and bool(mc.loot.items[uid].alive):
				mc._apply_take(a, uid)
				net.send_event("take", {"u": uid, "by": from})
		"drop":
			var at := Vector3(float(data.x), 0.0, float(data.z))
			var uid2: int = mc.loot.next_uid
			mc.loot.drop(String(data.id), at, uid2)
			net.send_event("drop", {"id": String(data.id), "x": at.x, "z": at.z, "u": uid2})


func _train_frame(delta: float) -> void:
	# the rain follows the players
	var zs := player.global_position.z
	var n := 1
	for id in remotes:
		zs += (remotes[id] as Node3D).global_position.z
		n += 1
	spawner.focus_z = zs / float(n)
	# hud
	hud.stability = player.hp / player.max_hp
	hud.fuel = player.jet.fuel_frac()
	hud.heat = player.jet.heat_frac()
	hud.overheated = player.jet.hot
	hud.distance = world.progress - run_start_z
	hud.round_no = round_no
	hud.coins = run_coins
	hud.cooldown = player.tool.cd_left / maxf(player.tool.cooldown_for(player.tool.weapon), 0.01)
	var mm: Array = [[player.global_position.z, 0.0, Color(1, 1, 1)]]
	for id in remotes:
		mm.append([(remotes[id] as Node3D).global_position.z, 0.0, Color(0.5, 0.9, 1.0)])
	hud.minimap = mm
	# the engine at the front: a round is won
	_goal_cd = maxf(0.0, _goal_cd - delta)
	if player.global_position.z < world.goal_z + 7.0 and _goal_cd <= 0.0 and player.is_on_floor():
		_round_cleared()


func _round_cleared() -> void:
	_goal_cd = 4.0
	var bonus := 40 + round_no * 20
	run_coins += bonus
	round_no += 1
	spawner.difficulty = 1.0 + float(round_no - 1) * 0.6
	hud.banner("ROUND CLEARED  +$%d" % bonus, 3.0)
	audio.play("coin", 0.0, 0.8)
	player.respawn_at(world.spawn_points[_slot % world.spawn_points.size()].global_position + Vector3(0, 0.3, 0))
	player.last_safe = player.global_position
	player.jet.refill()
	if net.is_host():
		net.send_event("round", {"n": round_no})


## Frame rate keeper: every 3 s of play, under 30 fps pulls the city in 10 m (and below 24 drops the effects), a steady 58+ gives it back.
func _watch_fps(delta: float) -> void:
	_fps_t += delta
	_fps_n += 1
	_fps_sum += delta
	if _fps_t < 3.0:
		return
	fps_avg = float(_fps_n) / maxf(_fps_sum, 0.001)
	_fps_t = 0.0
	_fps_n = 0
	_fps_sum = 0.0
	if fps_avg < 30.0:
		world.set_view_distance(world.view_dist - 10.0)
		if fps_avg < 24.0:
			_set_effects_level(0 if world.view_dist <= 30.0 else 1)
	elif fps_avg > 58.0 and world.view_dist < 80.0:
		world.set_view_distance(world.view_dist + 5.0)
		if fx.level < 2 and world.view_dist >= 60.0:
			_set_effects_level(2)
