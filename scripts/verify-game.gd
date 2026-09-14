# Runs a generated Godot project in the real engine and checks the rigged
# character actually animates.
#
# scripts/test-godot.mjs checks the files we write; it cannot check that Godot
# runs them. A .tscn can be perfectly valid and still produce a character that
# stands frozen because the script never found the skeleton, or one whose legs
# both swing the same way.
#
# Usage:
#   1. Write a project with a rigged model into a folder (see buildProject).
#   2. godot --headless --path <folder> --import
#   3. godot --headless --path <folder> --script verify-game.gd
#
# Prints RESULT: PASS, or the specific checks that failed.

extends SceneTree
## Frame 0 adds the scene; _ready lands a frame later, so checks start at frame 1.

var _main: Node
var _frame := 0
var _fails := 0

func _find(node: Node, type: String) -> Node:
	if node.get_class() == type:
		return node
	for child in node.get_children():
		var found := _find(child, type)
		if found != null:
			return found
	return null

func _initialize() -> void:
	_main = (load("res://main.tscn") as PackedScene).instantiate()
	get_root().add_child(_main)
	print("main.tscn instantiated")

func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < 2:
		return false

	var player := _main.get_node("Player") as CharacterBody3D
	var hero := _main.get_node("Player/Hero")
	var sk := _find(hero, "Skeleton3D") as Skeleton3D

	print("hero ready: ", hero.is_node_ready(), "   bones resolved: ", hero._bones)
	if not hero.is_node_ready():
		return false

	var legL := sk.find_bone("LegL")
	var legR := sk.find_bone("LegR")
	var armL := sk.find_bone("ArmL")

	player.velocity = Vector3.ZERO
	for i in 20:
		hero._physics_process(1.0 / 60.0)
	var still := sk.get_bone_pose_rotation(legL)
	print("standing: LegL pose = ", still)
	if not still.is_equal_approx(Quaternion.IDENTITY):
		print("FAIL: the leg did not settle to rest while standing")
		_fails += 1

	player.velocity = Vector3(5, 0, 0)
	var swing := []
	for i in 40:
		hero._physics_process(1.0 / 60.0)
		swing.append(sk.get_bone_pose_rotation(legL).get_euler().x)
	var lo: float = swing.min()
	var hi: float = swing.max()
	print("walking:  LegL swings ", snappedf(lo, 0.001), " .. ", snappedf(hi, 0.001), " rad")
	if hi - lo < 0.2:
		print("FAIL: the leg barely moved while walking")
		_fails += 1

	var l := sk.get_bone_pose_rotation(legL).get_euler().x
	var r := sk.get_bone_pose_rotation(legR).get_euler().x
	var a := sk.get_bone_pose_rotation(armL).get_euler().x
	print("gait: LegL=", snappedf(l, 0.001), " LegR=", snappedf(r, 0.001), " ArmL=", snappedf(a, 0.001))
	if absf(l) > 0.05 and signf(l) == signf(r):
		print("FAIL: both legs swing the same way")
		_fails += 1
	if absf(l) > 0.05 and signf(l) == signf(a):
		print("FAIL: the left arm swings with the left leg, not against it")
		_fails += 1

	player.velocity = Vector3(1, 0, 0)
	var slow := []
	for i in 80:
		hero._physics_process(1.0 / 60.0)
		slow.append(absf(sk.get_bone_pose_rotation(legL).get_euler().x))
	print("slow walk peaks at ", snappedf(slow.max(), 0.001), " rad vs running ", snappedf(hi, 0.001))
	if slow.max() >= hi:
		print("FAIL: walking slowly swings as far as running")
		_fails += 1

	print("RESULT: ", "PASS" if _fails == 0 else str(_fails) + " FAILURES")
	return true
