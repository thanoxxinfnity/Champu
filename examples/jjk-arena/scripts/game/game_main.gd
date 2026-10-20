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
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if _args.has("graphics"):
		_mode = GraphicsSettings.mode_names().find(_args["graphics"]) as GraphicsSettings.Mode
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
	col.add_child(UiKit.label("JJK ARENA", 64, UiKit.ACCENT))
	col.add_child(UiKit.label("Gojo vs Sukuna — fan fighting game", 18))
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
	var ow := UiKit.button("OPEN WORLD  (coming next)", Vector2(0, 46), 16)
	ow.disabled = true
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
	var built := ArenaBuilder.build(_mode != GraphicsSettings.Mode.LOW)
	_world = built["root"]
	add_child(_world)
	_fight_nodes.append(_world)
	_dm = DestructionManager.new()
	_world.add_child(_dm)
	GraphicsSettings.apply(_mode, get_viewport(), built["env"], built["sun"], _dm)
	_player = _make_fighter(_pick, Vector3(-3, 0, 0), "Player")
	var enemy := _make_fighter(enemy_id, Vector3(3, 0, 0), "Enemy")
	var cam := FightCamera.new()
	cam.a = _player
	cam.b = enemy
	add_child(cam)
	_fight_nodes.append(cam)
	var ai := FightAI.new()
	ai.fighter = enemy
	ai.level = _level
	add_child(ai)
	_fight_nodes.append(ai)
	var mc := MatchController.new()
	add_child(mc)
	_fight_nodes.append(mc)
	mc.setup(_player, enemy)
	var hud := FightHud.new()
	add_child(hud)
	hud.bind(_player, enemy, mc)
	_fight_nodes.append(hud)
	_controls = FightControls.new()
	_controls.fighter = _player
	_controls.camera = cam
	add_child(_controls)
	_fight_nodes.append(_controls)
	for f in [_player, enemy]:
		f.hit_dealt.connect(func(t: Fighter, m: Dictionary, dmg: float):
			cam.shake = minf(1.0, cam.shake + dmg * 0.03)
			_on_hit(t, m))
	mc.round_ended.connect(func(_w):
		await get_tree().create_timer(2.8).timeout
		if is_instance_valid(mc) and not mc.running and mc.wins.values().all(func(n): return n < mc.rounds_to_win):
			mc.start_round())
	mc.match_ended.connect(func(_w):
		await get_tree().create_timer(3.5).timeout
		_show_menu())
	_shot_clock = 0.0
	_auto = _args.get("script", "")

func _physics_process(_d: float) -> void:
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
	elif float(move.get("damage", 0.0)) >= 12.0:
		_dm.blast(at, 1.6, 0.35)
