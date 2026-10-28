class_name Props
extends RefCounted
## Scenery built in code where the generated models were too broken to show: the cherry trees (their mesh was a cloud of loose
## pink triangles) and the stone lanterns (a lumpy mushroom). Clean low-poly shapes in the toon style, a few draw calls each.
## Every builder returns a node whose origin is at the foot and whose height is `h`; meta "size" matches ModelKit.fitted.

static var _mats := {}


static func _toon(c: Color, glow := 0.0) -> StandardMaterial3D:
	var key := "%s/%s" % [c.to_html(), glow]
	if not _mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
		m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		m.roughness = 1.0
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = c
			m.emission_energy_multiplier = glow
		_mats[key] = m
	return _mats[key]


static func _mesh(parent: Node3D, mesh: Mesh, pos: Vector3, mat: Material, rot := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	mi.scale = scl
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


## A cherry tree: a curved two-part trunk and soft clusters of blossom (pink spheres in three shades).
static func cherry_tree(h: float, seed := 0) -> Node3D:
	var rng := RandomNumberGenerator.new()
	rng.seed = 1234 + seed
	var root := Node3D.new()
	var bark := _toon(Color(0.36, 0.22, 0.2))
	var t1 := CylinderMesh.new()
	t1.top_radius = h * 0.045
	t1.bottom_radius = h * 0.075
	t1.height = h * 0.42
	t1.radial_segments = 8
	_mesh(root, t1, Vector3(0, h * 0.21, 0), bark)
	var t2 := CylinderMesh.new()
	t2.top_radius = h * 0.03
	t2.bottom_radius = h * 0.048
	t2.height = h * 0.3
	t2.radial_segments = 8
	var lean := rng.randf_range(-0.35, 0.35)
	_mesh(root, t2, Vector3(sin(lean) * h * 0.07, h * 0.55, 0), bark, Vector3(0, 0, -lean))
	var pinks := [_toon(Color(1.0, 0.72, 0.84)), _toon(Color(0.98, 0.6, 0.76)), _toon(Color(1.0, 0.84, 0.9))]
	var crown := Vector3(sin(lean) * h * 0.12, h * 0.7, 0)
	for i in 9:
		var s := SphereMesh.new()
		var r := h * rng.randf_range(0.14, 0.22)
		s.radius = r
		s.height = r * 1.7
		s.radial_segments = 10
		s.rings = 6
		var a := float(i) / 9.0 * TAU + rng.randf() * 0.5
		var off := Vector3(cos(a) * h * rng.randf_range(0.12, 0.26), rng.randf_range(-0.06, 0.12) * h, sin(a) * h * rng.randf_range(0.12, 0.26))
		if i == 0:
			off = Vector3(0, h * 0.12, 0)
		_mesh(root, s, crown + off, pinks[i % 3])
	root.set_meta("size", Vector3(h * 0.7, h, h * 0.7))
	return root


## A stone lantern (tōrō): base, post, the fire box with a warm glow, a wide roof and a knob on top.
static func stone_lantern(h: float) -> Node3D:
	var root := Node3D.new()
	var stone := _toon(Color(0.66, 0.66, 0.7))
	var dark := _toon(Color(0.5, 0.5, 0.56))
	var b := BoxMesh.new()
	b.size = Vector3(h * 0.42, h * 0.1, h * 0.42)
	_mesh(root, b, Vector3(0, h * 0.05, 0), dark)
	var post := CylinderMesh.new()
	post.top_radius = h * 0.08
	post.bottom_radius = h * 0.1
	post.height = h * 0.38
	post.radial_segments = 8
	_mesh(root, post, Vector3(0, h * 0.29, 0), stone)
	var shelf := BoxMesh.new()
	shelf.size = Vector3(h * 0.36, h * 0.06, h * 0.36)
	_mesh(root, shelf, Vector3(0, h * 0.51, 0), dark)
	var box := BoxMesh.new()
	box.size = Vector3(h * 0.26, h * 0.2, h * 0.26)
	_mesh(root, box, Vector3(0, h * 0.64, 0), stone)
	var fire := BoxMesh.new()
	fire.size = Vector3(h * 0.28, h * 0.11, h * 0.14)
	_mesh(root, fire, Vector3(0, h * 0.64, 0), _toon(Color(1.0, 0.78, 0.4), 1.6))
	_mesh(root, fire, Vector3(0, h * 0.64, 0), _toon(Color(1.0, 0.78, 0.4), 1.6), Vector3(0, PI * 0.5, 0))
	var roof := CylinderMesh.new()
	roof.top_radius = h * 0.04
	roof.bottom_radius = h * 0.3
	roof.height = h * 0.16
	roof.radial_segments = 4
	_mesh(root, roof, Vector3(0, h * 0.82, 0), dark, Vector3(0, PI * 0.25, 0))
	var knob := SphereMesh.new()
	knob.radius = h * 0.05
	knob.height = h * 0.1
	_mesh(root, knob, Vector3(0, h * 0.93, 0), stone)
	root.set_meta("size", Vector3(h * 0.42, h, h * 0.42))
	return root


## A torii gate: two red pillars, the black-capped top beam (kasagi) with upturned ends and the tie beam (nuki).
static func torii(h: float) -> Node3D:
	var root := Node3D.new()
	var red := _toon(Color(0.86, 0.2, 0.18))
	var black := _toon(Color(0.12, 0.1, 0.14))
	var w := h * 0.9
	for sx in [-1.0, 1.0]:
		var p := CylinderMesh.new()
		p.top_radius = h * 0.045
		p.bottom_radius = h * 0.055
		p.height = h * 0.9
		p.radial_segments = 10
		_mesh(root, p, Vector3(sx * w * 0.38, h * 0.45, 0), red)
		var foot := CylinderMesh.new()
		foot.top_radius = h * 0.065
		foot.bottom_radius = h * 0.07
		foot.height = h * 0.06
		_mesh(root, foot, Vector3(sx * w * 0.38, h * 0.03, 0), black)
	var nuki := BoxMesh.new()
	nuki.size = Vector3(w * 0.95, h * 0.06, h * 0.07)
	_mesh(root, nuki, Vector3(0, h * 0.72, 0), red)
	var kasagi := BoxMesh.new()
	kasagi.size = Vector3(w * 1.25, h * 0.08, h * 0.11)
	_mesh(root, kasagi, Vector3(0, h * 0.9, 0), red)
	var cap := BoxMesh.new()
	cap.size = Vector3(w * 1.32, h * 0.05, h * 0.13)
	_mesh(root, cap, Vector3(0, h * 0.965, 0), black)
	for sx2 in [-1.0, 1.0]:
		var tip := BoxMesh.new()
		tip.size = Vector3(w * 0.12, h * 0.05, h * 0.13)
		_mesh(root, tip, Vector3(sx2 * w * 0.68, h * 0.985, 0), black, Vector3(0, 0, sx2 * 0.25))
	root.set_meta("size", Vector3(w * 1.3, h, h * 0.15))
	return root
