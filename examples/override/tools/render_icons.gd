extends SceneTree
## xvfb-run -a godot --path . --rendering-driver opengl3 -s tools/render_icons.gd
## Renders each pack item's 3D model into assets/icons/<item>.png: a 192 px picture on a transparent background (the render target
## itself is transparent, so there is no cut-out edge to clean up). The pack draws these instead of line art.
## Same models as the ones lying in the world, at full detail.

const SIZE := 384
const OUT := 192
const ITEMS := {
	"fuse": "fuse", "wiring": "wiring", "timer": "timer", "gel": "gel", "detonator": "detonator", "keycard": "keycard", "mega_bomb": "mega_bomb",
	"cable": "cable", "scrap": "scrap",
	"shield": "shield", "medkit": "medkit", "hush": "hush", "beeper": "beeper",
}
## items whose in-game model was generated again under another name
const RAW := {"fuse": "fuse2", "wiring": "wiring2"}
const SPIN := {"keycard": 20.0, "gel": 25.0, "mega_bomb": 25.0, "timer": 15.0, "detonator": 25.0, "fuse": 30.0, "wiring": 25.0, "cable": 25.0, "scrap": 35.0, "shield": 75.0, "medkit": 20.0, "hush": 25.0, "beeper": 25.0}


func _init() -> void:
	DirAccess.make_dir_recursive_absolute("res://assets/icons")
	for item in ITEMS:
		await _render(item)
	quit()


## The full-detail generated model (tools/raw_trellis, not committed) gives the sharpest picture; the phone-sized game model is the fallback.
func _load_model(item: String) -> Node3D:
	var raw := ProjectSettings.globalize_path("res://tools/raw_trellis/%s.glb" % RAW.get(item, ITEMS[item]))
	if FileAccess.file_exists(raw):
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		if doc.append_from_file(raw, st) == OK:
			return doc.generate_scene(st) as Node3D
	return (load("res://assets/models/%s.glb" % ITEMS[item]) as PackedScene).instantiate() as Node3D


func _render(item: String) -> void:
	var vp := SubViewport.new()
	vp.size = Vector2i(SIZE, SIZE)
	vp.transparent_bg = true
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.78, 0.85)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, -35, 0)
	sun.light_energy = 1.3
	vp.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, 140, 0)
	fill.light_energy = 0.5
	vp.add_child(fill)
	var model := _load_model(item)
	var pivot := Node3D.new()
	vp.add_child(pivot)
	pivot.add_child(model)
	pivot.rotation_degrees.y = float(SPIN.get(item, 25.0))
	await process_frame
	var box := Assets.bounds(model)
	var longest := maxf(box.size.x, maxf(box.size.y, box.size.z))
	model.scale = Vector3.ONE * (1.0 / longest)
	model.position = -(box.position + box.size * 0.5) * (1.0 / longest)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 1.45
	vp.add_child(cam)
	cam.look_at_from_position(Vector3(0, 0.75, 1.5), Vector3.ZERO, Vector3.UP)
	cam.make_current()
	for i in range(8):
		await process_frame
	var img := vp.get_texture().get_image()
	img.convert(Image.FORMAT_RGBA8)
	var used := img.get_used_rect()
	if used.size.x > 0:
		var pad := int(float(maxi(used.size.x, used.size.y)) * 0.06)
		var side := maxi(used.size.x, used.size.y) + pad * 2
		var sq := Image.create(side, side, false, Image.FORMAT_RGBA8)
		sq.fill(Color(0, 0, 0, 0))
		sq.blit_rect(img, used, Vector2i((side - used.size.x) / 2, (side - used.size.y) / 2))
		sq.resize(OUT, OUT, Image.INTERPOLATE_LANCZOS)
		img = sq
	img.save_png("res://assets/icons/%s.png" % item)
	print("icon ", item, " ", img.get_size(), " corner alpha ", img.get_pixel(1, 1).a)
	vp.queue_free()
	await process_frame
