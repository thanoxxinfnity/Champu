class_name MatchController
extends Node
## Runs a best-of-N match between two Fighters: round timer, KO / time-out win, scores, reset between rounds. Also wires a fighter's
## ultimate to the arena (DestructionManager swap) so the fight and the destruction system meet in one place.

signal round_started(n: int)
signal round_ended(winner: Fighter)   # null = draw
signal match_ended(winner: Fighter)

@export var a: Fighter
@export var b: Fighter
@export var round_time := 99.0
@export var rounds_to_win := 2
@export var spawn_a := Vector3(-3, 0, 0)
@export var spawn_b := Vector3(3, 0, 0)
@export var destruction: Node       ## DestructionManager (optional)
@export var void_manager: Node      ## InfiniteVoidManager (optional)

var wins := {}
var round_no := 0
var time_left := 0.0
var running := false

func _ready() -> void:
	if a != null and b != null:
		setup(a, b)

func setup(fa: Fighter, fb: Fighter) -> void:
	a = fa
	b = fb
	a.opponent = b
	b.opponent = a
	wins = {a: 0, b: 0}
	for f in [a, b]:
		if not f.ko.is_connected(_on_ko.bind(f)):
			f.ko.connect(_on_ko.bind(f))
		f.ultimate_used.connect(_on_ultimate.bind(f))
	start_round()

func start_round() -> void:
	round_no += 1
	a.reset_round(spawn_a)
	b.reset_round(spawn_b)
	if destruction != null and destruction.has_method("reset_arena"):
		destruction.call("reset_arena")
	if void_manager != null and void_manager.get("active"):
		void_manager.call("deactivate")
	time_left = round_time
	running = true
	round_started.emit(round_no)

func _process(delta: float) -> void:
	if not running:
		return
	time_left -= delta
	if time_left <= 0.0:
		var w: Fighter = null
		if a.health > b.health:
			w = a
		elif b.health > a.health:
			w = b
		_end_round(w)

func _on_ko(loser: Fighter) -> void:
	if running:
		_end_round(b if loser == a else a)

func _end_round(w: Fighter) -> void:
	running = false
	if w != null:
		wins[w] += 1
	round_ended.emit(w)
	for f in [a, b]:
		if wins[f] >= rounds_to_win:
			match_ended.emit(f)
			return

func _on_ultimate(move: Dictionary, user: Fighter) -> void:
	# a big hit shakes the arena apart; Gojo-style users can instead open a domain
	if destruction != null and destruction.has_method("on_ultimate_hit"):
		destruction.call("on_ultimate_hit", user.opponent.global_position if user.opponent != null else user.global_position)
	if void_manager != null and user.has_meta("domain") and user.get_meta("domain") == "infinite_void":
		void_manager.call("activate", Vector3.ZERO)
