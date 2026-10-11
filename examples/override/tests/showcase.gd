extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 --resolution 1280x720 -s tests/showcase.gd -- <dir>
## The things a recording of the bot rarely shows: the creatures up close, the pack on frosted glass, a quest paper, the hurt picture.

var game: Game
var out := "/tmp/ovshow"


func shot(name: String, frames := 14) -> void:
	for i in range(frames):
		await process_frame
	root.get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name])
	print("saved ", name)


func creature(kind: String, pos: Vector3, yaw_deg: float, clip: String) -> Enemy:
	var e := Enemy.new()
	e.kind = kind
	e.game = game
	e.position = pos
	e.rotation_degrees.y = yaw_deg
	game.world.loaded[game.world.current].add_child(e)
	game.enemies.append(e)
	e.process_mode = Node.PROCESS_MODE_DISABLED
	await process_frame
	if e._anim != null:
		e._anim.play(clip)
	return e


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	game = (load("res://scenes/main.tscn") as PackedScene).instantiate() as Game
	game.headless_test = true
	Game.autostart = true
	game.enemies_off = true
	root.add_child(game)
	for i in range(40):
		await process_frame
	game.ui.close_modal()
	game.player.equip_emp()
	game.player.emp_charges = 4
	game.player.torch_on = true
	await shot("00_start")

	# The hall, with the three kinds of creature in the torch.
	game.player.global_position = Vector3(12.5, 0, 4)
	game.player.yaw = deg_to_rad(-90)
	game.player.pitch = deg_to_rad(-3)
	for e in game.enemies:
		e.queue_free()
	game.enemies.clear()
	await creature("warden", Vector3(20, 0, 4), 90.0, "stomp")
	await shot("01_warden")
	for e in game.enemies:
		e.queue_free()
	game.enemies.clear()
	await creature("hunter", Vector3(18, 0, 3.5), 90.0, "sweep")
	await shot("02_hunter")
	for e in game.enemies:
		e.queue_free()
	game.enemies.clear()
	await creature("crawler", Vector3(17, 0, 4), 90.0, "crawl")
	await shot("03_crawler")
	for e in game.enemies:
		e.queue_free()
	game.enemies.clear()
	var w := await creature("warden", Vector3(17, 0, 4), 90.0, "recoil")
	await shot("04_warden_stunned")
	w.queue_free()
	game.enemies.clear()

	# Blood: the first observation glass of the hall, and a wall with hand prints.
	game.world.focus("c1_hall")
	for i in range(6):
		await process_frame
	for room in ["c1_hall", "c1_server", "c1_store", "c1_cryo"]:
		if not game.world.loaded.has(room):
			continue
		var holder: Node = game.world.loaded[room].get_node_or_null("Blood")
		if holder == null:
			continue
		for c in holder.get_children():
			if c is Node3D and not c is MeshInstance3D:
				var nrm: Vector3 = c.global_transform.basis.z
				game.player.global_position = c.global_position + nrm * 2.6 - Vector3(0, c.global_position.y, 0)
				game.player.yaw = atan2(nrm.x, nrm.z) * -1.0 + PI
				game.player.pitch = 0.0
				game.player.rotation.y = game.player.yaw
				await shot("04e_glass_" + room, 25)
				break
	game.world.focus("c1_cryo")
	for i in range(6):
		await process_frame
	game.player.global_position = Vector3(5, 0, 5.2)
	game.player.yaw = 0.0
	game.player.rotation.y = 0.0
	game.player.pitch = 0.0
	await shot("04f_pods", 25)
	game.player.global_position = Vector3(12.5, 0, 4)
	game.player.yaw = deg_to_rad(-90)

	# Putting something down: it lies in the torch where it was left.
	game.player.global_position = Vector3(12.5, 0, 4)
	game.player.yaw = deg_to_rad(-90)
	game.s.inv = ["keycard", "gel"]
	game.drop_item(1)
	game.player.pitch = deg_to_rad(-38)
	await shot("04a_dropped", 20)
	game.player.pitch = deg_to_rad(-3)

	# The sound meter and the scrap button: loud, then still.
	game.s.inv = ["scrap", "scrap", "scrap", "fuse"]
	game.player.noise_level = 0.9
	await shot("04b_hud_loud", 3)
	game.player.noise_level = 0.0
	await shot("04c_hud_still", 3)

	# Hurt: the shaken picture with red edges and the heartbeat's pulse.
	game.player.health = 1
	game.ui.set_health(1)
	game.ui.flash_red()
	game.ui.blood_on_screen(true)
	game.player.shake(0.8)
	await shot("05_hurt", 12)
	game.player.health = 3
	game.ui.set_health(3)

	# Paper.
	game.read_paper(null, "p_flood")
	await shot("06_paper", 90)
	game.ui.close_modal()

	# The pack.
	game.s.inv = ["fuse", "wiring", "timer", "gel", "keycard", "fuse", "cable", "scrap", "scrap", "scrap", "fuse", "scrap", "wiring"]
	game.ui.show_pack()
	await shot("07_pack", 40)
	game.ui.slot_tap(1)
	game.ui.slot_tap(2)
	await shot("08_pack_crafted", 40)
	game.ui.close_modal()

	# The title.
	game.ui.show_title(true)
	await shot("09_title", 50)
	quit()
