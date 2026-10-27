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
var ui: CanvasLayer
var lobby_root: Control
var armory_root: Control
var pause_root: Control
var lbl_name: Label
var lbl_role: Label
var lbl_perk: Label
var lbl_coins: Label
var lbl_net: Label
var bars := {}
var start_btn: Button
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
	lobby3d = Node3D.new()
	add_child(lobby3d)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.09, 0.13, 0.3)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.75, 0.95)
	env.ambient_light_energy = 0.8
	lobby_env = WorldEnvironment.new()
	lobby_env.environment = env
	lobby3d.add_child(lobby_env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, 30, 0)
	sun.light_color = Color(1.0, 0.85, 0.7)
	lobby3d.add_child(sun)
	var rim := OmniLight3D.new()
	rim.position = Vector3(-2.5, 2.2, -2.0)
	rim.light_color = Color(0.4, 0.7, 1.0)
	rim.light_energy = 2.0
	rim.omni_range = 8.0
	lobby3d.add_child(rim)
	Mat.cyl(lobby3d, Vector3(0, -0.06, 0), 1.0, 0.12, Mat.flat(Color(0.22, 0.26, 0.4)))
	Mat.cyl(lobby3d, Vector3(0, 0.0, 0), 0.9, 0.04, Mat.flat(Color(0.9, 0.45, 0.15), 0.6))
	for i in 7:
		var a := float(i) / 7.0 * TAU
		Mat.box(lobby3d, Vector3(cos(a) * 3.6, 0.6 + float(i % 3) * 0.7, sin(a) * 3.6 - 2.0), Vector3(0.5, 1.2 + float(i % 3), 0.5), Mat.flat(Color(0.2, 0.26, 0.45)))
	lobby_cam = Camera3D.new()
	lobby_cam.position = Vector3(0, 1.25, 3.3)
	lobby_cam.fov = 40.0
	lobby3d.add_child(lobby_cam)
	lobby_cam.look_at(Vector3(0, 0.95, 0))
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
	# ── the lobby screen
	lobby_root = Control.new()
	lobby_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	lobby_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(lobby_root)
	var title := _lbl("CITY SHIFTER", lobby_root, 44, Color.WHITE)
	title.position = Vector2(36, 18)
	var sub := _lbl("SKY SIEGE", lobby_root, 24, Color(1.0, 0.75, 0.35))
	sub.position = Vector2(40, 72)
	lbl_coins = _lbl("", lobby_root, 20, Color(1.0, 0.88, 0.5))
	lbl_coins.position = Vector2(40, 108)
	# stats (left)
	var sp := PanelContainer.new()
	sp.position = Vector2(36, 190)
	sp.custom_minimum_size = Vector2(300, 190)
	sp.add_theme_stylebox_override("panel", _style(Color(0.05, 0.08, 0.2, 0.7)))
	lobby_root.add_child(sp)
	var sv := VBoxContainer.new()
	sp.add_child(sv)
	for k in ["SPEED", "JET FUEL", "STABILITY"]:
		var l := _lbl(k, sv, 15, Color(1, 1, 1, 0.8))
		var pb := ProgressBar.new()
		pb.custom_minimum_size = Vector2(260, 16)
		pb.show_percentage = false
		pb.max_value = 1.0
		sv.add_child(pb)
		bars[k] = pb
	# name, role, perk (bottom centre)
	var nb := VBoxContainer.new()
	nb.position = Vector2(380, 520)
	nb.custom_minimum_size = Vector2(520, 160)
	nb.alignment = BoxContainer.ALIGNMENT_CENTER
	lobby_root.add_child(nb)
	lbl_name = _lbl("", nb, 38)
	lbl_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_role = _lbl("", nb, 20, Color(1, 0.8, 0.5))
	lbl_role.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_perk = _lbl("", nb, 17, Color(1, 1, 1, 0.85))
	lbl_perk.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl_perk.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lbl_perk.custom_minimum_size = Vector2(520, 0)
	var prev := _btn("<", lobby_root, Vector2(70, 70))
	prev.position = Vector2(300, 330)
	prev.pressed.connect(func() -> void: _step(-1))
	var next := _btn(">", lobby_root, Vector2(70, 70))
	next.position = Vector2(910, 330)
	next.pressed.connect(func() -> void: _step(1))
	# buttons (right)
	var col := VBoxContainer.new()
	col.position = Vector2(930, 150)
	col.add_theme_constant_override("separation", 12)
	lobby_root.add_child(col)
	start_btn = _btn("TRAIN RUN", col, Vector2(300, 70), Color(1.0, 0.62, 0.25))
	start_btn.pressed.connect(func() -> void:
		mode = "train"
		start_play())
	var world_btn := _btn("OPEN WORLD", col, Vector2(300, 70), Color(0.45, 0.85, 1.0))
	world_btn.pressed.connect(func() -> void:
		mode = "world"
		start_play())
	var together := _btn("PLAY TOGETHER", col)
	together.pressed.connect(func() -> void: hud.show_net(true))
	var armory := _btn("ARMORY  (15)", col)
	armory.pressed.connect(func() -> void: _open_armory(true))
	lbl_net = _lbl("", col, 15, Color(0.7, 1.0, 0.8))
	lbl_net.custom_minimum_size = Vector2(300, 0)
	lbl_net.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
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


func _step(dir: int) -> void:
	sel = (sel + dir + Data.CAST_ORDER.size()) % Data.CAST_ORDER.size()
	save.char = Data.CAST_ORDER[sel]
	Data.write_save(save)
	_show_preview()
	_refresh_lobby()
	audio.play("ui", -6.0)


func _show_preview() -> void:
	if preview != null:
		preview.queue_free()
	preview = Avatar.new()
	lobby3d.add_child(preview)
	preview.setup(Data.CAST_ORDER[sel])


func _refresh_lobby() -> void:
	var id: String = Data.CAST_ORDER[sel]
	var info: Dictionary = Data.CAST[id]
	lbl_name.text = String(info.name)
	lbl_role.text = String(info.role)
	lbl_perk.text = String(info.perk)
	bars["SPEED"].value = float(info.speed) / 8.0
	bars["JET FUEL"].value = float(info.fuel) * float(info.get("fuel_mult", 1.0)) / 140.0
	bars["STABILITY"].value = float(info.hp) / 160.0
	lbl_coins.text = "$%d      LEVEL %d      BEST %d m" % [int(save.coins), Data.level_for(float(save.best)), int(save.best)]
	if net.is_host():
		start_btn.text = "START (%d players)" % net.roster.size()
		lbl_net.text = "You are the host. Players in room: %d" % net.roster.size()
	elif net.role == "client":
		start_btn.text = "WAITING FOR HOST"
		start_btn.disabled = true
		lbl_net.text = "Connected as player %d" % net.local_id
	else:
		start_btn.text = "PLAY SOLO"
		start_btn.disabled = false
		lbl_net.text = ""


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


func _process(delta: float) -> void:
	_clock += delta
	if state == State.LOBBY and preview != null:
		preview.rotation.y += delta * 0.7


# ── net callbacks ────────────────────────────────────────────────────────────

func _on_net_status(text: String) -> void:
	hud.set_status(text)
	_refresh_lobby()


func _on_code_ready(kind: String, code: String) -> void:
	hud.show_code(code)
	DisplayServer.clipboard_set(code)


func _on_peer_joined(id: int, char_id: String) -> void:
	_refresh_lobby()
	if state == State.PLAY:
		_spawn_remote(id, char_id)
		hud.toast("Player %d joined" % id)


func _on_peer_left(id: int) -> void:
	if remotes.has(id):
		(remotes[id] as Node).queue_free()
		remotes.erase(id)
		hud.toast("Player %d left" % id)
	_refresh_lobby()


func _on_state(id: int, snap: Array) -> void:
	if remotes.has(id):
		(remotes[id] as PlayerController).push_snapshot(snap, _clock)


func _on_remote_shot(id: int, weapon: String, yaw: float, pitch: float) -> void:
	if not net.is_host() or not remotes.has(id):
		return
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
				start_play()
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

func start_play() -> void:
	if state == State.PLAY:
		return
	if net.is_host():
		net.send_event("start", {"mode": mode})
	lobby3d.visible = false
	if lobby_env.get_parent() != null:
		lobby3d.remove_child(lobby_env)
	lobby_root.visible = false
	armory_root.visible = false
	if mode == "world":
		world = OpenWorld.new()
	else:
		world = TrainWorld.new()
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
	player.setup(self, world, spawner, Data.CAST_ORDER[sel], net.local_id if net.online() else 1, true)
	player.global_position = world.spawn_points[_slot % world.spawn_points.size()].global_position
	player.last_safe = player.global_position
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
			[Vector2(100, -28), "BRIDGE"], [Vector2(-120, -130), "JUNGLE"]]
		hud.map_half = OpenWorld.HALF
		hud.map_big = false
		audio.set_rumble(false)
		world.checkpoint.connect(_on_checkpoint)
		world.smashed.connect(_on_smashed)
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
	if net.is_host():
		net.send_event("end", {})
	var dist: float = (world.progress - run_start_z) if world != null else 0.0
	save.best = maxf(float(save.best), dist)
	save.coins = int(save.coins) + run_coins
	Data.write_save(save)
	get_tree().paused = false
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
		net.send_event("end", {})


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
