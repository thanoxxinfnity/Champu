extends SceneTree
## Plays through the town on a script and photographs it. Needs a display:
##   xvfb-run godot --path . --rendering-driver opengl3 --fixed-fps 60 -s tests/shots.gd -- <out_dir>
## It teleports the player to each place, gives guns where the story would, and
## saves a PNG per stop, plus a line of render stats.

var game: Game
var out := "user://shots"
var plan: Array = []
var step := 0
var wait := 0
var frame := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(game)
	if args.size() > 1 and args[1] == "video":
		plan = _video_plan()
		return
	if args.size() > 1 and args[1] == "action":
		plan = _action_plan()
		return
	if args.size() > 1 and args[1] == "screens":
		plan = [
			[150, func() -> void: pass, "title"],
			[5, func() -> void: game.begin(), ""],
			[30, func() -> void: game.set_paused(true), ""],
			[10, func() -> void: pass, "pause"],
			[5, func() -> void: game.set_paused(false); game.player.take_damage(99999.0, Vector3.ZERO), ""],
			[120, func() -> void: pass, "death"],
			[5, func() -> void: game.win(), ""],
			[20, func() -> void: pass, "win"],
		]
		return
	plan = [
		[30, func() -> void: pass, "title"],
		[5, func() -> void: game.begin(), ""],
		[90, func() -> void: pass, "ward_start"],
		[2, func() -> void: _at(Vector3(-12, 0, -69), PI), ""],
		[40, func() -> void: pass, "ward_cabinet"],
		[2, func() -> void: game.player.give_weapon("pistol"), ""],
		[2, func() -> void: _at(Vector3(-3, 0, -76), -PI * 0.5), ""],
		[60, func() -> void: pass, "clinic_corridor"],
		[2, func() -> void: _at(Vector3(5, 0, -66), PI * 0.9), ""],
		[40, func() -> void: _fire_at_nearest(), ""],
		[20, func() -> void: pass, "clinic_fight"],
		[2, func() -> void: _at(Vector3(0, 0, -56), PI), ""],
		[80, func() -> void: pass, "street_start"],
		[2, func() -> void: _at(Vector3(1, 0, -40), PI - 0.3), ""],
		[60, func() -> void: pass, "police_car"],
		[2, func() -> void: _at(Vector3(-22, 0, 3), PI * 0.5), ""],
		[60, func() -> void: pass, "gas_station"],
		[2, func() -> void: game.player.give_weapon("shotgun"), ""],
		[2, func() -> void: _at(Vector3(18, 0, 24), -PI * 0.5), ""],
		[60, func() -> void: pass, "church_gate"],
		[2, func() -> void: _at(Vector3(36, 0, 26), -PI * 0.5), ""],
		[60, func() -> void: pass, "church_yard"],
		[2, func() -> void: _at(Vector3(52, 0, 40), PI * 0.3), ""],
		[60, func() -> void: pass, "graveyard"],
		[2, func() -> void: game.player.give_weapon("rifle"), ""],
		[2, func() -> void: _at(Vector3(0, 0, 82), PI), ""],
		[90, func() -> void: pass, "south_road"],
		[2, func() -> void: _at(Vector3(0, 0, 100), PI), ""],
		[100, func() -> void: pass, "boss_arena"],
		[2, func() -> void: game.hud.show_touch = true; game.hud.set_playing(true), ""],
		[30, func() -> void: pass, "touch_hud"],
	]


## Clean frames, no HUD, to be used as the first frame of a generated video.
func _video_plan() -> Array:
	return [
		[5, func() -> void: game.begin(), ""],
		[5, func() -> void:
			game.hud.visible = false
			game.player.give_weapon("pistol")
			game.player.give_weapon("rifle")
			game.player.equip("rifle")
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			_at(Vector3(0, 0, 14), 0.0)
			var kinds := ["walker", "runner", "cop", "nurse", "walker", "bloater"]
			for i in range(kinds.size()):
				var z: Zombie = game.spawn_enemy(kinds[i], Vector3(-7.0 + 2.8 * i, 0, -4.0 - 3.0 * (i % 3)))
				z.alerted = true, ""],
		[80, func() -> void: pass, "v5_street_horde"],
		[2, func() -> void: _fire_at_nearest(), ""],
		[2, func() -> void: pass, "v5_muzzle"],
		[5, func() -> void:
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			_at(Vector3(5, 0, -78), PI * 0.5)
			var z1: Zombie = game.spawn_enemy("nurse", Vector3(-1, 0, -77))
			z1.alerted = true
			var z2: Zombie = game.spawn_enemy("walker", Vector3(-4, 0, -75))
			z2.alerted = true, ""],
		[60, func() -> void: pass, "v5_clinic"],
		[5, func() -> void:
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			_at(Vector3(0, 0, 96), PI)
			var b: Zombie = game.spawn_enemy("warden", Vector3(1, 0, 112))
			b.alerted = true, ""],
		[50, func() -> void: pass, "v6_warden"],
		[5, func() -> void:
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			_at(Vector3(-6, 0, 100), PI * 0.8)
			game.player.pitch = 0.05, ""],
		[40, func() -> void: pass, "v6_helicopter"],
		[5, func() -> void: _at(Vector3(40, 0, 30), -PI * 0.5), ""],
		[40, func() -> void: pass, "v5_church_yard"],
		[5, func() -> void: _at(Vector3(54, 0, 44), PI * 0.35), ""],
		[40, func() -> void: pass, "v5_graveyard"],
	]


## Ghouls coming down the road at the camera, a gunfight and a boss.
func _action_plan() -> Array:
	return [
		[5, func() -> void: game.begin(), ""],
		[5, func() -> void:
			game.player.give_weapon("pistol")
			game.player.give_weapon("shotgun")
			_at(Vector3(0, 0, 10), 0.0)
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			var kinds := ["walker", "runner", "cop", "nurse", "bloater"]
			for i in range(kinds.size()):
				var z: Zombie = game.spawn_enemy(kinds[i], Vector3(-6.0 + 3.0 * i, 0, -8.0 - 2.0 * (i % 2)))
				z.alerted = true, ""],
		[30, func() -> void: pass, "horde_1"],
		[40, func() -> void: pass, "horde_2"],
		[25, func() -> void: _fire_at_nearest(), ""],
		[2, func() -> void: pass, "muzzle_flash"],
		[30, func() -> void: _fire_at_nearest(), ""],
		[3, func() -> void: pass, "gunfight"],
		[60, func() -> void: _at(Vector3(0, 0, 80), PI), ""],
		[5, func() -> void:
			for z in get_nodes_in_group("enemies"):
				(z as Node).queue_free()
			var b: Zombie = game.spawn_enemy("warden", Vector3(2, 0, 100))
			b.alerted = true
			game.hud.boss_hp(1.0), ""],
		[60, func() -> void: pass, "boss_1"],
		[90, func() -> void: pass, "boss_2"],
	]


func _at(p: Vector3, yaw: float) -> void:
	game.player.global_position = p
	game.player.yaw = yaw
	game.player.pitch = -0.1
	game.player.velocity = Vector3.ZERO


func _fire_at_nearest() -> void:
	var e := get_nodes_in_group("enemies")
	if e.is_empty():
		return
	var z := e[0] as Zombie
	game.player.look_at_point(z.chest())
	game.player._cd = 0.0
	game.player._try_fire()


func _process(_d: float) -> bool:
	frame += 1
	if frame == 1:
		wait = int(plan[0][0])   # the first stop waits too, or it photographs an unrendered frame
	if step >= plan.size():
		print("frames ", frame, "  draw calls ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "  prims ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
		quit(0)
		return true
	if wait > 0:
		wait -= 1
		return false
	var s: Array = plan[step]
	if s[2] != "":
		var img := root.get_viewport().get_texture().get_image()
		img.save_png("%s/%02d_%s.png" % [out, step, s[2]])
		print("shot ", s[2], "  draw calls ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "  tris ", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
	(s[1] as Callable).call()
	step += 1
	if step < plan.size():
		wait = int(plan[step][0])
	return false
