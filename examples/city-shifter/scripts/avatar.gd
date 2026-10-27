class_name Avatar
extends Node3D
## A survivor on screen: the rigged model (Triverse, rigged by tools/autorig_obj.py) driven by RigAnimator, or a boxy stand-in when the file is missing.
## Motion comes from three places: the MDM text-to-motion walk and run clips (assets/anim, made once on a CPU and baked to joint-direction keys), the
## procedural poses of CMPoses (idle, hurt, a gauntlet swing), and the new jet poses in this file (lean into the thrust, legs trailing, fall with arms up).
## The jetpack is a pair of cylinders on the back with a flame that follows the thrust.

const MODEL_DIR := "res://assets/cast/"
const CLIPS := {"walk": "walk", "run": "run"}
const PACK := "res://assets/cast/jetpack.glb"

var char_id := ""
var rig: RigAnimator
var stand_in := false
var height := 1.75
var ground_speed := 0.0         # m/s on the roof
var airborne := false
var jetting := false
var thrust := 0.0               # 0..1, the flame
var attack_t := 0.0             # >0 while the gauntlet arm swings
var hurt_t := 0.0
var _holder: Node3D
var _t := 0.0
var _clip_t := 0.0
var _blinking := false
var riding := false             # sitting on a horse (or in a vehicle: then the avatar is hidden by the player)
var _flames: Array = []
var _pack_size := Vector3(0.4, 0.62, 0.3)
var _pack: Node3D
var _lean := 0.0
var _parts: Dictionary = {}     # stand-in limbs
var _last: Dictionary = {}


var outline := true             # the ink outline doubles the triangles: only my own avatar has it in a match


## Farther than the view radius nothing of this avatar is drawn.
func _limit_range(n: Node) -> void:
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var g := mi as GeometryInstance3D
		g.visibility_range_end = Data.VIEW_RADIUS + 6.0
		g.visibility_range_end_margin = 4.0
		g.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF


func setup(id: String) -> void:
	char_id = id
	var info: Dictionary = Data.CAST.get(id, Data.CAST["outlaw"])
	height = float(info.get("height", 1.75))
	_holder = Node3D.new()
	add_child(_holder)
	var path := "%s%s.glb" % [MODEL_DIR, String(info.get("model", id))]
	if ResourceLoader.exists(path):
		var scene := load(path) as PackedScene
		rig = RigAnimator.new()
		_holder.add_child(rig)
		if scene != null and rig.load_model(scene):
			var box := _bounds(rig.model)
			var k := height / maxf(box.size.y, 0.001)
			rig.scale = Vector3.ONE * k
			rig.position.y = -box.position.y * k
			rig.rotation.y = PI          # the glb faces +Z, the game faces -Z
			_tint(rig.model, info.get("tint", Color.WHITE))
			Anime.style(rig.model, outline, 0.012)
			if not outline:
				_limit_range(rig.model)
			_make_pack()
			return
		rig.queue_free()
		rig = null
	stand_in = true
	_build_stand_in(info)
	_make_pack()


func _bounds(n: Node3D) -> AABB:
	var out := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null:
			continue
		var xf := Transform3D.IDENTITY
		var cur: Node = m
		while cur != null and cur != n.get_parent():
			if cur is Node3D:
				xf = (cur as Node3D).transform * xf
			cur = cur.get_parent()
		var bb := xf * m.mesh.get_aabb()
		out = bb if first else out.merge(bb)
		first = false
	return out


func _tint(model: Node3D, c: Color) -> void:
	if c == Color.WHITE:
		return
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		for s in m.mesh.get_surface_count():
			var mat := m.get_active_material(s)
			if mat is StandardMaterial3D:
				var copy := (mat as StandardMaterial3D).duplicate() as StandardMaterial3D
				copy.albedo_color = c
				m.set_surface_override_material(s, copy)


func _build_stand_in(info: Dictionary) -> void:
	var skin := Color(0.9, 0.72, 0.6)
	var base: Color = info.get("tint", Color.WHITE)
	var cols := {"outlaw": [Color(0.4, 0.26, 0.2), Color(0.18, 0.22, 0.4)], "tracker": [Color(1.0, 0.55, 0.15), Color(0.4, 0.5, 0.25)],
		"viper": [Color(0.95, 0.5, 0.15), Color(0.28, 0.3, 0.38)], "engineer": [Color(0.25, 0.45, 0.25), Color(0.25, 0.28, 0.3)],
		"ninja": [Color(0.22, 0.26, 0.34), Color(0.25, 0.3, 0.4)], "mechanic": [Color(0.15, 0.6, 0.6), Color(0.22, 0.26, 0.34)]}
	var pair: Array = cols.get(char_id, [Color(0.5, 0.5, 0.6), Color(0.3, 0.3, 0.4)])
	var top := Mat.flat(pair[0] * (base if base != Color.WHITE else Color.WHITE))
	var legs := Mat.flat(pair[1])
	var s := height / 1.75
	var root := Node3D.new()
	_holder.add_child(root)
	_parts["root"] = root
	Mat.box(root, Vector3(0, 1.15 * s, 0), Vector3(0.62, 0.7, 0.36) * s, top)
	Mat.box(root, Vector3(0, 1.72 * s, 0), Vector3(0.34, 0.34, 0.34) * s, Mat.flat(skin))
	Mat.box(root, Vector3(0, 1.9 * s, -0.02 * s), Vector3(0.38, 0.14, 0.38) * s, Mat.flat(pair[1].darkened(0.2)))
	for side in [-1.0, 1.0]:
		var leg := Node3D.new()
		leg.position = Vector3(side * 0.16 * s, 0.8 * s, 0)
		Mat.box(leg, Vector3(0, -0.4 * s, 0), Vector3(0.22, 0.8, 0.24) * s, legs)
		root.add_child(leg)
		_parts["leg%d" % int(side)] = leg
		var arm := Node3D.new()
		arm.position = Vector3(side * 0.4 * s, 1.42 * s, 0)
		Mat.box(arm, Vector3(0, -0.32 * s, 0), Vector3(0.16, 0.64, 0.18) * s, top)
		root.add_child(arm)
		_parts["arm%d" % int(side)] = arm


func _make_pack() -> void:
	_pack = Node3D.new()
	_holder.add_child(_pack)
	_pack.position = Vector3(0, height * 0.66, height * 0.14)      # on the back (+Z is behind: the avatar faces -Z)
	var real := ModelKit.fitted(PACK, height * 0.42, "center")
	if real != null:
		_pack.add_child(real)
		_pack_size = real.get_meta("size")
		_pack.position = Vector3(0, height * 0.66, height * 0.12 + _pack_size.z * 0.5)
		Anime.style(real, true, 0.012)
	else:
		var body := Mat.flat(Color(0.35, 0.38, 0.46))
		for sx in [-0.12, 0.12]:
			Mat.cyl(_pack, Vector3(sx * height, 0, 0), 0.085 * height, 0.42 * height, body)
			Mat.cyl(_pack, Vector3(sx * height, -0.26 * height, 0), 0.06 * height, 0.08 * height, Mat.flat(Color(0.95, 0.75, 0.2), 0.8))
	for sx in [-1.0, 1.0]:
		var fl := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.07
		cm.bottom_radius = 0.0
		cm.height = 0.7
		cm.radial_segments = 6
		cm.rings = 1
		fl.mesh = cm
		fl.material_override = Mat.unlit(Color(1.0, 0.6, 0.15))
		fl.position = Vector3(sx * _pack_size.x * 0.24, -_pack_size.y * 0.5 - 0.3, 0.0)
		fl.visible = false
		_pack.add_child(fl)
		_flames.append(fl)


## Spawn protection: the whole figure blinks.
func modulate_blink(on: bool) -> void:
	if on:
		visible = int(Time.get_ticks_msec() / 120) % 2 == 0
		_blinking = true
	elif _blinking:
		visible = true
		_blinking = false


func _process(delta: float) -> void:
	_t += delta
	attack_t = maxf(0.0, attack_t - delta)
	hurt_t = maxf(0.0, hurt_t - delta)
	for f in _flames:
		(f as MeshInstance3D).visible = thrust > 0.05
		(f as MeshInstance3D).scale = Vector3(1.0, 0.4 + thrust * 1.3 + 0.2 * sin(_t * 40.0 + (f as Node3D).position.x * 9.0), 1.0)
	var want_lean := 0.0
	if (jetting or airborne) and not riding:
		want_lean = clampf(ground_speed / 8.0, 0.0, 1.0) * 28.0 + (14.0 if jetting else 0.0)
	_lean = lerpf(_lean, want_lean, minf(1.0, delta * 8.0))
	_holder.rotation.x = -deg_to_rad(_lean)
	_holder.position.y = 0.0
	if rig != null:
		var d := _pose()
		rig.apply(PoseLib.build(d))
		_last = d
	else:
		_stand_in_pose()


func _clip(name: String) -> AnimClip:
	return AnimClip.load_clip(String(CLIPS.get(name, name)))


func _pose() -> Dictionary:
	if riding:
		# in the saddle: thighs forward and out, shins down, hands forward on the reins; the body follows the horse's speed
		var lean := clampf(ground_speed / 12.0, 0.0, 1.0)
		var bump := sin(_t * (6.0 + ground_speed * 1.3)) * 0.04 * clampf(ground_speed / 6.0, 0.0, 1.0)
		return {"lean": 4.0 + 20.0 * lean, "crouch": 0.03 + 0.03 * lean + bump,
			"uL": Vector3(0.12, -0.78, 0.6), "fL": Vector3(0.04, -0.25, 1.0), "uR": Vector3(0.12, -0.78, 0.6), "fR": Vector3(0.04, -0.25, 1.0),
			"tL": Vector3(0.55, -0.55, 0.62), "sL": Vector3(0.22, -1.0, -0.2), "ftL": Vector3(0.0, -0.45, 1.0),
			"tR": Vector3(0.55, -0.55, 0.62), "sR": Vector3(0.22, -1.0, -0.2), "ftR": Vector3(0.0, -0.45, 1.0), "head": -6.0 * lean}
	if hurt_t > 0.0:
		return CMPoses.hurt(1.0 - hurt_t / 0.4)
	if attack_t > 0.0:
		var k := 1.0 - attack_t / 0.3
		var d := CMPoses.swing(1, clampf(k, 0.0, 1.0), 0)
		return d
	if airborne or jetting:
		if jetting:
			# superman: chest low over the hands, legs trailing, the flame behind
			return {"lean": 18.0, "uL": Vector3(0.35, -0.35, 0.85), "fL": Vector3(0.2, -0.1, 0.95), "uR": Vector3(0.35, -0.35, 0.85), "fR": Vector3(0.2, -0.1, 0.95),
				"tL": Vector3(0.1, -0.95, -0.3), "sL": Vector3(0.1, -0.85, -0.55), "ftL": Vector3(0.0, -0.6, 0.8),
				"tR": Vector3(0.1, -0.97, -0.15), "sR": Vector3(0.1, -0.9, -0.4), "ftR": Vector3(0.0, -0.6, 0.8), "head": -10.0}
		# falling: arms up and out, legs apart
		var flail := sin(_t * 9.0) * 0.12
		return {"lean": 2.0, "uL": Vector3(0.75, 0.35 + flail, 0.15), "fL": Vector3(0.6, 0.75, 0.2), "uR": Vector3(0.75, 0.35 - flail, 0.15), "fR": Vector3(0.6, 0.75, 0.2),
			"tL": Vector3(0.35, -0.93, 0.1), "sL": Vector3(0.3, -0.95, -0.1), "tR": Vector3(0.35, -0.93, -0.1), "sR": Vector3(0.3, -0.95, 0.1)}
	if ground_speed > 0.35:
		var run_gait := ground_speed > 3.8
		var w := _clip("walk")
		var r := _clip("run")
		var gait := r if run_gait else w
		if gait == null:
			return CMPoses.walk(_t * 8.0, clampf(ground_speed / 4.0, 0.0, 1.4)) if not run_gait else CMPoses.run(_t * 11.0)
		_clip_t += get_process_delta_time() * clampf(ground_speed / maxf(gait.speed, 0.4), 0.45, 1.8)
		var d2 := gait.sample(_clip_t)
		# the generated arms hang still: swing them against the legs
		var sw := clampf(((d2["tL"] as Vector3).z - (d2["tR"] as Vector3).z) * 0.6, -1.0, 1.0)
		var bend := 0.8 if run_gait else 0.35
		d2["uL"] = Vector3(0.16, -0.95, -0.55 * sw)
		d2["uR"] = Vector3(0.16, -0.95, 0.55 * sw)
		d2["fL"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, sw))
		d2["fR"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, -sw))
		return d2
	return CMPoses.idle(_t)


func _stand_in_pose() -> void:
	var root: Node3D = _parts.get("root")
	if root == null:
		return
	var swing := sin(_t * 9.0) * clampf(ground_speed / 5.0, 0.0, 1.0) * 0.8
	var up := airborne or jetting
	for side in [-1, 1]:
		var leg: Node3D = _parts["leg%d" % side]
		var arm: Node3D = _parts["arm%d" % side]
		leg.rotation.x = (swing * side if not up else (0.5 if jetting else 0.2))
		arm.rotation.x = (-swing * side if not up else (-1.4 if jetting else -2.4))
		if attack_t > 0.0 and side == 1:
			arm.rotation.x = -1.5


## Where the gauntlet hand is (for beams): in the avatar's own space.
func hand_point() -> Vector3:
	return global_position + global_transform.basis * Vector3(0.35, height * 0.65, -0.55)
