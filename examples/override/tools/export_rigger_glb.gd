extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/export_rigger_glb.gd -- warden crawler hunter
## Writes assets/rigger/<model>.glb in Rigger's layout (rigger/GAME_BRIEF.md): Character > Rig (the 49 bones) + Mesh (skinned),
## one looping clip named "Take", facing +Z. Anything that loads a Rigger export (the Rkk demo, check_import.gd) loads these.


func _init() -> void:
	DirAccess.make_dir_recursive_absolute("res://assets/rigger")
	for model in OS.get_cmdline_user_args():
		_export(model)
	quit()


func _export(model: String) -> void:
	var ch := Node3D.new()
	ch.name = "Character"
	root.add_child(ch)
	var sk := Rig.build_skeleton(model)
	sk.name = "Rig"
	ch.add_child(sk)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = load("%s%s_skin.res" % [Rig.DIR, model])
	mi.skin = Rig.build_skin(model)
	mi.material_override = Assets.original_material(model)
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var ap := AnimationPlayer.new()
	ap.name = "AnimationPlayer"
	ch.add_child(ap)
	var lib := Rig.library(model)
	var take: Animation = lib.get_animation("walk").duplicate()
	for t in range(take.get_track_count()):
		take.track_set_path(t, NodePath(String(take.track_get_path(t)).replace("Skeleton:", "Rig:")))
	var out := AnimationLibrary.new()
	out.add_animation("Take", take)
	ap.add_animation_library("", out)
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	var err := doc.append_from_scene(ch, st)
	if err == OK:
		err = doc.write_to_filesystem(st, "res://assets/rigger/%s.glb" % model)
	print("%s -> assets/rigger/%s.glb  err %d" % [model, model, err])
	ch.queue_free()
