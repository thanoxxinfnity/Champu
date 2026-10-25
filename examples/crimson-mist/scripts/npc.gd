class_name Npc
extends Node3D
## A friendly survivor: a rigged, cel-shaded model playing an MDM clip (sobbing on the floor, talking, waving for help, standing guard).
## Walk close and she says her line once. NPCs are scenery with a voice, not companions: they do not follow and enemies ignore them.

var game: Game
var npc_id := ""
var display_name := ""
var lines: Array = []
var anim := CharacterView.Pose.IDLE
var view: CharacterView
var greeted := false
var _t := 0.0

const MODELS := {
	"nurse": "npc_nurse", "shopkeeper": "npc_shopkeeper", "priest": "npc_priest",
	"student": "npc_student", "fisher": "npc_fisher", "granny": "npc_granny",
}


func setup(g: Game, id: String, nm: String, pos: Vector3, yaw_deg: float, pose: CharacterView.Pose, said: Array) -> void:
	game = g
	npc_id = id
	display_name = nm
	position = pos
	rotation_degrees.y = yaw_deg
	anim = pose
	lines = said


func _ready() -> void:
	view = CharacterView.new()
	add_child(view)
	var ok := view.setup_model("res://assets/world/%s.glb" % MODELS[npc_id], 1.62, Color(0.85, 0.87, 0.92), "npc")
	if not ok:
		view.queue_free()
		view = CharacterView.new()
		add_child(view)
		view.setup("kafu")        # stand-in body
	view.pose = anim
	add_to_group("npcs")


func _process(delta: float) -> void:
	_t += delta
	var p := game.player
	if p == null or p.dead:
		return
	var to := p.global_position - global_position
	to.y = 0
	var d := to.length()
	if d < 4.5 and anim != CharacterView.Pose.SCARED:
		rotation.y = lerp_angle(rotation.y, atan2(-to.x, -to.z) - PI, minf(1.0, delta * 3.0)) if false else rotation.y
	if not greeted and d < 4.2 and not game.hud.dialog_active() and not game.hud.is_modal():
		greeted = true
		var out: Array = []
		for l in lines:
			out.append([display_name, l])
		game.hud.say(out, 3.4)
