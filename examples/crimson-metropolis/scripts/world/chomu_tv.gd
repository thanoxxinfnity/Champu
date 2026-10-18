class_name ChomuTv
extends Node3D
## A wall TV whose screen loops a Chomugiri ad (a mock chat app typing out, then the wordmark card) — drawn pixel by pixel into
## a small image, no font needed. The screen faces local +Z; the node's origin is the middle of the screen.

const W := 256
const H := 160
const FPS := 10.0
const AD_SECONDS := 7.0
const CARD_SECONDS := 3.0

var size := Vector2(1.5, 0.88)         # screen size in metres
var on := true

var _img := Image.create(W, H, false, Image.FORMAT_RGBA8)
var _tex: ImageTexture
var _t := 0.0
var _acc := 0.0
var _mat: StandardMaterial3D
var _glow: OmniLight3D


func _ready() -> void:
	var bezel := MeshInstance3D.new()
	var bb := BoxMesh.new()
	bb.size = Vector3(size.x + 0.08, size.y + 0.08, 0.05)
	bezel.mesh = bb
	bezel.material_override = Builder.mat(Color(0.04, 0.04, 0.05), 0.35, 0.4)
	bezel.position.z = -0.03
	add_child(bezel)

	_tex = ImageTexture.create_from_image(_img)
	_mat = StandardMaterial3D.new()
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.albedo_texture = _tex
	var screen := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = size
	screen.mesh = pm
	screen.material_override = _mat
	screen.rotation_degrees.x = 90.0
	screen.position.z = 0.0
	screen.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(screen)

	_glow = OmniLight3D.new()
	_glow.light_color = Color(0.75, 0.82, 1.0)
	_glow.light_energy = 0.6
	_glow.omni_range = 5.0
	_glow.position = Vector3(0, 0, 0.8)
	add_child(_glow)
	_draw()


func set_on(v: bool) -> void:
	on = v
	_glow.visible = v
	_draw()


func _process(delta: float) -> void:
	if not on:
		return
	_t += delta
	_acc += delta
	if _acc >= 1.0 / FPS:
		_acc = 0.0
		_draw()


func _draw() -> void:
	if not on:
		_img.fill(Color(0.02, 0.025, 0.03))
	else:
		var cycle := fmod(_t, AD_SECONDS + CARD_SECONDS)
		if cycle < AD_SECONDS:
			_ad(cycle)
		else:
			_card()
	_tex.update(_img)


func _ad(t: float) -> void:
	_img.fill(Color(0.07, 0.065, 0.08))
	var card := Rect2i(84, 10, 88, 128)
	_img.fill_rect(card, Color(0.12, 0.12, 0.15))
	_img.fill_rect(Rect2i(card.position.x + 4, card.position.y + 4, card.size.x - 8, 14), Color(1.0, 0.54, 0.24))
	var rows := [[0.55, false], [0.75, true], [0.4, false], [0.65, true]]
	var reveal: float = fmod(t * 0.7, 1.0) * rows.size()
	for i in range(rows.size()):
		if float(i) > reveal:
			continue
		var frac: float = clampf(reveal - float(i), 0.0, 1.0)
		var wf: float = rows[i][0]
		var mine: bool = rows[i][1]
		var bw := int(card.size.x * 0.72 * wf * frac)
		if bw < 4:
			continue
		var by := card.position.y + 28 + i * 24
		var bx := card.position.x + card.size.x - 6 - bw if mine else card.position.x + 6
		_img.fill_rect(Rect2i(bx, by, bw, 14), Color(1.0, 0.6, 0.35) if mine else Color(0.75, 0.78, 0.85))
	_img.fill_rect(Rect2i(0, H - 28, W, 28), Color(0.05, 0.04, 0.035))
	_img.fill_rect(Rect2i(14, H - 20, 118, 12), Color(1.0, 0.54, 0.24))
	_img.fill_rect(Rect2i(150, H - 17, 92, 6), Color(0.85, 0.82, 0.78))


func _card() -> void:
	_img.fill(Color(0.09, 0.07, 0.06))
	_img.fill_rect(Rect2i(48, 68, 160, 20), Color(1.0, 0.54, 0.24))
	_img.fill_rect(Rect2i(70, 96, 116, 8), Color(0.96, 0.85, 0.74))
