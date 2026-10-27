extends SceneTree
## A gameplay film of the real game, played by a scripted bot with the game's own controls and camera:
## lobby (hero emote, the 360 viewer), loading screen, run, jetpack flight, aim-assisted shots, melee, the cannon, a car.
##   xvfb-run -a godot --rendering-driver opengl3 --path . --write-movie /tmp/film.avi --fixed-fps 30 --resolution 960x540 -s tests/film.gd
## (heroes with files in private/cast show their licensed models: the film is for the owner, not for the repository)

var game: Main
var p: PlayerController
const FPS := 30


func wait(secs: float, each := Callable()) -> void:
	for i in int(secs * FPS):
		if each.is_valid():
			each.call(i)
		await process_frame


func nearest_enemy() -> PlayerController:
	var best: PlayerController = null
	var bd := 1.0e9
	for e in Combat.enemies(p):
		var d := p.global_position.distance_to(e.global_position)
		if d < bd:
			bd = d
			best = e
	return best


func face(t: Node3D, off := 0.0) -> void:
	var to := t.global_position - p.global_position
	p.yaw = lerp_angle(p.yaw, atan2(-to.x, -to.z) + off, 0.25)


func keep_alive() -> void:
	p.hp = p.max_hp
	p.shield = maxf(p.shield, 1.0)
	p.fuel = maxf(p.fuel, p.max_fuel * 0.5)


func _initialize() -> void:
	game = await T.boot(self, "kafu")
	game.save.coins = 3200
	game.bot_mode = true
	game.lobby.set_save(game.save)
	# ── the lobby
	await wait(2.0)
	game.lobby.hero_tapped.emit()
	await wait(2.2)
	game.lobby.show_screen("view")
	await wait(1.5, func(_i: int) -> void: game.lobby.view_drag.emit(Vector2(3, 0)))
	game.lobby.view_cat.emit("weapons")
	game.view_i = Data.WEAPON_ORDER.find("nova_blaster")
	game._view_show()
	await wait(2.5, func(_i: int) -> void: game.lobby.view_drag.emit(Vector2(4, 0)))
	game.view_i = Data.WEAPON_ORDER.size() + Data.MELEE_ORDER.find("hammer_big")
	game._view_show()
	await wait(2.0)
	game.lobby.show_screen("home")
	await wait(1.0)
	# ── loading and the first steps
	game.mode = "world"
	game.match_type = "solo"
	game.begin_match()
	var guard := 0
	while game.state != Main.State.PLAY and guard < 900:
		await process_frame
		guard += 1
	await wait(1.5)
	p = game.player
	p.assist_level = 2
	for b in game.mc._brains:
		b.set_physics_process(true)
	game.hud.toast("Aim assist: the shot goes at the enemy", 3.0)
	await wait(0.5)
	p.move_input = Vector2(0, 1)
	await wait(3.0, func(i: int) -> void:
		keep_alive()
		p.yaw += 0.006 * sin(float(i) * 0.05))
	# ── jetpack flight towards the nearest enemy
	var foe := nearest_enemy()
	p.press_jump()
	p.jet_held = true
	await wait(7.0, func(i: int) -> void:
		keep_alive()
		foe = nearest_enemy()
		if foe != null:
			face(foe)
			if i > 60 and p.global_position.distance_to(foe.global_position) < 38.0:
				p.move_input = Vector2.ZERO
		p.jet_held = p.global_position.y < 14.0 or (i % 40) < 28)
	p.jet_held = false
	# ── shots (the crosshair is deliberately off: the lock does the aiming)
	p.tool.equip("nova_blaster")
	await wait(1.0, func(_i: int) -> void: keep_alive())
	var shots := 0
	await wait(9.0, func(i: int) -> void:
		keep_alive()
		foe = nearest_enemy()
		if foe == null:
			return
		var d := p.global_position.distance_to(foe.global_position)
		p.move_input = Vector2(0, 1) if d > 30.0 else Vector2.ZERO
		face(foe, 0.12)
		if d < 45.0 and i % 18 == 0:
			p.tool.cd_left = 0.0
			if p.tool.fire():
				shots += 1)
	print("shots fired: ", shots)
	# ── melee: a bot brought close, the hammer swings
	p.tool.equip("hammer_big")
	foe = nearest_enemy()
	if foe != null:
		foe.global_position = p.global_position + p.flat_forward() * 3.0 + Vector3(0, 0.5, 0)
	await wait(5.0, func(i: int) -> void:
		keep_alive()
		foe = nearest_enemy()
		if foe != null:
			face(foe)
		if i % 40 == 0:
			p.tool.cd_left = 0.0
			p.tool.fire())
	p.tool.equip("katana")
	await wait(3.0, func(i: int) -> void:
		keep_alive()
		if i % 14 == 0:
			p.tool.cd_left = 0.0
			p.tool.fire())
	# ── the cannon at the ground ahead
	p.tool.give("genesis_cannon")
	p.tool.equip("genesis_cannon")
	p.pitch = -0.12
	await wait(1.2, func(_i: int) -> void: keep_alive())
	for k in 2:
		p.tool.cd_left = 0.0
		p.tool.charge["genesis_cannon"] = 1.0
		p.tool.fire()
		await wait(1.6, func(_i: int) -> void: keep_alive())
	# ── a car
	p.tool.equip("shift_gauntlet")
	var m: Mount = null
	for mm in game.world.mounts:
		if (mm as Mount) is Vehicle and (mm as Mount).is_free():
			m = mm
			break
	if m != null:
		p.global_position = m.global_position + Vector3(2.5, 1.0, 0)
		await wait(0.6)
		game._ride()
		await wait(7.0, func(i: int) -> void:
			keep_alive()
			if p.mount != null:
				p.mount.set_input(1.0, 0.45 * sin(float(i) * 0.04), false, false))
		game._ride()
	await wait(1.5)
	print("film done")
	quit()
