class_name ModelFit
extends RefCounted
## Generated models arrive at arbitrary scale and origin (the Triverse ones are normalised to a 2-unit box centred on 0).
## These helpers measure a not-yet-in-the-tree model and place it: scaled to a real size, sitting on the floor, centred.


## The AABB of `node` and everything under it, in the space of node's parent (node's own transform included).
static func aabb_of(node: Node3D) -> AABB:
	var acc := [false, AABB()]
	_collect(node, node.transform, acc)
	return acc[1]


static func _collect(n: Node, xf: Transform3D, acc: Array) -> void:
	if n is VisualInstance3D:
		var box := _xform(xf, (n as VisualInstance3D).get_aabb())
		if not acc[0]:
			acc[1] = box
			acc[0] = true
		else:
			acc[1] = (acc[1] as AABB).merge(box)
	for c in n.get_children():
		if c is Node3D:
			_collect(c, xf * (c as Node3D).transform, acc)


static func _xform(xf: Transform3D, box: AABB) -> AABB:
	var out := AABB(xf * box.position, Vector3.ZERO)
	for i in range(8):
		var corner := box.position + Vector3(
			box.size.x if i & 1 else 0.0,
			box.size.y if i & 2 else 0.0,
			box.size.z if i & 4 else 0.0)
		out = out.expand(xf * corner)
	return out


## Turn by `yaw_deg`, scale so the longest horizontal side is `length` metres, centre on x/z and put the lowest point at y = `floor_y`.
static func place_by_length(node: Node3D, length: float, yaw_deg: float, floor_y := 0.0) -> void:
	node.rotation_degrees.y = yaw_deg
	var box := aabb_of(node)
	var longest := maxf(box.size.x, box.size.z)
	node.scale = Vector3.ONE * (length / maxf(longest, 0.0001))
	box = aabb_of(node)
	var c := box.position + box.size * 0.5
	node.position += Vector3(-c.x, floor_y - box.position.y, -c.z)


## Scale so the model is `height` metres tall, centre on x/z, feet on `floor_y`.
static func place_by_height(node: Node3D, height: float, yaw_deg := 0.0, floor_y := 0.0) -> void:
	node.rotation_degrees.y = yaw_deg
	var box := aabb_of(node)
	node.scale = Vector3.ONE * (height / maxf(box.size.y, 0.0001))
	box = aabb_of(node)
	var c := box.position + box.size * 0.5
	node.position += Vector3(-c.x, floor_y - box.position.y, -c.z)


## For furniture and props: scale so the largest dimension is `size`, optionally lay a model that came out standing on its
## edge flat (rugs, paintings), turn by `yaw_deg`, centre it on x/z and put its lowest point at `floor_y`
## (or its middle at `centre_y` when that is given — wall pictures).
static func place_by_largest(node: Node3D, size: float, yaw_deg := 0.0, floor_y := 0.0, lay_flat := false, centre_y = null) -> void:
	var box := aabb_of(node)
	node.scale = Vector3.ONE * (size / maxf(maxf(box.size.x, box.size.y), maxf(box.size.z, 0.0001)))
	if lay_flat:
		node.rotation_degrees.x = -90.0
	node.rotation_degrees.y = yaw_deg
	box = aabb_of(node)
	var c := box.position + box.size * 0.5
	node.position += Vector3(-c.x, (centre_y - c.y) if centre_y != null else (floor_y - box.position.y), -c.z)


## A box collider around an already-placed model, added next to it (furniture the player must not walk through).
static func collider_for(node: Node3D, shrink := 0.92) -> StaticBody3D:
	var box := aabb_of(node)
	var sb := StaticBody3D.new()
	sb.collision_layer = Data.L_WORLD
	sb.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = box.size * shrink
	cs.shape = bs
	sb.add_child(cs)
	sb.position = box.position + box.size * 0.5
	node.get_parent().add_child(sb)
	return sb
