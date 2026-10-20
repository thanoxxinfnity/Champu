class_name Fighter
extends CharacterBody3D
## One combatant: health, cursed energy, a state machine (idle / move / attack / hit / dodge / block / ko) and the move set.
## Input comes from outside (`intent`), so the same body is driven by the touch controls, a keyboard or the AI.

signal hit_dealt(target: Fighter, move: Dictionary, damage: float)
signal damaged(amount: float)
signal state_changed(state: int)
signal ko
signal ultimate_used(move: Dictionary)
signal move_phase(move_name: String, phase: int)   ## 0 wind-up, 1 active (the projectile / slash leaves now), 2 recover
signal domain_used

enum State { IDLE, MOVE, ATTACK, HIT, DODGE, BLOCK, KO }

const MOVES := {
	"light": {"damage": 6.0, "startup": 0.08, "active": 0.10, "recover": 0.18, "range": 1.6, "arc": 0.7, "cost": 0.0, "gain": 4.0, "stun": 0.25, "knock": 2.5},
	"heavy": {"damage": 14.0, "startup": 0.22, "active": 0.12, "recover": 0.38, "range": 1.9, "arc": 0.6, "cost": 0.0, "gain": 8.0, "stun": 0.5, "knock": 6.0},
	"special": {"damage": 22.0, "startup": 0.30, "active": 0.14, "recover": 0.45, "range": 6.0, "arc": 0.35, "cost": 35.0, "gain": 0.0, "stun": 0.7, "knock": 8.0},
	"domain": {"damage": 0.0, "startup": 0.90, "active": 0.10, "recover": 0.50, "range": 0.0, "arc": 0.0, "cost": 100.0, "gain": 0.0, "stun": 0.0, "knock": 0.0},
	"skill2": {"damage": 18.0, "startup": 0.26, "active": 0.12, "recover": 0.40, "range": 6.0, "arc": 0.4, "cost": 25.0, "gain": 0.0, "stun": 0.6, "knock": 5.0},
	"ultimate": {"damage": 45.0, "startup": 0.60, "active": 0.20, "recover": 0.80, "range": 9.0, "arc": 0.25, "cost": 100.0, "gain": 0.0, "stun": 1.2, "knock": 14.0},
}
## Per-character overrides on top of MOVES. "ultimate_low" replaces the ultimate when the user is below half health.
const SETS := {
	"gojo": {
		"special": {"range": 7.0, "damage": 22.0, "knock": 9.0},                                          # Reversal: Red — blows the target away
		"skill2": {"range": 8.0, "damage": 16.0, "knock": -7.0, "stun": 0.8},                            # Lapse: Blue — drags the target in
		"ultimate": {"range": 14.0, "arc": 0.35},                                                        # Hollow Purple
		"ultimate_low": {"name": "purple200", "damage": 62.0, "range": 40.0, "arc": 0.5, "startup": 1.1, "unblockable": true, "knock": 18.0},
	},
	"sukuna": {
		"special": {"range": 8.0, "damage": 20.0, "knock": 4.0},                                         # Dismantle — ranged slashes
		"skill2": {"range": 2.8, "damage": 24.0, "knock": 3.0, "startup": 0.18, "arc": 0.6},             # Cleave — close-range, scales to the body
		"ultimate": {"range": 12.0, "arc": 0.3},                                                         # Fuga
		"ultimate_low": {"name": "world_slash", "damage": 65.0, "range": 40.0, "arc": 0.6, "startup": 1.2, "unblockable": true, "knock": 16.0},
	},
}
const COMBO_WINDOW := 0.45
const DODGE_TIME := 0.28
const DODGE_COOLDOWN := 0.8
const MAX_HEALTH := 100.0
const MAX_ENERGY := 100.0

@export var move_speed := 5.5
@export var fighter_name := "Fighter"
@export var moveset := "gojo"
var health := MAX_HEALTH
var energy := 0.0
var state := State.IDLE
var opponent: Fighter
var intent := {"move": Vector2.ZERO, "light": false, "heavy": false, "special": false, "ultimate": false, "dodge": false, "block": false, "domain": false, "skill2": false}

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
var ground_fn: Callable      ## (x, z) -> ground height; empty = flat floor at y = 0 (the arena)
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
	var floor_y: float = ground_fn.call(global_position.x, global_position.z) if ground_fn.is_valid() else 0.0
	var target_y := floor_y + (fly_height if flying else 0.0)
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
	for name in ["domain", "ultimate", "special", "skill2", "heavy", "light"]:
		if intent.get(name, false) and _try_start(name):
			return
	var mv: Vector2 = intent["move"]
	if mv.length() > 0.1:
		velocity = Vector3(mv.x, 0, mv.y).normalized() * move_speed * (1.9 if flying else 1.0)
		_set_state(State.MOVE)
	else:
		velocity = Vector3.ZERO
		_set_state(State.IDLE)

func move_for(name: String) -> Dictionary:
	var m: Dictionary = MOVES[name].duplicate()
	var set: Dictionary = SETS.get(moveset, {})
	if name == "ultimate" and health < MAX_HEALTH * 0.5 and set.has("ultimate_low"):
		m.merge(set["ultimate_low"], true)
	elif set.has(name):
		m.merge(set[name], true)
	if not m.has("name"):
		m["name"] = name
	return m

func _try_start(name: String) -> bool:
	var m := move_for(name)
	if energy < float(m["cost"]):
		return false
	energy -= float(m["cost"])
	_move = m
	_move_name = m["name"]
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
	move_phase.emit(_move_name, 0)
	return true

func _attack_state(delta: float) -> void:
	velocity = facing * (2.0 if _phase == 1 else 0.0)
	_timer -= delta
	if _phase == 1 and not _hit_done:
		_try_hit()
	if _timer <= 0.0:
		_phase += 1
		if _phase <= 2:
			move_phase.emit(_move_name, _phase)
		if _phase == 1 and _move_name == "domain":
			domain_used.emit()
		match _phase:
			1: _timer = float(_move["active"])
			2: _timer = float(_move["recover"])
			_: _set_state(State.IDLE)

func _try_hit() -> void:
	if opponent == null or not opponent.is_alive() or float(_move["range"]) <= 0.0:
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
	if state == State.BLOCK and not move.get("unblockable", false) and float(move.get("cost", 0.0)) < 100.0:
		dmg *= 0.2
		_kb = kb_dir * float(move["knock"]) * 0.3
		health = maxf(0.0, health - dmg)
		damaged.emit(dmg)
		energy = minf(MAX_ENERGY, energy + 2.0)
		if health <= 0.0:
			_die()
		return dmg
	if state == State.ATTACK and float(_move.get("cost", 0.0)) >= 100.0:
		# super armour: a domain or ultimate being cast takes the damage but is not interrupted
		health = maxf(0.0, health - dmg * 0.7)
		damaged.emit(dmg * 0.7)
		if health <= 0.0:
			_die()
		return dmg * 0.7
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

## Damage that does not come from a melee swing (domain slashes, projectiles that already resolved their aim).
func take_damage(attacker: Fighter, dmg: float, stun := 0.15, knock := 1.0) -> float:
	return receive_hit(attacker, {"damage": dmg, "stun": stun, "knock": knock, "cost": 0.0}, dmg)

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
