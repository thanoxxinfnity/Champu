class_name Mat
extends RefCounted
## Cheap materials and shapes. Everything in the world is one of a handful of cached materials (so the batches stay few): flat colours lit per vertex
## (no per-pixel lighting pass), or fully unlit for glows. No textures, no shadows.

static var _cache := {}
static var _boxes := {}


static func flat(c: Color, glow := 0.0) -> StandardMaterial3D:
	var key := "f%s/%s" % [c.to_html(), glow]
	if not _cache.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
		m.roughness = 1.0
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = c
			m.emission_energy_multiplier = glow
		_cache[key] = m
	return _cache[key]


static func unlit(c: Color, alpha := 1.0) -> StandardMaterial3D:
	var key := "u%s/%s" % [c.to_html(), alpha]
	if not _cache.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(c.r, c.g, c.b, alpha)
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		if alpha < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_cache[key] = m
	return _cache[key]


static func box_mesh(size: Vector3) -> BoxMesh:
	var key := "%s" % size
	if not _boxes.has(key):
		var b := BoxMesh.new()
		b.size = size
		_boxes[key] = b
	return _boxes[key]


## A box mesh instance with a cached mesh and material.
static func box(parent: Node, center: Vector3, size: Vector3, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = box_mesh(size)
	mi.material_override = m
	mi.position = center
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


## A static box with a collision shape (layer 1 = world).
static func solid(parent: Node, center: Vector3, size: Vector3, m: Material, layer := 1) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.position = center
	body.collision_layer = layer
	body.collision_mask = 0
	var mi := MeshInstance3D.new()
	mi.mesh = box_mesh(size)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	body.add_child(cs)
	parent.add_child(body)
	return body


static func cyl(parent: Node, center: Vector3, r: float, h: float, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = h
	c.radial_segments = 8
	c.rings = 1
	mi.mesh = c
	mi.material_override = m
	mi.position = center
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi
