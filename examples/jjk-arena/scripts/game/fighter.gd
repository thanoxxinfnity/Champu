class_name Fighter
extends CharacterBody3D
## One combatant: health, cursed energy, a state machine (idle / move / attack / hit / dodge / block / ko) and the move set.
## Input comes from outside (`intent`), so the same body is driven by the touch controls, a keyboard or the AI.

signal hit_dealt(target: Fighter, move: Dictionary, damage: float)
signal damaged(amount: float)
signal state_changed(state: int)
signal ko
signal ultimate_used(move: Dictionary)

enum State { IDLE, MOVE, ATTACK, HIT, DODGE, BLOCK, KO }

const MOVES := {
	"light": {"damage": 6.0, "startup": 0.08, "active": 0.10, "recover": 0.18, "range": 1.6, "arc": 0.7, "cost": 0.0, "gain": 4.0, "stun": 0.25, "knock": 2.5},
	"heavy": {"damage": 14.0, "startup": 0.22, "active": 0.12, "recover": 0.38, "range": 1.9, "arc": 0.6, "cost": 0.0, "gain": 8.0, "stun": 0.5, "knock": 6.0},
	"special": {"damage": 22.0, "startup": 0.30, "active": 0.14, "recover": 0.45, "range": 6.0, "arc": 0.35, "cost": 35.0, "gain": 0.0, "stun": 0.7, "knock": 8.0},
	"ultimate": {"damage": 45.0, "startup": 0.60, "active": 0.20, "recover": 0.80, "range": 9.0, "arc": 0.25, "cost": 100.0, "gain": 0.0, "stun": 1.2, "knock": 14.0},
}
const COMBO_WINDOW := 0.45
const DODGE_TIME := 0.28
const DODGE_COOLDOWN := 0.8
const MAX_HEALTH := 100.0
const MAX_ENERGY := 100.0

@export var move_speed := 5.5
@export var fighter_name := "Fighter"
var health := MAX_HEALTH
var energy := 0.0
var state := State.IDLE
var opponent: Fighter
var intent := {"move": Vector2.ZERO, "light": false, "heavy": false, "special": false, "ultimate": false, "dodge": false, "block": false}

var _timer := 0.0
var _phase := 0            # 0 startup, 1 active, 2 recover
var _move := {}
var _move_name := ""
var _hit_done := false
var _combo := 0
var _combo_t := 0.0
var _dodge_cd := 0.0
var _kb := Vector3.ZERO
var facing := Vector3.FORWARD
var flying := false
var fly_height := 3.2
var _fly_prev := false

## What the pose animator needs: attack kind ("light1".."light3", "heavy", "special", "ultimate"), phase 0-2 and progress 0..1 inside it.
func attack_info() -> Dictionary:
	if state != State.ATTACK:
		return {}
	var total: float = [float(_move["startup"]), float(_move["active"]), float(_move["recover"])][clampi(_phase, 0, 2)]
	var kind := _move_name if _move_name != "light" else "light%d" % clampi(_combo, 1, 3)
	return {"kind": kind, "phase": _phase, "k": 1.0 - clampf(_timer / maxf(total, 0.001), 0.0, 1.0)}

func hit_progress() -> float:
	return 1.0 - clampf(_timer / 0.4, 0.0, 1.0)

func _ready() -> void:
	add_to_group("fighter")

func is_alive() -> bool:
	return state != State.KO

func face(target: Vector3) -> void:
	if not is_inside_tree():
		return
	var d := target - global_position
	d.y = 0.0
	if d.length() > 0.01:
		facing = d.normalized()
		look_at(global_position + facing, Vector3.UP)

func _physics_process(delta: float) -> void:
	if state == State.KO:
		return
	_combo_t = maxf(0.0, _combo_t - delta)
	_dodge_cd = maxf(0.0, _dodge_cd - delta)
	energy = minf(MAX_ENERGY, energy + 1.5 * delta)
	if opponent != null and opponent.is_alive() and state != State.HIT:
		face(opponent.global_position)
	var want_fly: bool = intent.get("fly", false)
	if want_fly and not _fly_prev:
		flying = not flying
	_fly_prev = want_fly
	match state:
		State.IDLE, State.MOVE:
			_free_state(delta)
		State.ATTACK:
			_attack_state(delta)
		State.HIT:
			_timer -= delta
			if _timer <= 0.0:
				_set_state(State.IDLE)
		State.DODGE:
			_timer -= delta
			velocity = _kb
			if _timer <= 0.0:
				_set_state(State.IDLE)
		State.BLOCK:
			if not intent["block"]:
				_set_state(State.IDLE)
	velocity += _kb * 0.0
	_kb = _kb.move_toward(Vector3.ZERO, 18.0 * delta) if state != State.DODGE else _kb
	if state == State.HIT:
		velocity = _kb
	var target_y := fly_height if flying else 0.0
	velocity.y = clampf((target_y - global_position.y) * 5.0, -14.0, 9.0)
	move_and_slide()

func _free_state(_delta: float) -> void:
	if intent["block"]:
		_set_state(State.BLOCK)
		velocity = Vector3.ZERO
		return
	if intent["dodge"] and _dodge_cd <= 0.0:
		var m: Vector2 = intent["move"]
		var dir := Vector3(m.x, 0, m.y)
		if dir.length() < 0.2:
			dir = -facing
		_kb = dir.normalized() * 10.0
		_timer = DODGE_TIME
		_dodge_cd = DODGE_COOLDOWN
		_set_state(State.DODGE)
		return
	for name in ["ultimate", "special", "heavy", "light"]:
		if intent[name] and _try_start(name):
			return
	var mv: Vector2 = intent["move"]
	if mv.length() > 0.1:
		velocity = Vector3(mv.x, 0, mv.y).normalized() * move_speed * (1.9 if flying else 1.0)
		_set_state(State.MOVE)
	else:
		velocity = Vector3.ZERO
		_set_state(State.IDLE)

func _try_start(name: String) -> bool:
	var m: Dictionary = MOVES[name]
	if energy < float(m["cost"]):
		return false
	energy -= float(m["cost"])
	_move = m
	_move_name = name
	_phase = 0
	_timer = float(m["startup"])
	_hit_done = false
	if name == "light":
		_combo = (_combo + 1) if _combo_t > 0.0 else 1
		_combo_t = COMBO_WINDOW + float(m["startup"]) + float(m["active"]) + float(m["recover"])
		if _combo > 3:
			_combo = 1
	velocity = Vector3.ZERO
	_set_state(State.ATTACK)
	if name == "ultimate":
		ultimate_used.emit(m)
	return true

func _attack_state(delta: float) -> void:
	velocity = facing * (2.0 if _phase == 1 else 0.0)
	_timer -= delta
	if _phase == 1 and not _hit_done:
		_try_hit()
	if _timer <= 0.0:
		_phase += 1
		match _phase:
			1: _timer = float(_move["active"])
			2: _timer = float(_move["recover"])
			_: _set_state(State.IDLE)

func _try_hit() -> void:
	if opponent == null or not opponent.is_alive():
		return
	var to := opponent.global_position - global_position
	to.y = 0.0
	if to.length() > float(_move["range"]):
		return
	if to.length() > 0.01 and facing.dot(to.normalized()) < 1.0 - float(_move["arc"]) - 0.3:
		return
	_hit_done = true
	var dmg := float(_move["damage"]) * (1.0 + 0.15 * float(maxi(0, _combo - 1)) if _move_name == "light" else 1.0)
	var dealt := opponent.receive_hit(self, _move, dmg)
	energy = minf(MAX_ENERGY, energy + float(_move["gain"]))
	hit_dealt.emit(opponent, _move, dealt)

func receive_hit(attacker: Fighter, move: Dictionary, dmg: float) -> float:
	if state == State.KO:
		return 0.0
	if state == State.DODGE:
		return 0.0                     # i-frames
	var kb_dir := (global_position - attacker.global_position)
	kb_dir.y = 0.0
	kb_dir = kb_dir.normalized() if kb_dir.length() > 0.01 else -facing
	if state == State.BLOCK and move != MOVES["ultimate"]:
		dmg *= 0.2
		_kb = kb_dir * float(move["knock"]) * 0.3
		health = maxf(0.0, health - dmg)
		damaged.emit(dmg)
		energy = minf(MAX_ENERGY, energy + 2.0)
		if health <= 0.0:
			_die()
		return dmg
	health = maxf(0.0, health - dmg)
	damaged.emit(dmg)
	energy = minf(MAX_ENERGY, energy + dmg * 0.25)
	_kb = kb_dir * float(move["knock"])
	_timer = float(move["stun"])
	if health <= 0.0:
		_die()
	else:
		_set_state(State.HIT)
	return dmg

func _die() -> void:
	flying = false
	_set_state(State.KO)
	velocity = Vector3.ZERO
	ko.emit()

func _set_state(s: int) -> void:
	if state == s:
		return
	state = s as State
	state_changed.emit(s)

func reset_round(at: Vector3) -> void:
	health = MAX_HEALTH
	energy = 0.0
	if is_inside_tree():
		global_position = at
	else:
		position = at
	velocity = Vector3.ZERO
	_kb = Vector3.ZERO
	_combo = 0
	state = State.IDLE
	state_changed.emit(State.IDLE)
