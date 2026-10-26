class_name Glob
extends Node3D
## A lob of acid from a spitter: flies in an arc to where the player stood, hurts and slows whoever it lands on, then leaves a short-lived puddle.

var game: Game
var damage := 12.0
var _from := Vector3.ZERO
var _to := Vector3.ZERO
var _t := 0.0
var _dur := 0.8
var _puddle := 0.0
var _landed := false
var _blob: MeshInstance3D


func setup(g: Game, from: Vector3, to: Vector3, dmg: float) -> void:
	game = g
	_from = from
	_to = to
	damage = dmg
	_dur = clampf(from.distance_to(to) / 14.0, 0.35, 1.0)
	position = from


func _ready() -> void:
	_blob = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.16
	sm.height = 0.32
	sm.radial_segments = 6
	sm.rings = 3
	_blob.mesh = sm
	_blob.material_override = Toon.flat(Color(0.55, 0.95, 0.35), 0.0, 0.0, Color(0.5, 1.0, 0.2), 1.6)
	add_child(_blob)


func _physics_process(delta: float) -> void:
	if _landed:
		_puddle -= delta
		var p := game.player
		if p != null and not p.dead and p.global_position.distance_to(global_position) < 1.3:
			p.slow(0.6)
		if _puddle <= 0.0:
			queue_free()
		return
	_t += delta
	var k := clampf(_t / _dur, 0.0, 1.0)
	position = _from.lerp(_to, k) + Vector3(0, sin(k * PI) * 1.6, 0)
	var p := game.player
	if p != null and not p.dead and global_position.distance_to(p.global_position + Vector3(0, 1.0, 0)) < 0.75:
		p.take_damage(damage, global_position)
		Bestiary.note("(spit)", damage)
		p.slow(2.0)
		_land()
		return
	if k >= 1.0:
		_land()


func _land() -> void:
	_landed = true
	_puddle = 3.0
	position.y = _to.y + 0.05
	_blob.scale = Vector3(3.0, 0.15, 3.0)
	game.fx.dust(global_position)
	game.sfx.play_at("hit", global_position, -6.0, 0.6)
