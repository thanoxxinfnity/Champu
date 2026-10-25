class_name Companion
extends CharacterBody3D
## A rescued survivor who follows the player. Slot 1 is the scout (marks enemies through walls, calls out threats); slot 2 is a light fighter.
## Companions are not targeted by enemies — they keep pace, hang back in fights and snap to the player if left far behind.

var game: Game
var char_id := "kafu"
var slot := 1
var view: CharacterView
var _cd := 0.0
var _mark_t := 1.5
var _call_t := 8.0
var _path := PackedVector3Array()
var _repath := 0.0
var _swing_t := 0.0
var _side := 1.0


func setup(g: Game, id: String, s: int) -> void:
	game = g
	char_id = id
	slot = s
	_side = 1.0 if s == 1 else -1.0


func _ready() -> void:
	collision_layer = 0
	collision_mask = Data.L_WORLD
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.5
	cs.shape = cap
	cs.position.y = 0.78
	add_child(cs)
	view = CharacterView.new()
	add_child(view)
	view.setup(char_id)
	add_to_group("companions")


func _physics_process(delta: float) -> void:
	var p := game.player
	if p == null:
		return
	_cd = maxf(0.0, _cd - delta)
	_swing_t = maxf(0.0, _swing_t - delta)
	var yaw := p.yaw
	var back := Vector3(sin(yaw), 0, cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	var want := p.global_position + back * 2.2 + right * 1.9 * _side
	var to := want - global_position
	to.y = 0
	var dist := to.length()
	var far := global_position.distance_to(p.global_position)
	if far > 38.0:
		global_position = p.global_position + back * 3.0
		return
	var speed := 0.0
	if dist > 0.8 or far > 4.5:
		speed = clampf(dist * 2.4, 0.0, float(Data.CAST[char_id].speed) * 1.5)
	var dest := want
	if far > 8.0 or not game.world.nav.walkable(want):
		_repath -= delta
		if _repath <= 0.0 or _path.is_empty():
			_repath = 0.6
			_path = game.world.nav.path(global_position, p.global_position)
		while not _path.is_empty() and Vector2(_path[0].x - global_position.x, _path[0].z - global_position.z).length() < 0.8:
			_path.remove_at(0)
		if not _path.is_empty():
			dest = _path[0]
	var dir := dest - global_position
	dir.y = 0
	if speed > 0.05 and dir.length() > 0.05:
		dir = dir.normalized()
		velocity.x = move_toward(velocity.x, dir.x * speed, 22.0 * delta)
		velocity.z = move_toward(velocity.z, dir.z * speed, 22.0 * delta)
	else:
		velocity.x = move_toward(velocity.x, 0, 22.0 * delta)
		velocity.z = move_toward(velocity.z, 0, 22.0 * delta)
	velocity.y = velocity.y - 19.0 * delta if not is_on_floor() else -0.5
	move_and_slide()
	# face: the enemy being fought, else the way we walk, else where the player looks
	var target := game.nearest_enemy_to(global_position, 9.0)
	var face_yaw := view.rotation.y
	var planar := Vector2(velocity.x, velocity.z)
	if target != null and slot == 2:
		var d := target.global_position - global_position
		face_yaw = atan2(-d.x, -d.z)
	elif planar.length() > 0.4:
		face_yaw = atan2(-velocity.x, -velocity.z)
	else:
		face_yaw = yaw
	view.rotation.y = lerp_angle(view.rotation.y, face_yaw, minf(1.0, delta * 8.0))
	var sp := planar.length() / maxf(float(Data.CAST[char_id].speed), 0.1)
	view.move_speed = clampf(sp, 0.0, 1.4)
	view.ground_speed = planar.length()
	if _swing_t > 0.0:
		view.pose = CharacterView.Pose.SWING
		view.swing_phase = 1
		view.swing_k = 1.0 - _swing_t / 0.3
	elif planar.length() > float(Data.CAST[char_id].speed) * 1.1:
		view.pose = CharacterView.Pose.RUN
	elif planar.length() > 0.3:
		view.pose = CharacterView.Pose.WALK
	else:
		view.pose = CharacterView.Pose.IDLE
	_abilities(delta, target)


func _abilities(delta: float, target: Enemy) -> void:
	if slot == 1:
		_mark_t -= delta
		if _mark_t <= 0.0:
			_mark_t = 2.0
			for e in get_tree().get_nodes_in_group("enemies"):
				var en := e as Enemy
				if en.global_position.distance_to(global_position) < 26.0 and en.marked < 2.0:
					en.marked = 6.0
		_call_t -= delta
		if _call_t <= 0.0 and target != null and not game.hud.dialog_active():
			_call_t = 12.0
			var d := target.global_position - game.player.global_position
			var side := "ahead" if d.dot(game.player.facing()) > 3.0 else ("behind us" if d.dot(game.player.facing()) < -3.0 else "to the side")
			game.hud.say([[Data.CAST[char_id].name.split(" ")[0], "%s %s!" % [Data.ENEMIES[target.kind].name, side]]], 2.2)
	else:
		if target != null and _cd <= 0.0 and target.global_position.distance_to(global_position) < 2.2:
			_cd = 1.3
			_swing_t = 0.3
			target.take_damage(9.0, global_position, 1.5)
			game.sfx.play_at("swing", global_position, -4.0, 1.2)
