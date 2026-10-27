class_name Anime
extends RefCounted
## The anime look on top of any real model: toon (banded) diffuse and a hard highlight on every material, a dark ink outline (inverted hull, one extra
## draw of the same mesh, only for things the player looks at: people, mounts, vehicles, the gauntlets), and a colour grade for the whole screen.

static var _toon := {}
static var _ink: ShaderMaterial


static func ink() -> ShaderMaterial:
	if _ink == null:
		_ink = ShaderMaterial.new()
		_ink.shader = load("res://shaders/ink.gdshader") as Shader
		_ink.set_shader_parameter("width", 0.018)
		_ink.set_shader_parameter("color", Color(0.06, 0.05, 0.12))
	return _ink


## Toon-shade every material under `n`; with `outline` the meshes also get the ink outline. Safe to call twice.
static func style(n: Node, outline := false, width := 0.018) -> void:
	if DisplayServer.get_name() == "headless":        # the dummy renderer has no meshes to restyle
		return
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null:
			continue
		for s in m.mesh.get_surface_count():
			var mat := m.get_active_material(s)
			if mat is BaseMaterial3D:
				m.set_surface_override_material(s, _toon_of(mat as BaseMaterial3D))
		if outline and m.material_overlay == null:
			if absf(width - 0.018) < 0.0001:
				m.material_overlay = ink()
			else:
				var sm := ink().duplicate() as ShaderMaterial
				sm.set_shader_parameter("width", width)
				m.material_overlay = sm
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


## For people: the toon styling, then every opaque material is swapped for the cel shader of shaders/toon_char.gdshader (the same texture, crisp light steps, violet shadows, rim light).
static func style_char(n: Node, outline := false, width := 0.018, bright := 1.0) -> void:
	style(n, outline, width)
	if DisplayServer.get_name() == "headless":
		return
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null:
			continue
		for sidx in m.mesh.get_surface_count():
			var src := m.mesh.surface_get_material(sidx)
			if src is BaseMaterial3D and (src as BaseMaterial3D).transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
				m.set_surface_override_material(sidx, _char_of(src as BaseMaterial3D, bright))


static var _char := {}


static func _char_of(src: BaseMaterial3D, bright := 1.0) -> ShaderMaterial:
	var key := [src, bright]
	if _char.has(key):
		return _char[key]
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/toon_char.gdshader") as Shader
	sm.set_shader_parameter("albedo", src.albedo_color)
	if src.albedo_texture != null:
		sm.set_shader_parameter("albedo_tex", src.albedo_texture)
		sm.set_shader_parameter("has_tex", true)
	else:
		sm.set_shader_parameter("has_tex", false)
	sm.set_shader_parameter("bright", bright)
	_char[key] = sm
	return sm


## The same for a bare mesh (MultiMesh patterns): its surface materials are swapped for toon ones.
static func style_mesh(mesh: Mesh) -> void:
	if DisplayServer.get_name() == "headless":
		return
	for s in mesh.get_surface_count():
		var mat := mesh.surface_get_material(s)
		if mat is BaseMaterial3D:
			mesh.surface_set_material(s, _toon_of(mat as BaseMaterial3D))


static func _toon_of(mat: BaseMaterial3D) -> BaseMaterial3D:
	if _toon.has(mat):
		return _toon[mat]
	var c := mat.duplicate() as BaseMaterial3D
	c.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
	c.specular_mode = BaseMaterial3D.SPECULAR_TOON
	c.roughness = 0.7
	c.metallic = minf(c.metallic, 0.25)
	c.metallic_specular = 0.3
	_toon[mat] = c
	return c


## The sky of the open world: a pastel gradient, a low sun with a halo and soft anime clouds (all in the sky shader, no textures).
static func sky() -> Sky:
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/anime_sky.gdshader") as Shader
	var sky := Sky.new()
	sky.sky_material = sm
	sky.radiance_size = Sky.RADIANCE_SIZE_32
	return sky
