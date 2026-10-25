class_name Interactable
extends Node3D
## Anything the player can use: loot, the generator, the workbench, a locked door, a note, a prisoner. Shows a bobbing glint while usable.

var kind := "loot"
var value := ""             # item id for loot, note index for notes, ally slot for allies ...
var label := "Use"
var radius := 2.1
var used := false
var enabled := true
var count := 1
var key := ""             # world-loot slot, so a pickup is remembered across retries and saves
var _glint: MeshInstance3D
var _t := randf() * 6.0
var _base_y := 0.0


func setup(k: String, v: String, text: String, r := 2.1) -> void:
	kind = k
	value = v
	label = text
	radius = r


func add_glint(color := Color(1.0, 0.8, 0.45), y := 0.7) -> void:
	_glint = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.09
	sm.height = 0.18
	sm.radial_segments = 6
	sm.rings = 3
	_glint.mesh = sm
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = 2.5
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_glint.material_override = m
	_glint.position.y = y
	_base_y = y
	_glint.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_glint)


func _process(delta: float) -> void:
	if _glint != null:
		_t += delta
		_glint.position.y = _base_y + sin(_t * 2.4) * 0.07
		_glint.visible = enabled and not used


func usable() -> bool:
	return enabled and not used
