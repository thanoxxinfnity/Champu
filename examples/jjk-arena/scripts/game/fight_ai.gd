class_name FightAI
extends Node
## Drives a Fighter with the same `intent` dictionary the touch controls fill in. A small state machine:
## approach (dashing in from far) -> pressure (a real combo: three lights into a launching heavy, juggles while the target is in the air)
## -> zone with techniques at mid range -> retreat when hurt -> punish when the opponent is stunned or recovering.
## It reads the opponent: blocks or side-steps a visible wind-up (better on higher levels) and never hits a fighter who is lying down.

enum Level { EASY, NORMAL, HARD }

@export var fighter: Fighter
@export var level := Level.NORMAL
var _think := 0.0
var _mode := "approach"
var _mode_t := 0.0
var _rng := RandomNumberGenerator.new()
var _fly_cd := 0.0
var _seq_i := 0              ## position in the combo string
var _seq_t := 0.0            ## time since the last combo press
var _read_cd := 0.0          ## after reacting to a wind-up, wait before reading the next one
const COMBO := ["light", "light", "light", "heavy"]

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
	_seq_t += delta
	_read_cd -= delta
	var to := o.global_position - f.global_position
	to.y = 0.0
	var dist := to.length()
	var dir := to.normalized() if dist > 0.01 else Vector3.FORWARD
	var side := Vector2(-dir.z, dir.x) * (1.0 if int(Time.get_ticks_msec() / 900) % 2 == 0 else -1.0)
	if _think <= 0.0:
		_think = _reaction() * _rng.randf_range(0.7, 1.3)
		_choose_mode(dist)
	# reading a wind-up beats everything else
	if _read_cd <= 0.0 and o.state == Fighter.State.ATTACK and o._phase == 0 and f.state in [Fighter.State.IDLE, Fighter.State.MOVE]:
		var reach := float(o._move.get("range", 1.6)) + 0.8
		if dist < reach:
			_read_cd = 0.6
			var skill: float = [0.2, 0.45, 0.7][level]
			if _rng.randf() < skill:
				if float(o._move.get("range", 1.6)) > 4.0 or o._move.get("unblockable", false):
					i["dodge"] = true                       # techniques: side-step
					i["move"] = side
				else:
					i["block"] = true
					_mode = "block"
					_mode_t = 0.35
				f.intent = i
				return
	var down: bool = o.knock == "down" or o.knock == "getup"
	match _mode:
		"approach":
			i["move"] = Vector2(dir.x, dir.z)
			if dist > 7.0 and f._dodge_cd <= 0.0 and _rng.randf() < 0.02 * (level + 1):
				i["dodge"] = true                           # dash in
		"retreat":
			i["move"] = Vector2(-dir.x, -dir.z)
			if _rng.randf() < 0.25 * (level + 1) * 0.3:
				i["dodge"] = true
		"strafe":
			i["move"] = side
		"block":
			i["block"] = true
		"zone":
			# mid range: throw a technique, otherwise keep the distance
			if not _technique(i, dist):
				i["move"] = side
		"attack":
			if down:
				i["move"] = side * 0.6                     # wait for the get-up, then punish it
			elif dist > 1.5:
				i["move"] = Vector2(dir.x, dir.z)
			else:
				_pressure(i, o)
	_fly_cd -= delta
	if o.flying != f.flying and _fly_cd <= 0.0:
		i["fly"] = true
		_fly_cd = 1.2
	if f.flying:
		i["climb"] = clampf((o.global_position.y - f.global_position.y) * 0.6, -1.0, 1.0)
	f.intent = i

func _choose_mode(dist: float) -> void:
	var f := fighter
	var o := f.opponent
	var hurt := f.health < Fighter.MAX_HEALTH * 0.3
	var punish := o.state == Fighter.State.HIT or (o.state == Fighter.State.ATTACK and o._phase == 2)
	var r := _rng.randf()
	if punish and dist < 2.5:
		_mode = "attack"
	elif hurt and r < 0.35:
		_mode = "retreat"
	elif dist > 9.0:
		_mode = "approach"
	elif dist > 3.0 and f.energy >= 25.0 and r < 0.35 + 0.1 * level:
		_mode = "zone"
	elif dist > 2.6:
		_mode = "approach"
	elif r < 0.6 + 0.1 * level:
		_mode = "attack"
	elif r < 0.85:
		_mode = "strafe"
	else:
		_mode = "block"
	_mode_t = _rng.randf_range(0.4, 1.2)

## Up close: the combo string, juggles while the target is airborne, supers when the meter is full.
func _pressure(i: Dictionary, o: Fighter) -> void:
	var f := fighter
	if f.state != Fighter.State.IDLE and f.state != Fighter.State.MOVE:
		return                                          # a press only counts when it can start a swing
	if f.energy >= 100.0 and level >= Level.NORMAL and _rng.randf() < 0.35:
		if _rng.randf() < 0.4:
			i["domain"] = true
		else:
			i["ultimate"] = true
		return
	if o.knock == "air":
		i["light"] = true                               # juggle
		return
	if _seq_t > 0.9:
		_seq_i = 0
	var easy_drop := level == Level.EASY and _seq_i >= 2   # easy bots never finish the string
	var press: String = "light" if easy_drop else COMBO[_seq_i % COMBO.size()]
	i[press] = true
	_seq_i += 1
	_seq_t = 0.0

## A ranged technique if there is meter for one; true if something was thrown.
func _technique(i: Dictionary, dist: float) -> bool:
	var f := fighter
	if f.state != Fighter.State.IDLE and f.state != Fighter.State.MOVE:
		return false
	if f.energy >= 100.0 and level >= Level.NORMAL and _rng.randf() < 0.3:
		i["ultimate"] = true
		return true
	if f.energy >= 35.0 and dist < 8.0 and _rng.randf() < 0.5:
		i["special"] = true
		return true
	if f.energy >= 25.0 and dist < 7.0 and _rng.randf() < 0.4:
		i["skill2"] = true
		return true
	return false
