class_name Pickup
extends Area3D
## Anything lying in the dark that Rohan can walk over: medkits, ammo, guns,
## the bolt cutters, and the notes people left behind. Each one carries a thin
## coloured beam so it can be found in a black street.

var game: Game
var kind := "ammo"        # medkit | ammo | weapon | cutters | note
var value := ""           # weapon name or note text
var _node: Node3D
var _t := randf() * 6.0
var _base_y := 0.0
var taken := false


func setup(g: Node, k: String, v: String, pos: Vector3) -> void:
	game = g
	kind = k
	value = v
	position = pos


func _ready() -> void:
	collision_layer = 0
	collision_mask = Data.L_PLAYER
	var cs := CollisionShape3D.new()
	var sp := SphereShape3D.new()
	sp.radius = 1.3
	cs.shape = sp
	cs.position.y = 0.6
	add_child(cs)
	body_entered.connect(_on_body)

	var color := Color(0.3, 1.0, 0.4)
	match kind:
		"medkit":
			_node = Assets.make("medkit", 0.32, false)
		"ammo":
			_node = Assets.make("ammo_box", 0.3, false)
			color = Color(1.0, 0.85, 0.25)
		"weapon":
			var d: Dictionary = Data.WEAPONS[value]
			_node = Assets.make(d.model, maxf(float(d.len) * 1.5, 0.6), true)
			color = Color(0.35, 0.65, 1.0)
		"cutters":
			_node = _cutters()
			color = Color(1.0, 0.5, 0.15)
		"note":
			_node = _paper()
			color = Color(0.9, 0.9, 0.7)
	add_child(_node)
	_node.position.y = 0.55
	_base_y = _node.position.y

	var beam := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.025
	cm.bottom_radius = 0.07
	cm.height = 3.2
	cm.radial_segments = 6
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(color.r, color.g, color.b, 0.28)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	cm.material = m
	beam.mesh = cm
	beam.position.y = 1.6
	beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(beam)
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = 0.9
	l.omni_range = 4.5
	l.position.y = 0.8
	add_child(l)


func _cutters() -> Node3D:
	var n := Node3D.new()
	var red := StandardMaterial3D.new()
	red.albedo_color = Color(0.8, 0.1, 0.08)
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.5, 0.5, 0.52)
	steel.metallic = 0.8
	steel.roughness = 0.4
	for s in [-1.0, 1.0]:
		var h := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.05, 0.05, 0.6)
		h.mesh = bm
		h.material_override = red
		h.position = Vector3(s * 0.05, 0, 0.3)
		h.rotation_degrees.y = s * -4.0
		n.add_child(h)
		var j := MeshInstance3D.new()
		var jm := BoxMesh.new()
		jm.size = Vector3(0.05, 0.06, 0.16)
		j.mesh = jm
		j.material_override = steel
		j.position = Vector3(s * 0.03, 0, -0.05)
		j.rotation_degrees.y = s * 12.0
		n.add_child(j)
	n.rotation_degrees.x = 90.0
	var holder := Node3D.new()
	holder.add_child(n)
	return holder


func _paper() -> Node3D:
	var n := Node3D.new()
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.26, 0.01, 0.34)
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.85, 0.82, 0.7)
	m.emission_enabled = true
	m.emission = Color(0.6, 0.55, 0.4)
	m.emission_energy_multiplier = 0.6
	mi.material_override = m
	mi.rotation_degrees = Vector3(-18, 0, 0)
	n.add_child(mi)
	return n


func _process(delta: float) -> void:
	if taken:
		return
	_t += delta
	_node.rotation.y += delta * 1.4
	_node.position.y = _base_y + sin(_t * 2.2) * 0.07


func _on_body(b: Node3D) -> void:
	if taken or not (b is Player):
		return
	var p := b as Player
	if kind == "medkit" and p.hp >= p.max_hp - 0.5:
		return    # leave it for when it is needed
	taken = true
	game.collect(self)
	queue_free()
