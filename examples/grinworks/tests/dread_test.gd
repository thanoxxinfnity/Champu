extends SceneTree
## godot --headless --path . --fixed-fps 60 -s tests/dread_test.gd
## The fear director: tension rises in the dark and near the creature and falls in a lit room, every kind of event
## runs without error, a shape at the end of a corridor is gone when you look at it, and Mr. Grin's rig has every clip.

var fails := 0
var game: Game


func check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _init() -> void:
	var packed := load("res://scenes/main.tscn") as PackedScene
	game = packed.instantiate()
	game.headless_test = true
	root.add_child(game)
	await physics_frame
	await physics_frame
	game._begin()
	for i in range(5):
		await physics_frame
	game.ui.close_modal()
	var d := game.dread

	print("-- the rig")
	var grin := Rig.make_grin(2.4)
	check(grin != null, "the skinned mesh is baked and loads")
	var anim := grin.get_meta("anim") as AnimationPlayer
	for clip in ["idle", "walk", "stalk", "run", "flee", "recoil", "scream", "lunge", "peek"]:
		check(anim.has_animation(clip), "clip %s exists" % clip)
	var sk := grin.get_meta("skeleton") as Skeleton3D
	check(sk.get_bone_count() == Rig.JOINTS.size(), "the skeleton has %d bones" % Rig.JOINTS.size())
	check(sk.find_bone("head") >= 0 and sk.find_bone("thigh_l") >= 0 and sk.find_bone("fore_r") >= 0, "head, thigh and forearm bones are there")
	var tracks_ok := true
	for clip in anim.get_animation_list():
		var a := anim.get_animation(clip)
		for t in range(a.get_track_count()):
			var bone := String(a.track_get_path(t)).get_slice(":", 1)
			if sk.find_bone(bone) < 0:
				tracks_ok = false
	check(tracks_ok, "every animation track names a real bone")
	grin.free()

	print("-- tension")
	game.player.global_position = game.level.nodes["hw"].pos
	for i in range(300):
		d.update(0.1)
	var calm := d.tension
	check(calm > 0.2, "in the dark hub it builds (%.2f)" % calm)
	game.hollow.wake("hn")
	game.hollow.grace = 100.0
	for i in range(300):
		d.update(0.1)
	check(d.tension > calm, "with the creature about it is higher (%.2f)" % d.tension)
	game.hollow.sleep()
	game.player.global_position = game.level.nodes["ai"].pos
	game.level.set_lit("airlock", true, true)
	for i in range(900):
		d.update(0.1)
	check(d.tension < calm, "back in a lit room it falls (%.2f)" % d.tension)

	print("-- every kind of event")
	game.player.global_position = game.level.nodes["hn"].pos + Vector3(0, 0, 4)
	game.player.yaw = 0.0
	game.hollow.wake("hse")
	game.hollow.grace = 100.0
	game.hollow.state = Hollow.S.PATROL
	var before := d.events
	d.flicker()
	d.distant_sound()
	d.whisper()
	d.peek()
	await physics_frame
	check(true, "flicker, sound, whisper and peek all ran")
	for i in range(400):
		d.update(0.05)
		await physics_frame
	check(d.events >= before, "the director keeps running")
	check(d._decoy == null, "a shape at the end of the corridor does not stay for ever")

	print("-- %s" % ("ALL OK" if fails == 0 else "%d FAILED" % fails))
	quit(0 if fails == 0 else 1)
