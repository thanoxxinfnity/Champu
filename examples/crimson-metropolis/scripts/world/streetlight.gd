class_name Streetlight
extends Node3D
## One lamp post: a pole, an arm and a bulb. The bulb glows when lit; the actual light comes from LampPool, which
## moves a handful of real lights to whichever posts are nearest the player.

var _bulb_mat: StandardMaterial3D


func _init() -> void:
	add_to_group("streetlight")


func setup(pole_mat: Material) -> void:
	var pole := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.07
	cyl.bottom_radius = 0.12
	cyl.height = 7.0
	pole.mesh = cyl
	pole.material_override = pole_mat
	pole.position.y = 3.5
	add_child(pole)
	var arm := MeshInstance3D.new()
	var abox := BoxMesh.new()
	abox.size = Vector3(0.1, 0.1, 1.6)
	arm.mesh = abox
	arm.material_override = pole_mat
	arm.position = Vector3(0, 7.0, -0.7)
	add_child(arm)
	_bulb_mat = StandardMaterial3D.new()
	_bulb_mat.albedo_color = Color(0.85, 0.85, 0.8)
	_bulb_mat.emission_enabled = true
	_bulb_mat.emission = Color(1.0, 0.8, 0.5)
	_bulb_mat.emission_energy_multiplier = 0.0
	var bulb := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.3, 0.1, 0.6)
	bulb.mesh = bm
	bulb.material_override = _bulb_mat
	bulb.position = Vector3(0, 6.92, -1.3)
	bulb.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(bulb)


func set_lit(on: bool) -> void:
	if _bulb_mat != null:
		_bulb_mat.emission_energy_multiplier = 3.0 if on else 0.0


## Where the real light for this post goes: just under the bulb.
func light_position() -> Vector3:
	return global_position + global_transform.basis * Vector3(0, 6.6, -1.3)
