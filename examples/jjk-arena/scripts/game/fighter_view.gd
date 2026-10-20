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

## Punches and kicks come from real motion capture (CMU database, tools/bvh_to_pose.py); techniques keep their hand-made signature poses.
const MOCAP_ATTACKS := {"light1": "mc_jab", "light2": "mc_cross", "light3": "mc_hook", "heavy": "mc_kick_round", "sukuna_heavy": "mc_kick_front"}

func setup(f: Fighter, model_path: String, sway := true, curl_fists := false) -> bool:
	fighter = f
	rig = RigAnimator.new()
	add_child(rig)
	if not rig.load_model(model_path):
		return false
	rig.curl_fists = curl_fists
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
	if f.has_meta("pose_override"):
		return f.get_meta("pose_override")
	if f.get_meta("stunned", false):
		return PoseLib.stunned(_t)
	if f.get_meta("brace", false):
		return PoseLib.block()
	match f.state:
		Fighter.State.KO:
			var fall := AnimClip.load_clip("mc_fall")
			if fall != null:
				return fall.sample(_ko_t, false)
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
				var kind: String = info["kind"]
				var mocap: String = MOCAP_ATTACKS.get(f.moveset + "_" + kind, MOCAP_ATTACKS.get(kind, ""))
				if mocap != "":
					var clip := AnimClip.load_clip(mocap)
					if clip != null:
						return clip.sample(float(info["p"]) * clip.duration() * 0.999, false)
				if not kind.begins_with("light") and kind != "heavy":
					kind = f.moveset + "_" + kind
				return PoseLib.attack(kind, info["phase"], info["k"])
	if f.flying:
		var clip := AnimClip.load_clip("fly_fast_side" if speed > 0.25 else "fly_hover_gojo")
		if clip != null:
			return clip.sample(_t)
		return PoseLib.fly_fast(_t) if speed > 0.25 else PoseLib.fly_hover(_t)
	if speed > 0.1:
		var run := AnimClip.load_clip("mc_run")
		if run != null and speed > 0.5:
			return run.sample(_t * clampf(speed, 0.6, 1.6))
		return PoseLib.walk(_t, speed)
	var idle := AnimClip.load_clip("mc_stance")
	if idle != null:
		return idle.sample(_t * 0.8)
	return PoseLib.stance(_t)

func _process(delta: float) -> void:
	if fighter == null or rig == null:
		return
	_t += delta
	if cloth != null:
		var v := fighter.velocity
		cloth.wind = Vector3(-v.x, 0.0, -v.z) * 0.6 + Vector3(0.6, 0, 0.3)
		cloth.gust = 0.8 + clampf(v.length() * 0.15, 0.0, 1.5)
	if fighter.state == Fighter.State.KO:
		if not _was_ko:
			_ko_t = 0.0
		_ko_t += delta
	_was_ko = fighter.state == Fighter.State.KO
	var want_fists: bool = not fighter.get_meta("show_hands", false)
	if want_fists != rig.fists_on:
		rig.set_fists(want_fists)
	var tgt := _target_pose()
	# attacks are already eased by their own phases; everything else is smoothed so cuts between poses do not snap
	var rate := 26.0 if fighter.state == Fighter.State.ATTACK else 12.0
	_cur = PoseLib.mix(_cur, tgt, clampf(rate * delta, 0.0, 1.0))
	var built := PoseLib.build(_cur)
	if tgt.has("curl"):
		built["curl"] = tgt["curl"]
	rig.apply(built)
