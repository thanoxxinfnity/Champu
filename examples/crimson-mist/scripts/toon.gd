class_name Toon
extends RefCounted
## Swaps every material under a node for the cel shader (+ an ink outline for opaque surfaces) while keeping its colour and texture.

const SHADER := preload("res://shaders/toon.gdshader")
const OUTLINE := preload("res://shaders/outline.gdshader")

static var _cache := {}
static var _outline_mats := {}


static func outline_material(width: float, ink := Color(0.04, 0.045, 0.06)) -> ShaderMaterial:
	var key := "%s/%s" % [width, ink.to_html()]
	if not _outline_mats.has(key):
		var m := ShaderMaterial.new()
		m.shader = OUTLINE
		m.set_shader_parameter("width", width)
		m.set_shader_parameter("ink", ink)
		_outline_mats[key] = m
	return _outline_mats[key]


## One shared material for batched flat-colour geometry: the colour comes from the vertex colours Batcher bakes in.
static func vcolor() -> ShaderMaterial:
	if not _cache.has("vcolor"):
		var m := ShaderMaterial.new()
		m.shader = SHADER
		m.set_shader_parameter("use_vcolor", true)
		m.set_shader_parameter("grime", 0.3)
		_cache["vcolor"] = m
	return _cache["vcolor"]


## True for a plain flat toon material (no texture, outline or glow) whose colour can live in vertex colours instead.
static func is_plain(m: Material) -> bool:
	var sm := m as ShaderMaterial
	if sm == null or sm.shader != SHADER or sm.next_pass != null:
		return false
	if sm.get_shader_parameter("use_tex") == true or sm.get_shader_parameter("use_vcolor") == true:
		return false
	var e = sm.get_shader_parameter("emission_color")
	return e == null or (e as Color).r + (e as Color).g + (e as Color).b < 0.001


## A plain toon material from a colour (buildings, ground, props that have no texture).
static func flat(color: Color, outline := 0.0, grime := 0.0, emission := Color.BLACK, energy := 1.0) -> ShaderMaterial:
	var key := "flat/%s/%s/%s/%s/%s" % [color.to_html(), outline, grime, emission.to_html(), energy]
	if not _cache.has(key):
		var m := ShaderMaterial.new()
		m.shader = SHADER
		m.set_shader_parameter("albedo", color)
		m.set_shader_parameter("grime", grime)
		m.set_shader_parameter("emission_color", emission)
		m.set_shader_parameter("emission_energy", energy)
		if outline > 0.0:
			m.next_pass = outline_material(outline)
		_cache[key] = m
	return _cache[key]


static func apply(root: Node, outline := 0.012, tint := Color.WHITE, grime := 0.0) -> Array[ShaderMaterial]:
	var out: Array[ShaderMaterial] = []
	if DisplayServer.get_name() == "headless":
		return out      # the dummy renderer has no mesh surfaces to restyle
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		for s in mi.mesh.get_surface_count():
			var src := mi.get_active_material(s)
			var m := _convert(src, outline, tint, grime, mi.mesh.get_instance_id() * 16 + s)
			mi.set_surface_override_material(s, m)
			out.append(m)
	return out


static func _convert(src: Material, outline: float, tint: Color, grime: float, key_id: int) -> ShaderMaterial:
	var key := "src/%s/%s/%s/%s/%s" % [key_id, outline, tint.to_html(), grime, src.get_instance_id() if src != null else 0]
	if _cache.has(key):
		return _cache[key]
	var m := ShaderMaterial.new()
	m.shader = SHADER
	var base := Color.WHITE
	var alpha := false
	if src is BaseMaterial3D:
		var b := src as BaseMaterial3D
		base = b.albedo_color
		if b.albedo_texture != null:
			m.set_shader_parameter("albedo_tex", b.albedo_texture)
			m.set_shader_parameter("use_tex", true)
		alpha = b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED
		if b.emission_enabled:
			m.set_shader_parameter("emission_color", b.emission)
			m.set_shader_parameter("emission_energy", b.emission_energy_multiplier)
	m.set_shader_parameter("albedo", Color(base.r * tint.r, base.g * tint.g, base.b * tint.b, base.a))
	m.set_shader_parameter("grime", grime)
	if alpha:
		m.set_shader_parameter("alpha_cut", 0.45)
	elif outline > 0.0:
		m.next_pass = outline_material(outline)
	_cache[key] = m
	return m
