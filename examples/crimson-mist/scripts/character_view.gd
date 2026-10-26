class_name CharacterView
extends Node3D
## A cast member on screen: loads the rigged model (or a stand-in), turns it to cel shading with an ink outline, poses its skeleton from
## code and swings hair, coat and tail bones after the body. The owner sets `state` and `move_speed`; everything else is automatic.

const MODEL_DIRS := ["res://private/models/", "res://assets/cast/"]

## Which MDM clip drives which pose, per body type. "human" keeps the procedural idle/aim and swings the arms itself.
const CLIPS := {
	"human": {"walk": "walk", "run": "run", "swing": ["swing1", "swing2", "swing3"], "hurt": "hurt", "dead": "death", "scared": "scared", "roll": "roll", "throw": "throw"},
	"zombie": {"idle": "z_idle", "walk": "z_walk", "run": "z_run", "swing": ["z_attack"], "hurt": "z_hurt", "dead": "z_death"},
	"crawler": {"idle": "crawl", "walk": "crawl", "run": "crawl", "swing": ["z_attack"], "hurt": "z_hurt", "dead": "z_death"},
	"bloater": {"idle": "z_idle", "walk": "waddle", "run": "waddle", "swing": ["z_attack"], "hurt": "z_hurt", "dead": "z_death"},
	"weeper": {"idle": "z_idle", "walk": "z_walk", "run": "z_run", "swing": ["z_attack"], "hurt": "z_hurt", "dead": "z_death"},
	"boss": {"idle": "z_idle", "walk": "z_walk", "run": "z_walk", "swing": ["slam"], "hurt": "z_hurt", "dead": "z_death"},
	"npc": {"idle": "z_idle", "walk": "walk", "run": "run", "scared": "sit_cry", "talk": "talk", "wave": "wave"},
}

enum Pose { IDLE, WALK, RUN, SWING, AIM, THROW, HURT, ROLL, DEAD, SCARED, TALK, WAVE }

var char_id := ""
var style := "human"
var clip_speed_scale := 1.0
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
## Test hook (tests/playthrough.gd): when on, every body is checked each frame and the longest run of frames in a T-like pose is kept.
static var watch := false
static var worst_t_run := 0
static var worst_t_who := ""
var _t_run := 0


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


## Rigged model from any path (enemies, NPCs): scaled to `h`, cel-shaded, posed by the clip table of `body_style`. False if the file is missing.
func setup_model(path: String, h: float, tint: Color, body_style: String) -> bool:
	style = body_style
	height = h
	_holder = Node3D.new()
	add_child(_holder)
	if not ResourceLoader.exists(path):
		return false
	var scene := load(path) as PackedScene
	rig = RigAnimator.new()
	_holder.add_child(rig)
	if scene == null or not rig.load_model(scene):
		rig.queue_free()
		rig = null
		return false
	var box := Assets.bounds(rig.model)
	var k := h / maxf(box.size.y, 0.001)
	rig.scale = Vector3.ONE * k
	rig.position.y = -box.position.y * k
	rig.rotation.y = PI
	materials = Toon.apply(rig.model, 0.014, tint)
	for mi in rig.model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).visibility_range_end = 85.0      # nothing past the fog needs drawing
	return true


func flash(v: float) -> void:
	for m in materials:
		m.set_shader_parameter("flash", v)


func start_pose(p: Pose) -> void:
	pose = p
	timer = 0.0


func _clip_pose() -> Dictionary:
	## The MDM clip for the current pose, or an empty dictionary when none is defined (procedural poses take over).
	var table: Dictionary = CLIPS.get(style, CLIPS.human)
	var base: float = (Data.CAST.get(char_id, {"speed": 4.0}).speed as float) if style == "human" else 3.0
	var g := ground_speed if ground_speed >= 0.0 else move_speed * base
	var dt := get_process_delta_time()
	match pose:
		Pose.IDLE:
			var ci: String = table.get("idle", "")
			var c := AnimClip.load_clip(ci) if ci != "" else null
			return c.sample(_t * 0.8) if c != null else {}
		Pose.TALK:
			var c1 := AnimClip.load_clip(table.get("talk", "talk"))
			return c1.sample(_t) if c1 != null else {}
		Pose.WAVE:
			var c2 := AnimClip.load_clip(table.get("wave", "wave"))
			return c2.sample(_t) if c2 != null else {}
		Pose.WALK, Pose.RUN:
			var wn: String = table.get("walk", "walk")
			var rn: String = table.get("run", "run")
			var w := AnimClip.load_clip(wn)
			var r := AnimClip.load_clip(rn)
			if w == null or r == null:
				return {}
			var run_gait := g > (2.5 if style == "human" else 2.2) and rn != wn
			var gait := r if run_gait else w
			var nominal := maxf(gait.speed, 0.4)
			_clip_t += dt * clampf(g / nominal, 0.45, 1.8) * clip_speed_scale
			var d := gait.sample(_clip_t)
			if style == "human":
				# the generated arms hang still or point, so swing them against the legs ourselves
				var sw := clampf(((d["tL"] as Vector3).z - (d["tR"] as Vector3).z) * 0.6, -1.0, 1.0)
				var bend := 0.8 if run_gait else 0.35
				d["uL"] = Vector3(0.16, -0.95, -0.55 * sw)
				d["uR"] = Vector3(0.16, -0.95, 0.55 * sw)
				d["fL"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, sw))
				d["fR"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, -sw))
			return d
		Pose.SWING:
			var names: Array = table.get("swing", [])
			if names.is_empty():
				return {}
			var c3 := AnimClip.load_clip(names[swing_combo % names.size()])
			if c3 == null:
				return {}
			var prog := swing_k * 0.265 if swing_phase == 0 else (0.265 + swing_k * 0.205 if swing_phase == 1 else 0.47 + swing_k * 0.53)
			return c3.at(prog)
		Pose.THROW:
			var c4 := AnimClip.load_clip(table.get("throw", "throw"))
			return c4.at(timer / 0.38) if c4 != null else {}
		Pose.HURT:
			var c5 := AnimClip.load_clip(table.get("hurt", "hurt"))
			return c5.sample(timer) if c5 != null else {}
		Pose.ROLL:
			var c6 := AnimClip.load_clip(table.get("roll", "roll"))
			return c6.at(timer / 0.42) if c6 != null else {}
		Pose.DEAD:
			var c7 := AnimClip.load_clip(table.get("dead", "death"))
			return c7.sample(timer * 1.3) if c7 != null else {}
		Pose.SCARED:
			var c8 := AnimClip.load_clip(table.get("scared", "scared"))
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
	if watch and is_visible_in_tree():
		_watch_t_pose()
	if not rig.sway_bones.is_empty():
		_update_sway(delta)


func _watch_t_pose() -> void:
	rig.skeleton.force_update_all_bone_transforms()
	var bend := 0.0
	for side in ["upperarmL", "upperarmR"]:
		if rig.idx.has(side):
			var i: int = rig.idx[side]
			bend = maxf(bend, rad_to_deg(rig._rest_dir[i].angle_to(rig.skeleton.get_bone_global_pose(i).basis.y.normalized())))
	_t_run = _t_run + 1 if bend < 6.0 else 0
	if _t_run > worst_t_run:
		worst_t_run = _t_run
		worst_t_who = "%s %s pose %d" % [char_id if char_id != "" else String(name), style, pose]


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
