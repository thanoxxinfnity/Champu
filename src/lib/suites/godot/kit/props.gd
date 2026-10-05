extends Node
## Ready-made 3D things that look made, not placeholder: cars, coins, trees, rocks, crates, buildings, lamps, barriers.
## Every function returns a Node3D whose origin sits on the ground. Cars and the like face -Z.
## Autoload name: Props


func _mat(color: Color, metallic: float = 0.0, roughness: float = 0.7, emission: float = 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metallic
	m.roughness = roughness
	if emission > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emission
	return m


func _part(parent: Node3D, mesh: Mesh, material: Material, position: Vector3, rotation_degrees: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = material
	mi.position = position
	mi.rotation_degrees = rotation_degrees
	parent.add_child(mi)
	return mi


func _box(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


func _cyl(radius: float, height: float, sides: int = 16) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = radius
	c.bottom_radius = radius
	c.height = height
	c.radial_segments = sides
	return c


## A car about 1.9 wide and 4.2 long, facing -Z. Wheels are in meta "wheels" (four Node3D) so a script can spin them.
func car(color: Color = Color("#e63946")) -> Node3D:
	var root := Node3D.new()
	root.name = "Car"
	var paint := _mat(color, 0.55, 0.28)
	var glass := _mat(Color("#0e1722"), 0.9, 0.08)
	var dark := _mat(Color("#14161a"), 0.2, 0.7)
	var chrome := _mat(Color("#c9ced6"), 1.0, 0.2)
	_part(root, _box(Vector3(1.9, 0.5, 4.2)), paint, Vector3(0, 0.62, 0))
	_part(root, _box(Vector3(1.78, 0.18, 1.5)), paint, Vector3(0, 0.95, -1.15), Vector3(-8, 0, 0))
	_part(root, _box(Vector3(1.6, 0.52, 2.0)), paint, Vector3(0, 1.1, 0.35))
	_part(root, _box(Vector3(1.52, 0.4, 1.7)), glass, Vector3(0, 1.14, 0.35))
	_part(root, _box(Vector3(1.64, 0.06, 2.05)), paint, Vector3(0, 1.38, 0.35))
	_part(root, _box(Vector3(1.96, 0.22, 0.3)), dark, Vector3(0, 0.42, -2.1))
	_part(root, _box(Vector3(1.96, 0.22, 0.3)), dark, Vector3(0, 0.42, 2.1))
	_part(root, _box(Vector3(0.42, 0.16, 0.08)), _mat(Color("#fff6d8"), 0.0, 0.2, 3.0), Vector3(-0.62, 0.7, -2.12))
	_part(root, _box(Vector3(0.42, 0.16, 0.08)), _mat(Color("#fff6d8"), 0.0, 0.2, 3.0), Vector3(0.62, 0.7, -2.12))
	_part(root, _box(Vector3(0.5, 0.14, 0.08)), _mat(Color("#ff2a2a"), 0.0, 0.3, 2.5), Vector3(-0.6, 0.72, 2.12))
	_part(root, _box(Vector3(0.5, 0.14, 0.08)), _mat(Color("#ff2a2a"), 0.0, 0.3, 2.5), Vector3(0.6, 0.72, 2.12))
	_part(root, _box(Vector3(1.5, 0.05, 0.4)), dark, Vector3(0, 1.05, 2.0))
	var wheels: Array[Node3D] = []
	for sx in [-1.0, 1.0]:
		for sz in [-1.35, 1.35]:
			var pivot := Node3D.new()
			pivot.position = Vector3(sx * 1.0, 0.42, sz)
			var spin := Node3D.new()
			pivot.add_child(spin)
			_part(spin, _cyl(0.42, 0.34, 18), dark, Vector3.ZERO, Vector3(0, 0, 90))
			_part(spin, _cyl(0.26, 0.36, 12), chrome, Vector3.ZERO, Vector3(0, 0, 90))
			_part(spin, _box(Vector3(0.38, 0.08, 0.1)), dark, Vector3(sx * 0.19, 0, 0))
			root.add_child(pivot)
			wheels.append(spin)
	root.set_meta("wheels", wheels)
	return root


## A spinning gold coin standing on its edge, 0.9 across. Call Props.spin(coin) to turn it.
func coin() -> Node3D:
	var root := Node3D.new()
	root.name = "Coin"
	var holder := Node3D.new()
	holder.position.y = 0.9
	root.add_child(holder)
	_part(holder, _cyl(0.45, 0.09, 24), _mat(Color("#ffc928"), 1.0, 0.25, 0.7), Vector3.ZERO, Vector3(90, 0, 0))
	_part(holder, _cyl(0.33, 0.11, 24), _mat(Color("#ffe27a"), 1.0, 0.3, 0.4), Vector3.ZERO, Vector3(90, 0, 0))
	root.set_meta("holder", holder)
	return root


## Spins a node forever around Y (a coin, a gem, a pickup) and bobs it a little.
func spin(node: Node3D, degrees_per_second: float = 140.0, bob: float = 0.12) -> void:
	var target: Node3D = node.get_meta("holder") if node.has_meta("holder") else node
	var tween := node.create_tween().set_loops()
	tween.tween_property(target, "rotation_degrees:y", 360.0, 360.0 / degrees_per_second).from(0.0)
	if bob > 0.0:
		var start_y := target.position.y
		var bob_tween := node.create_tween().set_loops()
		bob_tween.tween_property(target, "position:y", start_y + bob, 0.7).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		bob_tween.tween_property(target, "position:y", start_y - bob, 0.7).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func tree(height: float = 5.0) -> Node3D:
	var root := Node3D.new()
	root.name = "Tree"
	var trunk := _mat(Color("#6b4a2f"), 0.0, 0.95)
	var leaf_a := _mat(Color("#2f7d3a"), 0.0, 0.85)
	var leaf_b := _mat(Color("#3d9a49"), 0.0, 0.85)
	_part(root, _cyl(0.22, height * 0.35, 8), trunk, Vector3(0, height * 0.175, 0))
	for i in 3:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = height * (0.34 - i * 0.07)
		cone.height = height * 0.42
		cone.radial_segments = 8
		_part(root, cone, leaf_a if i % 2 == 0 else leaf_b, Vector3(0, height * (0.38 + i * 0.22), 0))
	return root


func rock(size: float = 1.6) -> Node3D:
	var root := Node3D.new()
	root.name = "Rock"
	var m := _mat(Color("#7b7f87"), 0.0, 0.95)
	var sphere := SphereMesh.new()
	sphere.radius = size * 0.5
	sphere.height = size * 0.8
	sphere.radial_segments = 7
	sphere.rings = 4
	_part(root, sphere, m, Vector3(0, size * 0.28, 0), Vector3(0, 23, 0))
	var small := SphereMesh.new()
	small.radius = size * 0.28
	small.height = size * 0.45
	small.radial_segments = 6
	small.rings = 3
	_part(root, small, _mat(Color("#6b6f77"), 0.0, 0.95), Vector3(size * 0.45, size * 0.14, size * 0.12))
	return root


func crate(size: float = 1.4) -> Node3D:
	var root := Node3D.new()
	root.name = "Crate"
	var wood := _mat(Color("#b0803f"), 0.0, 0.85)
	var frame := _mat(Color("#7a5528"), 0.0, 0.9)
	_part(root, _box(Vector3(size, size, size)), wood, Vector3(0, size * 0.5, 0))
	for x in [-1.0, 1.0]:
		_part(root, _box(Vector3(size * 0.1, size * 1.02, size * 1.02)), frame, Vector3(x * size * 0.45, size * 0.5, 0))
	_part(root, _box(Vector3(size * 1.02, size * 0.1, size * 1.02)), frame, Vector3(0, size * 0.95, 0))
	_part(root, _box(Vector3(size * 1.02, size * 0.1, size * 1.02)), frame, Vector3(0, size * 0.05, 0))
	return root


func cone(height: float = 0.9) -> Node3D:
	var root := Node3D.new()
	root.name = "Cone"
	var c := CylinderMesh.new()
	c.top_radius = 0.06
	c.bottom_radius = height * 0.32
	c.height = height
	c.radial_segments = 12
	_part(root, c, _mat(Color("#ff6a1a"), 0.0, 0.5), Vector3(0, height * 0.5, 0))
	_part(root, _cyl(height * 0.22, height * 0.14, 12), _mat(Color("#f4f4f4"), 0.0, 0.5), Vector3(0, height * 0.5, 0))
	_part(root, _box(Vector3(height * 0.8, height * 0.06, height * 0.8)), _mat(Color("#2a2a2a"), 0.0, 0.8), Vector3(0, height * 0.03, 0))
	return root


func building(width: float = 8.0, height: float = 18.0, depth: float = 8.0, color: Color = Color("#8d96a3")) -> Node3D:
	var root := Node3D.new()
	root.name = "Building"
	_part(root, _box(Vector3(width, height, depth)), _mat(color, 0.1, 0.75), Vector3(0, height * 0.5, 0))
	var glass := _mat(Color("#bfe6ff"), 0.6, 0.15, 0.9)
	var rows := int(height / 3.0)
	for r in rows:
		for side in [-1.0, 1.0]:
			_part(root, _box(Vector3(width * 0.8, 1.0, 0.06)), glass, Vector3(0, 2.2 + r * 3.0, side * (depth * 0.5 + 0.02)))
	_part(root, _box(Vector3(width * 1.04, 0.5, depth * 1.04)), _mat(color.darkened(0.3), 0.1, 0.8), Vector3(0, height + 0.25, 0))
	return root


func lamp_post(height: float = 5.0, light_color: Color = Color("#ffd9a0")) -> Node3D:
	var root := Node3D.new()
	root.name = "LampPost"
	var metal := _mat(Color("#2b2f36"), 0.7, 0.4)
	_part(root, _cyl(0.1, height, 8), metal, Vector3(0, height * 0.5, 0))
	_part(root, _box(Vector3(0.9, 0.08, 0.14)), metal, Vector3(0.4, height, 0))
	_part(root, _box(Vector3(0.4, 0.1, 0.3)), _mat(light_color, 0.0, 0.3, 4.0), Vector3(0.75, height - 0.05, 0))
	var light := OmniLight3D.new()
	light.light_color = light_color
	light.light_energy = 1.4
	light.omni_range = 9.0
	light.position = Vector3(0.75, height - 0.3, 0)
	root.add_child(light)
	return root


func barrier(length: float = 3.0) -> Node3D:
	var root := Node3D.new()
	root.name = "Barrier"
	_part(root, _box(Vector3(length, 0.6, 0.45)), _mat(Color("#e9eaec"), 0.0, 0.6), Vector3(0, 0.4, 0))
	for i in int(length / 0.7):
		_part(root, _box(Vector3(0.34, 0.6, 0.47)), _mat(Color("#d4322c"), 0.0, 0.6), Vector3(-length * 0.5 + 0.35 + i * 0.7, 0.4, 0))
	return root


func barrel(height: float = 1.1) -> Node3D:
	var root := Node3D.new()
	root.name = "Barrel"
	var body := _mat(Color("#c4472c"), 0.3, 0.55)
	var band := _mat(Color("#2b2b2e"), 0.6, 0.4)
	_part(root, _cyl(height * 0.38, height, 14), body, Vector3(0, height * 0.5, 0))
	for y in [0.2, 0.8]:
		_part(root, _cyl(height * 0.4, height * 0.08, 14), band, Vector3(0, height * y, 0))
	return root


func bush(size: float = 1.2) -> Node3D:
	var root := Node3D.new()
	root.name = "Bush"
	var a := SphereMesh.new()
	a.radius = size * 0.5
	a.height = size
	a.radial_segments = 8
	a.rings = 4
	_part(root, a, _mat(Color("#3a8c47"), 0.0, 0.9), Vector3(0, size * 0.4, 0))
	_part(root, a, _mat(Color("#2f7a3b"), 0.0, 0.9), Vector3(size * 0.55, size * 0.3, size * 0.2))
	return root


func fence(length: float = 4.0) -> Node3D:
	var root := Node3D.new()
	root.name = "Fence"
	var wood := _mat(Color("#a07445"), 0.0, 0.9)
	for i in int(length / 1.0) + 1:
		_part(root, _box(Vector3(0.14, 1.0, 0.14)), wood, Vector3(-length * 0.5 + i * (length / maxf(int(length), 1.0)), 0.5, 0))
	_part(root, _box(Vector3(length, 0.12, 0.08)), wood, Vector3(0, 0.8, 0))
	_part(root, _box(Vector3(length, 0.12, 0.08)), wood, Vector3(0, 0.4, 0))
	return root


func house(width: float = 6.0, depth: float = 5.0, wall: Color = Color("#e8d9c0"), roof: Color = Color("#b4472f")) -> Node3D:
	var root := Node3D.new()
	root.name = "House"
	_part(root, _box(Vector3(width, 3.0, depth)), _mat(wall, 0.0, 0.85), Vector3(0, 1.5, 0))
	var prism := PrismMesh.new()
	prism.size = Vector3(width * 1.15, 2.0, depth * 1.12)
	_part(root, prism, _mat(roof, 0.0, 0.8), Vector3(0, 4.0, 0))
	_part(root, _box(Vector3(1.0, 1.9, 0.1)), _mat(Color("#6b4a2f"), 0.0, 0.9), Vector3(0, 0.95, depth * 0.5 + 0.02))
	_part(root, _box(Vector3(1.0, 0.9, 0.1)), _mat(Color("#bfe6ff"), 0.4, 0.2, 0.6), Vector3(width * 0.28, 1.8, depth * 0.5 + 0.02))
	return root
