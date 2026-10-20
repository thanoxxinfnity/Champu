extends Node
## Entry point: title menu (character, mode, graphics, difficulty) -> loading screen -> fight. Everything is built in code.
## Test hooks (user args after `--`): `autostart=<roster id>` skips the menu; `shot=<png>` saves a screenshot after `shot_t=<seconds>` and quits;
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
func _show_menu() -> void:
	_clear_fight()
	_menu = Control.new()
	_menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_menu)
	var bg := TextureRect.new()
	bg.texture = load("res://assets/loading/01_versus.jpg")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	bg.modulate = Color(0.55, 0.55, 0.6)
	_menu.add_child(bg)
	var col := VBoxContainer.new()
	col.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	col.offset_left = 60.0
	col.offset_top = -230.0
	col.offset_right = 520.0
	col.offset_bottom = 230.0
	col.add_theme_constant_override("separation", 12)
	_menu.add_child(col)
	col.add_child(UiKit.label("CURSED CLASH", 66, UiKit.ACCENT))
	col.add_child(UiKit.label("SHIBUYA SHOWDOWN  ·  Gojo vs Sukuna (fan game)", 18))
	col.add_child(UiKit.label("Choose your fighter", 20))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	col.add_child(row)
	var picks := {}
	for id in PICKS:
		var b := UiKit.button(Roster.find(id)["name"], Vector2(150, 56), 15)
		b.pressed.connect(func():
			_pick = id
			for k in picks:
				picks[k].modulate = Color(1, 1, 1) if k == id else Color(0.6, 0.6, 0.6))
		picks[id] = b
		b.modulate = Color(1, 1, 1) if id == _pick else Color(0.6, 0.6, 0.6)
		row.add_child(b)
	var g := UiKit.button("Graphics: %s" % GraphicsSettings.mode_names()[_mode], Vector2(0, 46), 16)
	g.pressed.connect(func():
		_mode = ((_mode + 1) % 6) as GraphicsSettings.Mode
		g.text = "Graphics: %s" % GraphicsSettings.mode_names()[_mode])
	col.add_child(g)
	var d := UiKit.button("AI level: %s" % ["Easy", "Normal", "Hard"][_level], Vector2(0, 46), 16)
	d.pressed.connect(func():
		_level = ((_level + 1) % 3) as FightAI.Level
		d.text = "AI level: %s" % ["Easy", "Normal", "Hard"][_level])
	col.add_child(d)
	var fight := UiKit.button("FIGHT", Vector2(0, 62), 26)
	fight.pressed.connect(_begin_loading)
	col.add_child(fight)
	var ow := UiKit.button("OPEN WORLD", Vector2(0, 56), 22)
	ow.pressed.connect(func():
		_open = true
		_begin_loading())
	col.add_child(ow)

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
	if not v.setup(f, c["model"], GraphicsSettings.use_cloth_sway(_mode)):
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
	if _args.has("quit_t") and _shot_clock >= float(_args["quit_t"]):
		get_tree().quit()
	if _args.has("shot") and _shot_clock >= float(_args.get("shot_t", "4")):
		get_viewport().get_texture().get_image().save_png(_args["shot"])
		get_tree().quit()

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
	if big and phase == 0:
		_hud_flash(MOVE_TITLES.get(moves + "_" + name, ""))
		if name != "ultimate" and _cam != null:
			_cam.cinematic(f, 1.0)
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
	if moves == "gojo":
		o.add_to_group("void_target")
		_void.activate(f.global_position)
		var hidden: Array[Node3D] = []
		for c in _world.get_children():
			if c is Node3D and c != _void and c != _dm and c != _shrine and not (c is DirectionalLight3D) and (c as Node3D).visible:
				(c as Node3D).visible = false
				hidden.append(c)
		get_tree().create_timer(5.0).timeout.connect(func() -> void:
			for h in hidden:
				if is_instance_valid(h):
					h.visible = true
			if is_instance_valid(_void) and _void.active:
				_void.deactivate()
			if is_instance_valid(o):
				o.remove_from_group("void_target"))
	else:
		_shrine.activate(f, _env, f == _player)
	_impact.impact_frame(2)

func _hud_flash(text: String) -> void:
	for n in _fight_nodes:
		if n is FightHud:
			(n as FightHud).flash(text, 1.2)

## Open world: the streamed 5.6 km city with sky, sun and fog; the fight systems run on top of it unchanged.
func _build_open_world() -> Dictionary:
	var root := Node3D.new()
	root.name = "OpenWorld"
	_map = WorldMap.new()
	_map.view_chunks = [2, 3, 4, 5, 5, 3][_mode]
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
