class_name Kit
extends RefCounted
## Building kit for Harrow Cove: a solid shell (collider + nav block from World._box) dressed with textured walls, window rows with frames, sills and
## mullions, doors with steps and awnings, cornices, plinths, drain pipes, gabled tile roofs with chimneys or flat roofs with parapets and rooftop clutter.
## Everything is plain meshes under the zone node; Batcher merges them per material afterwards, so detail costs triangles, not draw calls.

const STYLES := [
	{"wall": "brick_red", "tile": 2.8, "tint": Color(0.78, 0.72, 0.7), "roof": "roof_tiles", "roof_tint": Color(0.62, 0.56, 0.56), "gable": true, "frame": Color(0.78, 0.76, 0.72), "shutters": Color(0.2, 0.3, 0.28)},
	{"wall": "plaster_beige", "tile": 3.2, "tint": Color(0.82, 0.84, 0.88), "roof": "roof_grey", "roof_tint": Color(0.55, 0.58, 0.62), "gable": true, "frame": Color(0.88, 0.88, 0.86), "shutters": Color(0.32, 0.22, 0.2)},
	{"wall": "planks_white", "tile": 2.4, "tint": Color(0.74, 0.8, 0.84), "roof": "roof_iron", "roof_tint": Color(0.55, 0.5, 0.5), "gable": true, "frame": Color(0.9, 0.9, 0.88), "shutters": Color(0.22, 0.28, 0.4)},
	{"wall": "brick_dark", "tile": 2.8, "tint": Color(0.75, 0.74, 0.78), "roof": "concrete", "roof_tint": Color(0.5, 0.52, 0.54), "gable": false, "frame": Color(0.2, 0.22, 0.25), "shutters": Color(0.3, 0.3, 0.32)},
	{"wall": "plaster_blue", "tile": 3.2, "tint": Color(0.8, 0.86, 0.92), "roof": "roof_tiles", "roof_tint": Color(0.5, 0.48, 0.52), "gable": true, "frame": Color(0.92, 0.92, 0.9), "shutters": Color(0.5, 0.2, 0.2)},
	{"wall": "planks_brown", "tile": 2.4, "tint": Color(0.7, 0.68, 0.66), "roof": "roof_iron", "roof_tint": Color(0.46, 0.42, 0.42), "gable": true, "frame": Color(0.82, 0.8, 0.74), "shutters": Color(0.18, 0.26, 0.24)},
	{"wall": "concrete_block", "tile": 3.0, "tint": Color(0.74, 0.76, 0.78), "roof": "concrete", "roof_tint": Color(0.46, 0.48, 0.5), "gable": false, "frame": Color(0.25, 0.27, 0.3), "shutters": Color(0.3, 0.3, 0.3)},
]

const FACES := {"e": [Vector3(1, 0, 0), Vector3(0, 0, -1)], "w": [Vector3(-1, 0, 0), Vector3(0, 0, 1)], "n": [Vector3(0, 0, -1), Vector3(-1, 0, 0)], "s": [Vector3(0, 0, 1), Vector3(1, 0, 0)]}


static func style(i: int) -> Dictionary:
	return STYLES[posmod(i, STYLES.size())]


static func glass(lit: bool) -> Material:
	if lit:
		return Toon.flat(Color(0.95, 0.78, 0.5), 0.0, 0.0, Color(1.0, 0.62, 0.3), 1.35)
	return Toon.flat(Color(0.06, 0.09, 0.12), 0.0, 0.0, Color(0.02, 0.035, 0.05), 0.6)


## A dressed building. `faces` lists the sides that get windows ("e","w","n","s"); `doors` the sides with a ground-floor door; `sign` an optional shop name.
static func building(w: World, parent: Node3D, r: Rect2, h: float, style_id: int, faces: Array, doors: Array = [], sign_text := "", seed_v := 1) -> void:
	var st := style(style_id)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v * 7919 + style_id
	var c := r.get_center()
	var wall_m := Surf.mat(st.wall, st.tile, st.tint, 0.55, 0.7)
	w._box(parent, Vector3(c.x, h * 0.5, c.y), Vector3(r.size.x, h, r.size.y), wall_m)
	var trim_m := Surf.mat("concrete", 2.4, Color(0.7, 0.72, 0.76), 0.0, 0.5)
	# plinth + cornice run round the whole block
	w._flat(parent, Vector3(c.x, 0.45, c.y), Vector3(r.size.x + 0.3, 0.9, r.size.y + 0.3), Surf.mat("concrete_block", 2.4, Color(0.55, 0.57, 0.6), 0.6, 0.8))
	w._flat(parent, Vector3(c.x, h - 0.12, c.y), Vector3(r.size.x + 0.5, 0.36, r.size.y + 0.5), trim_m)
	# roof
	if st.gable:
		_gable(w, parent, r, h, st, rng)
	else:
		_flat_roof(w, parent, r, h, st, rng)
	for f in faces:
		_windows(w, parent, r, h, f, st, rng, doors.has(f))
	for f in doors:
		_door(w, parent, r, f, st, rng, sign_text if f == doors[0] else "")
	# drain pipe on a back corner
	var pipe_m := Surf.mat("metal", 2.0, Color(0.42, 0.44, 0.48), 0.0, 0.6, 0.0)
	w._flat(parent, Vector3(r.end.x + 0.1, h * 0.5, r.end.y + 0.1), Vector3(0.14, h, 0.14), pipe_m)


static func _gable(w: World, parent: Node3D, r: Rect2, h: float, st: Dictionary, rng: RandomNumberGenerator) -> void:
	var c := r.get_center()
	var along_z := r.size.y >= r.size.x
	var span := r.size.x if along_z else r.size.y
	var length := r.size.y if along_z else r.size.x
	var roof := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(span + 1.4, 2.2 + span * 0.14, length + 1.0)
	roof.mesh = pm
	roof.material_override = Surf.mat(st.roof, 2.2, st.roof_tint, 0.0, 0.9)
	roof.position = Vector3(c.x, h + pm.size.y * 0.5 - 0.1, c.y)
	if not along_z:
		roof.rotation_degrees.y = 90.0
	roof.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(roof)
	# chimney (brick) and a dormer on bigger blocks
	var brick := Surf.mat("brick_dark", 1.5, Color(0.7, 0.66, 0.66), 0.0, 1.0)
	var off := Vector3(r.size.x * rng.randf_range(0.15, 0.3) * (1 if rng.randf() < 0.5 else -1), 0, r.size.y * rng.randf_range(0.1, 0.3) * (1 if rng.randf() < 0.5 else -1))
	w._flat(parent, Vector3(c.x + off.x, h + pm.size.y * 0.72, c.y + off.z), Vector3(0.95, 2.6, 0.95), brick)
	w._flat(parent, Vector3(c.x + off.x, h + pm.size.y * 0.72 + 1.4, c.y + off.z), Vector3(1.15, 0.2, 1.15), Surf.mat("concrete", 1.0, Color(0.5, 0.52, 0.55)))


static func _flat_roof(w: World, parent: Node3D, r: Rect2, h: float, st: Dictionary, rng: RandomNumberGenerator) -> void:
	var c := r.get_center()
	var par := Surf.mat("concrete", 2.4, Color(0.56, 0.58, 0.6), 0.0, 0.8)
	var t := 0.4
	w._flat(parent, Vector3(c.x, h + 0.55, r.position.y), Vector3(r.size.x + 0.5, 0.9, t), par)
	w._flat(parent, Vector3(c.x, h + 0.55, r.end.y), Vector3(r.size.x + 0.5, 0.9, t), par)
	w._flat(parent, Vector3(r.position.x, h + 0.55, c.y), Vector3(t, 0.9, r.size.y + 0.5), par)
	w._flat(parent, Vector3(r.end.x, h + 0.55, c.y), Vector3(t, 0.9, r.size.y + 0.5), par)
	w._flat(parent, Vector3(c.x, h + 0.02, c.y), Vector3(r.size.x, 0.1, r.size.y), Surf.mat("rust", 3.0, Color(0.42, 0.44, 0.46), 0.0, 1.0, 0.0))
	# rooftop clutter: AC units, a water tank on legs, an antenna
	var metal := Surf.mat("metal", 1.5, Color(0.52, 0.54, 0.58), 0.0, 0.7, 0.0)
	for i in rng.randi_range(2, 4):
		var p := Vector3(rng.randf_range(r.position.x + 1.5, r.end.x - 1.5), h + 0.55, rng.randf_range(r.position.y + 1.5, r.end.y - 1.5))
		w._flat(parent, p, Vector3(rng.randf_range(0.9, 1.6), 1.0, rng.randf_range(0.8, 1.2)), metal)
	var tp := Vector3(c.x + r.size.x * 0.25, h, c.y - r.size.y * 0.25)
	for lx in [-0.5, 0.5]:
		for lz in [-0.5, 0.5]:
			w._flat(parent, tp + Vector3(lx, 0.8, lz), Vector3(0.1, 1.6, 0.1), metal)
	var tank := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.9
	cm.bottom_radius = 0.9
	cm.height = 1.8
	cm.radial_segments = 10
	tank.mesh = cm
	tank.material_override = Surf.mat("planks_brown", 1.6, Color(0.55, 0.5, 0.45), 0.0, 0.8)
	tank.position = tp + Vector3(0, 2.5, 0)
	parent.add_child(tank)
	w._flat(parent, Vector3(c.x - r.size.x * 0.3, h + 3.0, c.y + r.size.y * 0.2), Vector3(0.08, 6.0, 0.08), metal)


## Window rows on one face. Ground floor skips the door bay on faces that have a door.
static func _windows(w: World, parent: Node3D, r: Rect2, h: float, face: String, st: Dictionary, rng: RandomNumberGenerator, has_door: bool) -> void:
	var basis: Array = FACES[face]
	var n: Vector3 = basis[0]
	var along: Vector3 = basis[1]
	var c := r.get_center()
	var face_len := r.size.y if face == "e" or face == "w" else r.size.x
	var origin := Vector3(c.x, 0, c.y) + n * (r.size.x * 0.5 if n.x != 0.0 else r.size.y * 0.5)
	var frame_m := Toon.flat(st.frame, 0.0, 0.3)
	var shut_m := Toon.flat(st.shutters, 0.0, 0.4)
	var bays := int(floor((face_len - 1.6) / 3.2))
	if bays < 1:
		return
	var floors: Array = []
	var y := 2.0
	if has_door:
		y = 4.9
	while y < h - 1.6:
		floors.append(y)
		y += 3.1
	if not has_door and h > 4.6:
		floors.append(1.95)
		floors.sort()
	for fy in floors:
		for b in bays:
			var u := (b - (bays - 1) * 0.5) * 3.2
			var pos := origin + along * u
			if rng.randf() < 0.1:
				continue
			_window(w, parent, pos, n, along, fy, rng.randf() < 0.24, frame_m, shut_m, rng.randf() < 0.4)


static func _window(w: World, parent: Node3D, pos: Vector3, n: Vector3, along: Vector3, y: float, lit: bool, frame_m: Material, shut_m: Material, shutters: bool) -> void:
	var wide := along.x != 0.0
	var sz := func(l: float, hgt: float, d: float) -> Vector3:
		return Vector3(l, hgt, d) if wide else Vector3(d, hgt, l)
	var at := func(off: float, yy: float, lat := 0.0) -> Vector3:
		return pos + n * off + along * lat + Vector3(0, yy, 0)
	w._flat(parent, at.call(0.06, y), sz.call(1.55, 2.0, 0.12), frame_m)
	w._flat(parent, at.call(0.12, y), sz.call(1.25, 1.7, 0.06), glass(lit))
	w._flat(parent, at.call(0.15, y), sz.call(0.07, 1.7, 0.07), frame_m)
	w._flat(parent, at.call(0.15, y), sz.call(1.25, 0.07, 0.07), frame_m)
	w._flat(parent, at.call(0.17, y - 1.04), sz.call(1.85, 0.12, 0.34), frame_m)
	if shutters:
		w._flat(parent, at.call(0.1, y, 1.05), sz.call(0.55, 1.9, 0.07), shut_m)
		w._flat(parent, at.call(0.1, y, -1.05), sz.call(0.55, 1.9, 0.07), shut_m)


static func _door(w: World, parent: Node3D, r: Rect2, face: String, st: Dictionary, rng: RandomNumberGenerator, sign_text: String) -> void:
	var basis: Array = FACES[face]
	var n: Vector3 = basis[0]
	var along: Vector3 = basis[1]
	var c := r.get_center()
	var origin := Vector3(c.x, 0, c.y) + n * (r.size.x * 0.5 if n.x != 0.0 else r.size.y * 0.5)
	var wide := along.x != 0.0
	var face_len := r.size.y if face == "e" or face == "w" else r.size.x
	var lat := clampf(rng.randf_range(-face_len * 0.25, face_len * 0.25), -face_len * 0.4, face_len * 0.4)
	var pos := origin + along * lat
	var sz := func(l: float, hgt: float, d: float) -> Vector3:
		return Vector3(l, hgt, d) if wide else Vector3(d, hgt, l)
	var frame_m := Toon.flat(st.frame, 0.0, 0.3)
	w._flat(parent, pos + n * 0.08 + Vector3(0, 1.4, 0), sz.call(2.0, 2.8, 0.14), frame_m)
	w._flat(parent, pos + n * 0.16 + Vector3(0, 1.3, 0), sz.call(1.5, 2.55, 0.08), Surf.mat("door_wood", 1.6, Color(0.7, 0.68, 0.66), 0.0, 0.6))
	w._flat(parent, pos + n * 0.4 + Vector3(0, 0.1, 0), sz.call(2.4, 0.2, 0.9), Surf.mat("concrete", 1.5, Color(0.6, 0.62, 0.66)))
	# awning
	var aw := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = sz.call(3.0, 0.1, 1.5)
	aw.mesh = bm
	var cols := [Color(0.5, 0.18, 0.2), Color(0.2, 0.34, 0.36), Color(0.5, 0.42, 0.22)]
	aw.material_override = Surf.mat("plaster_clay", 1.0, cols[rng.randi() % cols.size()], 0.0, 0.5)
	aw.position = pos + n * 0.85 + Vector3(0, 3.05, 0)
	aw.rotation = (Vector3(0, 0, -n.x * 0.22) if n.x != 0.0 else Vector3(n.z * 0.22, 0, 0))
	parent.add_child(aw)
	if sign_text != "":
		w._flat(parent, pos + n * 0.1 + Vector3(0, 3.55, 0), sz.call(3.2, 0.7, 0.1), Toon.flat(Color(0.12, 0.13, 0.16), 0.0, 0.2))
		var l := Label3D.new()
		l.text = sign_text
		l.font_size = 64
		l.pixel_size = 0.0075
		l.modulate = Color(0.95, 0.85, 0.6)
		l.outline_size = 0
		l.no_depth_test = false
		l.position = pos + n * 0.18 + Vector3(0, 3.55, 0)
		l.rotation.y = atan2(n.x, n.z)
		parent.add_child(l)
