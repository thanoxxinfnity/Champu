class_name TrafficSystem
extends Node3D
## Ambient traffic: TRELLIS-generated cars driving the closed roads in their
## lane. Each car is an AnimatableBody3D moved along the road samples, so it
## shoves the player's car physically when they meet. Cars keep their
## distance from the car ahead and brake for the player in their lane.

const MODELS := {"sedan": 1.45, "suv": 1.75, "truck": 1.9}
const FOOTPRINT := {"sedan": Vector2(1.35, 3.25), "suv": Vector2(1.18, 2.58), "truck": Vector2(1.22, 2.25)}
const PAINT := [Color(0.9, 0.9, 0.92), Color(0.08, 0.08, 0.1), Color(0.6, 0.05, 0.05), Color(0.1, 0.2, 0.5), Color(0.5, 0.5, 0.52), Color(0.9, 0.7, 0.1)]
## TRELLIS cars already face +Z, the game's forward.
const MODEL_YAW := 0.0

var world: WorldBuilder
var player: Node3D
var cars: Array[Dictionary] = []
var _light_mat: StandardMaterial3D
var _tail_mat: StandardMaterial3D


func setup(w: WorldBuilder) -> void:
	world = w
	_light_mat = StandardMaterial3D.new()
	_light_mat.emission_enabled = true
	_light_mat.emission = Color(1.0, 0.95, 0.8)
	_light_mat.albedo_color = Color(1, 1, 1)
	_tail_mat = StandardMaterial3D.new()
	_tail_mat.emission_enabled = true
	_tail_mat.emission = Color(1.0, 0.04, 0.02)
	_tail_mat.albedo_color = Color(0.4, 0.0, 0.0)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(w.map_id)
	for ri in w.road_ranges.size():
		var r: Dictionary = w.meta.roads[ri]
		if not r.traffic:
			continue
		var rr := w.road_ranges[ri]
		var street: bool = r.kind == "street"
		var count := clampi(int(rr.y * 2.0 / (300.0 if street else 380.0)), 2, 16)
		var half := w.road_half[ri]
		for k in count:
			var dir := 1 if (not street or k % 2 == 0) else -1
			var lane := (half * 0.25 if street else half * 0.75) * dir
			var s := rr.y * (float(k) + rng.randf_range(0.0, 0.5)) / count
			var speed := rng.randf_range(10.0, 13.0) if street else rng.randf_range(17.0, 23.0)
			_spawn(ri, s, lane, dir, speed, rng)


func _spawn(ri: int, s: float, lane: float, dir: int, speed: float, rng: RandomNumberGenerator) -> void:
	var model: String = MODELS.keys()[rng.randi() % MODELS.size()]
	var h: float = MODELS[model]
	var fp: Vector2 = FOOTPRINT[model] * h
	var body := AnimatableBody3D.new()
	body.name = "Traffic_%d" % cars.size()
	body.sync_to_physics = false
	body.add_to_group("obstacle")
	body.add_to_group("traffic")
	add_child(body)
	var visual := Node3D.new()
	visual.rotation.y = MODEL_YAW
	body.add_child(visual)
	for lod in [["tex", 0.0, 45.0], ["near", 45.0, 220.0], ["far", 220.0, 700.0]]:
		var mesh := AssetLibrary.mesh(model, lod[0])
		if mesh == null:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = AssetLibrary.material(model, lod[0])
		mi.scale = Vector3.ONE * h
		mi.visibility_range_begin = lod[1]
		mi.visibility_range_end = lod[2]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod[0] != "far" else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		visual.add_child(mi)
	# Head and tail lights (the game's +Z is forward).
	for side in [-1.0, 1.0]:
		var hl := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.3, 0.12, 0.05)
		hl.mesh = bm
		hl.material_override = _light_mat
		hl.position = Vector3(side * fp.x * 0.33, h * 0.42, fp.y * 0.5)
		body.add_child(hl)
		var tl := MeshInstance3D.new()
		tl.mesh = bm
		tl.material_override = _tail_mat
		tl.position = Vector3(side * fp.x * 0.33, h * 0.45, -fp.y * 0.5)
		body.add_child(tl)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(fp.x * 0.95, h * 0.85, fp.y * 0.95)
	cs.shape = bs
	cs.position = Vector3(0, h * 0.5, 0)
	body.add_child(cs)
	cars.append({"body": body, "road": ri, "s": s, "lane": lane, "dir": dir, "cruise": speed, "speed": speed, "len": fp.y})


func set_lights(night: bool) -> void:
	if _light_mat:
		_light_mat.emission_energy_multiplier = 5.0 if night else 0.6
		_tail_mat.emission_energy_multiplier = 3.0 if night else 0.8


func _physics_process(delta: float) -> void:
	if world == null:
		return
	var ppos := player.global_position if player and is_instance_valid(player) else Vector3(INF, 0, INF)
	for c in cars:
		var rr := world.road_ranges[c.road]
		var body: AnimatableBody3D = c.body
		var fwd := body.global_basis.z
		var target: float = c.cruise
		# Brake for the player ahead in this lane.
		var to_p := ppos - body.global_position
		var ahead := to_p.dot(fwd)
		if ahead > 0.0 and ahead < 22.0 and absf(to_p.dot(body.global_basis.x)) < 2.6 and absf(to_p.y) < 4.0:
			target = 0.0 if ahead < 11.0 else c.cruise * (ahead - 11.0) / 11.0
		# Keep a gap to the next traffic car in the same lane.
		for o in cars:
			if o == c or o.road != c.road or o.dir != c.dir or absf(o.lane - c.lane) > 1.0:
				continue
			var gap := fposmod((o.s - c.s) * c.dir, rr.y) * 2.0
			if gap < 30.0:
				target = minf(target, o.speed * clampf((gap - 9.0) / 12.0, 0.0, 1.0))
		c.speed = move_toward(c.speed, target, (9.0 if target < c.speed else 3.0) * delta)
		c.s = fposmod(c.s + c.speed * delta / 2.0 * c.dir, float(rr.y))
		var i0 := int(c.s)
		var i1 := (i0 + 1) % rr.y
		var f: float = c.s - i0
		var a := world.samples[rr.x + i0]
		var b := world.samples[rr.x + i1]
		var p := a.lerp(b, f)
		var t: Vector3 = (b - a).normalized() * float(c.dir)
		if t.length_squared() < 0.5:
			continue
		var right: Vector3 = t.cross(Vector3.UP).normalized()
		var pos: Vector3 = p + right * absf(c.lane) + Vector3.UP * 0.03
		body.global_transform = Transform3D(Basis.looking_at(-t, Vector3.UP), pos)
