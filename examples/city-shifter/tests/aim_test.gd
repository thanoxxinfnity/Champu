extends SceneTree
## Aim assist (Free Fire's default lock): a shot fired roughly at an enemy goes at the enemy; with the assist off it does not.
##   godot --headless --path . --fixed-fps 60 -s tests/aim_test.gd

func _initialize() -> void:
	var g := await T.boot(self, "outlaw")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 30)
	var p: PlayerController = g.player
	for b in g.mc._brains:
		b.set_physics_process(false)
	var foes := Combat.enemies(p)
	T.check(not foes.is_empty(), "there are enemies (%d)" % foes.size())
	var t: PlayerController = foes[0]
	for f in foes:
		if f != t:
			f.global_position = Vector3(0, -500, 0)             # everybody else out of the picture
	p.global_position = Vector3(0, 40, 0)
	p.velocity = Vector3.ZERO
	t.global_position = Vector3(10, 41, -22)
	t.velocity = Vector3.ZERO
	await T.frames(self, 3)
	p.yaw = 0.0
	p.pitch = 0.0
	var want := (Combat.center(t) - p.eye()).normalized()
	var off := p.aim_dir().angle_to(want)
	T.check(off > deg_to_rad(15.0) and off < deg_to_rad(33.0), "the crosshair is %.0f degrees off the enemy" % rad_to_deg(off))
	p.assist_level = 2
	var d := p.assisted_dir(p.aim_dir())
	T.check(d.angle_to(want) < deg_to_rad(1.0), "full assist: the shot goes at the enemy (%.1f deg off)" % rad_to_deg(d.angle_to(want)))
	t.global_position = Vector3(4, 41, -22)
	await T.frames(self, 2)
	p.yaw = 0.0
	p.pitch = 0.0
	want = (Combat.center(t) - p.eye()).normalized()
	off = p.aim_dir().angle_to(want)
	p.assist_level = 1
	d = p.assisted_dir(p.aim_dir())
	T.check(d.angle_to(want) < off * 0.7 and d.angle_to(want) > deg_to_rad(2.0), "low assist leans towards the enemy (%.0f of %.0f deg)" % [rad_to_deg(d.angle_to(want)), rad_to_deg(off)])
	p.yaw = 0.0
	p.pitch = 0.0
	p.assist_level = 0
	d = p.assisted_dir(p.aim_dir())
	T.check(d.angle_to(p.aim_dir()) < 0.001, "assist off: the shot goes where the crosshair points")
	# a wide miss is not locked: the enemy 90 degrees to the side
	t.global_position = Vector3(40, 41, 0)
	await T.frames(self, 2)
	p.assist_level = 2
	p.yaw = 0.0
	T.check(p.find_lock() == null, "an enemy far outside the cone is not locked")
	# a real shot: the pistol fired near the enemy hurts it
	t.global_position = Vector3(10, 41, -26)
	await T.frames(self, 3)
	p.yaw = 0.0
	p.pitch = 0.0
	p.tool.equip("nova_blaster")
	p.tool.cd_left = 0.0
	t.shield = 0.0
	var hp0 := t.hp
	p.tool.fire()
	await T.frames(self, 6)
	T.check(t.hp < hp0, "a shot fired off to the side still hit the locked enemy (%.0f -> %.0f)" % [hp0, t.hp])
	T.check(p.tool.inventory.has("nova_blaster"), "everybody carries the Nova Blaster from the start")
	T.done(self)
