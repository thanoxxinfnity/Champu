class_name PaintCustomizer
extends RefCounted
## Live paint, rims and underglow for a car model built by CarBuilder.
##
## Every painted part of a car (body, doors, roof, mirrors, wing) shares one
## ShaderMaterial stored on the model as meta "paint_material", so a colour
## change is a single uniform write that lands on the whole car in the same
## frame — no material swaps, no shader recompiles on the phone.

const PALETTE: Array[Color] = [
	Color(0.93, 0.33, 0.05),  # Horizon orange
	Color(0.86, 0.06, 0.10),  # Rosso
	Color(0.10, 0.36, 0.95),  # Bayside blue
	Color(0.05, 0.70, 0.45),  # Jade
	Color(0.98, 0.80, 0.08),  # Giallo
	Color(0.55, 0.16, 0.85),  # Midnight purple
	Color(0.92, 0.93, 0.95),  # Pearl white
	Color(0.42, 0.44, 0.47),  # Nardo grey
	Color(0.06, 0.09, 0.14),  # Tuxedo black
	Color(0.96, 0.35, 0.62),  # Sakura
]
const FINISHES: Array[String] = ["METALLIC", "MATTE", "PEARL", "CHAMELEON"]
const CHAMELEON := 3
const RIMS: Array[String] = ["CHROME", "BLACK", "GOLD", "GUNMETAL"]
const GLOW_COLORS: Array[Color] = [
	Color(0.1, 0.9, 1.0),
	Color(1.0, 0.15, 0.75),
	Color(0.4, 1.0, 0.2),
	Color(1.0, 0.55, 0.1),
	Color(0.55, 0.3, 1.0),
]

const SAVE_PATH := "user://garage.cfg"

static var _shader: Shader = preload("res://shaders/car_paint.gdshader")


static func default_config(car: Dictionary) -> Dictionary:
	return {"color": car.paint, "finish": 0, "rim": 0, "underglow": false, "glow": 0, "logo_path": ""}


static func make_paint_material() -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _shader
	return m


static func set_paint(mat: ShaderMaterial, color: Color, finish: int) -> void:
	mat.set_shader_parameter("base_color", color)
	match finish:
		1:  # Matte: no coat, no flakes, diffuse
			mat.set_shader_parameter("flip_color", color.darkened(0.15))
			mat.set_shader_parameter("metallic_amount", 0.05)
			mat.set_shader_parameter("roughness_amount", 0.72)
			mat.set_shader_parameter("clearcoat_amount", 0.0)
			mat.set_shader_parameter("flake_amount", 0.0)
		3:  # Chameleon: a strong two-tone flip; the game also rolls the hue with speed
			var flip2 := Color.from_hsv(fposmod(color.h + 0.4, 1.0), 0.9, clampf(color.v + 0.15, 0.0, 1.0))
			mat.set_shader_parameter("flip_color", flip2)
			mat.set_shader_parameter("metallic_amount", 0.6)
			mat.set_shader_parameter("roughness_amount", 0.18)
			mat.set_shader_parameter("clearcoat_amount", 1.0)
			mat.set_shader_parameter("flake_amount", 0.2)
		2:  # Pearlescent: colour shifts with the viewing angle
			var flip := Color.from_hsv(fposmod(color.h + 0.07, 1.0), clampf(color.s * 0.85, 0.0, 1.0), clampf(color.v * 1.1 + 0.05, 0.0, 1.0))
			mat.set_shader_parameter("flip_color", flip)
			mat.set_shader_parameter("metallic_amount", 0.45)
			mat.set_shader_parameter("roughness_amount", 0.2)
			mat.set_shader_parameter("clearcoat_amount", 1.0)
			mat.set_shader_parameter("flake_amount", 0.08)
		_:  # Metallic with flakes and clearcoat
			mat.set_shader_parameter("flip_color", color.lightened(0.08))
			mat.set_shader_parameter("metallic_amount", 0.78)
			mat.set_shader_parameter("roughness_amount", 0.3)
			mat.set_shader_parameter("clearcoat_amount", 1.0)
			mat.set_shader_parameter("flake_amount", 0.15)


static func set_rims(mat: StandardMaterial3D, style: int) -> void:
	match style:
		1:
			mat.albedo_color = Color(0.03, 0.03, 0.035)
			mat.metallic = 0.6
			mat.roughness = 0.25
		2:
			mat.albedo_color = Color(0.85, 0.66, 0.25)
			mat.metallic = 1.0
			mat.roughness = 0.18
		3:
			mat.albedo_color = Color(0.25, 0.27, 0.3)
			mat.metallic = 0.9
			mat.roughness = 0.35
		_:
			mat.albedo_color = Color(0.92, 0.93, 0.95)
			mat.metallic = 1.0
			mat.roughness = 0.08


## Applies a whole garage config to a model (and its showroom reflection,
## which shares the same materials).
static func apply(model: Node3D, config: Dictionary) -> void:
	var paint: ShaderMaterial = model.get_meta("paint_material")
	set_paint(paint, config.color, config.finish)
	set_rims(model.get_meta("rim_material"), config.rim)
	set_underglow(model, config.underglow, GLOW_COLORS[config.glow % GLOW_COLORS.size()])
	set_logo(model, config.get("logo_path", ""))


## A player-uploaded image on both doors, or hidden if `path` is empty/missing.
static func set_logo(model: Node3D, path: String) -> void:
	var l := model.get_node_or_null("LogoDecalL") as MeshInstance3D
	var r := model.get_node_or_null("LogoDecalR") as MeshInstance3D
	if l == null or r == null:
		return
	if path == "" or not FileAccess.file_exists(path):
		l.visible = false
		r.visible = false
		return
	var img := Image.new()
	if img.load(path) != OK:
		l.visible = false
		r.visible = false
		return
	var tex := ImageTexture.create_from_image(img)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = tex
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	l.material_override = mat
	r.material_override = mat
	l.visible = true
	r.visible = true


static func set_underglow(model: Node3D, on: bool, color: Color) -> void:
	var glow := model.get_node_or_null("Underglow") as Node3D
	if glow == null:
		return
	glow.visible = on
	var strip_mat: StandardMaterial3D = model.get_meta("glow_material")
	strip_mat.emission = color
	strip_mat.albedo_color = color
	for child in glow.get_children():
		if child is OmniLight3D:
			(child as OmniLight3D).light_color = color


## Coins a new player starts with.
const START_COINS := 2000


static func load_garage() -> Dictionary:
	var out := {"selected": CarCatalog.index_of("kaze"), "cars": {}, "coins": START_COINS, "owned": ["kaze"], "map": "hills", "best_trap": 0}
	var cf := ConfigFile.new()
	if cf.load(SAVE_PATH) != OK:
		return out
	out.selected = int(cf.get_value("garage", "selected", out.selected))
	out.coins = int(cf.get_value("garage", "coins", START_COINS))
	out.owned = Array(cf.get_value("garage", "owned", ["kaze"]))
	out.map = str(cf.get_value("garage", "map", "hills"))
	out.best_trap = int(cf.get_value("garage", "best_trap", 0))
	for i in CarCatalog.count():
		var car := CarCatalog.get_car(i)
		if cf.has_section_key("cars", car.id):
			var saved: Dictionary = cf.get_value("cars", car.id)
			var cfg := default_config(car)
			for k in cfg.keys():
				if saved.has(k):
					cfg[k] = saved[k]
			out.cars[car.id] = cfg
	return out


static func save_garage(garage: Dictionary) -> void:
	var cf := ConfigFile.new()
	cf.set_value("garage", "selected", garage.selected)
	cf.set_value("garage", "coins", garage.coins)
	cf.set_value("garage", "owned", garage.owned)
	cf.set_value("garage", "map", garage.map)
	cf.set_value("garage", "best_trap", garage.best_trap)
	for id in garage.cars.keys():
		cf.set_value("cars", id, garage.cars[id])
	cf.save(SAVE_PATH)
