class_name Outskirts
extends Node3D
## Everything past the street grid, so the city sits in a place rather than on a plate: grass fields on three sides, a sandy beach and
## an animated sea to the south with a wooden pier and a lit ferris wheel, and a big hillside sign on the northern hills.

const CITY_EDGE := 165.0          # the street grid (roads included) ends here
const BEACH_START := 330.0
const SHORE_Z := 447.0
const SEA_END := 1700.0
const SKY_RING := 450.0           # the road slab ends here

var sea: MeshInstance3D
var ferris: Node3D
var pier_deck: StaticBody3D
var _rng := RandomNumberGenerator.new()
var _spin := 0.0


func build() -> void:
	name = "Outskirts"
	_rng.seed = 21
	_fields()
	_beach()
	_sea()
	_pier()
	_palms()
	_hill_sign()


func _slab(x0: float, z0: float, x1: float, z1: float, y: float, mat: Material, name_: String, solid := false) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(x1 - x0, 0.1, z1 - z0)
	mi.mesh = bm
	mi.material_override = mat
	mi.position = Vector3((x0 + x1) * 0.5, y, (z0 + z1) * 0.5)
	mi.name = name_
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## Grass where the asphalt slab would otherwise run on forever: north, east and west of the city.
func _fields() -> void:
	var grass := Scenery.pbr("grass", 9.0, 0.95)
	_slab(-SKY_RING, -SKY_RING, SKY_RING, -CITY_EDGE, 0.04, grass, "GrassNorth")
	_slab(-SKY_RING, -CITY_EDGE, -CITY_EDGE, BEACH_START, 0.04, grass, "GrassWest")
	_slab(CITY_EDGE, -CITY_EDGE, SKY_RING, BEACH_START, 0.04, grass, "GrassEast")
	_slab(-SKY_RING, CITY_EDGE, SKY_RING, BEACH_START, 0.04, grass, "GrassSouth")


func _beach() -> void:
	var sand := Scenery.pbr("sand", 6.0, 0.97)
	_slab(-SKY_RING, BEACH_START, SKY_RING, SHORE_Z, 0.05, sand, "Beach")


func _sea() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(SEA_END * 2.0, SEA_END - SHORE_Z + 60.0)
	plane.subdivide_width = 96
	plane.subdivide_depth = 64
	sea = MeshInstance3D.new()
	sea.name = "Sea"
	sea.mesh = plane
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/water.gdshader")
	var noise := FastNoiseLite.new()
	noise.frequency = 0.02
	var nt := NoiseTexture2D.new()
	nt.noise = noise
	nt.as_normal_map = true
	nt.bump_strength = 6.0
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	mat.set_shader_parameter("wave_n", nt)
	sea.material_override = mat
	sea.position = Vector3(0, -0.55, SHORE_Z + (SEA_END - SHORE_Z) * 0.5 - 30.0)
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sea)
	# Sea floor so nothing falls through when it wades in; the sea itself has no collision.
	var floor_body := StaticBody3D.new()
	floor_body.collision_layer = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(SEA_END * 2.0, 1.0, SEA_END)
	cs.shape = bs
	floor_body.add_child(cs)
	floor_body.position = Vector3(0, -3.0, SHORE_Z + SEA_END * 0.5)
	add_child(floor_body)


## A wooden pier running out over the water, with a ferris wheel at its end (lit at night).
func _pier() -> void:
	var wood := Builder.mat(Color(0.42, 0.3, 0.2), 0.85)
	var z0 := SHORE_Z - 20.0
	var len := 120.0
	pier_deck = StaticBody3D.new()
	pier_deck.collision_layer = Data.L_WORLD
	pier_deck.position = Vector3(0, 0.25, z0 + len * 0.5)
	add_child(pier_deck)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(9.0, 0.4, len)
	cs.shape = bs
	pier_deck.add_child(cs)
	var deck := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(9.0, 0.4, len)
	deck.mesh = bm
	deck.material_override = wood
	pier_deck.add_child(deck)
	for i in range(0, int(len), 8):
		for sx in [-4.0, 4.0]:
			var post := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.18
			cm.bottom_radius = 0.2
			cm.height = 3.2
			post.mesh = cm
			post.material_override = wood
			post.position = Vector3(sx, -1.7, -len * 0.5 + i)
			pier_deck.add_child(post)
	# The wheel.
	ferris = Node3D.new()
	ferris.name = "FerrisWheel"
	ferris.position = Vector3(0, 15.0, z0 + len - 10.0)
	add_child(ferris)
	var steel := Builder.mat(Color(0.85, 0.85, 0.88), 0.4, 0.6)
	var lamp := StandardMaterial3D.new()
	lamp.albedo_color = Color(1.0, 0.85, 0.5)
	lamp.emission_enabled = true
	lamp.emission = Color(1.0, 0.8, 0.4)
	lamp.emission_energy_multiplier = 2.5
	var rim := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 12.6
	tm.outer_radius = 13.0
	rim.mesh = tm
	rim.rotation_degrees.x = 90.0
	rim.material_override = steel
	ferris.add_child(rim)
	for k in range(12):
		var a := TAU * k / 12.0
		var spoke := MeshInstance3D.new()
		var sm := BoxMesh.new()
		sm.size = Vector3(0.18, 12.9, 0.18)
		spoke.mesh = sm
		spoke.rotation.z = a
		spoke.material_override = steel
		ferris.add_child(spoke)
		var gondola := MeshInstance3D.new()
		var gm := BoxMesh.new()
		gm.size = Vector3(1.6, 1.4, 1.6)
		gondola.mesh = gm
		gondola.position = Vector3(cos(a) * 13.0, sin(a) * 13.0, 0)
		gondola.material_override = lamp if k % 2 == 0 else Builder.mat(Color(0.8, 0.15, 0.2), 0.5)
		ferris.add_child(gondola)
	for sx in [-5.0, 5.0]:
		var leg := MeshInstance3D.new()
		var lm := BoxMesh.new()
		lm.size = Vector3(0.7, 30.0, 0.7)
		leg.mesh = lm
		leg.position = Vector3(sx * 0.9, -0.5, 0)
		leg.rotation.z = -sx * 0.045
		leg.material_override = steel
		ferris.add_child(leg)


func _palms() -> void:
	var scene := load(Scenery.SCENERY + "palm_near.glb") as PackedScene
	if scene == null:
		return
	for i in range(34):
		var x := -SKY_RING + 20.0 + (SKY_RING * 2.0 - 40.0) * float(i) / 33.0 + _rng.randf_range(-6.0, 6.0)
		if absf(x) < 14.0:
			continue                                   # keep the pier approach clear
		var z := _rng.randf_range(BEACH_START + 12.0, BEACH_START + 40.0)
		var n := scene.instantiate() as Node3D
		add_child(n)
		ModelFit.place_by_height(n, _rng.randf_range(8.0, 11.0), _rng.randf_range(0.0, 360.0), 0.08)
		n.position += Vector3(x, 0, z)


## Big white letters on the northern hillside, readable from the city.
func _hill_sign() -> void:
	var root := Node3D.new()
	root.name = "HillSign"
	root.position = Vector3(-60.0, 118.0, -1020.0)
	add_child(root)
	var l := Label3D.new()
	l.text = "CRIMSON"
	l.font_size = 900
	l.pixel_size = 0.12
	l.modulate = Color(0.97, 0.97, 0.95)
	l.outline_size = 0
	l.shaded = true
	l.double_sided = true
	l.rotation.y = 0.0
	root.add_child(l)


func _process(delta: float) -> void:
	_spin += delta * 0.12
	if ferris != null:
		ferris.rotation.z = _spin
