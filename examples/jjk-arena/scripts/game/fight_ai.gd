class_name FightAI
extends Node
## Drives a Fighter with the same `intent` dictionary the touch controls fill in. A small state machine:
## approach -> pressure (combo) -> retreat when hurt / low guard -> punish when the opponent is stunned or recovering.

enum Level { EASY, NORMAL, HARD }

@export var fighter: Fighter
@export var level := Level.NORMAL
var _think := 0.0
var _mode := "approach"
var _mode_t := 0.0
var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.randomize()

func _reaction() -> float:
	return [0.55, 0.3, 0.14][level]

func _physics_process(delta: float) -> void:
	if fighter == null or fighter.opponent == null:
		return
	var f := fighter
	var o := f.opponent
	var i := {"move": Vector2.ZERO, "light": false, "heavy": false, "special": false, "ultimate": false, "dodge": false, "block": false, "domain": false, "skill2": false}
	if not f.is_alive() or not o.is_alive():
		f.intent = i
		return
	_think -= delta
	_mode_t -= delta
	var to := o.global_position - f.global_position
	to.y = 0.0
	var dist := to.length()
	var dir := to.normalized() if dist > 0.01 else Vector3.FORWARD
	if _think <= 0.0:
		_think = _reaction() * _rng.randf_range(0.7, 1.3)
		_choose_mode(dist)
	match _mode:
		"approach":
			i["move"] = Vector2(dir.x, dir.z)
		"retreat":
			i["move"] = Vector2(-dir.x, -dir.z)
			if _rng.randf() < 0.25 * (level + 1) * 0.3:
				i["dodge"] = true
		"strafe":
			i["move"] = Vector2(-dir.z, dir.x) * (1.0 if int(_mode_t * 2.0) % 2 == 0 else -1.0)
		"block":
			i["block"] = true
		"attack":
			if dist > 1.5:
				i["move"] = Vector2(dir.x, dir.z)
			else:
				_pick_attack(i, dist)
	f.intent = i

func _choose_mode(dist: float) -> void:
	var f := fighter
	var o := f.opponent
	var hurt := f.health < 30.0
	var punish := o.state == Fighter.State.HIT or (o.state == Fighter.State.ATTACK and o._phase == 2)
	var r := _rng.randf()
	if punish and dist < 2.5:
		_mode = "attack"
	elif o.state == Fighter.State.ATTACK and o._phase < 2 and dist < 2.4:
		_mode = "block" if r < 0.5 + 0.15 * level else ("retreat" if r < 0.8 else "attack")
	elif hurt and r < 0.45:
		_mode = "retreat"
	elif dist > 2.6:
		_mode = "approach"
	elif r < 0.55:
		_mode = "attack"
	elif r < 0.75:
		_mode = "strafe"
	else:
		_mode = "block"
	_mode_t = _rng.randf_range(0.4, 1.2)

func _pick_attack(i: Dictionary, dist: float) -> void:
	var f := fighter
	if f.energy >= 100.0 and level >= Level.NORMAL and _rng.randf() < 0.5:
		if _rng.randf() < 0.4:
			i["domain"] = true
		else:
			i["ultimate"] = true
	elif f.energy >= 35.0 and dist > 2.2 and _rng.randf() < 0.4:
		i["special"] = true
	elif f.energy >= 25.0 and _rng.randf() < 0.3:
		i["skill2"] = true
	elif _rng.randf() < 0.3:
		i["heavy"] = true
	else:
		i["light"] = true
