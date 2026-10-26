extends SceneTree
## A bot plays Chapter 1 from the title screen to the epilogue with the real controls: move stick (camera-relative), attack, roll, use, craft.
## It follows the waypoint the HUD shows, walks the nav grid, fights what stands in its way and rolls through the Bellkeeper's toll.
##   godot --headless --fixed-fps 60 --path . -s tests/playthrough.gd -- [character]      (prints ALL OK when the chapter is finished)

var game: Game
var _last_mission := -1
var _stuck := 0.0
var _last_pos := Vector3.ZERO
var _side := 1.0
var deaths := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	game = await T.boot(self, args[0] if args.size() > 0 else "rachel")
	await T.start(self, game)
	var p := game.player
	p.max_hp = 600.0      # the bot is not a good fighter: three times the health, same enemies
	p.hp = 600.0
	var frames := 0
	var budget := 30000
	while frames < budget and not game.story.finished:
		await process_frame
		frames += 1
		if game.state == Game.State.DEAD:
			deaths += 1
			await T.frames(self, 130)
			game.retry()
			p.max_hp = 600.0
			p.hp = 600.0
			continue
		if game.state != Game.State.PLAYING:
			continue
		if game.hud.is_modal():
			if OS.get_cmdline_user_args().has("--debug") and frames % 60 == 0:
				print("  modal screen ", game.hud.screen, " inv ", p.inventory, " crafted ", game.story.crafted.keys(), " mission ", game.story.mission)
			_craft_everything()
			game.hud.hide_all_screens()
			continue
		_think(p, frames)
	print("damage taken by kind: ", Bestiary.dealt)
	T.check(game.story.finished, "the bot finished Chapter 1 (mission %d, %d frames, %d deaths)" % [game.story.mission, frames, deaths])
	T.check(deaths <= 4, "the bot did not need more than 4 retries (%d)" % deaths)
	T.check(game.player.has_crowbar and game.player.has_pistol, "weapons were found on the way")
	T.check(game.companions.size() == 2, "both companions joined")
	T.done(self)


func _craft_everything() -> void:
	for r in Data.RECIPES:
		if game.story.mission == 3 and not game.story.crafted.has(r):
			game.story.craft(r)


func _think(p: Player, frames: int) -> void:
	var st := game.story
	if st.mission != _last_mission:
		_last_mission = st.mission
		print("mission ", st.mission + 1, " at frame ", frames, " hp ", int(p.hp))
	p.yaw = 0.0
	p.pitch = -0.1
	if frames % 900 == 0 and OS.get_cmdline_user_args().has("--debug"):
		var ni := game.nearest_interactable()
		print("  f", frames, " pos ", p.global_position.snapped(Vector3.ONE * 0.1), " marker ", st.marker, " has ", st.has_marker, " near ", ni.kind + ":" + ni.value if ni else "-", " enemies ", get_nodes_in_group("enemies").size(), " stuck ", snappedf(_stuck, 0.1))
	game.hud.held["sprint"] = false
	game.hud.move = Vector2.ZERO
	# 1. the toll: roll through a ring that reaches us
	for n in game.get_children():
		if n is Shockwave:
			var sw := n as Shockwave
			var d := Vector2(p.global_position.x - sw.global_position.x, p.global_position.z - sw.global_position.z).length()
			if absf(d - sw.radius) < 2.6:
				game.hud.pressed["dodge"] = true
	# 2. fight: anything awake and close
	var e := game.nearest_enemy_to(p.global_position, 9.0)
	if e != null and (e.state == Enemy.S.CHASE or e.state == Enemy.S.WINDUP or e.state == Enemy.S.STRIKE or e.global_position.distance_to(p.global_position) < 4.0):
		var to := e.global_position - p.global_position
		to.y = 0
		if to.length() > 1.9:
			_walk_to(p, e.global_position, 1.0)
		else:
			game.hud.pressed["attack"] = true
			if p.hp < p.max_hp * 0.4 and p.count("bandage") > 0:
				game.hud.pressed["bandage"] = true
		return
	# 3. use what is in reach (loot, doors, prisoners, the generator, the barricade, the workbench)
	var it := game.nearest_interactable()
	if it != null:
		var at_marker := st.has_marker and it.global_position.distance_to(st.marker) < 4.5
		var wanted := it.kind in ["loot", "note"] or at_marker
		if it.kind == "loot" and it.value == "ammo" and p.count("ammo") >= 30:
			wanted = false
		if wanted:
			game.hud.pressed["use"] = true
			return
	# 4. follow the waypoint
	if st.has_marker:
		_walk_to(p, st.marker, 1.6)
	elif st.mission == 0:
		_walk_to(p, game.world.spots.exit, 1.0)


func _walk_to(p: Player, target: Vector3, stop_dist: float) -> void:
	var here := p.global_position
	if Vector2(target.x - here.x, target.z - here.z).length() < stop_dist:
		return
	var path := game.world.nav.path(here, target)
	var dest := target
	if not path.is_empty():
		var i := 0
		while i < path.size() - 1 and Vector2(path[i].x - here.x, path[i].z - here.z).length() < 0.8:
			i += 1
		dest = path[i]
	var d := dest - here
	d.y = 0
	if d.length() < 0.05:
		return
	d = d.normalized()
	# stuck? sidestep for a moment
	if here.distance_to(_last_pos) < 0.01:
		_stuck += 1.0 / 60.0
	else:
		_stuck = 0.0
	_last_pos = here
	if _stuck > 1.2:
		d = d.rotated(Vector3.UP, 1.2 * _side)
		if _stuck > 2.4:
			_stuck = 0.0
			_side = -_side
	var fwd := Vector3(-sin(p.yaw), 0, -cos(p.yaw))
	var right := Vector3(cos(p.yaw), 0, -sin(p.yaw))
	game.hud.move = Vector2(d.dot(right), -d.dot(fwd)).limit_length(1.0)
	game.hud.held["sprint"] = Vector2(target.x - here.x, target.z - here.z).length() > 12.0
