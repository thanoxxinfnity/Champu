class_name FighterView
extends Node3D
## The visible half of a Fighter: loads the character glb, drives its skeleton from the Fighter's state with PoseLib, smooths between
## poses, and runs the cloth sway on the sway bones.

var fighter: Fighter
var rig: RigAnimator
var cloth: ClothSway
var _cur := {}
var _t := 0.0
var _ko_t := 0.0
var _was_ko := false

func setup(f: Fighter, model_path: String, sway := true) -> bool:
	fighter = f
	rig = RigAnimator.new()
	add_child(rig)
	if not rig.load_model(model_path):
		return false
	rig.set_fists(true)
	if sway:
		cloth = ClothSway.new()
		cloth.skeleton = rig.skeleton
		add_child(cloth)
		cloth.build()
	_cur = PoseLib.stance(0.0)
	return true

func _target_pose() -> Dictionary:
	var f := fighter
	var speed := clampf(Vector2(f.velocity.x, f.velocity.z).length() / maxf(f.move_speed, 0.1), 0.0, 1.5)
	match f.state:
		Fighter.State.KO:
			return PoseLib.ko(_ko_t / 0.6)
		Fighter.State.HIT:
			return PoseLib.hit(f.hit_progress())
		Fighter.State.BLOCK:
			return PoseLib.block()
		Fighter.State.DODGE:
			return PoseLib.dodge()
		Fighter.State.ATTACK:
			var info := f.attack_info()
			if not info.is_empty():
				return PoseLib.attack(info["kind"], info["phase"], info["k"])
	if f.flying:
		var clip := AnimClip.load_clip("fly_fast_side" if speed > 0.25 else "fly_hover_gojo")
		if clip != null:
			return clip.sample(_t)
		return PoseLib.fly_fast(_t) if speed > 0.25 else PoseLib.fly_hover(_t)
	if speed > 0.1:
		return PoseLib.walk(_t, speed)
	return PoseLib.stance(_t)

func _process(delta: float) -> void:
	if fighter == null or rig == null:
		return
	_t += delta
	if fighter.state == Fighter.State.KO:
		if not _was_ko:
			_ko_t = 0.0
		_ko_t += delta
	_was_ko = fighter.state == Fighter.State.KO
	var tgt := _target_pose()
	# attacks are already eased by their own phases; everything else is smoothed so cuts between poses do not snap
	var rate := 26.0 if fighter.state == Fighter.State.ATTACK else 12.0
	_cur = PoseLib.mix(_cur, tgt, clampf(rate * delta, 0.0, 1.0))
	rig.apply(PoseLib.build(_cur))
