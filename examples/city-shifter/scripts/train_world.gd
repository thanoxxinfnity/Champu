class_name TrainWorld
extends Node3D
## The train and the world it runs through. The train never moves: it is a static, solid thing the players walk on. The world slides past it (rails,
## poles and two rows of city blocks are repeating patterns shifted by the train's progress), which costs a handful of draw calls and no physics.
## Roofs have gaps between the cars and holes in some cars; the bridges are for those.
## View distance (30–80 m) is a visibility range on the city chunks plus matching fog, so the edge fades instead of popping.

signal goal_reached

var env: Environment
var sun: DirectionalLight3D
var spawn_points: Array[Marker3D] = []
var progress := 0.0                 # metres travelled
var speed := Data.TRAIN_SPEED
var view_dist := 60.0
var _chunks: Array[MultiMeshInstance3D] = []     # city blocks that slide past: [node, ...], each wraps when it has gone by
var _chunk_len := 48.0
var _chunk_n := 5
var _patterns: Array[Node3D] = []                # periodic things (sleepers, poles): [node] with meta "period"
var _far: Array[MultiMeshInstance3D] = []
var _ships: Array[Node3D] = []
var _clouds: Array[MeshInstance3D] = []
var _t := 0.0
var _goal_given := false
var goal_z := 0.0


func _ready() -> void:
	build()


func build() -> void:
	_environment()
	_train()
	_track()
	_city()
	_sky()
	set_view_distance(view_dist)


# ── geometry of the train ────────────────────────────────────────────────────

static func car_center_z(i: int) -> float:
	return -(float(i) * (Data.CAR_LEN + Data.CAR_GAP)) - Data.CAR_LEN * 0.5


static func deck_range(i: int) -> Vector2:
	var c := car_center_z(i)
	return Vector2(c - Data.CAR_LEN * 0.5, c + Data.CAR_LEN * 0.5)


## Is this point over a roof (x within the car width, z within a car)?
static func over_roof(p: Vector3) -> bool:
	if absf(p.x) > Data.CAR_W * 0.5:
		return false
	for i in Data.CARS:
		var r := deck_range(i)
		if p.z >= r.x and p.z <= r.y:
			return true
	return false


func _environment() -> void:
	env = Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.1, 0.17, 0.42)
	sm.sky_horizon_color = Color(1.0, 0.62, 0.38)
	sm.ground_horizon_color = Color(0.75, 0.5, 0.45)
	sm.ground_bottom_color = Color(0.12, 0.14, 0.25)
	sm.sun_angle_max = 14.0
	sky.sky_material = sm
	sky.process_mode = Sky.PROCESS_MODE_QUALITY if false else Sky.PROCESS_MODE_AUTOMATIC
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.66, 0.85)
	env.ambient_light_energy = 0.75
	env.fog_enabled = true
	env.fog_light_color = Color(0.86, 0.62, 0.5)
	env.fog_density = 0.04
	env.fog_sky_affect = 0.6
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 35, 0)
	sun.light_color = Color(1.0, 0.85, 0.7)
	sun.light_energy = 1.05
	sun.shadow_enabled = false
	add_child(sun)


func _train() -> void:
	var steel := Mat.flat(Color(0.42, 0.46, 0.55))
	var dark := Mat.flat(Color(0.16, 0.18, 0.24))
	var stripe := Mat.flat(Color(0.95, 0.95, 0.98))
	var warn := Mat.flat(Color(1.0, 0.72, 0.1))
	var body_cols := [Color(0.2, 0.55, 0.62), Color(0.85, 0.42, 0.2), Color(0.35, 0.4, 0.62), Color(0.72, 0.28, 0.3), Color(0.3, 0.6, 0.4), Color(0.5, 0.5, 0.58)]
	var half := Data.CAR_W * 0.5
	for i in Data.CARS:
		var cz := car_center_z(i)
		var body := Mat.flat(body_cols[i % body_cols.size()])
		var holed := i == 2 or i == 4
		# the car body under the roof (visual) and the wheels
		Mat.box(self, Vector3(0, Data.DECK_Y - 1.5, cz), Vector3(Data.CAR_W - 0.1, 2.8, Data.CAR_LEN - 0.3), body)
		Mat.box(self, Vector3(0, Data.DECK_Y - 3.0, cz), Vector3(Data.CAR_W - 0.6, 0.7, Data.CAR_LEN - 1.0), dark)
		for wz in [-4.0, -2.8, 2.8, 4.0]:
			for wx in [-1, 1]:
				Mat.cyl(self, Vector3(wx * (half - 0.1), 0.0, cz + wz), 0.55, 0.3, dark).rotation_degrees = Vector3(0, 0, 90)
		# the roof deck: solid; a car with a hole has the deck in two halves
		var deck_h := 0.4
		if holed:
			var seg := (Data.CAR_LEN - 3.2) * 0.5
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz - Data.CAR_LEN * 0.5 + seg * 0.5), Vector3(Data.CAR_W, deck_h, seg), steel)
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz + Data.CAR_LEN * 0.5 - seg * 0.5), Vector3(Data.CAR_W, deck_h, seg), steel)
			Mat.box(self, Vector3(0, Data.DECK_Y - 1.2, cz), Vector3(Data.CAR_W - 0.4, 0.2, 3.2), Mat.flat(Color(1.0, 0.45, 0.1), 1.2))
			for hz in [-1.6, 1.6]:
				Mat.box(self, Vector3(0, Data.DECK_Y + 0.02, cz + hz), Vector3(Data.CAR_W, 0.06, 0.25), warn)
		else:
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz), Vector3(Data.CAR_W, deck_h, Data.CAR_LEN), steel)
		# painted stripes and low side rails (rails collide: a bump, not a fence)
		Mat.box(self, Vector3(0, Data.DECK_Y + 0.02, cz), Vector3(0.4, 0.05, Data.CAR_LEN - 0.4), stripe)
		for sx in [-1.0, 1.0]:
			Mat.solid(self, Vector3(sx * (half - 0.08), Data.DECK_Y + 0.3, cz), Vector3(0.16, 0.6, Data.CAR_LEN), dark)
			for rz in [-5.0, 0.0, 5.0]:
				Mat.box(self, Vector3(sx * (half - 0.08), Data.DECK_Y + 0.75, cz + rz), Vector3(0.2, 0.3, 0.2), warn)
		# the coupling gap to the next car: chain and hitch
		if i < Data.CARS - 1:
			var gz := cz - Data.CAR_LEN * 0.5 - Data.CAR_GAP * 0.5
			Mat.box(self, Vector3(0, Data.DECK_Y - 1.6, gz), Vector3(0.5, 0.35, Data.CAR_GAP + 0.6), dark)
			Mat.box(self, Vector3(0.0, Data.DECK_Y - 1.0, gz), Vector3(1.4, 0.12, Data.CAR_GAP), Mat.flat(Color(0.9, 0.4, 0.1), 0.8))
	# the engine in front: a cab, a nose and a headlamp
	var ez := car_center_z(Data.CARS) + 1.0
	var eng := Mat.flat(Color(0.75, 0.2, 0.18))
	Mat.solid(self, Vector3(0, Data.DECK_Y - 0.2, ez), Vector3(Data.CAR_W, 0.4, Data.CAR_LEN - 2.0), steel)
	Mat.box(self, Vector3(0, Data.DECK_Y - 1.5, ez), Vector3(Data.CAR_W - 0.1, 2.8, Data.CAR_LEN - 2.0), eng)
	Mat.box(self, Vector3(0, Data.DECK_Y + 1.4, ez + 2.0), Vector3(Data.CAR_W - 0.6, 2.8, 4.0), eng)
	Mat.box(self, Vector3(0, Data.DECK_Y + 2.0, ez + 0.0), Vector3(1.2, 2.0, 1.2), dark)
	Mat.box(self, Vector3(0, Data.DECK_Y + 1.4, ez - 0.05 - 2.0 + 0.1), Vector3(2.4, 1.0, 0.1), Mat.flat(Color(0.5, 0.85, 1.0), 1.0))
	Mat.box(self, Vector3(0, Data.DECK_Y - 0.8, ez - (Data.CAR_LEN - 2.0) * 0.5 - 0.1), Vector3(1.0, 0.6, 0.2), Mat.unlit(Color(1.0, 0.95, 0.7)))
	goal_z = ez + 1.0
	# spawn markers on the roof of the last car: two columns, four rows
	var sc := car_center_z(0)
	for n in 8:
		var m := Marker3D.new()
		m.name = "Spawn%d" % n
		m.position = Vector3(-1.3 if n % 2 == 0 else 1.3, Data.DECK_Y + 0.15, sc + 4.0 - float(n / 2) * 1.5)
		add_child(m)
		spawn_points.append(m)


func _track() -> void:
	var bed := Mat.flat(Color(0.28, 0.27, 0.32))
	var rail := Mat.flat(Color(0.7, 0.72, 0.8))
	Mat.box(self, Vector3(0, -1.0, -45), Vector3(9.0, 0.8, 260), bed)
	for rx in [-1.05, 1.05]:
		Mat.box(self, Vector3(rx, -0.55, -45), Vector3(0.12, 0.12, 260), rail)
	# sleepers: one multimesh whose pattern slides by the progress modulo the spacing
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = Mat.box_mesh(Vector3(3.4, 0.14, 0.4))
	var n := 140
	mm.instance_count = n
	for k in n:
		mm.set_instance_transform(k, Transform3D(Basis.IDENTITY, Vector3(0, -0.62, -float(k) * 2.0 + 50.0)))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = Mat.flat(Color(0.35, 0.24, 0.2))
	mi.set_meta("period", 2.0)
	mi.set_meta("base_z", 0.0)
	add_child(mi)
	_patterns.append(mi)
	# lamp poles on both sides
	var pm := MultiMesh.new()
	pm.transform_format = MultiMesh.TRANSFORM_3D
	pm.mesh = Mat.box_mesh(Vector3(0.25, 7.0, 0.25))
	var pn := 24
	pm.instance_count = pn
	for k in pn:
		var side := -1.0 if k % 2 == 0 else 1.0
		pm.set_instance_transform(k, Transform3D(Basis.IDENTITY, Vector3(side * 5.4, 2.5, -float(k / 2) * 18.0 + 60.0)))
	var pmi := MultiMeshInstance3D.new()
	pmi.multimesh = pm
	pmi.material_override = Mat.flat(Color(0.2, 0.22, 0.3))
	pmi.set_meta("period", 36.0)
	add_child(pmi)
	_patterns.append(pmi)
	var lm := MultiMesh.new()
	lm.transform_format = MultiMesh.TRANSFORM_3D
	lm.mesh = Mat.box_mesh(Vector3(0.9, 0.3, 0.5))
	lm.instance_count = pn
	for k in pn:
		var side2 := -1.0 if k % 2 == 0 else 1.0
		lm.set_instance_transform(k, Transform3D(Basis.IDENTITY, Vector3(side2 * 4.9, 6.1, -float(k / 2) * 18.0 + 60.0)))
	var lmi := MultiMeshInstance3D.new()
	lmi.multimesh = lm
	lmi.material_override = Mat.unlit(Color(1.0, 0.85, 0.5))
	lmi.set_meta("period", 36.0)
	add_child(lmi)
	_patterns.append(lmi)


# ── the city that slides past ────────────────────────────────────────────────

func _city() -> void:
	var cols := [Color(0.3, 0.34, 0.5), Color(0.5, 0.36, 0.42), Color(0.24, 0.3, 0.42), Color(0.62, 0.44, 0.36), Color(0.36, 0.42, 0.5), Color(0.55, 0.52, 0.62)]
	for side in [-1.0, 1.0]:
		for c in _chunk_n:
			var mmi := _make_chunk(side, c, 19.0, 9, cols, 5.0, 24.0, true)
			mmi.position.z = -float(c) * _chunk_len + 30.0
			add_child(mmi)
			_chunks.append(mmi)
	# the skyline far away: fewer, bigger blocks, slower (parallax)
	for side in [-1.0, 1.0]:
		for c in 3:
			var far_chunk := _make_chunk(side, c + 40, 70.0, 7, cols, 40.0, 120.0, false)
			far_chunk.position.z = -float(c) * 120.0 + 60.0
			far_chunk.set_meta("len", 120.0)
			add_child(far_chunk)
			_far.append(far_chunk)


func _make_chunk(side: float, seed_i: int, x_off: float, count: int, cols: Array, hmin: float, hmax: float, near: bool) -> MultiMeshInstance3D:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1000 + seed_i * 7 + (1 if side > 0 else 0)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = Mat.box_mesh(Vector3(1, 1, 1))
	mm.instance_count = count
	var span := _chunk_len if near else 120.0
	for k in count:
		var w := rng.randf_range(6.0, 12.0) * (1.0 if near else 3.0)
		var d := span / float(count) * rng.randf_range(0.7, 0.95)
		var h := rng.randf_range(hmin, hmax)
		var x := side * (x_off + w * 0.5 + rng.randf_range(0.0, 6.0))
		var z := -float(k) * span / float(count) - span * 0.5 / float(count)
		mm.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3(w, h, d)), Vector3(x, h * 0.5 - 1.0, z)))
		var c: Color = cols[rng.randi() % cols.size()]
		mm.set_instance_color(k, c if near else c.darkened(0.25))
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# lit windows: a thin emissive-looking strip painted as a second instance set is not worth a draw call; the colour variation carries the look
	return mi


func _sky() -> void:
	# clouds: a few flat translucent slabs drifting slowly
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for k in 7:
		var cm := MeshInstance3D.new()
		cm.mesh = Mat.box_mesh(Vector3(rng.randf_range(24, 50), 2.5, rng.randf_range(10, 20)))
		cm.material_override = Mat.unlit(Color(1.0, 0.82, 0.74), 0.55)
		cm.position = Vector3(rng.randf_range(-120, 120), rng.randf_range(55, 85), rng.randf_range(-220, 20))
		cm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(cm)
		_clouds.append(cm)
	# the siege ships: dark hulls with glowing undersides hanging over the horizon
	for k in 3:
		var ship := Node3D.new()
		Mat.box(ship, Vector3.ZERO, Vector3(26, 5, 8), Mat.flat(Color(0.12, 0.13, 0.2)))
		Mat.box(ship, Vector3(0, -2.8, 0), Vector3(18, 1.2, 5), Mat.flat(Color(1.0, 0.35, 0.15), 1.6))
		Mat.box(ship, Vector3(0, 3.2, 0), Vector3(8, 2.4, 5), Mat.flat(Color(0.2, 0.22, 0.32)))
		ship.position = Vector3(-60.0 + k * 55.0, 48.0 + k * 6.0, -60.0 - k * 40.0)
		ship.set_meta("phase", float(k) * 2.1)
		add_child(ship)
		_ships.append(ship)


# ── per frame ────────────────────────────────────────────────────────────────

func update(delta: float) -> void:
	_t += delta
	var d := speed * delta
	progress += d
	for p in _patterns:
		var per: float = p.get_meta("period")
		p.position.z = fposmod(progress, per)
	for ch in _chunks:
		ch.position.z += d
		if ch.position.z > _chunk_len * 1.2 + 30.0:
			ch.position.z -= _chunk_len * float(_chunk_n)
	for f in _far:
		f.position.z += d * 0.35
		if f.position.z > 180.0:
			f.position.z -= 360.0
	for c in _clouds:
		c.position.z += d * 0.12
		if c.position.z > 40.0:
			c.position.z -= 280.0
	for s in _ships:
		var ph: float = s.get_meta("phase")
		s.position.x += sin(_t * 0.2 + ph) * 3.0 * delta
		s.position.y += sin(_t * 0.5 + ph) * 0.5 * delta


## 30–80 m. The city chunks go invisible past it (fading over 8 m) and the fog thickens to hide the edge.
func set_view_distance(dist: float) -> void:
	view_dist = clampf(dist, 30.0, 80.0)
	for ch in _chunks:
		ch.visibility_range_end = view_dist + 24.0
		ch.visibility_range_end_margin = 8.0
		ch.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	for f in _far:
		f.visibility_range_end = 0.0
	if env != null:
		env.fog_density = 2.6 / view_dist


func set_far_visible(on: bool) -> void:
	for f in _far:
		f.visible = on
	for s in _ships:
		s.visible = on
	for c in _clouds:
		c.visible = on
