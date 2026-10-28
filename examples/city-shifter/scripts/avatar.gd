class_name Avatar
extends Node3D
## A survivor on screen: the rigged model (Triverse, rigged by tools/autorig_obj.py) driven by RigAnimator, or a boxy stand-in when the file is missing.
## Motion comes from three places: the MDM text-to-motion walk and run clips (assets/anim, made once on a CPU and baked to joint-direction keys), the
## procedural poses of CMPoses (idle, hurt, a gauntlet swing), and the new jet poses in this file (lean into the thrust, legs trailing, fall with arms up).
## The jetpack is a pair of cylinders on the back with a flame that follows the thrust.

const MODEL_DIR := "res://assets/cast/"
const PRIVATE_DIR := "res://private/cast/"
# motion-captured game clips (Quaternius Universal Animation Library, CC0; tools/ual_to_clips.py); the older MDM ones stay as a fallback
const CLIPS := {"walk": "ual/walk", "run": "ual/run", "sprint": "ual/sprint", "idle": "ual/idle", "air": "ual/jump_air", "hit": "ual/hit_chest",
	"sword": "ual/sword_attack", "death": "ual/death"}
const LOBBY_CLIPS := ["ual/dance", "ual/yes", "ual/fold_arms", "ual/punch_cross", "ual/sword_combo", "ual/pistol_reload"]
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
var melee_body := false         # the body twist of a swing (a melee weapon) or the aim stance (a gauntlet)
var grip_r = null               # Vector3 in holder space: where the right hand holds the weapon (null = the arm hangs as the pose says)
var grip_l = null               # the same for the left hand (two-handed weapons)
var _holder: Node3D
var _arm_len := {}
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


var outline := false            # the inverted-hull ink: off for heroes (it broke into shards on the generated meshes); toon_char.gdshader darkens the edge instead


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
	_gait_mdm = String(info.get("gait", "")) == "mdm"
	_holder = Node3D.new()
	add_child(_holder)
	_blob = Gfx.blob(0.42 * height / 1.75)
	add_child(_blob)
	var path := "%s%s.glb" % [MODEL_DIR, String(info.get("model", id))]
	if ResourceLoader.exists("%s%s.glb" % [PRIVATE_DIR, id]):
		path = "%s%s.glb" % [PRIVATE_DIR, id]          # the owner's own licensed model (never in the repository), when it is on this machine
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
			Anime.style_char(rig.model, outline, 0.012, 0.72 if path.begins_with(PRIVATE_DIR) else 1.0)
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
		_pack.position = Vector3(0, height * 0.66, _back_of_body() + _pack_size.z * 0.5 - 0.06 * height)
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


static var _back_cache := {}


## How far behind the origin the hero's back is (holder space, +Z = behind): measured once per model from the chest-high vertices, so the pack sits on
## the body whatever the model's build, coat or hair. A stand-in without a rig uses the fixed guess.
func _back_of_body() -> float:
	var key := "%s|%d" % [char_id, int(height * 100.0)]
	if _back_cache.has(key):
		return _back_cache[key]
	var zs: Array[float] = []
	if rig != null and rig.model != null:
		var lo := height * 0.50
		var hi := height * 0.82
		for mi in rig.model.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			if m.mesh == null:
				continue
			var xf := rig.transform
			var cur: Node = m
			var chain := Transform3D.IDENTITY
			while cur != null and cur != rig.model.get_parent():
				if cur is Node3D:
					chain = (cur as Node3D).transform * chain
				cur = cur.get_parent()
			xf = xf * chain
			for si in m.mesh.get_surface_count():
				var arr := m.mesh.surface_get_arrays(si)
				if arr.is_empty() or arr[Mesh.ARRAY_VERTEX] == null:
					continue
				var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
				var step := maxi(1, verts.size() / 4000)
				var i := 0
				while i < verts.size():
					var v := xf * verts[i]
					if v.y >= lo and v.y <= hi and absf(v.x) < height * 0.2:
						zs.append(v.z)
					i += step
	var z := height * 0.12
	if zs.size() > 20:
		zs.sort()
		z = clampf(zs[int(zs.size() * 0.85)], height * 0.05, height * 0.3)
	_back_cache[key] = z
	return z


## Spawn protection: the whole figure blinks.
## The spawn shield: a soft see-through bubble round the hero (the body used to blink on and off, which read as a glitch).
func modulate_blink(on: bool) -> void:
	if on and _bubble == null:
		_bubble = MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = height * 0.55
		sm.height = height * 1.1
		sm.radial_segments = 20
		sm.rings = 10
		_bubble.mesh = sm
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color = Color(0.55, 0.85, 1.0, 0.16)
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.no_depth_test = false
		_bubble.material_override = m
		_bubble.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_bubble.position.y = height * 0.52
		add_child(_bubble)
	if _bubble != null:
		_bubble.visible = on
	if _blinking:
		visible = true                  # (an avatar left hidden by the old blink comes back)
		_blinking = false


var _bubble: MeshInstance3D


func _process(delta: float) -> void:
	_t += delta
	if _blob != null:
		_blob.visible = show_blob and not airborne and not jetting and not riding
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
		# poses ease into each other: a switch of clip (idle -> walk -> run, a hit, the end of a swing) no longer snaps the body in one frame
		# (a swing is left crisp: the weapon is animated on its own clock and the arms must keep up with it)
		if not _last.is_empty():
			d = PoseLib.mix(_last, d, 1.0 - exp(-delta * (40.0 if attack_t > 0.0 else 16.0)))
		if grip_r != null and not riding:
			_solve_arm(d, "R", grip_r)
			if grip_l != null:
				_solve_arm(d, "L", grip_l)
		rig.apply(PoseLib.build(d))
		_last = d
	else:
		_stand_in_pose()


## Heroes whose legs live inside a long coat (data "gait": "mdm") keep the gentler generated walk and run: the captured jog's high knees fold the coat.
var _gait_mdm := false
var _running := false
var show_blob := true                # off where there is no ground under the hero (the loading screen)
var _blob: MeshInstance3D            # the soft shadow on the ground; it stays on the ground while the hero jumps or falls


func _clip(name: String) -> AnimClip:
	if _gait_mdm and name in ["walk", "run", "sprint"]:
		return AnimClip.load_clip("run" if name == "sprint" else name)
	return AnimClip.load_clip(String(CLIPS.get(name, name)))


## Play a named emote (CMPoses.EMOTES) for `secs`; used by the lobby when you tap your hero.
func play_emote(name: String, secs := 2.6) -> void:
	_emote = name
	_emote_t = 0.0
	_emote_left = secs


var _emote := ""
var _emote_t := 0.0
var _emote_left := 0.0


## A whole-body clip played over everything else (lobby emotes, a death, a dance): `play_clip("ual/dance")`.
var clip_name := ""
var clip_t := 0.0
var clip_left := 0.0


func play_clip(name: String, secs := -1.0) -> void:
	var c := _clip(name)
	if c == null:
		return
	clip_name = name
	clip_t = 0.0
	clip_left = secs if secs > 0.0 else (1.0e9 if c.loop else c.duration())


func _pose() -> Dictionary:
	if clip_name != "" and clip_left > 0.0:
		var c := _clip(clip_name)
		var dt0 := get_process_delta_time()
		clip_t += dt0
		clip_left -= dt0
		if c != null:
			return c.sample(clip_t)
	if _emote_left > 0.0:
		var dt := get_process_delta_time()
		_emote_t += dt
		_emote_left -= dt
		return CMPoses.emote(_emote, _emote_t)
	if riding:
		# in the saddle: thighs forward and out, shins down, hands forward on the reins; the body follows the horse's speed
		var lean := clampf(ground_speed / 12.0, 0.0, 1.0)
		var bump := sin(_t * (6.0 + ground_speed * 1.3)) * 0.04 * clampf(ground_speed / 6.0, 0.0, 1.0)
		return {"lean": 4.0 + 20.0 * lean, "crouch": 0.03 + 0.03 * lean + bump,
			"uL": Vector3(0.12, -0.78, 0.6), "fL": Vector3(0.04, -0.25, 1.0), "uR": Vector3(0.12, -0.78, 0.6), "fR": Vector3(0.04, -0.25, 1.0),
			"tL": Vector3(0.55, -0.55, 0.62), "sL": Vector3(0.22, -1.0, -0.2), "ftL": Vector3(0.0, -0.45, 1.0),
			"tR": Vector3(0.55, -0.55, 0.62), "sR": Vector3(0.22, -1.0, -0.2), "ftR": Vector3(0.0, -0.45, 1.0), "head": -6.0 * lean}
	if hurt_t > 0.0:
		var hc := _clip("hit")
		return hc.at(1.0 - hurt_t / 0.4) if hc != null else CMPoses.hurt(1.0 - hurt_t / 0.4)
	if attack_t > 0.0:
		var k := 1.0 - attack_t / 0.3
		if not melee_body:
			return CMPoses.aim()
		var sc := _clip("sword")
		if sc != null and grip_r == null:
			return sc.at(0.25 + 0.55 * clampf(k, 0.0, 1.0))      # the swing itself, without the wind-up and the recovery
		var d := CMPoses.swing(1, clampf(k, 0.0, 1.0), 0)
		return d
	if airborne or jetting:
		if jetting:
			# superman: chest low over the hands, legs trailing, the flame behind
			return {"lean": 18.0, "uL": Vector3(0.35, -0.35, 0.85), "fL": Vector3(0.2, -0.1, 0.95), "uR": Vector3(0.35, -0.35, 0.85), "fR": Vector3(0.2, -0.1, 0.95),
				"tL": Vector3(0.1, -0.95, -0.3), "sL": Vector3(0.1, -0.85, -0.55), "ftL": Vector3(0.0, -0.6, 0.8),
				"tR": Vector3(0.1, -0.97, -0.15), "sR": Vector3(0.1, -0.9, -0.4), "ftR": Vector3(0.0, -0.6, 0.8), "head": -10.0}
		var ac := _clip("air")
		if ac != null:
			_clip_t += get_process_delta_time()
			return ac.sample(_clip_t)
		# falling: arms up and out, legs apart
		var flail := sin(_t * 9.0) * 0.12
		return {"lean": 2.0, "uL": Vector3(0.75, 0.35 + flail, 0.15), "fL": Vector3(0.6, 0.75, 0.2), "uR": Vector3(0.75, 0.35 - flail, 0.15), "fR": Vector3(0.6, 0.75, 0.2),
			"tL": Vector3(0.35, -0.93, 0.1), "sL": Vector3(0.3, -0.95, -0.1), "tR": Vector3(0.35, -0.93, -0.1), "sR": Vector3(0.3, -0.95, 0.1)}
	if ground_speed > 0.35:
		_running = ground_speed > (2.7 if _running else 3.5)     # hysteresis: a speed near the switch no longer flips walk <-> run every frame
		var run_gait := _running
		var w := _clip("walk")
		var r := _clip("run")
		var gait := r if run_gait else w
		if ground_speed > 7.5 and _clip("sprint") != null:
			gait = _clip("sprint")
		if gait == null:
			return CMPoses.walk(_t * 8.0, clampf(ground_speed / 4.0, 0.0, 1.4)) if not run_gait else CMPoses.run(_t * 11.0)
		_clip_t += get_process_delta_time() * clampf(ground_speed / maxf(gait.speed, 0.4), 0.45, 1.8)
		var d2 := gait.sample(_clip_t)
		if not _gait_mdm:
			return d2                                   # captured clips swing their own arms
		# the generated arms hang still: swing them against the legs
		var sw := clampf(((d2["tL"] as Vector3).z - (d2["tR"] as Vector3).z) * 0.6, -1.0, 1.0)
		var bend := 0.8 if run_gait else 0.35
		d2["uL"] = Vector3(0.16, -0.95, -0.55 * sw)
		d2["uR"] = Vector3(0.16, -0.95, 0.55 * sw)
		d2["fL"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, sw))
		d2["fR"] = Vector3(0.1, -0.7 + (0.5 if run_gait else 0.0), bend + 0.5 * maxf(0.0, -sw))
		return d2
	var ic := _clip("idle")
	if ic != null:
		return ic.sample(_t)
	return CMPoses.idle(_t)


## The node the hero's body and the held weapon both live in (the lean of the jet pose carries them together).
func holder() -> Node3D:
	return _holder


## Two-bone solver: the arm `side` ("L" or "R") reaches the point `target` (holder space) with the elbow out and down. It writes the upper arm and forearm
## directions into the pose; the shoulder is read from the skeleton as it stood a frame ago.
func _solve_arm(d: Dictionary, side: String, target: Vector3) -> void:
	var sk := rig.skeleton
	var ui: int = rig.idx.get("upperarm" + side, -1)
	var fi: int = rig.idx.get("forearm" + side, -1)
	var hi: int = rig.idx.get("hand" + side, -1)
	if sk == null or ui < 0 or fi < 0 or hi < 0:
		return
	var to_rig := rig.global_transform.affine_inverse() * sk.global_transform
	if not _arm_len.has(side):
		var r0 := sk.get_bone_global_rest(ui).origin
		_arm_len[side] = Vector2(r0.distance_to(sk.get_bone_global_rest(fi).origin), sk.get_bone_global_rest(fi).origin.distance_to(sk.get_bone_global_rest(hi).origin))
		_arm_len[side] = (_arm_len[side] as Vector2) * to_rig.basis.get_scale().x
	var la: float = (_arm_len[side] as Vector2).x
	var lb: float = (_arm_len[side] as Vector2).y
	var shoulder := to_rig * sk.get_bone_global_pose(ui).origin
	var want := rig.transform.affine_inverse() * target
	var dv := want - shoulder
	var reach := clampf(dv.length(), 0.05, la + lb - 0.002)
	var dn := dv.normalized()
	var pole := Vector3(-0.8 if side == "R" else 0.8, -0.6, 0.25)
	pole = (pole - dn * dn.dot(pole)).normalized()
	var x := (la * la - lb * lb + reach * reach) / (2.0 * reach)
	var h := sqrt(maxf(la * la - x * x, 0.0))
	var elbow := shoulder + dn * x + pole * h
	var hand := shoulder + dn * reach
	var u := (elbow - shoulder).normalized()
	var f := (hand - elbow).normalized()
	if side == "R":                      # the pose tables give the right arm in the left arm's mirrored frame
		u.x = -u.x
		f.x = -f.x
	d["u" + side] = u
	d["f" + side] = f
	d["h" + side] = Vector3.ZERO


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
