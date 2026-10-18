class_name Builder
extends RefCounted
## Axis-aligned building blocks for hand-built interiors: boxes, floors, and walls with door and window openings cut in
## (a wall is solid boxes around each opening, so the colliders leave real gaps to walk through).

static var _glass: StandardMaterial3D


static func glass() -> StandardMaterial3D:
	if _glass == null:
		_glass = StandardMaterial3D.new()
		_glass.albedo_color = Color(0.55, 0.75, 0.9, 0.28)
		_glass.metallic = 0.2
		_glass.roughness = 0.05
		_glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return _glass


static func mat(color: Color, rough := 0.9, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	return m


## A box from a centre and a size. With `collide` it is a StaticBody3D on the world layer.
static func box(parent: Node, center: Vector3, size: Vector3, material: Material, collide := true, shadow := true) -> Node3D:
	var holder: Node3D
	if collide:
		var sb := StaticBody3D.new()
		sb.collision_layer = Data.L_WORLD
		sb.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		sb.add_child(cs)
		holder = sb
	else:
		holder = Node3D.new()
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = material
	if not shadow:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	holder.add_child(mi)
	holder.position = center
	parent.add_child(holder)
	return holder


## A box given by its min corner and size (handy for slabs: floor_slab(parent, x0, z0, x1, z1, top_y, thickness)).
static func slab(parent: Node, x0: float, z0: float, x1: float, z1: float, top_y: float, thick: float, material: Material) -> Node3D:
	return box(parent, Vector3((x0 + x1) * 0.5, top_y - thick * 0.5, (z0 + z1) * 0.5), Vector3(x1 - x0, thick, z1 - z0), material)


## A wall along X at depth `z` from x0 to x1, or along Z at `x` from z0 to z1 (set `along_x`). Openings are
## [start_along_wall, width, bottom, height] in metres, measured from the wall's start. Returns the glass panes placed in
## openings whose `glazed` flag (5th element) is true.
static func wall(parent: Node, along_x: bool, fixed: float, a0: float, a1: float, y0: float, height: float, thick: float, material: Material, openings: Array = []) -> void:
	var ops := openings.duplicate()
	ops.sort_custom(func(p, q): return p[0] < q[0])
	var cursor := a0
	for o in ops:
		var os: float = a0 + o[0]
		var ow: float = o[1]
		var ob: float = o[2]
		var oh: float = o[3]
		if os > cursor:
			_segment(parent, along_x, fixed, cursor, os, y0, height, thick, material)
		if ob > 0.0:
			_segment(parent, along_x, fixed, os, os + ow, y0, ob, thick, material)
		if ob + oh < height:
			_segment(parent, along_x, fixed, os, os + ow, y0 + ob + oh, height - ob - oh, thick, material)
		if o.size() > 4 and o[4]:
			_pane(parent, along_x, fixed, os, os + ow, y0 + ob, oh)
		cursor = os + ow
	if cursor < a1:
		_segment(parent, along_x, fixed, cursor, a1, y0, height, thick, material)


static func _segment(parent: Node, along_x: bool, fixed: float, s0: float, s1: float, y0: float, h: float, thick: float, material: Material) -> void:
	if s1 - s0 < 0.001 or h < 0.001:
		return
	var mid := (s0 + s1) * 0.5
	var len := s1 - s0
	var center := Vector3(mid, y0 + h * 0.5, fixed) if along_x else Vector3(fixed, y0 + h * 0.5, mid)
	var size := Vector3(len, h, thick) if along_x else Vector3(thick, h, len)
	box(parent, center, size, material)


static func _pane(parent: Node, along_x: bool, fixed: float, s0: float, s1: float, y0: float, h: float) -> void:
	var mid := (s0 + s1) * 0.5
	var center := Vector3(mid, y0 + h * 0.5, fixed) if along_x else Vector3(fixed, y0 + h * 0.5, mid)
	var size := Vector3(s1 - s0, h, 0.04) if along_x else Vector3(0.04, h, s1 - s0)
	box(parent, center, size, glass(), true, false)
