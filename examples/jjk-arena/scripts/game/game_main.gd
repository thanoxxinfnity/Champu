extends Node
## Entry point: title menu (character, mode, graphics, difficulty) -> loading screen -> fight. Everything is built in code.
## Test hooks (user args after `--`): `memlog=1` prints memory and draw stats every second; `autostart=<roster id>` skips the menu; `shot=<png>` saves a screenshot after `shot_t=<seconds>` and quits;
## `script=<name>` replays a canned input script for the player (jab, fly).

const PICKS := ["gojo_open", "gojo_blindfold", "sukuna"]

var _menu: Control
var _world: Node3D
var _fight_nodes: Array[Node] = []
var _mode := GraphicsSettings.Mode.STANDARD
var _level := FightAI.Level.NORMAL
var _pick := "gojo_open"
var _args := {}
var _shot_clock := -1.0
var _player: Fighter
var _controls: FightControls
var _auto := ""
var _dm: DestructionManager
var _cam: ThirdPersonCamera
var _void: InfiniteVoidManager
var _shrine: ShrineDomain
var _env: Environment
var _impact: ImpactFx
var _open := false
var _cut: Cutscene
var _ai: FightAI
var _enemy: Fighter
var _map: WorldMap
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if _args.has("graphics"):
		_mode = GraphicsSettings.mode_names().find(_args["graphics"]) as GraphicsSettings.Mode
	if _args.has("open"):
		_open = true
	if _args.has("autostart"):
		_pick = _args["autostart"]
		_begin_loading()
	else:
		_show_menu()

# ---------------------------------------------------------------- menu
const CARDS := {"gojo_open": "res://assets/ui/card_gojo.jpg", "gojo_blindfold": "res://assets/ui/card_gojo.jpg", "sukuna": "res://assets/ui/card_sukuna.jpg"}
const BADGES := {"gojo": ["purple", "void"], "sukuna": ["fuga", "shrine", "slash"]}

func _show_menu() -> void:
	_clear_fight()
	_menu = Control.new()
	_menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_menu)
	var bg := TextureRect.new()
	bg.texture = load("res://assets/ui/title_bg.jpg")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	bg.modulate = Color(0.62, 0.62, 0.68)
	_menu.add_child(bg)
	var logo := TextureRect.new()
	logo.texture = load("res://assets/ui/logo.png")
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT
	logo.set_anchors_preset(Control.PRESET_TOP_LEFT)
	logo.position = Vector2(40, 18)
	logo.size = Vector2(500, 230)
	_menu.add_child(logo)
	# character cards
	var cards := HBoxContainer.new()
	cards.position = Vector2(60, 262)
	cards.add_theme_constant_override("separation", 14)
	_menu.add_child(cards)
	var picks := {}
	var badge_row := HBoxContainer.new()
	badge_row.add_theme_constant_override("separation", 8)
	var refresh_badges := func():
		for c in badge_row.get_children():
			c.queue_free()
		for key in BADGES.get(Roster.find(_pick)["moves"], []):
			var t := TextureRect.new()
			t.texture = load("res://assets/ui/badge_%s.png" % key)
			t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
			t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
			t.custom_minimum_size = Vector2(92, 92)
			badge_row.add_child(t)
	for id in PICKS:
		var card := TextureButton.new()
		card.texture_normal = load(CARDS[id])
		card.ignore_texture_size = true
		card.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_COVERED
		card.custom_minimum_size = Vector2(150, 250)
		card.focus_mode = Control.FOCUS_NONE
		var tag := UiKit.label("BLINDFOLD" if id == "gojo_blindfold" else ("OPEN EYES" if id == "gojo_open" else ""), 15, Color(1, 1, 1))
		tag.position = Vector2(8, 6)
		card.add_child(tag)
		card.pressed.connect(func():
			_pick = id
			for k in picks:
				picks[k].modulate = Color(1, 1, 1) if k == id else Color(0.5, 0.5, 0.55)
				picks[k].scale = Vector2.ONE * (1.06 if k == id else 1.0)
			refresh_badges.call())
		picks[id] = card
		card.modulate = Color(1, 1, 1) if id == _pick else Color(0.5, 0.5, 0.55)
		cards.add_child(card)
	badge_row.position = Vector2(60, 528)
	_menu.add_child(badge_row)
	refresh_badges.call()
	# right-hand menu
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	col.offset_left = -400.0
	col.offset_right = -50.0
	col.offset_top = -170.0
	col.offset_bottom = 230.0
	col.add_theme_constant_override("separation", 12)
	_menu.add_child(col)
	var fight := UiKit.button("FIGHT", Vector2(0, 70), 34)
	fight.pressed.connect(_begin_loading)
	col.add_child(fight)
	var ow := UiKit.button("OPEN WORLD", Vector2(0, 60), 26)
	ow.pressed.connect(func():
		_open = true
		_begin_loading())
	col.add_child(ow)
	var g := UiKit.button("GRAPHICS:  %s" % GraphicsSettings.mode_names()[_mode].to_upper(), Vector2(0, 48), 18)
	g.pressed.connect(func():
		_mode = ((_mode + 1) % 6) as GraphicsSettings.Mode
		g.text = "GRAPHICS:  %s" % GraphicsSettings.mode_names()[_mode].to_upper())
	col.add_child(g)
	var d := UiKit.button("AI LEVEL:  %s" % ["EASY", "NORMAL", "HARD"][_level], Vector2(0, 48), 18)
	d.pressed.connect(func():
		_level = ((_level + 1) % 3) as FightAI.Level
		d.text = "AI LEVEL:  %s" % ["EASY", "NORMAL", "HARD"][_level])
	col.add_child(d)
	var foot := UiKit.label("Fan game · not affiliated with the anime's owners", 13, Color(1, 1, 1, 0.6))
	foot.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	foot.offset_left = -420.0
	foot.offset_top = -34.0
	_menu.add_child(foot)

# ---------------------------------------------------------------- loading
func _begin_loading() -> void:
	if _menu != null:
		_menu.queue_free()
		_menu = null
	var ls := LoadingScreen.new()
	ls.min_show_time = 1.5 if _args.has("autostart") else 4.0
	var layer := CanvasLayer.new()
	layer.layer = 100
	add_child(layer)
	layer.add_child(ls)
	ls.finished.connect(func():
		layer.queue_free()
		_start_fight())

# ---------------------------------------------------------------- fight
func _clear_fight() -> void:
	for n in _fight_nodes:
		if is_instance_valid(n):
			n.queue_free()
	_fight_nodes.clear()

func _make_fighter(id: String, at: Vector3, tag: String) -> Fighter:
	var c := Roster.find(id)
	var f := Fighter.new()
	f.fighter_name = c["name"]
	f.moveset = c["moves"]
	f.name = tag
	f.collision_layer = 0
	f.collision_mask = 0
	f.position = at
	f.set_meta("domain", c["domain"])
	add_child(f)
	_fight_nodes.append(f)
	var v := FighterView.new()
	f.add_child(v)
	if not v.setup(f, c["model"], GraphicsSettings.use_cloth_sway(_mode), c.get("curl_fists", false)):
		push_error("could not load " + c["model"])
	return f

func _start_fight() -> void:
	var enemy_id := "sukuna" if _pick != "sukuna" else "gojo_open"
	var built: Dictionary
	if _open:
		built = _build_open_world()
	else:
		built = ArenaBuilder.build(_mode != GraphicsSettings.Mode.LOW)
	_world = built["root"]
	add_child(_world)
	if _open:
		_map.update(Vector3.ZERO)
		_map.build_all_now()
	_fight_nodes.append(_world)
	_dm = DestructionManager.new()
	_world.add_child(_dm)
	GraphicsSettings.apply(_mode, get_viewport(), built["env"], built["sun"], _dm)
	_player = _make_fighter(_pick, Vector3(-3, 0, 0), "Player")
	var enemy := _make_fighter(enemy_id, Vector3(3, 0, 0), "Enemy")
	var cam := ThirdPersonCamera.new()
	cam.target = _player
	cam.lock = enemy
	add_child(cam)
	_cam = cam
	_void = InfiniteVoidManager.new()
	_void.enemy_group = &"void_target"
	_world.add_child(_void)
	_shrine = ShrineDomain.new()
	_world.add_child(_shrine)
	_env = built["env"]
	_impact = ImpactFx.new()
	add_child(_impact)
	_fight_nodes.append(_impact)
	_fight_nodes.append(cam)
	var ai := FightAI.new()
	_ai = ai
	_enemy = enemy
	ai.fighter = enemy
	ai.level = _level
	add_child(ai)
	_fight_nodes.append(ai)
	var mc := MatchController.new()
	if _open:
		mc.round_time = 99999.0
		mc.rounds_to_win = 999
		mc.spawn_a = Vector3(0, 0, 0)
		mc.spawn_b = Vector3(0, 0, -40)
		for f in [_player, enemy]:
			f.ground_fn = _map.ground
	add_child(mc)
	_fight_nodes.append(mc)
	mc.setup(_player, enemy)
	var hud := FightHud.new()
	hud.open_world = _open
	add_child(hud)
	hud.bind(_player, enemy, mc, Roster.find(_pick)["moves"], Roster.find(enemy_id)["moves"])
	_fight_nodes.append(hud)
	_controls = FightControls.new()
	_controls.fighter = _player
	_controls.camera = cam
	_controls.moveset = Roster.find(_pick)["moves"]
	add_child(_controls)
	_fight_nodes.append(_controls)
	_cut = Cutscene.new()
	_cut.camera = cam
	_cut.freeze = [_player, enemy, ai]
	_cut.hide_layers = [hud, _controls]
	add_child(_cut)
	_fight_nodes.append(_cut)
	for f in [_player, enemy]:
		f.hit_dealt.connect(func(t: Fighter, m: Dictionary, dmg: float):
			cam.shake = minf(1.0, cam.shake + dmg * 0.03)
			_on_hit(t, m))
		var moves: String = Roster.find(_pick if f == _player else enemy_id)["moves"]
		f.move_phase.connect(func(name: String, phase: int): _on_move_phase(f, moves, name, phase))
		f.domain_used.connect(func(): _on_domain(f, moves))
	mc.round_ended.connect(func(_w):
		await get_tree().create_timer(2.8 if not _open else 4.0).timeout
		if _open and is_instance_valid(mc):
			# open world: the beaten fighter respawns somewhere near the player and the hunt goes on
			mc.spawn_a = _player.global_position
			mc.spawn_b = _player.global_position + Vector3(randf_range(-60, 60), 0, randf_range(-60, 60))
		if is_instance_valid(mc) and not mc.running and mc.wins.values().all(func(n): return n < mc.rounds_to_win):
			mc.start_round())
	mc.match_ended.connect(func(_w):
		await get_tree().create_timer(3.5).timeout
		_show_menu())
	_shot_clock = 0.0
	_auto = _args.get("script", "")

func _physics_process(_d: float) -> void:
	if _open and _map != null:
		for n in _fight_nodes:
			if n is Fighter:
				var f := n as Fighter
				f.position = _map.resolve(f.position)
				var lim := WorldGen.HALF - 150.0
				f.position.x = clampf(f.position.x, -lim, lim)
				f.position.z = clampf(f.position.z, -lim, lim)
		if _player != null:
			_map.update(_player.global_position)
		return
	for n in _fight_nodes:
		if n is Fighter:
			var p: Vector3 = n.position
			var flat := Vector2(p.x, p.z)
			if flat.length() > 16.0:
				flat = flat.normalized() * 16.0
				n.position.x = flat.x
				n.position.z = flat.y

func _process(delta: float) -> void:
	if _shot_clock < 0.0:
		return
	_shot_clock += delta
	if _auto != "" and _player != null:
		_run_script()
	if _args.has("memlog") and int(_shot_clock) != int(_shot_clock - delta):
		print("MEM t=%d static=%.0fMB video=%.0fMB tex=%.0fMB buf=%.0fMB objects=%d nodes=%d fps=%d prims=%d draws=%d" % [int(_shot_clock),
			Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
			Performance.get_monitor(Performance.RENDER_TEXTURE_MEM_USED) / 1048576.0, Performance.get_monitor(Performance.RENDER_BUFFER_MEM_USED) / 1048576.0,
			Performance.get_monitor(Performance.OBJECT_COUNT), Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
			Performance.get_monitor(Performance.TIME_FPS), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
			Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)])
	if _args.has("memlog") and int(_shot_clock) == 8 and int(_shot_clock - delta) == 7:
		_dump_textures()
	if _args.has("quit_t") and _shot_clock >= float(_args["quit_t"]):
		get_tree().quit()
	if _args.has("shot") and _shot_clock >= float(_args.get("shot_t", "4")):
		get_viewport().get_texture().get_image().save_png(_args["shot"])
		get_tree().quit()

## memlog: which textures the live scene holds, biggest first (width x height and the resource path), to find what eats video memory.
func _dump_textures() -> void:
	var seen := {}
	for n in get_tree().root.find_children("*", "GeometryInstance3D", true, false):
		var mats: Array = []
		if n is MeshInstance3D and (n as MeshInstance3D).mesh != null:
			var mi := n as MeshInstance3D
			for si in mi.mesh.get_surface_count():
				mats.append(mi.get_active_material(si))
		elif n is MultiMeshInstance3D and (n as MultiMeshInstance3D).multimesh != null and (n as MultiMeshInstance3D).multimesh.mesh != null:
			var mm := (n as MultiMeshInstance3D).multimesh.mesh
			for si in mm.get_surface_count():
				mats.append(mm.surface_get_material(si))
		mats.append((n as GeometryInstance3D).material_override)
		for m in mats:
			if m is BaseMaterial3D:
				for t in [m.albedo_texture, m.normal_texture, m.roughness_texture, m.metallic_texture, m.emission_texture, m.orm_texture]:
					if t != null:
						seen[t] = true
			elif m is ShaderMaterial and m.shader != null:
				for u in m.shader.get_shader_uniform_list():
					var v = m.get_shader_parameter(u["name"])
					if v is Texture2D:
						seen[v] = true
	var tri := {}
	for n in get_tree().root.find_children("*", "GeometryInstance3D", true, false):
		if not (n as Node3D).is_visible_in_tree():
			continue
		var mesh: Mesh = null
		var count := 1
		if n is MeshInstance3D:
			mesh = (n as MeshInstance3D).mesh
		elif n is MultiMeshInstance3D and (n as MultiMeshInstance3D).multimesh != null:
			mesh = (n as MultiMeshInstance3D).multimesh.mesh
			count = (n as MultiMeshInstance3D).multimesh.visible_instance_count
			if count < 0:
				count = (n as MultiMeshInstance3D).multimesh.instance_count
		if mesh == null:
			continue
		var t := 0
		for si in mesh.get_surface_count():
			var a := mesh.surface_get_arrays(si)
			var ix = a[Mesh.ARRAY_INDEX]
			t += (ix.size() if ix != null else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
		var key := "%s %s" % [n.get_class(), mesh.resource_path if mesh.resource_path != "" else String(n.name)]
		tri[key] = tri.get(key, 0) + t * count
	var trows := []
	for k in tri:
		trows.append([tri[k], k])
	trows.sort_custom(func(a, b): return a[0] > b[0])
	for r in trows.slice(0, 25):
		print("TRI %8d %s" % r)
	var rows := []
	var total := 0.0
	for t in seen:
		var mb: float = t.get_width() * t.get_height() * 1.33 / 1048576.0
		total += mb
		rows.append([mb, "%dx%d %s" % [t.get_width(), t.get_height(), t.resource_path]])
	rows.sort_custom(func(a, b): return a[0] > b[0])
	print("TEX count=%d est_at_1Bpp=%.0fMB" % [rows.size(), total])
	for r in rows.slice(0, 30):
		print("TEX  ", r[1])

func _run_script() -> void:
	var t := _shot_clock
	match _auto:
		"jab":
			if int(t * 3.0) % 2 == 0:
				_controls.tap("light")
		"fly":
			if t > 0.5 and t < 0.7:
				_controls.tap("fly")
		"demo":
			_player.energy = maxf(_player.energy, 40.0) if t > 6.0 and t < 7.0 else _player.energy
			if t < 5.5:
				if int(t * 3.0) % 2 == 0:
					_controls.tap("light")
			elif t < 6.4:
				_controls.tap("heavy")
			elif t > 7.0 and t < 7.3:
				_player.energy = 100.0
				_controls.tap("special")
			elif t > 9.0 and t < 9.2:
				_controls.tap("fly")
			elif t > 11.5 and t < 14.0:
				_controls.stick = Vector2(0.9, 0.0)
			elif t >= 14.0 and t < 14.2:
				_controls.stick = Vector2.ZERO
			elif t > 15.0 and t < 15.2:
				_controls.tap("fly")
			elif t > 17.0 and t < 17.2:
				_player.energy = 100.0
				_controls.tap("ultimate")
			elif t > 17.5 and t < 22.0 and int(t * 3.0) % 2 == 0:
				_controls.tap("light")
		"demo2":
			if t < 3.5:
				if int(t * 3.0) % 2 == 0:
					_controls.tap("light")
			elif t > 3.8 and t < 4.0:
				_player.energy = 100.0
				_controls.tap("special")
			elif t > 6.0 and t < 6.2:
				_player.energy = 100.0
				_controls.tap("domain")
			elif t > 7.6 and t < 11.5:
				if int(t * 3.0) % 2 == 0:
					_controls.tap("light")
			elif t > 13.0 and t < 13.2:
				_player.energy = 100.0
				_controls.tap("ultimate")
			elif t > 15.5 and t < 15.7:
				_controls.tap("fly")
			elif t > 16.5 and t < 19.0:
				_controls.stick = Vector2(0.8, 0.5)
			elif t >= 19.0 and t < 19.2:
				_controls.stick = Vector2.ZERO
		"domain":
			if t > 0.5 and t < 0.7:
				_player.energy = 100.0
				_controls.tap("domain")
			elif t > 2.5 and int(t * 3.0) % 2 == 0:
				_controls.tap("light")
		"demo3":
			if t < 2.5:
				if int(t * 3.0) % 2 == 0:
					_controls.tap("light")
			elif t > 2.8 and t < 3.0:
				_player.energy = 100.0
				_controls.tap("skill2")
			elif t > 4.6 and t < 4.8:
				_player.energy = 100.0
				_controls.tap("special")
			elif t > 6.5 and t < 6.7:
				_player.energy = 100.0
				_controls.tap("domain")
			elif t > 8.2 and t < 10.8:
				if int(t * 3.0) % 2 == 0:
					_controls.tap("light")
			elif t > 12.0 and t < 12.2:
				_player.energy = 100.0
				_player.health = maxf(_player.health, 60.0)
				_controls.tap("ultimate")
			elif t > 15.5 and t < 15.7:
				_player.energy = 100.0
				_player.health = minf(_player.health, 45.0)
				_controls.tap("ultimate")
		"skill2":
			if t > 0.5 and t < 0.7:
				_player.energy = 100.0
				_controls.tap("skill2")
		"lowult":
			if t > 0.5 and t < 0.7:
				_player.energy = 100.0
				_player.health = 40.0
				_controls.tap("ultimate")
		"ult":
			if t > 0.5 and t < 0.7:
				_player.energy = 100.0
				_controls.tap("ultimate")
		"skill":
			if t > 0.5 and t < 0.7:
				_player.energy = 100.0
				_controls.tap("special")
		"mix":
			if t > 0.5 and t < 0.7:
				_controls.tap("fly")
			elif t > 2.0 and int(t * 4.0) % 2 == 0:
				_controls.tap("light")

## Effects of a landed move: sparks on heavy hits, a burst and a small fire on a skill, towers coming down on an ultimate.
func _on_hit(target: Fighter, move: Dictionary) -> void:
	var at := target.global_position
	at.y = 0.0
	var cost: float = move.get("cost", 0.0)
	var q := GraphicsSettings.preset(_mode)
	if cost >= 100.0:
		_impact.hitstop(0.12, 0.05)
		_dm.blast(at, 7.0, 1.4)
		var near: Array = get_tree().get_nodes_in_group("buildings").filter(func(b): return b.is_inside_tree() and not b.has_meta("collapsed"))
		near.sort_custom(func(a, b): return a.global_position.distance_to(at) < b.global_position.distance_to(at))
		for i in mini(3, near.size()):
			BuildingCollapse.run(near[i], _dm, _world, 1.0 if q["particles"] > 0.5 else 0.5, _rng)
	elif cost >= 30.0:
		_dm.blast(at, 3.5, 0.9)
		var fire := FireFx.new()
		fire.radius = 1.4
		fire.burn_time = 7.0
		fire.intensity = 1.0 if q["particles"] > 0.5 else 0.5
		fire.position = at + Vector3(0, 0.3, 0)
		_world.add_child(fire)
	else:
		var heavy := float(move.get("damage", 0.0)) >= 12.0
		MoveVfx.hit_spark(_world, target.global_position + Vector3.UP * 1.25, heavy)
		_impact.hitstop(0.07 if heavy else 0.035, 0.08)
		if heavy:
			_dm.blast(at, 1.6, 0.35)

## Character-specific effects as a move winds up (phase 0) and fires (phase 1).
func _on_move_phase(f: Fighter, moves: String, name: String, phase: int) -> void:
	if phase > 1:
		return
	var o := f.opponent
	match [moves, name]:
		["gojo", "special"]:
			MoveVfx.gojo_red(_world, f, o, phase)
		["gojo", "skill2"]:
			MoveVfx.gojo_blue(_world, f, o, phase)
		["gojo", "ultimate"]:
			MoveVfx.gojo_purple(_world, f, o, phase)
		["gojo", "purple200"]:
			MoveVfx.gojo_purple(_world, f, o, phase, 2.2)
		["sukuna", "special"]:
			MoveVfx.sukuna_dismantle(_world, f, o, phase)
		["sukuna", "skill2"]:
			MoveVfx.sukuna_cleave(_world, f, o, phase)
		["sukuna", "ultimate"]:
			MoveVfx.sukuna_fuga(_world, f, o, phase)
		["sukuna", "world_slash"]:
			MoveVfx.sukuna_world_slash(_world, f, o, phase)
	var big := name in ["ultimate", "purple200", "world_slash", "domain"]
	if big and phase == 0 and _cut != null and not _cut.playing:
		match [moves, name]:
			["gojo", "domain"]:
				_cut.play(_shots_void(f, o))
			["sukuna", "domain"]:
				_cut.play(_shots_shrine(f, o))
			["gojo", "ultimate"], ["gojo", "purple200"]:
				_cut.play(_shots_purple(f, o))
			["sukuna", "ultimate"], ["sukuna", "world_slash"]:
				_cut.play(_shots_sukuna_super(f, o, name))
	if big and phase == 1:
		if _cam != null:
			_cam.shake = 1.0
		_impact.impact_frame(2 if name != "ultimate" else 1)
		_impact.speed_lines(0.5)
		if name == "world_slash":
			_impact.screen_cut()
		if name in ["ultimate", "purple200", "world_slash"]:
			_destroy_ahead(f, 80.0 if name != "ultimate" else 55.0, 22.0 if name != "ultimate" else 16.0)

const MOVE_TITLES := {
	"gojo_ultimate": "HOLLOW PURPLE", "gojo_purple200": "HOLLOW PURPLE 200%", "gojo_domain": "DOMAIN EXPANSION\nINFINITE VOID",
	"sukuna_ultimate": "FUGA", "sukuna_world_slash": "WORLD-CUTTING SLASH", "sukuna_domain": "DOMAIN EXPANSION\nMALEVOLENT SHRINE",
}

## Domain Expansion: Gojo opens Infinite Void (the opponent freezes completely), Sukuna raises the Malevolent Shrine (endless slashes).
func _on_domain(f: Fighter, moves: String) -> void:
	var o := f.opponent
	if o == null:
		return
	var now := Time.get_ticks_msec() / 1000.0
	if now - float(f.get_meta("domain_at", -99.0)) < 4.0:
		return                      # the cutscene already opened it; the move's own trigger arrives afterwards
	f.set_meta("domain_at", now)
	MoveVfx.domain_burst(_world, f, Color(0.35, 0.6, 1.0) if moves == "gojo" else Color(0.9, 0.08, 0.06))
	if moves == "gojo":
		o.add_to_group("void_target")
		_void.activate(f.global_position)
		var hidden: Array[Node3D] = []
		for c in _world.get_children():
			if c is Node3D and c != _void and c != _dm and c != _shrine and not (c is DirectionalLight3D) and (c as Node3D).visible:
				(c as Node3D).visible = false
				hidden.append(c)
		get_tree().create_timer(8.0).timeout.connect(func() -> void:
			for h in hidden:
				if is_instance_valid(h):
					h.visible = true
			if is_instance_valid(_void) and _void.active:
				_void.deactivate()
			if is_instance_valid(o):
				o.remove_from_group("void_target"))
	else:
		_shrine.activate(f, _env, not (_cut != null and _cut.playing) and f == _player)
	_impact.impact_frame(2)

func _hud_flash(text: String) -> void:
	for n in _fight_nodes:
		if n is FightHud:
			(n as FightHud).flash(text, 1.2)

## Open world: the streamed 5.6 km city with sky, sun and fog; the fight systems run on top of it unchanged.
func _build_open_world() -> Dictionary:
	var root := Node3D.new()
	root.name = "OpenWorld"
	for n in ModelCatalog.TOWERS + ModelCatalog.MIDRISE + ModelCatalog.TREES:
		ModelCatalog.entry(n)        # load every model now, behind the loading screen, so streaming never hitches on a first use
	_map = WorldMap.new()
	_map.view_chunks = [2, 3, 4, 5, 5, 3][_mode]
	var eff := GraphicsSettings.auto_mode() if _mode == GraphicsSettings.Mode.AUTO else int(_mode)
	_map.tree_keep = [0.3, 0.5, 0.75, 1.0, 1.0][eff]
	_map.tree_range = [170.0, 260.0, 0.0, 0.0, 0.0][eff]
	_map.light_trees = eff <= GraphicsSettings.Mode.STANDARD
	root.add_child(_map)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-42, -35, 0)
	sun.light_color = Color(1.0, 0.9, 0.78)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	root.add_child(sun)
	var env := Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.12, 0.2, 0.42)
	sky_mat.sky_horizon_color = Color(0.7, 0.55, 0.5)
	sky_mat.ground_horizon_color = Color(0.35, 0.3, 0.3)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 1.1
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.05
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.fog_enabled = true
	env.fog_light_color = Color(0.6, 0.55, 0.6)
	env.fog_density = 0.0028 if _map.view_chunks <= 3 else 0.0018
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	return {"root": root, "sun": sun, "env": env}

## Beams and world slashes bring down whatever towers stand in their path, hit or miss.
func _destroy_ahead(f: Fighter, length: float, width: float) -> void:
	var fwd := -f.global_transform.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	var hits := []
	for b in get_tree().get_nodes_in_group("buildings"):
		if not is_instance_valid(b) or not b.is_inside_tree() or b.has_meta("collapsed"):
			continue
		var to: Vector3 = b.global_position - f.global_position
		to.y = 0.0
		var along := to.dot(fwd)
		if along < 0.0 or along > length:
			continue
		if (to - fwd * along).length() < width + float(b.get_meta("width", 10.0)) * 0.5:
			hits.append([along, b])
	hits.sort_custom(func(a, c): return a[0] < c[0])
	var q := GraphicsSettings.preset(_mode)
	for i in mini(4, hits.size()):
		BuildingCollapse.run(hits[i][1], _dm, _world, 1.0 if q["particles"] > 0.5 else 0.5, _rng)

# ---------------------------------------------------------------- cinematics (staged like the console game: cut-ins, close-ups, flashes)

func _face(f: Node3D, dist: float, side := 0.35, up := 1.65) -> Array:
	var fwd := -f.global_transform.basis.z
	var sv := fwd.cross(Vector3.UP).normalized()
	var face := f.global_position + Vector3.UP * up
	return [face + fwd * dist + sv * side, face]

func _hand_shot(f: Node3D, side_sign := -1.0) -> Array:
	# close on the raised hand with the face behind it
	var fwd := -f.global_transform.basis.z
	var sv := fwd.cross(Vector3.UP).normalized()
	var hand := f.global_position + Vector3.UP * 1.62 + sv * side_sign * 0.12 + fwd * 0.18
	return [hand + fwd * 0.62 + sv * side_sign * 0.18 + Vector3.UP * 0.04, hand]

func _eye_shot(f: Node3D, k: float) -> Array:
	var fwd := -f.global_transform.basis.z
	var eye := f.global_position + Vector3.UP * 1.78 + fwd * 0.08
	return [eye + fwd * lerpf(0.55, 0.38, k) + Vector3.UP * 0.01, eye]

func _sparkles(at: Node3D, c: Color, secs: float) -> void:
	var p := GPUParticles3D.new()
	p.amount = 60
	p.lifetime = 1.2
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.9
	pm.gravity = Vector3(0, 0.3, 0)
	pm.scale_min = 0.02
	pm.scale_max = 0.07
	p.process_material = pm
	var q := QuadMesh.new()
	var m := MoveVfx.glow_mat(c, 3.0)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.albedo_texture = DestructionVfx.spark_texture()
	q.material = m
	p.draw_pass_1 = q
	_world.add_child(p)
	p.global_position = at.global_position + Vector3.UP * 1.6
	get_tree().create_timer(secs).timeout.connect(func():
		if is_instance_valid(p):
			p.queue_free())

func _end_sign(f: Fighter) -> void:
	f.remove_meta("pose_override")
	f.remove_meta("show_hands")

## Infinite Void on the real rig (~3.3 s): finger-sign close-up -> the eye -> the void bursts open -> the enemy's brain floods -> Gojo among the stars.
func _shots_void(f: Fighter, o: Fighter) -> Array:
	return [
		{"t": 0.8, "tint": Color(0.1, 0.3, 0.9, 0.1),
			"start": func():
				f.set_meta("show_hands", true)
				f.set_meta("pose_override", PoseLib.gojo_sign()),
			"cam": func(k: float) -> Array: return _hand_shot(f, -1.0)},
		{"t": 0.5, "tint": Color(0.2, 0.5, 1.0, 0.12), "cam": func(k: float) -> Array: return _eye_shot(f, k)},
		{"t": 0.9, "flash": Color(1, 1, 1, 1), "lines": Color(0.85, 0.95, 1.0, 0.8),
			"start": func(): _on_domain(f, "gojo"),
			"cam": func(k: float) -> Array:
				var a := k * 2.0
				var c := f.global_position + Vector3.UP * 1.4
				return [c + Vector3(sin(a) * 3.2, 0.4 + k * 0.8, cos(a) * 3.2), c]},
		{"t": 0.6, "lines": Color(1, 1, 1, 0.9), "cam": func(k: float) -> Array: return _face(o, 1.2 - k * 0.25, 0.15, 1.65)},
		{"t": 0.55,
			"start": func():
				_sparkles(f, Color(0.5, 0.85, 1.0), 1.0)
				_end_sign(f),
			"cam": func(k: float) -> Array: return _face(f, 1.1 - k * 0.2, 0.25, 1.7)},
	]

## Malevolent Shrine (~3.3 s): the seal -> the shrine rises -> Gojo braces -> the cuts -> Sukuna's face in red light.
func _shots_shrine(f: Fighter, o: Fighter) -> Array:
	return [
		{"t": 0.8, "tint": Color(0.6, 0.0, 0.0, 0.12),
			"start": func():
				f.set_meta("show_hands", true)
				f.set_meta("pose_override", PoseLib.sukuna_seal()),
			"cam": func(k: float) -> Array:
				var r := _hand_shot(f, 0.0)
				return [(r[0] as Vector3) + (-f.global_transform.basis.z) * 0.35 - Vector3.UP * 0.05, (r[1] as Vector3) - Vector3.UP * 0.12]},
		{"t": 1.0, "flash": Color(1, 0.2, 0.15, 0.8),
			"start": func(): _on_domain(f, "sukuna"),
			"cam": func(k: float) -> Array:
				var fwd := -f.global_transform.basis.z
				var base := f.global_position
				return [base + fwd * (7.5 - k * 1.5) + Vector3.UP * (0.6 + k * 0.6), base + Vector3.UP * (2.0 + k * 4.0) - fwd * 6.0]},
		{"t": 0.5, "start": func(): o.set_meta("brace", true), "cam": func(k: float) -> Array: return _face(o, 2.4 - k * 0.4, -0.6, 1.3)},
		{"t": 0.6, "web": true, "lines": Color(0.1, 0.0, 0.0, 0.6),
			"start": func():
				for i in 4:
					MoveVfx.slash_burst(_world, o.global_position + Vector3.UP * (0.6 + i * 0.4), 5, 3.0),
			"cam": func(k: float) -> Array: return _face(o, 3.0, 1.2, 1.2)},
		{"t": 0.45, "tint": Color(0.5, 0.0, 0.0, 0.15),
			"start": func():
				o.remove_meta("brace")
				_end_sign(f),
			"cam": func(k: float) -> Array: return _face(f, 1.0 - k * 0.15, -0.2, 1.72)},
	]

## Hollow Purple (~1.2 s): Blue and Red gather at the hands -> the eye -> flash, then the shot leaves.
func _shots_purple(f: Fighter, o: Fighter) -> Array:
	return [
		{"t": 0.6, "lines": Color(0.75, 0.5, 1.0, 0.6),
			"cam": func(k: float) -> Array:
				var r := _face(f, 1.7, 0.9, 1.45)
				return [(r[0] as Vector3) + Vector3.UP * k * 0.2, (r[1] as Vector3) - f.global_transform.basis.z * 0.9]},
		{"t": 0.45, "tint": Color(0.5, 0.3, 1.0, 0.12), "cam": func(k: float) -> Array: return _eye_shot(f, k)},
		{"t": 0.12, "flash": Color(1, 1, 1, 1), "cam": func(k: float) -> Array: return _face(f, 3.0, 2.0, 1.4)},
	]

func _shots_sukuna_super(f: Fighter, o: Fighter, name: String) -> Array:
	var shots := [
		{"t": 0.7, "lines": Color(1, 0.4, 0.3, 0.6), "tint": Color(0.5, 0.0, 0.0, 0.1), "cam": func(k: float) -> Array: return _face(f, 1.6 - k * 0.3, 0.8, 1.5)},
	]
	if name == "world_slash":
		shots.append({"t": 0.4, "web": true, "flash": Color(1, 1, 1, 0.9), "cam": func(k: float) -> Array: return _face(o, 3.0, -1.0, 1.3)})
	return shots
