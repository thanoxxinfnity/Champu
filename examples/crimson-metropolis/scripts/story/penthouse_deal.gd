class_name PenthouseDeal
extends Node
## Mission 1 — "The Penthouse Deal". Vance, a fixer, waits in the Crimson Tower's penthouse. Ride up, hear him out, fetch the
## briefcase from the executive floor (the alarm trips), and get off the roof on his helicopter.
##
## The stage number lives in GameState so a save resumes mid-mission.

enum Stage { IDLE, GO_TO_TOWER, TO_PENTHOUSE, TALK, GET_BRIEFCASE, ESCAPE, BOARD, DONE = 99 }

const REWARD := 25000
const TOWER_ARRIVE_RADIUS := 14.0

var world: World
var director: Director
var tower: Tower
var vance: Node3D
var talk_trigger: UseTrigger
var case_trigger: UseTrigger
var heli_trigger: UseTrigger
var helicopter: Node3D
var has_case := false
var lines_said: Array[String] = []
var _talking := false


func setup(w: World, dir: Director) -> void:
	world = w
	director = dir
	tower = w.tower
	_build_vance()
	_build_case_trigger()
	_build_helicopter()
	if stage() != Stage.IDLE and stage() != Stage.DONE:
		_announce()


func stage() -> int:
	return director.state.mission_stage


func _set_stage(s: int) -> void:
	director.state.mission_stage = s
	director.state.changed.emit()
	_announce()


func start() -> void:
	if stage() != Stage.IDLE:
		return
	_set_stage(Stage.GO_TO_TOWER)
	director.hud.toast("Mission: The Penthouse Deal", 3.0)


# ── what the player sees ──────────────────────────────────────────────────────

func objective_text() -> String:
	match stage():
		Stage.GO_TO_TOWER: return "Go to the Crimson Tower."
		Stage.TO_PENTHOUSE: return "Take the elevator to the Luxury Penthouse [29]."
		Stage.TALK: return "Talk to Vance."
		Stage.GET_BRIEFCASE: return "Take the briefcase from the Executive Floor [15]."
		Stage.ESCAPE: return "Get to the rooftop helipad [R]."
		Stage.BOARD: return "Board Vance's helicopter."
	return ""


func objective_pos() -> Vector3:
	match stage():
		Stage.GO_TO_TOWER: return tower.to_global(Vector3(0, 0, 30))
		Stage.TO_PENTHOUSE, Stage.GET_BRIEFCASE: return tower.elevator.global_position
		Stage.TALK: return vance.global_position
		Stage.ESCAPE, Stage.BOARD: return tower.heli_pad.global_position
	return Vector3.INF


func _announce() -> void:
	director.hud.set_objective(objective_text(), objective_pos())


# ── the cast and props ────────────────────────────────────────────────────────

func _build_vance() -> void:
	var m := Rig.make_character(1.80, Rig.spec_for("npc_business"))
	var holder := Node3D.new()
	holder.name = "Vance"
	tower.add_child(holder)
	holder.position = tower.boss_spot.position
	holder.rotation.y = PI * 0.85
	if m != null:
		holder.add_child(m)
		var anim := m.get_meta("anim") as AnimationPlayer
		anim.play("idle")
	vance = holder
	talk_trigger = UseTrigger.new()
	talk_trigger.prompt = "E - Talk to Vance"
	talk_trigger.radius = 1.6
	talk_trigger.position = holder.position + Vector3(0, 1.0, 0)
	talk_trigger.enabled_check = func(_p): return stage() == Stage.TALK and not _talking
	talk_trigger.callback = func(_p): talk()
	tower.add_child(talk_trigger)


func _build_case_trigger() -> void:
	case_trigger = UseTrigger.new()
	case_trigger.prompt = "E - Take Briefcase"
	case_trigger.radius = 1.6
	case_trigger.position = tower.briefcase_spot.position + Vector3(0, 0.2, 0.9)
	case_trigger.enabled_check = func(_p): return stage() == Stage.GET_BRIEFCASE
	case_trigger.callback = func(_p): take_case()
	tower.add_child(case_trigger)


func _build_helicopter() -> void:
	var scene := load(Data.model_path("helicopter")) as PackedScene
	if scene != null:
		helicopter = scene.instantiate() as Node3D
		tower.add_child(helicopter)
		ModelFit.place_by_largest(helicopter, 11.0, 0.0, tower.heli_pad.position.y + 0.1, false)
		helicopter.position += Vector3(tower.heli_pad.position.x, 0, tower.heli_pad.position.z)
		ModelFit.collider_for(helicopter)
	heli_trigger = UseTrigger.new()
	heli_trigger.prompt = "E - Board Helicopter"
	heli_trigger.radius = 2.4
	heli_trigger.position = tower.heli_pad.position + Vector3(4.2, 1.0, 0)
	heli_trigger.enabled_check = func(_p): return stage() == Stage.BOARD
	heli_trigger.callback = func(_p): complete()
	tower.add_child(heli_trigger)


# ── beats ─────────────────────────────────────────────────────────────────────

func _say(line: String, seconds := 3.4) -> void:
	lines_said.append(line)
	director.hud.toast(line, seconds)
	await get_tree().create_timer(seconds).timeout


func talk() -> void:
	if stage() != Stage.TALK or _talking:
		return
	_talking = true
	await _say("Vance: You came. Good. Sit down — no, don't.", 3.0)
	await _say("Vance: Floor fifteen. A briefcase on the executive desk. Mine, as far as I'm concerned.", 4.0)
	await _say("Vance: The alarm will go the second you lift it. I'll be on the roof with the helicopter.", 4.0)
	_talking = false
	_set_stage(Stage.GET_BRIEFCASE)


func take_case() -> void:
	if stage() != Stage.GET_BRIEFCASE:
		return
	has_case = true
	var held := tower.briefcase_spot.get_child(0) if tower.briefcase_spot.get_child_count() > 0 else null
	if held != null:
		held.visible = false
	director.state.raise_stars(2)
	director.hud.toast("ALARM! Security has called the police. Get to the roof.", 3.5)
	_set_stage(Stage.ESCAPE)


func complete() -> void:
	if stage() != Stage.BOARD:
		return
	director.state.add_cash(REWARD)
	director.state.set_stars(0)
	_set_stage(Stage.DONE)
	director.hud.set_objective("")
	director.hud.toast("MISSION PASSED — The Penthouse Deal   +$%s" % Hud._commas(REWARD), 5.0)
	director.state.save()


# ── progress watching ─────────────────────────────────────────────────────────

func _process(_delta: float) -> void:
	if director == null or director.player == null:
		return
	var pp := director.player.global_position
	var up := pp - tower.global_position
	match stage():
		Stage.GO_TO_TOWER:
			if Vector2(up.x, up.z).length() < TOWER_ARRIVE_RADIUS + 20.0:
				_set_stage(Stage.TO_PENTHOUSE)
		Stage.TO_PENTHOUSE:
			if _on_stop(pp, 2):
				_set_stage(Stage.TALK)
		Stage.ESCAPE:
			if _on_stop(pp, 3):
				_set_stage(Stage.BOARD)
	# Objective marker follows the moving target (the lift for the floors, Vance, the pad).
	if stage() != Stage.IDLE and stage() != Stage.DONE:
		director.hud.objective_pos = objective_pos()


## Standing on the floor of the given stop (a metre or two above it either way).
func _on_stop(pp: Vector3, stop: int) -> bool:
	var y: float = tower.global_position.y + tower.elevator.stop_y(stop)
	var up := pp - tower.global_position
	return absf(pp.y - y) < 1.5 and absf(up.x) < 18.0 and absf(up.z) < 20.0
