extends SceneTree
## godot --headless --path . -s tests/rig_test.gd
## The creatures carry Rigger's 49-bone humanoid contract (rigger/GAME_BRIEF.md): the names resolve, the fingers are real
## bones with their own animation keys, every clip drives bones that exist, and the pose actually changes.

var fails := 0

const CONTRACT := ["hips", "spine", "chest", "neck", "head", "thighL", "shinL", "footL", "toeL", "thighR", "shinR", "footR", "toeR",
	"upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR"]


func check(ok: bool, what: String) -> void:
	if not ok:
		fails += 1
		print("FAIL ", what)


func _initialize() -> void:
	for model in ["warden", "crawler", "hunter"]:
		_model(model)
	print("ALL OK" if fails == 0 else "FAILED %d" % fails)
	quit(fails)


func _model(model: String) -> void:
	var m := Rig.make(model, 2.0)
	check(m != null, "%s: Rig.make" % model)
	if m == null:
		return
	root.add_child(m)
	var sk := m.get_meta("skeleton") as Skeleton3D
	check(sk.get_bone_count() == 49, "%s: 49 bones, got %d" % [model, sk.get_bone_count()])
	for n in CONTRACT:
		check(sk.find_bone(n) != -1, "%s: bone %s" % [model, n])
	for k in ["L", "R"]:
		for f in Rig.FINGERS:
			for i in [1, 2, 3]:
				check(sk.find_bone("%s%d%s" % [f, i, k]) != -1, "%s: finger %s%d%s" % [model, f, i, k])
	check(sk.get_bone_parent(sk.find_bone("hips")) == -1, "%s: hips is the root" % model)
	check(sk.get_bone_name(sk.get_bone_parent(sk.find_bone("index2R"))) == "index1R", "%s: index2R hangs on index1R" % model)
	check(sk.get_bone_name(sk.get_bone_parent(sk.find_bone("pinky1L"))) == "handL", "%s: pinky1L hangs on handL" % model)
	var body := sk.get_node("Body") as MeshInstance3D
	check(body.skin != null and body.skin.get_bind_count() == 49, "%s: skin binds all 49" % model)
	check(body.mesh is ArrayMesh, "%s: the skinned mesh is baked" % model)
	var ap := m.get_meta("anim") as AnimationPlayer
	for c in ap.get_animation_list():
		var an := ap.get_animation(c)
		check(an.loop_mode == Animation.LOOP_LINEAR, "%s/%s loops" % [model, c])
		for t in range(an.get_track_count()):
			var path := String(an.track_get_path(t))
			var bone := path.get_slice(":", 1)
			check(sk.find_bone(bone) != -1, "%s/%s drives a bone that exists: %s" % [model, c, bone])
		var fingers := 0
		for t in range(an.get_track_count()):
			var bn := String(an.track_get_path(t)).get_slice(":", 1)
			if bn.ends_with("1L") or bn.ends_with("2L") or bn.ends_with("3L") or bn.ends_with("1R") or bn.ends_with("2R") or bn.ends_with("3R"):
				fingers += 1
		check(fingers == 30, "%s/%s keys all 30 finger bones (%d)" % [model, c, fingers])
	# the fingers move: a fist in "stomp", an open hand in "scream", differing from each other and from the bind pose
	var i1 := sk.find_bone("middle2L")
	var rest := sk.get_bone_rest(i1).basis.get_rotation_quaternion()
	ap.play("stomp")
	ap.seek(0.3, true)
	sk.force_update_all_bone_transforms()
	var fist := sk.get_bone_pose_rotation(i1)
	ap.play("scream")
	ap.seek(0.3, true)
	sk.force_update_all_bone_transforms()
	var open := sk.get_bone_pose_rotation(i1)
	check(not fist.is_equal_approx(rest), "%s: fingers leave the bind pose" % model)
	check(fist.angle_to(open) > 0.4, "%s: fist and open hand differ (%.2f rad)" % [model, fist.angle_to(open)])
	# a blend between clips has no snap: first frame of "walk" is close to the last frame of "idle"-> only checked for continuity of looping
	var walk := ap.get_animation("walk")
	var tr := walk.find_track(NodePath("Skeleton:thighL"), Animation.TYPE_ROTATION_3D)
	check(tr != -1, "%s: walk keys thighL" % model)
	if tr != -1:
		var a: Quaternion = walk.track_get_key_value(tr, 0)
		var b: Quaternion = walk.track_get_key_value(tr, walk.track_get_key_count(tr) - 1)
		check(a.is_equal_approx(b), "%s: walk loops without a snap" % model)
	# code can still take over any bone (the Rigger README's way): set a finger from script
	ap.stop()
	sk.set_bone_pose_rotation(i1, Quaternion(Vector3.BACK, 1.2))
	check(absf(sk.get_bone_pose_rotation(i1).z - sin(0.6)) < 0.01, "%s: a finger can be driven from code" % model)
	m.queue_free()
