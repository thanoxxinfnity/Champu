extends Node3D
## The hero cutscene: a furnished room, a rigged character who walks in, sits, turns the TV on
## (an ad, then the Chomugiri brand), picks up a phone, and opens the app. Built to be filmed with
## --write-movie, not viewed live — see tools/capture.gd.

# file, x, z, yaw_deg, target size (metres, largest dimension), fixed_y (wall-mounted items), lay_flat
const ROOM := [
	["01_grey_sofa.glb", -1.6, -1.2, 32.0, 2.0, null, false],
	["02_coffee_table.glb", -0.6, -0.4, 0.0, 1.1, null, false],
	["03_tv_console.glb", 0.0, -2.6, 0.0, 1.6, null, false],
	["07_bookshelf.glb", -2.6, -2.2, 20.0, 1.9, null, false],
	["08_armchair.glb", 1.7, -0.9, -40.0, 1.0, null, false],
	["09_persian_rug.glb", -0.6, -0.6, 0.0, 2.6, null, true],
	["10_palm_plant.glb", 2.4, -2.2, 0.0, 1.6, null, false],
	["12_pendant_lamp.glb", -0.6, -0.6, 0.0, 0.42, 1.9, false],
	["15_floor_lamp.glb", 2.6, -0.4, 0.0, 1.5, null, false],
	["17_landscape_painting.glb", -2.75, -2.88, 10.0, 1.0, 1.4, false],
	["19_book_stack.glb", -0.3, -0.35, 0.0, 0.3, null, false],
	["22_photo_frame.glb", 1.9, -2.88, 0.0, 0.35, 1.2, false],
	["16_succulent.glb", 1.6, -0.5, 0.0, 0.28, null, false],
	["05_fridge.glb", 3.3, -2.3, -90.0, 1.7, null, false],
	["21_curtains.glb", -2.9, -2.9, 0.0, 2.6, null, false],
]
const ROOM_W := 7.2
const ROOM_D := 6.4
const ROOM_H := 2.9
const CHAR_SIZE := 1.75

var character: Node3D
var anim: AnimationPlayer
var phone: Node3D
var tv_screen: MeshInstance3D
var screen_img := Image.create(256, 160, false, Image.FORMAT_RGBA8)
var screen_tex := ImageTexture.new()
var cam: Camera3D

# ── Timeline (seconds). Each phase starts where the one before it settles. ──
const WALK_START := 0.5
const WALK_DUR := 2.6
const SIT_START := WALK_START + WALK_DUR
const SIT_DUR := 0.9
const TV_ON_START := SIT_START + SIT_DUR + 0.5
const TV_AD_START := TV_ON_START + 0.3
const TV_AD_DUR := 2.4
const TV_BRAND_START := TV_AD_START + TV_AD_DUR
const TV_BRAND_DUR := 1.6
const PHONE_START := TV_BRAND_START + TV_BRAND_DUR + 0.4
const PHONE_DUR := 1.6
const HOLD_END := PHONE_START + PHONE_DUR + 2.2
var t := 0.0
var walk_target := Vector3(-0.85, 0, -0.75)
var walk_start_pos: Vector3


func _ready() -> void:
	_build_room()
	_build_lighting()
	character = Rig.make_character(CHAR_SIZE)
	add_child(character)
	anim = character.get_meta("anim") as AnimationPlayer
	walk_start_pos = Vector3(-4.6, 0, 1.5)
	character.position = walk_start_pos
	character.rotation_degrees.y = 110.0
	_load_phone()
	_build_tv_screen()
	draw_tv_off()

	cam = Camera3D.new()
	cam.fov = 42.0
	add_child(cam)
	cam.make_current()

	anim.play("walk")
	anim.seek(0.0)


func _process(delta: float) -> void:
	t += delta
	_drive_character()
	_drive_tv()
	_drive_camera()
	# This project exists only to be filmed with --write-movie, which renders until the app quits
	# rather than for a fixed frame count — so the cutscene ending is what ends the process.
	if t >= HOLD_END:
		get_tree().quit()


func _drive_character() -> void:
	var walk_e: float = clampf((t - WALK_START) / WALK_DUR, 0.0, 1.0)
	walk_e = 1.0 - pow(1.0 - walk_e, 3.0) # ease out
	var sit_e: float = clampf((t - SIT_START) / SIT_DUR, 0.0, 1.0)

	if t < SIT_START:
		if anim.current_animation != "walk":
			anim.play("walk")
		anim.seek(fmod(t - WALK_START, anim.get_animation("walk").length) if t >= WALK_START else 0.0, true)
		character.position = walk_start_pos.lerp(walk_target, walk_e)
		character.rotation_degrees.y = lerpf(110.0, 200.0, walk_e)
	elif t < SIT_START + SIT_DUR:
		if anim.current_animation != "sit_down":
			anim.play("sit_down")
		anim.seek(t - SIT_START, true)
		character.position = walk_target
		character.rotation_degrees.y = 200.0
	elif t < PHONE_START:
		if anim.current_animation != "seated_idle":
			anim.play("seated_idle")
			anim.seek(0.0)
	else:
		var first_frame: bool = anim.current_animation != "phone_raise"
		if first_frame:
			anim.play("phone_raise")
		var pt: float = clampf(t - PHONE_START, 0.0, PHONE_DUR)
		anim.seek(pt, true)
		if phone != null:
			var raise_e: float = clampf(pt / PHONE_DUR, 0.0, 1.0)
			# The real right-hand bone, not a guessed offset — a hardcoded local point does not
			# follow the arm through its own animation, which is how the phone ended up floating
			# off by the bookshelf instead of in the character's hand.
			var sk := character.get_meta("skeleton") as Skeleton3D
			var hand_pose := sk.get_bone_global_pose(Rig.index_of("handR"))
			var hand: Vector3 = sk.global_transform * hand_pose.origin
			if first_frame:
				phone.visible = true
				phone.global_position = hand # drawn from the pocket, not lerped in from the hidden origin
			else:
				phone.global_position = phone.global_position.lerp(hand, 0.35)
			phone.rotation_degrees = Vector3(-20, 210, 10)
			var glow := phone.get_meta("glow") as MeshInstance3D
			if glow != null:
				var gm := glow.material_override as StandardMaterial3D
				var lit: float = clampf((raise_e - 0.55) * 2.2, 0.0, 1.0)
				gm.albedo_color.a = lit * 0.9
				gm.emission_energy_multiplier = 1.0 + lit * 1.0


func _drive_tv() -> void:
	if t < TV_ON_START:
		return
	if t < TV_AD_START:
		var e: float = clampf((t - TV_ON_START) / (TV_AD_START - TV_ON_START), 0.0, 1.0)
		var mat := tv_screen.material_override as StandardMaterial3D
		mat.albedo_color.a = e
		draw_tv_off()
	elif t < TV_BRAND_START:
		draw_tv_ad(t)
		(tv_screen.material_override as StandardMaterial3D).albedo_color.a = 1.0
	else:
		draw_tv_brand()
		(tv_screen.material_override as StandardMaterial3D).albedo_color.a = 1.0
	screen_tex.update(screen_img)


func _drive_camera() -> void:
	# Four shots, cross-dissolved by camera motion alone (one continuous move per phase, not a hard
	# cut) — an establishing wide shot, in on the sofa for the TV beat, then a push to the phone.
	if t < SIT_START:
		var e: float = clampf(t / SIT_START, 0.0, 1.0)
		cam.global_position = Vector3(-2.2, 2.3, 3.2).lerp(Vector3(-1.0, 1.9, 2.6), e)
		cam.look_at(Vector3(-1.4, 1.0, -0.6), Vector3.UP)
	elif t < TV_BRAND_START + TV_BRAND_DUR:
		var e: float = clampf((t - SIT_START) / (TV_BRAND_START + TV_BRAND_DUR - SIT_START), 0.0, 1.0)
		cam.global_position = Vector3(0.6, 1.7, 1.6).lerp(Vector3(0.1, 1.35, 0.9), e)
		cam.look_at(Vector3(-0.3, 1.1, -1.8), Vector3.UP)
	else:
		var e: float = clampf((t - (TV_BRAND_START + TV_BRAND_DUR)) / (HOLD_END - (TV_BRAND_START + TV_BRAND_DUR)), 0.0, 1.0)
		# Pushes in from the TV shot's own end position toward a close three-quarter view of the
		# character, offset from wherever they actually ended up sitting — not a hardcoded guess.
		var seat := walk_target
		var wide := Vector3(0.6, 1.7, 1.6)
		var close := seat + Vector3(1.1, 0.75, 1.3)
		cam.global_position = wide.lerp(close, e)
		var look: Vector3 = (phone.global_position if phone != null else seat + Vector3(0, 1.1, 0)) if t > PHONE_START else seat + Vector3(0, 1.1, 0)
		cam.look_at(look, Vector3.UP)


func _build_room() -> void:
	var floor_mesh := MeshInstance3D.new()
	var floor_plane := PlaneMesh.new()
	floor_plane.size = Vector2(ROOM_W, ROOM_D)
	floor_mesh.mesh = floor_plane
	floor_mesh.material_override = _mat(Color(0.33, 0.25, 0.18), 0.85)
	floor_mesh.position = Vector3(0, 0, -ROOM_D * 0.5 + 1.2)
	add_child(floor_mesh)

	var ceiling := MeshInstance3D.new()
	var ceil_plane := PlaneMesh.new()
	ceil_plane.size = Vector2(ROOM_W, ROOM_D)
	ceiling.mesh = ceil_plane
	ceiling.material_override = _mat(Color(0.93, 0.91, 0.86), 0.95)
	ceiling.rotation_degrees.x = 180.0
	ceiling.position = Vector3(0, ROOM_H, -ROOM_D * 0.5 + 1.2)
	add_child(ceiling)

	# Four walls, warm plaster, the back wall a shade darker behind the TV so the screen reads.
	var wall_mat := _mat(Color(0.82, 0.76, 0.68), 0.92)
	var back_mat := _mat(Color(0.5, 0.46, 0.42), 0.92)
	_wall(Vector3(0, ROOM_H * 0.5, -ROOM_D + 1.2), Vector3(ROOM_W, ROOM_H, 0.1), back_mat)       # back (TV wall)
	_wall(Vector3(-ROOM_W * 0.5, ROOM_H * 0.5, 1.2 - ROOM_D * 0.5), Vector3(0.1, ROOM_H, ROOM_D), wall_mat)  # left
	_wall(Vector3(ROOM_W * 0.5, ROOM_H * 0.5, 1.2 - ROOM_D * 0.5), Vector3(0.1, ROOM_H, ROOM_D), wall_mat)   # right

	# A window on the right wall — the one real light source besides the TV and a lamp, and the
	# reason the room does not read as a sealed grey box.
	var window := MeshInstance3D.new()
	var wp := PlaneMesh.new()
	wp.size = Vector2(1.6, 1.3)
	window.mesh = wp
	window.material_override = _mat(Color(0.65, 0.78, 0.95), 0.1, true)
	window.rotation_degrees.y = 90.0
	window.position = Vector3(ROOM_W * 0.5 - 0.06, 1.55, -1.0)
	add_child(window)
	var sky_light := DirectionalLight3D.new()
	sky_light.rotation_degrees = Vector3(-35, -120, 0)
	sky_light.light_energy = 0.55
	sky_light.light_color = Color(0.8, 0.86, 1.0)
	add_child(sky_light)

	for item in ROOM:
		var node := _fit_and_place(item[0], item[1], item[2], item[3], item[4], item[5], item[6])
		if node != null:
			add_child(node)


func _wall(pos: Vector3, size: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mi.mesh = box
	mi.material_override = mat
	mi.position = pos
	add_child(mi)


func _mat(color: Color, roughness: float, transparent := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	if transparent:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color.a = 0.55
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = 0.4
	return m


func _build_lighting() -> void:
	add_child(WorldEnvironment.new())
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.05, 0.04, 0.035)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.5, 0.46)
	env.ambient_light_energy = 0.35
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	get_child(get_child_count() - 1).environment = env

	var lamp := OmniLight3D.new()
	lamp.position = Vector3(2.6, 1.55, -0.4)
	lamp.light_color = Color(1.0, 0.85, 0.65)
	lamp.light_energy = 3.0
	lamp.omni_range = 4.0
	add_child(lamp)

	var ceiling_lamp := OmniLight3D.new()
	ceiling_lamp.position = Vector3(-0.6, 1.75, -0.6)
	ceiling_lamp.light_color = Color(1.0, 0.92, 0.8)
	ceiling_lamp.light_energy = 2.2
	ceiling_lamp.omni_range = 4.5
	add_child(ceiling_lamp)


## Scales a loaded model to a real-world size and sits it on the floor at (x, z) — or, when
## fixed_y is given, hangs it there instead. Mirrors story-scene.js's fitAndPlace(), same reasons:
## each generated model comes out at its own arbitrary scale and origin.
func _fit_and_place(file: String, x: float, z: float, yaw_deg: float, target_size: float, fixed_y, lay_flat: bool) -> Node3D:
	var scene: PackedScene = load("res://assets/" + file)
	if scene == null:
		return null
	var node := scene.instantiate()
	var aabb := _world_aabb(node)
	var max_dim: float = maxf(aabb.size.x, maxf(aabb.size.y, aabb.size.z))
	if max_dim <= 0.0:
		max_dim = 1.0
	var scale: float = target_size / max_dim
	node.scale = Vector3.ONE * scale
	if lay_flat:
		node.rotation_degrees.x = -90.0
	node.rotation_degrees.y = yaw_deg

	var aabb2 := _world_aabb(node)
	var center2 := aabb2.position + aabb2.size * 0.5
	node.position.x += x - center2.x
	node.position.z += z - center2.z
	node.position.y += (fixed_y - center2.y) if fixed_y != null else -aabb2.position.y
	return node


## The AABB of `node` and everything under it, in `node`'s own coordinate space — including
## node's own current transform, which is the point: called once before fitAndPlace sets a scale
## (to measure the model as loaded) and again after (to find where the scaled/rotated base and
## centre landed). Node.get_aabb()'s global_transform only works on nodes already in the tree,
## which these never are yet, so this walks the hierarchy and multiplies transforms by hand.
func _world_aabb(node: Node3D) -> AABB:
	# [has_box: bool, box: AABB] — an Array so the recursive merge is visible to every caller;
	# an AABB return value would be copied at each level and the merge would be lost.
	var acc := [false, AABB()]
	_collect_aabb(node, node.transform, acc)
	return acc[1]


func _collect_aabb(n: Node, xf: Transform3D, acc: Array) -> void:
	if n is VisualInstance3D:
		var world_box := _xform_aabb(xf, (n as VisualInstance3D).get_aabb())
		if not acc[0]:
			acc[1] = world_box
			acc[0] = true
		else:
			acc[1] = (acc[1] as AABB).merge(world_box)
	for child in n.get_children():
		if child is Node3D:
			_collect_aabb(child, xf * (child as Node3D).transform, acc)


func _xform_aabb(xf: Transform3D, box: AABB) -> AABB:
	var out := AABB(xf * box.position, Vector3.ZERO)
	for i in range(8):
		var corner := box.position + Vector3(
			box.size.x if i & 1 else 0.0,
			box.size.y if i & 2 else 0.0,
			box.size.z if i & 4 else 0.0,
		)
		out = out.expand(xf * corner)
	return out


func _load_phone() -> void:
	var scene: PackedScene = load("res://assets/phone.glb")
	if scene == null:
		return
	phone = scene.instantiate()
	var aabb := _world_aabb(phone)
	var max_dim: float = maxf(aabb.size.x, maxf(aabb.size.y, aabb.size.z))
	phone.scale = Vector3.ONE * (0.15 / (max_dim if max_dim > 0.0 else 1.0))
	# Stays out of frame — origin, hidden — until _drive_character() positions it at the pocket
	# and shows it for the phone_raise phase; otherwise it sits at (0,0,0) in plain view the whole
	# walk/sit/TV stretch of the scene, a small dark smear floating mid-room.
	phone.visible = false
	add_child(phone)
	var glow := MeshInstance3D.new()
	var gp := PlaneMesh.new()
	gp.size = Vector2(0.26, 0.5)
	glow.mesh = gp
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(1.0, 0.54, 0.24, 0.0)
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.emission_enabled = true
	gm.emission = Color(1.0, 0.54, 0.24)
	gm.emission_energy_multiplier = 1.4
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.material_override = gm
	glow.position = Vector3(0, 0.02, 0.045)
	phone.add_child(glow)
	phone.set_meta("glow", glow)


func _build_tv_screen() -> void:
	# The generated 04_tv.glb model came out lying flat (like the rug, but never caught — a thin
	# dark sliver floating edge-on to every camera angle) and wasn't worth chasing further, so the
	# TV here is built, not loaded: a dark bezel box with this screen plane standing in front of it.
	var bezel := MeshInstance3D.new()
	var bezel_box := BoxMesh.new()
	bezel_box.size = Vector3(0.9, 0.56, 0.04)
	bezel.mesh = bezel_box
	bezel.material_override = _mat(Color(0.05, 0.05, 0.06), 0.4)
	bezel.position = Vector3(0.0, 0.95, -2.34)
	add_child(bezel)

	tv_screen = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(0.78, 0.46)
	tv_screen.mesh = plane
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(1, 1, 1, 0)
	screen_tex = ImageTexture.create_from_image(screen_img)
	mat.albedo_texture = screen_tex
	tv_screen.material_override = mat
	# PlaneMesh defaults to lying flat (normal +Y, like the floor) — standing it up to face the
	# room is what was missing before; without this it was a sliver seen edge-on from every angle.
	tv_screen.rotation_degrees.x = 90.0
	tv_screen.position = Vector3(0.0, 0.95, -2.3)
	add_child(tv_screen)


func draw_tv_off() -> void:
	screen_img.fill(Color(0.02, 0.03, 0.05))


func draw_tv_ad(t: float) -> void:
	var hue := fmod(t * 0.4, 1.0)
	for y in range(screen_img.get_height()):
		for x in range(screen_img.get_width()):
			var u := float(x) / screen_img.get_width()
			var c := Color.from_hsv(fmod(hue + u * 0.25, 1.0), 0.65, 0.6)
			screen_img.set_pixel(x, y, c)
	screen_img.fill_rect(Rect2i(20, 110, int(40 + 25 * sin(t * 3.0)), 14), Color(1, 1, 1, 0.85))


func draw_tv_brand() -> void:
	screen_img.fill(Color(0.09, 0.07, 0.06))
	# A simple blocky wordmark drawn as filled rects — no font rasteriser needed at this resolution.
	var bar := Color(1.0, 0.54, 0.24)
	screen_img.fill_rect(Rect2i(48, 68, 160, 20), bar)
	screen_img.fill_rect(Rect2i(70, 96, 116, 8), Color(0.96, 0.85, 0.74))
