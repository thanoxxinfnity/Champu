class_name Surf
extends RefCounted
## Textured toon surfaces from the Poly Haven sets in assets/tex (CC0): `Surf.mat("brick_red", 3.0, tint)` -> a cached ShaderMaterial.
## Missing textures fall back to a flat toon colour so the game and the headless tests never depend on them.

const SHADER := preload("res://shaders/surface.gdshader")
const DIR := "res://assets/tex/"

static var _cache := {}
static var _tex := {}


static func has(id: String) -> bool:
	return ResourceLoader.exists("%s%s_d.jpg" % [DIR, id])


static func _texture(id: String, suffix: String) -> Texture2D:
	var key := id + suffix
	if not _tex.has(key):
		var path := "%s%s_%s.jpg" % [DIR, id, suffix]
		_tex[key] = load(path) if ResourceLoader.exists(path) else null
	return _tex[key]


## id: texture set; tile: metres per repeat; tint: multiplies the picture; wet/grime: weathering; emission: glow colour (window glass).
static func mat(id: String, tile := 3.0, tint := Color.WHITE, wet := 0.0, grime := 0.0, normal := 1.0, emission := Color.BLACK, energy := 1.0) -> Material:
	var key := "%s/%s/%s/%s/%s/%s/%s/%s" % [id, tile, tint.to_html(), wet, grime, normal, emission.to_html(), energy]
	if _cache.has(key):
		return _cache[key]
	var m: Material
	if DisplayServer.get_name() == "headless" or not has(id):
		m = Toon.flat(tint.darkened(0.25), 0.0, grime, emission, energy)
	else:
		var sm := ShaderMaterial.new()
		sm.shader = SHADER
		sm.set_shader_parameter("tex_d", _texture(id, "d"))
		var n := _texture(id, "n")
		sm.set_shader_parameter("use_normal", n != null and normal > 0.0)
		if n != null:
			sm.set_shader_parameter("tex_n", n)
		sm.set_shader_parameter("tint", tint)
		sm.set_shader_parameter("tile", tile)
		sm.set_shader_parameter("normal_strength", normal)
		sm.set_shader_parameter("wet", wet)
		sm.set_shader_parameter("grime", grime)
		sm.set_shader_parameter("emission_color", emission)
		sm.set_shader_parameter("emission_energy", energy)
		m = sm
	_cache[key] = m
	return m
