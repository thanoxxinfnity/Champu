extends SceneTree
## Weapon animation: every weapon has a style, its frames are sane, the held model follows the hand, and the arms really reach the grip.
##   godot --headless --path . --fixed-fps 60 -s tests/weapon_anim_test.gd

func _initialize() -> void:
	for id in Data.WEAPON_ORDER + Data.MELEE_ORDER:
		var st := WeaponAnim.style_of(id)
		T.check(WeaponAnim.STYLES.has(st), "%s has the style %s" % [id, st])
		var ok := true
		for t in [0.0, 0.1, 0.2, 0.35, 0.5, 0.7, 5.0]:
			var f := WeaponAnim.frame(id, t, 1.75)
			ok = ok and (f.pos as Vector3).length() < 3.0 and absf((f.dir as Vector3).length() - 1.0) < 0.01
		T.check(ok, "%s: frames stay near the body with a unit direction" % id)
	T.check(WeaponAnim.frame("hammer", 0.28 * WeaponAnim.duration("hammer"), 1.75).pos.y > 1.7, "the hammer goes up over the head")
	T.check(WeaponAnim.frame("hammer", 0.55 * WeaponAnim.duration("hammer"), 1.75).pos.y < 1.3, "and comes down")
	T.check(WeaponAnim.frame("katana", 0.62 * WeaponAnim.duration("katana"), 1.75).pos.x < 0.0, "the katana cuts across to the left")
	T.check(WeaponAnim.frame("spear", 0.42 * WeaponAnim.duration("spear"), 1.75).pos.z < -0.6, "the spear is thrust forward")
	var g := await T.boot(self, "samurai")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 20)
	var p: PlayerController = g.player
	var tool: GauntletTool = p.tool
	tool.equip("hammer")
	await T.frames(self, 30)
	T.check(tool.held != null and tool.held.get_parent() == p.avatar.holder(), "the weapon lives in the hero's holder node")
	T.check(p.avatar.grip_r != null, "the right hand has a grip")
	var rest_hand: Vector3 = p.avatar.rig.skeleton.global_transform * p.avatar.rig.skeleton.get_bone_global_pose(p.avatar.rig.idx["handR"]).origin
	var gp: Vector3 = p.avatar.holder().global_transform * (p.avatar.grip_r as Vector3)
	T.check(rest_hand.distance_to(gp) < 0.35, "the hand is at the grip at rest (%.2f m off)" % rest_hand.distance_to(gp))
	tool.cd_left = 0.0
	tool.fire()
	var worst := 0.0
	var top := 0.0
	var steps := 0
	while tool.anim_t < WeaponAnim.duration("hammer") and steps < 120:
		await process_frame
		steps += 1
		var h: Vector3 = p.avatar.rig.skeleton.global_transform * p.avatar.rig.skeleton.get_bone_global_pose(p.avatar.rig.idx["handR"]).origin
		var grip: Vector3 = p.avatar.holder().global_transform * (p.avatar.grip_r as Vector3)
		worst = maxf(worst, h.distance_to(grip))
		top = maxf(top, h.y)
	T.check(worst < 0.45, "through the swing the hand stays on the weapon (worst %.2f m)" % worst)
	T.check(top > p.global_position.y + 1.6, "and the hand really goes up (%.2f m)" % (top - p.global_position.y))
	T.done(self)
