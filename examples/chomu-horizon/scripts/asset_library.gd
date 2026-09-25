class_name AssetLibrary
extends RefCounted
## The TRELLIS-generated world assets (res://assets/trellis), made by
## tools/prep_trellis.py. Every asset is 1 unit tall, standing on y = 0 and
## centred on its footprint, with up to three meshes:
##   near  ~3k triangles, vertex-coloured (colour sampled from the texture)
##   far   ~500 triangles, vertex-coloured
##   tex   ~9k triangles with the original UVs and texture (props only)
## Meshes and materials are loaded once and shared by every map.

const DIR := "res://assets/trellis/"

## How each asset is drawn: kind (plant/rock/prop), wind sway, and the
## distances where near hands over to far and far disappears.
## Distances (m): "near" is where the full mesh hands over to the far mesh
## (plants: to their impostor), "far" where it all ends (0: no far LOD).
const INFO := {
	"oak": {"kind": "plant", "wind": 1.0, "near": 75.0, "far": 1100.0},
	"pine": {"kind": "plant", "wind": 0.6, "near": 75.0, "far": 1100.0},
	"birch": {"kind": "plant", "wind": 1.2, "near": 75.0, "far": 1100.0, "tint": Color(0.62, 0.66, 0.6)},
	"palm": {"kind": "plant", "wind": 1.4, "near": 80.0, "far": 1100.0},
	"snowpine": {"kind": "plant", "wind": 0.4, "near": 75.0, "far": 1100.0},
	"deadtree": {"kind": "plant", "wind": 0.25, "near": 75.0, "far": 800.0},
	"cactus": {"kind": "plant", "wind": 0.0, "near": 75.0, "far": 800.0},
	"bush": {"kind": "plant", "wind": 0.8, "near": 90.0, "far": 0.0},
	"boulder": {"kind": "rock", "near": 90.0, "far": 600.0},
	"redrock": {"kind": "rock", "near": 160.0, "far": 1400.0},
	"haybale": {"kind": "rock", "near": 80.0, "far": 400.0},
	"windmill": {"kind": "prop", "near": 260.0, "far": 2200.0},
	"barn": {"kind": "prop", "near": 200.0, "far": 1100.0},
	"cabin": {"kind": "prop", "near": 200.0, "far": 1000.0},
	"gasstation": {"kind": "prop", "near": 200.0, "far": 1100.0},
	"busstop": {"kind": "prop", "near": 110.0, "far": 400.0},
	"kiosk": {"kind": "prop", "near": 110.0, "far": 400.0},
	"fountain": {"kind": "prop", "near": 150.0, "far": 600.0},
	"billboard": {"kind": "prop", "near": 160.0, "far": 700.0},
	"bench": {"kind": "prop", "near": 70.0, "far": 200.0},
	"sedan": {"kind": "prop", "near": 90.0, "far": 450.0},
	"suv": {"kind": "prop", "near": 90.0, "far": 450.0},
	"truck": {"kind": "prop", "near": 90.0, "far": 450.0},
}


static var _meshes := {}
static var _meta := {}
static var _materials := {}
static var _detail: Texture2D


static func has(asset: String, lod: String) -> bool:
	if lod == "imp":
		return ResourceLoader.exists("%s%s_imp.png" % [DIR, asset])
	return ResourceLoader.exists("%s%s_%s.glb" % [DIR, asset, lod])


## Size data written by prep_trellis.py (footprint, impostor half-widths).
static func asset_meta(asset: String) -> Dictionary:
	if _meta.is_empty():
		_meta = JSON.parse_string(FileAccess.get_file_as_string(DIR + "meta.json"))
	return _meta.get(asset, {})


## The mesh of one LOD ("near", "far" or "tex"); null if it does not exist.
static func mesh(asset: String, lod: String) -> Mesh:
	var key := asset + "/" + lod
	if _meshes.has(key):
		return _meshes[key]
	var m: Mesh = null
	if lod == "imp":
		m = _impostor_mesh(asset)
		_meshes[key] = m
		return m
	var path := "%s%s_%s.glb" % [DIR, asset, lod]
	if ResourceLoader.exists(path):
		var scene := load(path) as PackedScene
		var root := scene.instantiate()
		for node in root.find_children("*", "MeshInstance3D", true, false):
			m = (node as MeshInstance3D).mesh
			break
		root.free()
	_meshes[key] = m
	return m


## The material for one LOD: plants get the wind shader, textured props keep
## their texture (times the baked AO in the vertex colours).
static func material(asset: String, lod: String) -> Material:
	var key := asset + "/" + lod
	if _materials.has(key):
		return _materials[key]
	var info: Dictionary = INFO.get(asset, {"kind": "prop"})
	var mat: Material
	if lod == "imp":
		var im := ShaderMaterial.new()
		im.shader = preload("res://shaders/impostor.gdshader")
		im.set_shader_parameter("atlas", load("%s%s_imp.png" % [DIR, asset]))
		im.set_shader_parameter("tint", info.get("tint", Color.WHITE))
		mat = im
	elif lod == "tex":
		var sm := StandardMaterial3D.new()
		sm.vertex_color_use_as_albedo = true
		sm.roughness = 0.75
		var m := mesh(asset, "tex")
		if m and m.get_surface_count() > 0:
			var orig := m.surface_get_material(0) as BaseMaterial3D
			if orig:
				sm.albedo_texture = orig.albedo_texture
		sm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		mat = sm
	elif info.kind == "plant":
		var fm := ShaderMaterial.new()
		fm.shader = preload("res://shaders/foliage.gdshader")
		fm.set_shader_parameter("wind", info.get("wind", 1.0) if lod == "near" else info.get("wind", 1.0) * 0.5)
		fm.set_shader_parameter("tint", info.get("tint", Color.WHITE))
		fm.set_shader_parameter("detail", detail_texture())
		fm.set_shader_parameter("detail_amount", 0.35 if lod == "near" else 0.0)
		fm.set_shader_parameter("translucency", 0.3 if asset != "cactus" else 0.05)
		mat = fm
	else:
		var sm2 := StandardMaterial3D.new()
		sm2.vertex_color_use_as_albedo = true
		sm2.roughness = 0.9 if info.kind == "rock" else 0.7
		mat = sm2
	_materials[key] = mat
	return mat


## Two crossed quads, 1 unit tall, textured with the front and side views.
static func _impostor_mesh(asset: String) -> Mesh:
	var md := asset_meta(asset)
	if not md.has("imp_x"):
		return null
	var hx := float(md.imp_x)
	var hz := float(md.imp_z)
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	# Front view (XY plane) on the left half of the atlas, side view (ZY) on the right.
	var quads := [
		[Vector3(-hx, 0, 0), Vector3(hx, 0, 0), Vector3(-hx, 1, 0), Vector3(hx, 1, 0), 0.0],
		[Vector3(0, 0, -hz), Vector3(0, 0, hz), Vector3(0, 1, -hz), Vector3(0, 1, hz), 0.5],
	]
	for q in quads:
		var u0: float = q[4]
		var bl: Vector3 = q[0]
		var br: Vector3 = q[1]
		var tl: Vector3 = q[2]
		var tr: Vector3 = q[3]
		verts.append_array(PackedVector3Array([bl, tl, br, br, tl, tr]))
		uvs.append_array(PackedVector2Array([Vector2(u0, 1), Vector2(u0, 0), Vector2(u0 + 0.5, 1), Vector2(u0 + 0.5, 1), Vector2(u0, 0), Vector2(u0 + 0.5, 0)]))
	var norms := PackedVector3Array()
	norms.resize(verts.size())
	norms.fill(Vector3.UP)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m


## Fine speckle used to break up flat vertex colours up close.
static func detail_texture() -> Texture2D:
	if _detail == null:
		_detail = load("res://textures/ground/grass_a.jpg")
	return _detail


static func info(asset: String) -> Dictionary:
	return INFO.get(asset, {"kind": "prop", "near": 150.0, "far": 600.0})
