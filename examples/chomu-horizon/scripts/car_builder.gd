class_name CarBuilder
extends RefCounted
## Builds a car model from CarCatalog data, with every part a separate node.
##
## Hierarchy produced (the same contract load_glb_car() expects from a .glb):
##
##   <car id>                Node3D, origin on the ground between the axles, +Z = nose
##   ├── Body                MeshInstance3D  (paint + underbody surfaces)
##   ├── Cabin               MeshInstance3D  (glass + painted roof)
##   ├── Door_L / Door_R     Node3D hinge pivot → Panel (paint), Inner (trim)
##   ├── DoorGap_L / _R      MeshInstance3D, dark aperture shown when a door opens
##   ├── Details             MeshInstance3D  (trim, mirrors, spoiler, exhausts)
##   ├── HeadLights          MeshInstance3D  (emissive), + SpotLight3D children
##   ├── TailLights          MeshInstance3D  (emissive, brighter under braking)
##   ├── Wheel_FL/FR/RL/RR   Node3D at the wheel centre → Tire, Rim
##   ├── Underglow           Node3D → Strip + OmniLight3D (hidden by default)
##   └── ContactShadow       MeshInstance3D blob shadow (cheap ambient occlusion)
##
## Metas on the root: paint_material, rim_material, glow_material,
## tail_material, head_material — shared by every part, so PaintCustomizer
## and the controller change one resource and the whole car follows.

const RING := 28           # vertices around a body cross-section (multiple of 4)
const BODY_STEPS := 46     # cross-sections along the length, before arch refinement
const CABIN_STEPS := 22
const WHEEL_NAMES := ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]
const REQUIRED_PARTS := ["Body", "Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]

## Godot treats clockwise triangles as front-facing. Everything below emits
## triangles through _tri(), which orders them against an outward hint, so
## this is the single switch if that convention is ever wrong on a platform.
const CLOCKWISE_FRONT := true


# ─────────────────────────────── public API ────────────────────────────────


static func wheel_positions(car: Dictionary) -> Dictionary:
	var half_wb: float = car.wheelbase * 0.5
	var r: float = car.wheel_radius
	var t: float = car.track
	return {
		"Wheel_FL": Vector3(t, r, half_wb),
		"Wheel_FR": Vector3(-t, r, half_wb),
		"Wheel_RL": Vector3(t, r, -half_wb),
		"Wheel_RR": Vector3(-t, r, -half_wb),
	}


static func build(car: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = car.id
	var mats := _materials(car)
	for k in mats.keys():
		root.set_meta(k, mats[k])

	var prof := Profile.new(car)

	var body := MeshInstance3D.new()
	body.name = "Body"
	body.mesh = _body_mesh(prof, mats)
	root.add_child(body)

	var cabin := MeshInstance3D.new()
	cabin.name = "Cabin"
	cabin.mesh = _cabin_mesh(prof, mats)
	root.add_child(cabin)

	for side in [1, -1]:
		_add_door(root, prof, car, side, mats)

	var details := MeshInstance3D.new()
	details.name = "Details"
	details.mesh = _details_mesh(prof, car, mats)
	root.add_child(details)

	_add_lights(root, prof, car, mats)

	var positions := wheel_positions(car)
	for wname in WHEEL_NAMES:
		var rear: bool = wname.ends_with("RL") or wname.ends_with("RR")
		var width: float = car.wheel_width_rear if rear else car.wheel_width
		var side := 1.0 if (positions[wname] as Vector3).x > 0.0 else -1.0
		var wheel := _wheel(wname, car.wheel_radius, width, side, mats)
		wheel.position = positions[wname]
		root.add_child(wheel)

	_add_underglow(root, prof, car, mats)
	_add_contact_shadow(root, prof, car)
	return root


## Loads a custom car from a .glb (res:// or an absolute/user:// path) and
## gives it the same interface as a built car.
##
## Naming contract inside the .glb (case-insensitive, matched by prefix):
##   Body*, Wheel_FL*, Wheel_FR*, Wheel_RL*, Wheel_RR*   required
##   Door_L*, Door_R*                                    optional (hinge at the node origin)
## Materials whose name contains "paint" become the live paint material.
## Wheel origins must sit at the wheel centre with the axle along X.
## Missing wheels are replaced with built ones so the car still drives.
static func load_glb_car(path: String, car: Dictionary) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(path, state)
	if err != OK:
		push_warning("CarBuilder: could not read %s (error %d), using the built car" % [path, err])
		return build(car)
	var scene := doc.generate_scene(state) as Node3D
	if scene == null:
		return build(car)

	var root := Node3D.new()
	root.name = car.id
	var mats := _materials(car)
	for k in mats.keys():
		root.set_meta(k, mats[k])

	# Re-parent the recognised parts directly under root so the rest of the
	# game can address them by the same names as a built car.
	var found := {}
	for node in _walk(scene):
		if not (node is Node3D):
			continue
		var lname := String(node.name).to_lower()
		for part in ["body", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "door_l", "door_r"]:
			if lname.begins_with(part) and not found.has(part):
				found[part] = node
	# A single-mesh model (e.g. straight out of an image-to-3D generator)
	# has no named parts: the whole thing becomes the Body.
	if not found.has("body"):
		var wrapper := Node3D.new()
		wrapper.name = "Body"
		scene.name = "Mesh"
		wrapper.add_child(scene)
		root.add_child(wrapper)
		scene = Node3D.new()
	var xfs := {}
	for part in found.keys():
		xfs[part] = _global_of(found[part], scene)
	# Children first, so a Body that parents its wheels does not drag them along.
	var order := ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "door_l", "door_r", "body"]
	for part in order:
		if not found.has(part):
			continue
		var n: Node3D = found[part]
		n.get_parent().remove_child(n)
		n.name = _canonical(part)
		root.add_child(n)
		n.transform = xfs[part]
	# Anything not claimed (spoilers, interiors) stays as static dressing.
	scene.name = "Extra"
	root.add_child(scene)

	for mi in _walk(root):
		if mi is MeshInstance3D:
			var m := (mi as MeshInstance3D).mesh
			if m == null:
				continue
			for s in m.get_surface_count():
				var sm := m.surface_get_material(s)
				if sm != null and sm.resource_name.to_lower().contains("paint"):
					(mi as MeshInstance3D).set_surface_override_material(s, mats.paint_material)

	var positions := wheel_positions(car)
	for wname in WHEEL_NAMES:
		if root.get_node_or_null(wname) == null:
			var side := 1.0 if (positions[wname] as Vector3).x > 0.0 else -1.0
			var wheel := _wheel(wname, car.wheel_radius, car.wheel_width, side, mats)
			wheel.position = positions[wname]
			root.add_child(wheel)
	var prof := Profile.new(car)
	_add_underglow(root, prof, car, mats)
	_add_contact_shadow(root, prof, car)
	return root


## Writes a built car to a .glb with the part hierarchy intact, so it can be
## opened in Blender, reworked, and loaded back with load_glb_car(). The
## live paint shader has no glTF equivalent, so it is exported as a
## StandardMaterial3D named "paint" (which the loader recognises).
static func export_glb(model: Node3D, path: String) -> Error:
	var copy := model.duplicate() as Node3D
	var paint: ShaderMaterial = model.get_meta("paint_material")
	var flat := StandardMaterial3D.new()
	flat.resource_name = "paint"
	flat.albedo_color = paint.get_shader_parameter("base_color")
	flat.metallic = paint.get_shader_parameter("metallic_amount")
	flat.roughness = paint.get_shader_parameter("roughness_amount")
	var drop: Array[Node] = []
	for n in _walk(copy):
		if n is Light3D or n.name == "ContactShadow" or n.name == "Underglow":
			drop.append(n)
		elif n is MeshInstance3D and (n as MeshInstance3D).mesh is ArrayMesh:
			var mi := n as MeshInstance3D
			var mesh := (mi.mesh as ArrayMesh).duplicate() as ArrayMesh
			for s in mesh.get_surface_count():
				if mesh.surface_get_material(s) == paint:
					mesh.surface_set_material(s, flat)
			mi.mesh = mesh
	# Collected first and checked, because freeing a parent frees its children.
	for n in drop:
		if is_instance_valid(n):
			n.get_parent().remove_child(n)
			n.free()
	# The exporter expects a node inside a tree.
	var host: Node = model.get_tree().root if model.is_inside_tree() else null
	if host:
		host.add_child(copy)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_scene(copy, state)
	if err == OK:
		err = doc.write_to_filesystem(state, path)
	if host:
		host.remove_child(copy)
	copy.queue_free()
	return err


## Returns the names of required parts a model is missing (empty = drivable).
static func validate(model: Node3D) -> Array[String]:
	var missing: Array[String] = []
	for part in REQUIRED_PARTS:
		if model.get_node_or_null(part) == null:
			missing.append(part)
	return missing


## Opens (1.0) or closes (0.0) the doors. Scissor doors lift, others swing.
static func set_doors(model: Node3D, amount: float, style: String) -> void:
	for side in [1, -1]:
		var door := model.get_node_or_null("Door_L" if side > 0 else "Door_R") as Node3D
		if door == null:
			continue
		if style == "scissor":
			door.rotation = Vector3(deg_to_rad(68.0) * amount, 0.0, 0.0)
		else:
			door.rotation = Vector3(0.0, -side * deg_to_rad(62.0) * amount, 0.0)
		var gap := model.get_node_or_null("DoorGap_L" if side > 0 else "DoorGap_R") as Node3D
		if gap:
			gap.visible = amount > 0.02


# ─────────────────────────────── profile ───────────────────────────────────


## Smooth, continuous description of the body surface, sampled by the loft,
## the doors and the detail placement alike so they always line up.
class Profile:
	var car: Dictionary
	var st: Array
	var cab: Array
	var n: float
	var z_min: float
	var z_max: float
	var arches: Array[Vector3] = []  # (z, centre_y, radius)

	func _init(c: Dictionary) -> void:
		car = c
		st = c.body
		cab = c.cabin
		n = c.roundness
		z_min = st[0][0]
		z_max = st[st.size() - 1][0]
		var hw: float = c.wheelbase * 0.5
		var r: float = c.wheel_radius
		for zc in [hw, -hw]:
			arches.append(Vector3(zc, r + 0.015, r + 0.075))

	func _cr(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
		var t2 := t * t
		return 0.5 * (2.0 * p1 + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t2 * t)

	## Returns [half_width, y_bottom (with arches), y_top, top_ratio].
	func at(z: float) -> Array:
		z = clampf(z, z_min, z_max)
		var i := 0
		while i < st.size() - 2 and z > st[i + 1][0]:
			i += 1
		var a: Array = st[maxi(i - 1, 0)]
		var b: Array = st[i]
		var c: Array = st[i + 1]
		var d: Array = st[mini(i + 2, st.size() - 1)]
		var t: float = (z - b[0]) / maxf(c[0] - b[0], 0.0001)
		var w := _cr(a[1], b[1], c[1], d[1], t)
		var yb := _cr(a[2], b[2], c[2], d[2], t)
		var yt := _cr(a[3], b[3], c[3], d[3], t)
		var tr := _cr(a[4], b[4], c[4], d[4], t)
		for arch in arches:
			var dz: float = z - arch.x
			if absf(dz) < arch.z:
				yb = maxf(yb, arch.y + sqrt(arch.z * arch.z - dz * dz))
		yb = minf(yb, yt - 0.07)
		return [w, yb, yt, tr]

	## A point on the body surface; angle 0 = right side middle, PI/2 = top.
	func point(z: float, ang: float, p: Array = []) -> Vector3:
		if p.is_empty():
			p = at(z)
		var w: float = p[0]
		var yb: float = p[1]
		var yt: float = p[2]
		var tr: float = p[3]
		var yc := (yb + yt) * 0.5
		var h := (yt - yb) * 0.5
		var c := cos(ang)
		var s := sin(ang)
		var e := 2.0 / n
		var x := w * signf(c) * pow(absf(c), e)
		var y := yc + h * signf(s) * pow(absf(s), e)
		if y > yc:
			x *= lerpf(1.0, tr, (y - yc) / h)
		return Vector3(x, y, z)

	## Cabin roof (y, half width) at z; roof_y <= body top means no cabin there.
	func cabin_at(z: float) -> Vector2:
		if z <= cab[0][0]:
			return Vector2(cab[0][1], cab[0][2])
		for i in cab.size() - 1:
			var a: Array = cab[i]
			var b: Array = cab[i + 1]
			if z <= b[0]:
				var t: float = (z - a[0]) / (b[0] - a[0])
				t = t * t * (3.0 - 2.0 * t)
				return Vector2(lerpf(a[1], b[1], t), lerpf(a[2], b[2], t))
		var last: Array = cab[cab.size() - 1]
		return Vector2(last[1], last[2])

	func cabin_z0() -> float:
		return cab[0][0]

	func cabin_z1() -> float:
		return cab[cab.size() - 1][0]

	func body_samples() -> Array[float]:
		var zs: Array[float] = []
		for i in CarBuilder.BODY_STEPS + 1:
			zs.append(lerpf(z_min, z_max, float(i) / CarBuilder.BODY_STEPS))
		for arch in arches:
			for k in 13:
				var zz: float = arch.x + arch.z * cos(PI * float(k) / 12.0)
				zs.append(clampf(zz, z_min, z_max))
			zs.append(clampf(arch.x - arch.z - 0.004, z_min, z_max))
			zs.append(clampf(arch.x + arch.z + 0.004, z_min, z_max))
		zs.sort()
		var out: Array[float] = []
		for z in zs:
			if out.is_empty() or z - out[out.size() - 1] > 0.002:
				out.append(z)
		return out


# ─────────────────────────────── materials ─────────────────────────────────


static func _materials(car: Dictionary) -> Dictionary:
	var paint := PaintCustomizer.make_paint_material()
	PaintCustomizer.set_paint(paint, car.paint, 0)

	var rim := StandardMaterial3D.new()
	PaintCustomizer.set_rims(rim, 0)

	var under := StandardMaterial3D.new()
	under.albedo_color = Color(0.025, 0.025, 0.028)
	under.roughness = 0.85

	var trim := StandardMaterial3D.new()
	trim.albedo_color = Color(0.035, 0.036, 0.04)
	trim.roughness = 0.45
	trim.metallic = 0.3

	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.03, 0.045, 0.06)
	glass.metallic = 0.35
	glass.roughness = 0.04
	glass.metallic_specular = 1.0

	var tire := StandardMaterial3D.new()
	tire.albedo_color = Color(0.045, 0.045, 0.048)
	tire.roughness = 0.92

	var chrome := StandardMaterial3D.new()
	chrome.albedo_color = Color(0.9, 0.9, 0.92)
	chrome.metallic = 1.0
	chrome.roughness = 0.1

	var head := StandardMaterial3D.new()
	head.albedo_color = Color(0.9, 0.95, 1.0)
	head.emission_enabled = true
	head.emission = Color(0.85, 0.92, 1.0)
	head.emission_energy_multiplier = 2.2

	var tail := StandardMaterial3D.new()
	tail.albedo_color = Color(0.35, 0.0, 0.0)
	tail.emission_enabled = true
	tail.emission = Color(1.0, 0.0, 0.0)
	tail.emission_energy_multiplier = 0.8

	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = PaintCustomizer.GLOW_COLORS[0]
	glow.emission_enabled = true
	glow.emission = PaintCustomizer.GLOW_COLORS[0]
	glow.emission_energy_multiplier = 4.0

	return {
		"paint_material": paint,
		"rim_material": rim,
		"under_material": under,
		"trim_material": trim,
		"glass_material": glass,
		"tire_material": tire,
		"chrome_material": chrome,
		"head_material": head,
		"tail_material": tail,
		"glow_material": glow,
	}


# ─────────────────────────────── mesh helpers ──────────────────────────────


## Appends one triangle, ordered so that its front face points along `outward`.
static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, outward: Vector3) -> void:
	var geo := (b - a).cross(c - a)
	var ccw_out := geo.dot(outward) > 0.0
	# Counter-clockwise seen from outside when ccw_out; Godot wants the opposite.
	if ccw_out == CLOCKWISE_FRONT:
		var t := b
		b = c
		c = t
		var tn := nb
		nb = nc
		nc = tn
	st.set_normal(na)
	st.add_vertex(a)
	st.set_normal(nb)
	st.add_vertex(b)
	st.set_normal(nc)
	st.add_vertex(c)


## Lofts a grid of points (rows × cols) into triangles, with smooth normals,
## sending each quad to the SurfaceTool chosen by `pick(center, normal)`.
## `wrap` joins the last column back to the first (closed cross-sections).
static func _loft(grid: Array, wrap: bool, axis_of: Callable, tools: Array, pick: Callable) -> void:
	var rows := grid.size()
	var cols: int = (grid[0] as Array).size()
	var ccount := cols if wrap else cols - 1
	var normals := []
	for r in rows:
		var row := []
		row.resize(cols)
		row.fill(Vector3.ZERO)
		normals.append(row)
	var faces := []
	for r in rows - 1:
		for c in ccount:
			var c2 := (c + 1) % cols
			var p00: Vector3 = grid[r][c]
			var p01: Vector3 = grid[r][c2]
			var p10: Vector3 = grid[r + 1][c]
			var p11: Vector3 = grid[r + 1][c2]
			var center := (p00 + p01 + p10 + p11) * 0.25
			var out_dir: Vector3 = center - axis_of.call(center)
			var fn := (p10 - p00).cross(p01 - p00)
			if fn.length_squared() < 1e-12:
				fn = (p11 - p00).cross(p01 - p10)
			if fn.dot(out_dir) < 0.0:
				fn = -fn
			fn = fn.normalized() if fn.length_squared() > 1e-12 else out_dir.normalized()
			for idx in [[r, c], [r, c2], [r + 1, c], [r + 1, c2]]:
				var nrow: Array = normals[idx[0]]
				nrow[idx[1]] = (nrow[idx[1]] as Vector3) + fn
			faces.append([r, c, c2, center, fn])
	for f in faces:
		var r: int = f[0]
		var c: int = f[1]
		var c2: int = f[2]
		var fn: Vector3 = f[4]
		var st: SurfaceTool = tools[pick.call(f[3], fn)]
		var n00: Vector3 = (normals[r][c] as Vector3).normalized()
		var n01: Vector3 = (normals[r][c2] as Vector3).normalized()
		var n10: Vector3 = (normals[r + 1][c] as Vector3).normalized()
		var n11: Vector3 = (normals[r + 1][c2] as Vector3).normalized()
		_tri(st, grid[r][c], grid[r + 1][c], grid[r][c2], n00, n10, n01, fn)
		_tri(st, grid[r + 1][c], grid[r + 1][c2], grid[r][c2], n10, n11, n01, fn)


static func _new_tool() -> SurfaceTool:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	return st


static func _commit(mesh: ArrayMesh, st: SurfaceTool, mat: Material) -> void:
	if st == null:
		return
	var arrays := st.commit_to_arrays()
	if arrays.is_empty() or (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).is_empty():
		return
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(mesh.get_surface_count() - 1, mat)


static func _box(st: SurfaceTool, center: Vector3, size: Vector3, rot: Vector3 = Vector3.ZERO) -> void:
	var bm := BoxMesh.new()
	bm.size = size
	st.append_from(bm, 0, Transform3D(Basis.from_euler(rot), center))


static func _cyl(st: SurfaceTool, center: Vector3, radius: float, height: float, rot: Vector3, segments: int = 16) -> void:
	var cm := CylinderMesh.new()
	cm.top_radius = radius
	cm.bottom_radius = radius
	cm.height = height
	cm.radial_segments = segments
	cm.rings = 1
	st.append_from(cm, 0, Transform3D(Basis.from_euler(rot), center))


static func _sphere(st: SurfaceTool, center: Vector3, radius: float, scale: Vector3 = Vector3.ONE) -> void:
	var sm := SphereMesh.new()
	sm.radius = radius
	sm.height = radius * 2.0
	sm.radial_segments = 14
	sm.rings = 7
	st.append_from(sm, 0, Transform3D(Basis.from_scale(scale), center))


# ─────────────────────────────── parts ─────────────────────────────────────


static func _body_mesh(prof: Profile, mats: Dictionary) -> ArrayMesh:
	var zs := prof.body_samples()
	var grid := []
	var centers := []
	for z in zs:
		var p := prof.at(z)
		var ring := []
		for k in RING:
			ring.append(prof.point(z, TAU * float(k) / RING, p))
		grid.append(ring)
		centers.append(Vector3(0.0, (p[1] + p[2]) * 0.5, z))
	var paint := _new_tool()
	var under := _new_tool()
	var axis := func(v: Vector3) -> Vector3:
		var p2 := prof.at(v.z)
		return Vector3(0.0, (p2[1] + p2[2]) * 0.5, v.z)
	var pick := func(_c: Vector3, n: Vector3) -> int:
		return 1 if n.y < -0.45 else 0
	_loft(grid, true, axis, [paint, under], pick)
	# End caps: fans from each end section's centre.
	for end in [0, zs.size() - 1]:
		var ring: Array = grid[end]
		var ctr: Vector3 = centers[end]
		var out := Vector3(0.0, 0.0, -1.0 if end == 0 else 1.0)
		for k in RING:
			var a: Vector3 = ring[k]
			var b: Vector3 = ring[(k + 1) % RING]
			var tool := under if (a.y + b.y) * 0.5 < ctr.y - 0.12 else paint
			_tri(tool, ctr, a, b, out, out, out, out)
	var mesh := ArrayMesh.new()
	_commit(mesh, paint, mats.paint_material)
	_commit(mesh, under, mats.under_material)
	return mesh


static func _cabin_mesh(prof: Profile, mats: Dictionary) -> ArrayMesh:
	var z0 := prof.cabin_z0()
	var z1 := prof.cabin_z1()
	var cols := 16
	var grid := []
	var hmax := 0.0
	var info := []
	for i in CABIN_STEPS + 1:
		var z := lerpf(z0, z1, float(i) / CABIN_STEPS)
		var p := prof.at(z)
		var top: float = p[2]
		var base_hw: float = p[0] * p[3] * 0.965
		var roof := prof.cabin_at(z)
		var h := maxf(roof.x - top, 0.0) + 0.02
		hmax = maxf(hmax, h)
		info.append([z, top - 0.02, base_hw, roof.y, h])
	for row in info:
		var ring := []
		for k in cols + 1:
			var u := PI * float(k) / cols
			var c := cos(u)
			var s := sin(u)
			var f := pow(s, 2.0 / 3.2)
			var hw := lerpf(row[2], row[3], f)
			var x := hw * signf(c) * pow(absf(c), 2.0 / 3.2)
			ring.append(Vector3(x, row[1] + row[4] * f, row[0]))
		grid.append(ring)
	var glass := _new_tool()
	var roof_st := _new_tool()
	var axis := func(v: Vector3) -> Vector3:
		return Vector3(0.0, prof.at(v.z)[2] - 0.3, v.z)
	var pick := func(ctr: Vector3, _n: Vector3) -> int:
		var p2 := prof.at(ctr.z)
		var roof := prof.cabin_at(ctr.z)
		var h := maxf(roof.x - p2[2], 0.0)
		var frac: float = (ctr.y - p2[2]) / maxf(h, 0.001)
		return 1 if h > hmax * 0.72 and frac > 0.9 else 0
	_loft(grid, false, axis, [glass, roof_st], pick)
	var mesh := ArrayMesh.new()
	_commit(mesh, glass, mats.glass_material)
	_commit(mesh, roof_st, mats.paint_material)
	return mesh


static func _add_door(root: Node3D, prof: Profile, car: Dictionary, side: int, mats: Dictionary) -> void:
	var zf: float = prof.cabin_z1() - 0.12
	var length: float = clampf(car.wheelbase * 0.42, 1.0, 1.32)
	var zb := zf - length
	var a0 := -0.55
	var a1 := 0.95
	var rows := 10
	var cols := 8
	var outer := []
	var inner := []
	var gap := []
	for i in rows + 1:
		var z := lerpf(zb, zf, float(i) / rows)
		var p := prof.at(z)
		var ro := []
		var ri := []
		var rg := []
		for k in cols + 1:
			var ang := lerpf(a0, a1, float(k) / cols)
			if side < 0:
				ang = PI - ang
			var pt := prof.point(z, ang, p)
			var nrm := Vector3(pt.x, 0.0, 0.0).normalized() if absf(pt.x) > 0.001 else Vector3(side, 0, 0)
			ro.append(pt + nrm * 0.009)
			ri.append(pt + nrm * -0.012)
			rg.append(pt + nrm * 0.004)
		outer.append(ro)
		inner.append(ri)
		gap.append(rg)
	var hinge_p := prof.at(zf)
	var hinge: Vector3 = prof.point(zf, 0.2 if side > 0 else PI - 0.2, hinge_p)
	var pivot := Node3D.new()
	pivot.name = "Door_L" if side > 0 else "Door_R"
	pivot.position = hinge
	var to_local := func(g: Array) -> Array:
		var out := []
		for row in g:
			var r2 := []
			for v in row:
				r2.append((v as Vector3) - hinge)
			out.append(r2)
		return out
	var axis_out := func(v: Vector3) -> Vector3:
		return v - Vector3(side, 0, 0)
	var axis_in := func(v: Vector3) -> Vector3:
		return v + Vector3(side, 0, 0)
	var pick0 := func(_c: Vector3, _n: Vector3) -> int:
		return 0
	var st_out := _new_tool()
	_loft(to_local.call(outer), false, axis_out, [st_out], pick0)
	var st_in := _new_tool()
	_loft(to_local.call(inner), false, axis_in, [st_in], pick0)
	var panel := MeshInstance3D.new()
	panel.name = "Panel"
	var m1 := ArrayMesh.new()
	_commit(m1, st_out, mats.paint_material)
	_commit(m1, st_in, mats.trim_material)
	panel.mesh = m1
	pivot.add_child(panel)
	root.add_child(pivot)

	var st_gap := _new_tool()
	_loft(gap, false, func(v: Vector3) -> Vector3: return v - Vector3(side, 0, 0), [st_gap], pick0)
	var gap_mi := MeshInstance3D.new()
	gap_mi.name = "DoorGap_L" if side > 0 else "DoorGap_R"
	var m2 := ArrayMesh.new()
	_commit(m2, st_gap, mats.under_material)
	gap_mi.mesh = m2
	gap_mi.visible = false
	root.add_child(gap_mi)


static func _details_mesh(prof: Profile, car: Dictionary, mats: Dictionary) -> ArrayMesh:
	var trim := _new_tool()
	var paint := _new_tool()
	var chrome := _new_tool()
	var zmin := prof.z_min
	var zmax := prof.z_max
	var front := prof.at(zmax - 0.06)
	var rear := prof.at(zmin + 0.06)
	var fw: float = front[0]
	var rw: float = rear[0]

	# Grille and front splitter.
	var gh: float = (front[2] - front[1]) * 0.42
	_box(trim, Vector3(0.0, front[1] + gh * 0.55 + 0.02, zmax - 0.02), Vector3(fw * 1.05, gh, 0.08))
	_box(trim, Vector3(0.0, front[1] + 0.01, zmax - 0.2), Vector3(fw * 1.7, 0.03, 0.22))
	# Rear diffuser with fins.
	_box(trim, Vector3(0.0, rear[1] + 0.03, zmin + 0.1), Vector3(rw * 1.7, 0.1, 0.36))
	for i in 5:
		var fx := lerpf(-rw * 0.6, rw * 0.6, float(i) / 4.0)
		_box(trim, Vector3(fx, rear[1] - 0.02, zmin + 0.14), Vector3(0.02, 0.1, 0.3))
	# Side skirts between the arches.
	for side in [1.0, -1.0]:
		var sp := prof.at(0.0)
		_box(trim, Vector3(side * (sp[0] - 0.02), sp[1] + 0.02, 0.0), Vector3(0.06, 0.07, car.wheelbase - 0.95))
	# Mirrors at the base of the A-pillar.
	var zm: float = prof.cabin_z1() - 0.22
	var mp := prof.at(zm)
	for side in [1.0, -1.0]:
		var base_x: float = mp[0] * mp[3] * 0.96
		# Stalk, then a wedge-shaped housing angled back into the airflow.
		_box(trim, Vector3(side * (base_x + 0.05), mp[2] + 0.05, zm), Vector3(0.1, 0.025, 0.04))
		_box(paint, Vector3(side * (base_x + 0.13), mp[2] + 0.08, zm - 0.03), Vector3(0.15, 0.085, 0.07), Vector3(0.0, side * 0.25, 0.0))
		_box(trim, Vector3(side * (base_x + 0.13), mp[2] + 0.08, zm - 0.068), Vector3(0.13, 0.07, 0.01), Vector3(0.0, side * 0.25, 0.0))
	# Spoilers.
	match car.spoiler:
		"wing_low":
			var zw := zmin + 0.35
			var pw := prof.at(zw)
			_box(trim, Vector3(0.0, pw[2] + 0.13, zw), Vector3(pw[0] * 1.8, 0.035, 0.3), Vector3(deg_to_rad(-6.0), 0, 0))
			for s2 in [1.0, -1.0]:
				_box(trim, Vector3(s2 * pw[0] * 0.55, pw[2] + 0.06, zw + 0.02), Vector3(0.04, 0.14, 0.12))
		"wing_high":
			var zw2 := zmin + 0.28
			var pw2 := prof.at(zw2)
			_box(paint, Vector3(0.0, pw2[2] + 0.3, zw2), Vector3(pw2[0] * 1.75, 0.04, 0.32), Vector3(deg_to_rad(-8.0), 0, 0))
			for s3 in [1.0, -1.0]:
				_box(paint, Vector3(s3 * pw2[0] * 0.62, pw2[2] + 0.15, zw2), Vector3(0.045, 0.3, 0.14))
				_box(trim, Vector3(s3 * pw2[0] * 0.88, pw2[2] + 0.3, zw2), Vector3(0.02, 0.14, 0.4))
		"duck":
			var zd := zmin + 0.12
			var pd := prof.at(zd)
			_box(paint, Vector3(0.0, pd[2] + 0.02, zd), Vector3(pd[0] * 1.75, 0.05, 0.22), Vector3(deg_to_rad(-14.0), 0, 0))
	# Exhausts.
	var ey: float = rear[1] + 0.06
	match car.id:
		"vortex":
			for ex in [-0.16, -0.05, 0.05, 0.16]:
				_cyl(chrome, Vector3(ex, ey + 0.1, zmin + 0.02), 0.045, 0.2, Vector3(PI * 0.5, 0, 0), 12)
		"brute":
			for ex2 in [-0.62, -0.5, 0.5, 0.62]:
				_cyl(chrome, Vector3(ex2, ey, zmin + 0.05), 0.045, 0.25, Vector3(PI * 0.5, 0, 0), 12)
		_:
			_cyl(chrome, Vector3(-0.55, ey, zmin + 0.04), 0.07, 0.25, Vector3(PI * 0.5, 0, 0), 14)
	var mesh := ArrayMesh.new()
	_commit(mesh, trim, mats.trim_material)
	_commit(mesh, paint, mats.paint_material)
	_commit(mesh, chrome, mats.chrome_material)
	return mesh


static func _add_lights(root: Node3D, prof: Profile, car: Dictionary, mats: Dictionary) -> void:
	var head := _new_tool()
	var tail := _new_tool()
	var zmax := prof.z_max
	var zmin := prof.z_min
	var fz := zmax - 0.1
	var fp := prof.at(fz)
	var hy: float = lerpf(fp[1], fp[2], 0.7)
	var rp := prof.at(zmin + 0.05)
	var ty: float = lerpf(rp[1], rp[2], 0.72)
	var head_pos: Array[Vector3] = []
	match car.lights:
		"slit":
			for s in [1.0, -1.0]:
				var x: float = s * fp[0] * 0.62
				_box(head, Vector3(x, hy, fz), Vector3(0.42, 0.045, 0.1), Vector3(0, -s * 0.28, s * 0.06))
				head_pos.append(Vector3(x, hy, fz + 0.05))
			_box(tail, Vector3(0.0, ty, zmin + 0.01), Vector3(rp[0] * 1.7, 0.04, 0.06))
		"round":
			for s in [1.0, -1.0]:
				for off in [0.52, 0.76]:
					var x2: float = s * fp[0] * off
					_cyl(head, Vector3(x2, hy - 0.06, zmax - 0.01), 0.075, 0.05, Vector3(PI * 0.5, 0, 0), 16)
				head_pos.append(Vector3(s * fp[0] * 0.64, hy - 0.06, zmax + 0.02))
				_box(tail, Vector3(s * rp[0] * 0.5, ty - 0.05, zmin + 0.01), Vector3(rp[0] * 0.75, 0.09, 0.05))
		_:
			for s in [1.0, -1.0]:
				var x3: float = s * fp[0] * 0.62
				_box(head, Vector3(x3, hy, fz + 0.02), Vector3(0.36, 0.08, 0.1), Vector3(0, -s * 0.18, 0))
				head_pos.append(Vector3(x3, hy, fz + 0.06))
				for off2 in [0.42, 0.72]:
					_cyl(tail, Vector3(s * rp[0] * off2, ty, zmin + 0.0), 0.085, 0.05, Vector3(PI * 0.5, 0, 0), 16)
	var hm := MeshInstance3D.new()
	hm.name = "HeadLights"
	var m1 := ArrayMesh.new()
	_commit(m1, head, mats.head_material)
	hm.mesh = m1
	root.add_child(hm)
	var tm := MeshInstance3D.new()
	tm.name = "TailLights"
	var m2 := ArrayMesh.new()
	_commit(m2, tail, mats.tail_material)
	tm.mesh = m2
	root.add_child(tm)
	# Real beams, switched on at night by the world (off by default: two
	# shadowless spots are cheap but not free on a phone).
	for i in head_pos.size():
		var spot := SpotLight3D.new()
		spot.name = "Beam%d" % i
		spot.position = head_pos[i]
		spot.rotation = Vector3(deg_to_rad(-4.0), PI, 0.0)
		spot.spot_range = 45.0
		spot.spot_angle = 28.0
		spot.light_energy = 5.0
		spot.light_color = Color(1.0, 0.96, 0.88)
		spot.visible = false
		hm.add_child(spot)


static func _wheel(wname: String, radius: float, width: float, side: float, mats: Dictionary) -> Node3D:
	var w := Node3D.new()
	w.name = wname
	var axle := Vector3(0, 0, PI * 0.5)
	# Tyre: main tread, rounded shoulders, dark barrel inside.
	var tire := _new_tool()
	_cyl(tire, Vector3.ZERO, radius, width * 0.82, axle, 28)
	for s in [1.0, -1.0]:
		var tm := TorusMesh.new()
		tm.inner_radius = radius - width * 0.18
		tm.outer_radius = radius - 0.005
		tm.rings = 28
		tm.ring_segments = 8
		tire.append_from(tm, 0, Transform3D(Basis.from_euler(axle), Vector3(s * width * 0.36, 0, 0)))
	var rim_r := radius * 0.7
	_cyl(tire, Vector3(-side * 0.02, 0, 0), rim_r * 0.98, width * 0.8, axle, 20)
	# Rim: face, lip, 5 split spokes, centre cap, brake disc.
	var rim := _new_tool()
	var face_x := side * (width * 0.41)
	var lip := TorusMesh.new()
	lip.inner_radius = rim_r - 0.022
	lip.outer_radius = rim_r + 0.008
	lip.rings = 24
	lip.ring_segments = 6
	rim.append_from(lip, 0, Transform3D(Basis.from_euler(axle), Vector3(face_x, 0, 0)))
	for i in 5:
		var a := TAU * float(i) / 5.0
		for off in [-0.09, 0.09]:
			var ang: float = a + off
			var mid := Vector3(face_x - side * 0.01, sin(ang) * rim_r * 0.5, cos(ang) * rim_r * 0.5)
			_box(rim, mid, Vector3(0.035, rim_r * 0.95, 0.03), Vector3(PI * 0.5 - ang, 0, 0))
	_cyl(rim, Vector3(face_x, 0, 0), rim_r * 0.22, 0.05, axle, 12)
	_cyl(rim, Vector3(-side * 0.01, 0, 0), rim_r * 0.72, 0.02, axle, 18)
	var tm_i := MeshInstance3D.new()
	tm_i.name = "Tire"
	var m1 := ArrayMesh.new()
	_commit(m1, tire, mats.tire_material)
	tm_i.mesh = m1
	w.add_child(tm_i)
	var rm_i := MeshInstance3D.new()
	rm_i.name = "Rim"
	var m2 := ArrayMesh.new()
	_commit(m2, rim, mats.rim_material)
	rm_i.mesh = m2
	w.add_child(rm_i)
	return w


static func _add_underglow(root: Node3D, prof: Profile, car: Dictionary, mats: Dictionary) -> void:
	var g := Node3D.new()
	g.name = "Underglow"
	g.visible = false
	var strip := MeshInstance3D.new()
	strip.name = "Strip"
	var bm := BoxMesh.new()
	var mid := prof.at(0.0)
	bm.size = Vector3(mid[0] * 1.6, 0.02, car.length - 1.3)
	strip.mesh = bm
	strip.material_override = mats.glow_material
	strip.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	strip.position = Vector3(0, 0.16, 0)
	g.add_child(strip)
	for zz in [car.wheelbase * 0.3, -car.wheelbase * 0.3]:
		var l := OmniLight3D.new()
		l.position = Vector3(0, 0.12, zz)
		l.omni_range = 2.8
		l.light_energy = 2.6
		l.omni_attenuation = 1.4
		l.light_color = PaintCustomizer.GLOW_COLORS[0]
		g.add_child(l)
	root.add_child(g)


static var _shadow_tex: GradientTexture2D


static func _add_contact_shadow(root: Node3D, prof: Profile, car: Dictionary) -> void:
	if _shadow_tex == null:
		var grad := Gradient.new()
		grad.set_color(0, Color(0, 0, 0, 0.82))
		grad.set_color(1, Color(0, 0, 0, 0.0))
		grad.add_point(0.55, Color(0, 0, 0, 0.55))
		_shadow_tex = GradientTexture2D.new()
		_shadow_tex.gradient = grad
		_shadow_tex.fill = GradientTexture2D.FILL_RADIAL
		_shadow_tex.fill_from = Vector2(0.5, 0.5)
		_shadow_tex.fill_to = Vector2(1.0, 0.5)
		_shadow_tex.width = 64
		_shadow_tex.height = 64
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_texture = _shadow_tex
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	var mi := MeshInstance3D.new()
	mi.name = "ContactShadow"
	var pm := PlaneMesh.new()
	var mid := prof.at(0.0)
	pm.size = Vector2(mid[0] * 2.6, car.length * 1.12)
	mi.mesh = pm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(0, 0.02, 0)
	root.add_child(mi)


# ─────────────────────────────── glb helpers ───────────────────────────────


static func _walk(n: Node) -> Array[Node]:
	var out: Array[Node] = [n]
	for c in n.get_children():
		out.append_array(_walk(c))
	return out


static func _global_of(n: Node3D, stop: Node) -> Transform3D:
	var xf := n.transform
	var p := n.get_parent()
	while p != null and p != stop and p is Node3D:
		xf = (p as Node3D).transform * xf
		p = p.get_parent()
	return xf


static func _canonical(part: String) -> String:
	match part:
		"body":
			return "Body"
		"door_l":
			return "Door_L"
		"door_r":
			return "Door_R"
		_:
			return "Wheel_" + part.substr(6).to_upper()
