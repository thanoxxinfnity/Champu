extends Node
## The look of a level: sky, light, fog, ground, walls, scattered props and a chase camera.
## A scene built with these reads as designed instead of as a blank test plane.
## Autoload name: Stage

const SKIES := {
	"day": {"top": Color("#3f78d6"), "horizon": Color("#cfe4f7"), "ground": Color("#8aa07a"), "sun": Color("#fff1d6"), "sun_energy": 1.0, "fog": Color("#d9e8f5"), "ambient": 0.5},
	"sunset": {"top": Color("#3b2f6e"), "horizon": Color("#ff9a5a"), "ground": Color("#4a3a46"), "sun": Color("#ffb070"), "sun_energy": 0.9, "fog": Color("#f0a070"), "ambient": 0.45},
	"night": {"top": Color("#05081a"), "horizon": Color("#1b2a55"), "ground": Color("#0a0f1f"), "sun": Color("#8fa8ff"), "sun_energy": 0.35, "fog": Color("#0d1530"), "ambient": 0.35},
	"overcast": {"top": Color("#7c8794"), "horizon": Color("#c5ccd3"), "ground": Color("#707a74"), "sun": Color("#e8eef5"), "sun_energy": 0.6, "fog": Color("#c5ccd3"), "ambient": 0.65},
	"snow": {"top": Color("#8fb4e0"), "horizon": Color("#eef4fb"), "ground": Color("#dfe9f2"), "sun": Color("#ffffff"), "sun_energy": 0.9, "fog": Color("#e6eef6"), "ambient": 0.7},
	"desert": {"top": Color("#4f8fd8"), "horizon": Color("#f6dcae"), "ground": Color("#c9a272"), "sun": Color("#fff0cc"), "sun_energy": 1.1, "fog": Color("#f0d8aa"), "ambient": 0.55},
}

var _texture_cache := {}


## Sky, sun with shadows, fog, filmic tone mapping and a touch of glow, in one call.
## preset: day, sunset, night, overcast, snow, desert. Returns the WorldEnvironment.
func environment(parent: Node, preset: String = "day", fog_amount: float = 1.0) -> WorldEnvironment:
	var look: Dictionary = SKIES.get(preset, SKIES["day"])
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = look["top"]
	sky_material.sky_horizon_color = look["horizon"]
	sky_material.ground_horizon_color = look["horizon"]
	sky_material.ground_bottom_color = look["ground"]
	sky_material.sun_angle_max = 25.0
	sky_material.sky_curve = 0.18
	var sky := Sky.new()
	sky.sky_material = sky_material
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = look["ambient"]
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 0.8
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.04
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.18
	env.fog_enabled = fog_amount > 0.0
	env.fog_light_color = look["fog"]
	env.fog_density = 0.004 * fog_amount
	env.fog_sky_affect = 0.35
	var world := WorldEnvironment.new()
	world.name = "WorldEnvironment"
	world.environment = env
	parent.add_child(world)

	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = look["sun"]
	sun.light_energy = look["sun_energy"]
	sun.rotation_degrees = Vector3(-48.0, -35.0, 0.0)
	sun.shadow_enabled = true
	sun.shadow_blur = 1.6
	sun.directional_shadow_max_distance = 90.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	parent.add_child(sun)
	return world


## A texture from res://textures/ whose file name contains `hint` (or any texture when `any` is true).
func texture(hint: String, any: bool = true) -> Texture2D:
	var key := "%s|%s" % [hint, any]
	if _texture_cache.has(key):
		return _texture_cache[key]
	var found: Texture2D = null
	var dir := DirAccess.open("res://textures")
	if dir:
		var names: Array[String] = []
		for file in dir.get_files():
			var clean := file.trim_suffix(".import").trim_suffix(".remap")
			if clean.get_extension() in ["jpg", "jpeg", "png", "webp"] and not names.has(clean):
				names.append(clean)
		names.sort()
		for n in names:
			if found == null and hint != "" and n.to_lower().contains(hint.to_lower()):
				found = load("res://textures/" + n) as Texture2D
		if found == null and any and names.size() > 0:
			found = load("res://textures/" + names[0]) as Texture2D
	_texture_cache[key] = found
	return found


## A mottled colour texture made in code, so a surface is never one flat colour.
func noise_texture(dark: Color, light: Color, frequency: float = 0.035, size: int = 256) -> ImageTexture:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.frequency = frequency
	noise.fractal_octaves = 4
	var gray := noise.get_seamless_image(size, size)
	var image := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in size:
		for x in size:
			var t := clampf(gray.get_pixel(x, y).r * 1.4 - 0.2, 0.0, 1.0)
			image.set_pixel(x, y, dark.lerp(light, t))
	return ImageTexture.create_from_image(image)


## A tiled material: a generated texture from res://textures/ when one fits `hint`, a noise texture otherwise.
func material(color: Color, hint: String = "", tile: float = 20.0, roughness: float = 0.9) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	var tex := texture(hint, false) if hint != "" else null
	if tex != null:
		mat.albedo_texture = tex
		mat.albedo_color = Color(1, 1, 1).lerp(color, 0.25)
	else:
		mat.albedo_texture = noise_texture(color.darkened(0.22), color.lightened(0.12))
	mat.uv1_scale = Vector3(tile, tile, 1)
	mat.texture_repeat = true
	mat.roughness = roughness
	return mat


## A flat arena floor with collision. `size` is the side length in metres; `hint` picks a texture ("grass", "road", "sand").
func ground(parent: Node, size: float = 120.0, color: Color = Color("#5d8f4a"), hint: String = "") -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = "Ground"
	var mesh_instance := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(size, size)
	mesh_instance.mesh = plane
	mesh_instance.material_override = material(color, hint, size / 7.0)
	body.add_child(mesh_instance)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(size, 1.0, size)
	shape.shape = box
	shape.position.y = -0.5
	body.add_child(shape)
	parent.add_child(body)
	return body


## A solid box with collision — walls, ramps, platforms, buildings.
func block(parent: Node, size: Vector3, position: Vector3, color: Color = Color("#8a8f98"), hint: String = "", rotation_y_degrees: float = 0.0) -> StaticBody3D:
	var body := StaticBody3D.new()
	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh_instance.mesh = mesh
	mesh_instance.material_override = material(color, hint, maxf(size.x, size.z) / 5.0, 0.8)
	body.add_child(mesh_instance)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	body.position = position
	body.rotation_degrees.y = rotation_y_degrees
	parent.add_child(body)
	return body


## A wall round a square arena, with a lit edge so the boundary reads clearly.
func arena_walls(parent: Node, half: float = 40.0, height: float = 2.4, color: Color = Color("#6d7380")) -> Node3D:
	var root := Node3D.new()
	root.name = "ArenaWalls"
	var t := 1.0
	block(root, Vector3(half * 2.0 + t * 2.0, height, t), Vector3(0, height * 0.5, -half - t * 0.5), color)
	block(root, Vector3(half * 2.0 + t * 2.0, height, t), Vector3(0, height * 0.5, half + t * 0.5), color)
	block(root, Vector3(t, height, half * 2.0), Vector3(-half - t * 0.5, height * 0.5, 0), color)
	block(root, Vector3(t, height, half * 2.0), Vector3(half + t * 0.5, height * 0.5, 0), color)
	parent.add_child(root)
	return root


## Places `count` things made by `maker` (a Callable returning a Node3D) at random spots inside the square
## `half` metres wide, keeping `min_gap` between them and `keep_clear` metres around each point in `avoid`.
func scatter(parent: Node, maker: Callable, count: int, half: float, min_gap: float = 4.0, avoid: Array[Vector3] = [], keep_clear: float = 8.0, seed_value: int = 1) -> Array[Node3D]:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var placed: Array[Node3D] = []
	var tries := 0
	while placed.size() < count and tries < count * 40:
		tries += 1
		var spot := Vector3(rng.randf_range(-half, half), 0.0, rng.randf_range(-half, half))
		var ok := true
		for a in avoid:
			if spot.distance_to(Vector3(a.x, 0.0, a.z)) < keep_clear:
				ok = false
		for p in placed:
			if spot.distance_to(Vector3(p.position.x, 0.0, p.position.z)) < min_gap:
				ok = false
		if not ok:
			continue
		var node: Node3D = maker.call()
		node.position = spot
		node.rotation_degrees.y = rng.randf_range(0.0, 360.0)
		parent.add_child(node)
		placed.append(node)
	return placed


## Makes `item` collectable: calls `on_collect` once, the first time `who` (or anything in the group "player") touches it.
func pickup(item: Node3D, who: Node3D, on_collect: Callable, radius: float = 1.5, height: float = 0.9) -> Area3D:
	var area := Area3D.new()
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	shape.shape = sphere
	shape.position.y = height
	area.add_child(shape)
	item.add_child(area)
	var done := [false]
	area.body_entered.connect(func(body: Node) -> void:
		if not done[0] and (body == who or body.is_in_group("player")):
			done[0] = true
			on_collect.call())
	return area


## A camera that follows `target` from behind and above, smoothly, with a speed-based field of view.
func chase_camera(parent: Node, target: Node3D, distance: float = 8.0, height: float = 3.6) -> Camera3D:
	var cam := Camera3D.new()
	cam.name = "ChaseCamera"
	cam.set_script(preload("res://kit/chase_cam.gd"))
	cam.set("target", target)
	cam.set("distance", distance)
	cam.set("height", height)
	parent.add_child(cam)
	cam.make_current()
	cam.call("snap")
	return cam
