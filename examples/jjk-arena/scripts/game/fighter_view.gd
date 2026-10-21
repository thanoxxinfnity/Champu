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
			match f.knock:
				"air":
					return PoseLib.mix(PoseLib.hit(0.2), PoseLib.ko(0.45), 0.6)
				"down":
					return PoseLib.ko(1.0)
				"getup":
					return PoseLib.mix(PoseLib.ko(1.0), PoseLib.stance(_t), 1.0 - clampf(f._down_t / Fighter.GETUP_TIME, 0.0, 1.0))
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
		var k := clampf(_fly_pitch / FLY_PITCH, 0.0, 1.0)
		return PoseLib.mix(PoseLib.fly_hover(_t), PoseLib.fly_glide(_t, rad_to_deg(_fly_pitch) * 0.75), k)
	if speed > 0.1:
		var run := AnimClip.load_clip("mc_run")
		if run != null and speed > 0.5:
			return run.sample(_t * clampf(speed, 0.6, 1.6))
		return PoseLib.walk(_t, speed)
	var idle := AnimClip.load_clip("mc_stance")
	if idle != null:
		return idle.sample(_t * 0.8)
	return PoseLib.stance(_t)

## Flight body attitude: the whole rig pitches forward with forward speed (up to FLY_PITCH, Superman style), rolls into sideways motion
## and leans back when climbing. It turns about the hips so the body does not swing around the feet.
const FLY_PITCH := 1.25
const HIP := Vector3(0, 1.0, 0)
var _fly_pitch := 0.0
var _fly_roll := 0.0

func _update_attitude(delta: float) -> void:
	var f := fighter
	var want_p := 0.0
	var want_r := 0.0
	if f.flying and f.state != Fighter.State.ATTACK and f.state != Fighter.State.KO:
		var lv := f.global_transform.basis.inverse() * f.velocity        # local: -Z is forward
		var top := maxf(f.fly_speed, 0.1)
		want_p = clampf(-lv.z / top, -0.3, 1.0) * FLY_PITCH - clampf(lv.y / top, -0.6, 0.6) * 0.5
		want_r = -clampf(lv.x / top, -1.0, 1.0) * 0.55
	_fly_pitch = lerpf(_fly_pitch, want_p, clampf(4.0 * delta, 0.0, 1.0))
	_fly_roll = lerpf(_fly_roll, want_r, clampf(4.0 * delta, 0.0, 1.0))
	var b := Basis.from_euler(Vector3(-_fly_pitch, 0.0, _fly_roll))
	var bob := Vector3(0, sin(_t * 1.6) * 0.06, 0) if f.flying else Vector3.ZERO
	rig.transform = Transform3D(b, HIP - b * HIP + bob)

func _process(delta: float) -> void:
	if fighter == null or rig == null:
		return
	_t += delta
	_update_attitude(delta)
	if cloth != null:
		var v := fighter.velocity
		cloth.wind = -v * 0.6 + Vector3(0.6, 0, 0.3)
		cloth.gust = 0.8 + clampf(v.length() * 0.15, 0.0, 2.5)
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
