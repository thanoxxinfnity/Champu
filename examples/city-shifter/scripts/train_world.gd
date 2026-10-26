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
var _chunks: Array[Node3D] = []     # city blocks that slide past: [node, ...], each wraps when it has gone by
var _chunk_len := 48.0
var _chunk_n := 5
var _patterns: Array[Node3D] = []                # periodic things (sleepers, poles): [node] with meta "period"
var _far: Array[Node3D] = []
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


const CAR_MODELS := ["res://assets/train/car_a.glb", "res://assets/train/car_c.glb"]
const LOCO_MODEL := "res://assets/train/loco.glb"


## The train: real models (a carriage and a flatbed alternating, a locomotive in front) squeezed to the car size, with invisible solid decks, rails and walls
## underneath that the players actually stand on. Holes in the roof of two cars are drawn as dark pits.
func _train() -> void:
	var dark := Mat.flat(Color(0.12, 0.13, 0.18))
	var pit := Mat.flat(Color(1.0, 0.45, 0.1), 1.0)
	var half := Data.CAR_W * 0.5
	for i in Data.CARS:
		var cz := car_center_z(i)
		var holed := i == 2 or i == 4
		var vis := ModelKit.car(CAR_MODELS[i % CAR_MODELS.size()], Data.CAR_W, Data.CAR_LEN - 0.4, Data.DECK_Y)
		if vis != null:
			vis.position = Vector3(0, 0, cz)
			add_child(vis)
		# the solid roof the players stand on (not drawn: the model above it is what you see)
		var deck_h := 0.4
		if holed:
			var seg := (Data.CAR_LEN - 3.2) * 0.5
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz - Data.CAR_LEN * 0.5 + seg * 0.5), Vector3(Data.CAR_W, deck_h, seg), dark, 1, false)
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz + Data.CAR_LEN * 0.5 - seg * 0.5), Vector3(Data.CAR_W, deck_h, seg), dark, 1, false)
			Mat.box(self, Vector3(0, Data.DECK_Y + 0.03, cz), Vector3(Data.CAR_W - 0.3, 0.05, 3.2), dark)
			for hz in [-1.6, 1.6]:
				Mat.box(self, Vector3(0, Data.DECK_Y + 0.05, cz + hz), Vector3(Data.CAR_W - 0.3, 0.06, 0.2), pit)
		else:
			Mat.solid(self, Vector3(0, Data.DECK_Y - deck_h * 0.5, cz), Vector3(Data.CAR_W, deck_h, Data.CAR_LEN), dark, 1, false)
		for sx in [-1.0, 1.0]:
			Mat.solid(self, Vector3(sx * (half - 0.08), Data.DECK_Y + 0.3, cz), Vector3(0.16, 0.6, Data.CAR_LEN), dark, 1, false)
	# the locomotive in front
	var ez := car_center_z(Data.CARS) + 1.0
	var loco := ModelKit.car(LOCO_MODEL, Data.CAR_W, Data.CAR_LEN - 2.0, Data.DECK_Y)
	if loco != null:
		loco.position = Vector3(0, 0, ez)
		add_child(loco)
	Mat.solid(self, Vector3(0, Data.DECK_Y - 0.2, ez), Vector3(Data.CAR_W, 0.4, Data.CAR_LEN - 2.0), dark, 1, false)
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
	# lamp posts on both sides: the real model, one multimesh, sliding by the period
	var lamp := ModelKit.first_mesh("res://assets/props/lamp.glb")
	if lamp != null:
		var lb := lamp.get_aabb()
		var k := 7.5 / maxf(lb.size.y, 0.0001)           # the model is prepared upright along its own Y (glTF up)
		var pm := MultiMesh.new()
		pm.transform_format = MultiMesh.TRANSFORM_3D
		pm.mesh = lamp
		var pn := 24
		pm.instance_count = pn
		for q in pn:
			var side := -1.0 if q % 2 == 0 else 1.0
			var basis := Basis.from_scale(Vector3.ONE * k).rotated(Vector3.UP, 0.0 if side < 0.0 else PI)
			pm.set_instance_transform(q, Transform3D(basis, Vector3(side * 5.2, -0.6 - lb.position.y * k, -float(q / 2) * 18.0 + 60.0)))
		var pmi := MultiMeshInstance3D.new()
		pmi.multimesh = pm
		pmi.set_meta("period", 36.0)
		add_child(pmi)
		_patterns.append(pmi)


# ── the city that slides past ────────────────────────────────────────────────

const CITY_NEAR := ["res://assets/city/city_a.glb", "res://assets/city/city_c.glb"]
const CITY_FAR := "res://assets/city/city_b.glb"


## The city is a handful of real skyline models (one mesh each) that slide past: five near blocks a side, wrapping round, and a far skyline that moves slower.
func _city() -> void:
	for side in [-1.0, 1.0]:
		for c in _chunk_n:
			var model := ModelKit.fitted(CITY_NEAR[(c + (1 if side > 0.0 else 0)) % CITY_NEAR.size()], _chunk_len * 1.05, "bottom")
			if model == null:
				continue
			var sz: Vector3 = model.get_meta("size")
			var holder := Node3D.new()
			holder.add_child(model)
			model.rotation.y = 0.0 if side < 0.0 else PI
			holder.position = Vector3(side * (17.0 + sz.x * 0.5), -1.0, -float(c) * _chunk_len + 30.0)
			add_child(holder)
			_chunks.append(holder)
	for side in [-1.0, 1.0]:
		for c in 3:
			var far_model := ModelKit.fitted(CITY_FAR, 130.0, "bottom")
			if far_model == null:
				continue
			var fsz: Vector3 = far_model.get_meta("size")
			var fh := Node3D.new()
			fh.add_child(far_model)
			fh.position = Vector3(side * (70.0 + fsz.x * 0.5), -2.0, -float(c) * 120.0 + 60.0)
			fh.set_meta("len", 120.0)
			add_child(fh)
			_far.append(fh)


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
	# the siege ships: the airship model, darkened, hanging over the horizon
	for k in 3:
		var ship := ModelKit.fitted("res://assets/props/airship.glb", 38.0, "center")
		if ship == null:
			continue
		for mi in ship.find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).material_overlay = Mat.unlit(Color(0.12, 0.06, 0.16), 0.55)
		ship.position = Vector3(-60.0 + k * 55.0, 48.0 + k * 6.0, -60.0 - k * 40.0)
		ship.rotation.y = -PI * 0.5 + float(k) * 0.3
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
		for mi in ch.find_children("*", "MeshInstance3D", true, false):
			var g := mi as GeometryInstance3D
			g.visibility_range_end = view_dist + 30.0
			g.visibility_range_end_margin = 8.0
			g.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	if env != null:
		env.fog_density = 2.6 / view_dist


func set_far_visible(on: bool) -> void:
	for f in _far:
		f.visible = on
	for s in _ships:
		s.visible = on
	for c in _clouds:
		c.visible = on
