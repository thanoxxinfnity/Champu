class_name CharacterView
extends Node3D
## A cast member on screen: loads the rigged model (or a stand-in), turns it to cel shading with an ink outline, poses its skeleton from
## code and swings hair, coat and tail bones after the body. The owner sets `state` and `move_speed`; everything else is automatic.

const MODEL_DIRS := ["res://assets/cast/", "res://private/models/"]

enum Pose { IDLE, WALK, RUN, SWING, AIM, THROW, HURT, ROLL, DEAD, SCARED }

var char_id := ""
var rig: RigAnimator
var height := 1.6
var pose := Pose.IDLE
var move_speed := 0.0          # 0..1.4 (1 = walking pace, 1.4 = run)
var swing_phase := 0
var swing_k := 0.0
var swing_combo := 0
var timer := 0.0               # time inside the current one-shot pose (hurt, roll, death, throw)
var stand_in := false
var materials: Array[ShaderMaterial] = []
var _t := 0.0
var _phase := 0.0
var _sway_state := {}
var ground_speed := -1.0       # m/s, set by the owner; negative = derive from move_speed
var use_clips := true
var _clip_t := 0.0
var _last_pose := -1
var _last_dict := {}
var _blend_from := {}
var _blend_t := 1.0
var _last_pos := Vector3.ZERO
var _have_last := false
var _vel_model := Vector3.ZERO
var _holder: Node3D


static func model_path(model: String) -> String:
	for d in MODEL_DIRS:
		if ResourceLoader.exists("%s%s.glb" % [d, model]):
			return "%s%s.glb" % [d, model]
	return ""


func setup(id: String) -> void:
	char_id = id
	var info: Dictionary = Data.CAST.get(id, {})
	height = float(info.get("height", 1.6))
	_holder = Node3D.new()
	add_child(_holder)
	var path := model_path(String(info.get("model", id)))
	if path != "":
		var scene := load(path) as PackedScene
		rig = RigAnimator.new()
		_holder.add_child(rig)
		if scene != null and rig.load_model(scene):
			var box := Assets.bounds(rig.model)
			var k := height / maxf(box.size.y, 0.001)
			rig.scale = Vector3.ONE * k
			rig.position.y = -box.position.y * k
			rig.rotation.y = PI          # the glb faces +Z, the game faces -Z
			materials = Toon.apply(rig.model, 0.011, Color(0.8, 0.82, 0.88))
			_last_pos = global_position if is_inside_tree() else Vector3.ZERO
			return
		rig.queue_free()
		rig = null
	stand_in = true
	_holder.add_child(Assets.stand_in_person(height, info.get("tint", Color(0.9, 0.8, 0.8))))


func flash(v: float) -> void:
	for m in materials:
		m.set_shader_parameter("flash", v)


func start_pose(p: Pose) -> void:
	pose = p
	timer = 0.0


func _clip_pose() -> Dictionary:
	## The MDM clip for the current pose, or an empty dictionary when the clip pack is not there (procedural poses take over).
	var base := Data.CAST.get(char_id, {"speed": 4.0}).speed as float
	var g := ground_speed if ground_speed >= 0.0 else move_speed * base
	match pose:
		Pose.IDLE:
			return {}      # MDM's idle gestures read as fidgeting; the calm procedural stance is better
		Pose.WALK, Pose.RUN:
			var w := AnimClip.load_clip("walk")
			var r := AnimClip.load_clip("run")
			if w == null or r == null:
				return {}
			var run_gait := g > 2.5
			var gait := r if run_gait else w
			_clip_t += get_process_delta_time() * (clampf(g / maxf(r.speed, 1.5), 0.7, 1.35) if run_gait else clampf(g / maxf(w.speed, 0.4), 0.45, 1.8))
			var d := gait.sample(_clip_t)
			# the generated arms hang still or point, so swing them against the legs ourselves
			var sw := clampf(((d["tL"] as Vector3).z - (d["tR"] as Vector3).z) * 0.6, -1.0, 1.0)
			var bend := 0.8 if run_gait else 0.35
			d["uL"] = Vector3(0.16, -0.95, -0.55 * sw)
			d["uR"] = Vector3(0.16, -0.95, 0.55 * sw)
			d["fL"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, sw))
			d["fR"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, -sw))
			return d
		Pose.SWING:
			var c2 := AnimClip.load_clip("swing%d" % (1 + swing_combo % 3))
			if c2 == null:
				return {}
			var prog := swing_k * 0.265 if swing_phase == 0 else (0.265 + swing_k * 0.205 if swing_phase == 1 else 0.47 + swing_k * 0.53)
			return c2.at(prog)
		Pose.AIM:
			return {}      # a steady two-handed aim is cleaner procedurally
		Pose.THROW:
			var c4 := AnimClip.load_clip("throw")
			return c4.at(timer / 0.38) if c4 != null else {}
		Pose.HURT:
			var c5 := AnimClip.load_clip("hurt")
			return c5.sample(timer) if c5 != null else {}
		Pose.ROLL:
			var c6 := AnimClip.load_clip("roll")
			return c6.at(timer / 0.42) if c6 != null else {}
		Pose.DEAD:
			var c7 := AnimClip.load_clip("death")
			return c7.sample(timer * 1.3) if c7 != null else {}
		Pose.SCARED:
			var c8 := AnimClip.load_clip("scared")
			return c8.sample(_t) if c8 != null else {}
	return {}


func _process(delta: float) -> void:
	_t += delta
	timer += delta
	if rig == null:
		return
	_phase += delta * (5.5 + 3.0 * move_speed) * (1.0 if move_speed > 0.05 else 0.0)
	if pose != _last_pose:
		_blend_from = _last_dict
		_blend_t = 0.0
		_last_pose = pose
		if pose == Pose.WALK or pose == Pose.RUN:
			_clip_t = 0.0 if _blend_from.is_empty() else _clip_t
	var d: Dictionary = _clip_pose() if use_clips else {}
	if d.is_empty():
		match pose:
			Pose.WALK:
				d = CMPoses.walk(_phase, move_speed)
			Pose.RUN:
				d = CMPoses.run(_phase)
			Pose.SWING:
				d = CMPoses.swing(swing_phase, swing_k, swing_combo)
			Pose.AIM:
				d = CMPoses.aim()
			Pose.THROW:
				d = CMPoses.throw_flare(timer / 0.35)
			Pose.HURT:
				d = CMPoses.hurt(timer / 0.45)
			Pose.ROLL:
				d = CMPoses.roll(timer)
			Pose.DEAD:
				d = CMPoses.death(timer / 0.9)
			Pose.SCARED:
				d = CMPoses.sit_scared(_t)
			_:
				d = CMPoses.idle(_t)
	_last_dict = d
	if not _blend_from.is_empty() and _blend_t < 0.2:
		_blend_t += delta
		d = PoseLib.mix(_blend_from, d, clampf(_blend_t / 0.2, 0.0, 1.0))
	# MDM clips store the crouch as a fraction of body height; the rig works in metres
	if d.has("crouch") and use_clips:
		d = d.duplicate()
		d["crouch"] = float(d["crouch"]) * height
	rig.apply(PoseLib.build(d))
	if not rig.sway_bones.is_empty():
		_update_sway(delta)


func _update_sway(delta: float) -> void:
	# Velocity of the body in model space, then each hair/coat/tail bone lags behind it with its own spring.
	var pos := global_position
	var v := (pos - _last_pos) / maxf(delta, 0.0001) if _have_last else Vector3.ZERO
	_have_last = true
	_last_pos = pos
	v = v.limit_length(8.0)
	_vel_model = _vel_model.lerp(global_transform.basis.inverse() * v, minf(1.0, delta * 8.0))
	var out := {}
	for i in rig.sway_bones.size():
		var bi := rig.sway_bones[i]
		var st: Array = _sway_state.get(bi, [Vector3.ZERO, Vector3.ZERO])
		var x: Vector3 = st[0]
		var vel: Vector3 = st[1]
		var target := Vector3(-_vel_model.x, 0.0, -_vel_model.z) * 0.022
		target.x += sin(_t * 1.6 + bi * 0.37) * 0.012
		target.z += cos(_t * 1.3 + bi * 0.21) * 0.012
		vel += (target - x) * 70.0 * delta
		vel *= maxf(0.0, 1.0 - 7.0 * delta)
		x += vel * delta
		x = x.limit_length(0.14)
		_sway_state[bi] = [x, vel]
		# the model faces +Z in its own space; the view is turned PI, so flip x and z of the offset
		out[bi] = Vector3(-x.x, x.y, -x.z)
	rig.set_sway(out)
