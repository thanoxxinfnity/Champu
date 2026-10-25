extends SceneTree
## In-game animation check: the player walks/runs sideways past the camera (side view), swings, rolls, gets hurt and dies; one PNG per action.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/anim_shots.gd -- /tmp/out rachel

func shot(out: String, name: String) -> void:
	root.get_texture().get_image().save_png("%s/anim_%s.png" % [out, name])


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0] if args.size() > 0 else "/tmp/cm/out"
	var id := args[1] if args.size() > 1 else "rachel"
	root.size = Vector2i(1280, 720)
	var game := await T.boot(self, id)
	await T.start(self, game)
	game.hud.visible = false
	var p := game.player
	p.global_position = Vector3(-3, 0, -30)
	p.yaw = 0.0
	p.pitch = -0.05
	p.cam.fov = 40.0
	await T.frames(self, 10)
	p.move_input = Vector2(0, -1)
	p.sprint = false
	for i in 4:
		await T.frames(self, 7)
		print("walk frame ", i, " clip_t ", snappedf(p.view._clip_t, 0.01), " tL ", (p.view._last_dict.get("tL", Vector3.ZERO) as Vector3).snapped(Vector3.ONE * 0.01))
		shot(out, "walk_%d" % i)
	p.sprint = true
	for i in 4:
		await T.frames(self, 6)
		shot(out, "run_%d" % i)
	p.move_input = Vector2.ZERO
	p.sprint = false
	await T.frames(self, 20)
	p.has_crowbar = true
	p.try_attack()
	for i in 4:
		await T.frames(self, 5)
		shot(out, "swing_%d" % i)
	await T.frames(self, 40)
	p.try_roll()
	p.move_input = Vector2(1, 0)
	for i in 3:
		await T.frames(self, 8)
		shot(out, "roll_%d" % i)
	p.move_input = Vector2.ZERO
	await T.frames(self, 40)
	p.take_damage(10.0, p.global_position + Vector3(-1, 0, 0))
	await T.frames(self, 10)
	shot(out, "hurt")
	p.take_damage(400.0, p.global_position + Vector3(-1, 0, 0))
	await T.frames(self, 30)
	shot(out, "death_0")
	await T.frames(self, 50)
	shot(out, "death_1")
	quit()
