class_name Pedestrian
extends CharacterBody3D
## A person on the pavement. Walks a loop around its block until something frightens it — a gunshot, a crash, a car coming at it —
## then runs away from the cause. Can be hurt, can die, can be run over. Uses the same rig and animation set as the player.

signal killed(by: Node)

const WALK := 1.35
const RUN := 5.2
const FLEE_TIME := 9.0
const HEAR_GUN := 55.0
const HEAR_CRASH := 30.0
const SIDEWALK_OFFSET := 40.0     # from a block's centre to the middle of its pavement

var kind := "npc_casual"
var health := 60
var dead := false
var fleeing := false
var model: Node3D
var anim: AnimationPlayer
var cw := true
var block := Vector3.ZERO         # centre of the block it walks around
var corner := 0                   # index of the corner it is heading for
var _flee_from := Vector3.ZERO
var _flee_t := 0.0
var _gravity := 19.0
var _anim_name := &""
var _stuck := 0.0


static func make(npc_kind: String, block_center: Vector3, clockwise: bool) -> Pedestrian:
	var p := Pedestrian.new()
	p.kind = npc_kind
	p.block = block_center
	p.cw = clockwise
	p.name = "Ped_" + npc_kind
	return p


func _ready() -> void:
	add_to_group("npc")
	add_to_group("pedestrians")
	collision_layer = Data.L_DYNAMIC
	collision_mask = Data.L_WORLD
	floor_snap_length = 0.4
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.7
	cs.shape = cap
	cs.position.y = 0.85
	cs.name = "Body"
	add_child(cs)
	var cfg: Dictionary = Data.CHARACTERS[kind]
	model = Rig.make_character(cfg.height, Rig.spec_for(kind))
	if model != null:
		add_child(model)
		anim = model.get_meta("anim") as AnimationPlayer
		_play(&"idle")
	# Start at the nearest corner of the pavement loop and head for the next.
	corner = _nearest_corner()


func _corner_pos(i: int) -> Vector3:
	var k := posmod(i, 4)
	var sx := 1.0 if k == 0 or k == 1 else -1.0
	var sz := 1.0 if k == 1 or k == 2 else -1.0
	return Vector3(block.x + sx * SIDEWALK_OFFSET, global_position.y, block.z + sz * SIDEWALK_OFFSET)


func _nearest_corner() -> int:
	var best := 0
	var best_d := INF
	for i in range(4):
		var d := _corner_pos(i).distance_to(global_position)
		if d < best_d:
			best_d = d
			best = i
	return best + (1 if cw else -1)


func _play(n: StringName, speed := 1.0) -> void:
	if anim == null:
		return
	if _anim_name != n and anim.has_animation(n):
		_anim_name = n
		anim.play(n, 0.2)
	anim.speed_scale = speed


func hear_noise(pos: Vector3, gun: bool) -> void:
	if dead:
		return
	var reach := HEAR_GUN if gun else HEAR_CRASH
	if pos.distance_to(global_position) <= reach:
		scare(pos)


func scare(from: Vector3) -> void:
	if dead:
		return
	fleeing = true
	_flee_from = from
	_flee_t = FLEE_TIME


func take_hit(dmg: int, by: Node) -> void:
	if dead:
		return
	health -= dmg
	scare(by.global_position if by is Node3D else global_position)
	if health <= 0:
		die(by)


func die(by: Node) -> void:
	if dead:
		return
	dead = true
	fleeing = false
	velocity = Vector3.ZERO
	(get_node("Body") as CollisionShape3D).set_deferred("disabled", true)
	remove_from_group("pedestrians")
	if anim != null:
		anim.stop()
	var t := create_tween()
	t.tween_property(model, "rotation:x", -PI * 0.5, 0.35)
	t.parallel().tween_property(model, "position:y", 0.18, 0.35)
	killed.emit(by)
	get_tree().call_group("wanted_watch", "report_crime", &"kill_ped", global_position, by)
	get_tree().create_timer(14.0).timeout.connect(queue_free)


## Called by Vehicle: a fast car touching this pedestrian.
func run_over(by: Vehicle, speed: float) -> void:
	if dead:
		return
	if by.is_player_driven:
		get_tree().call_group("wanted_watch", "report_crime", &"hit_ped", global_position, by.driver)
	take_hit(int(20.0 + speed * 4.0), by)


func _physics_process(delta: float) -> void:
	if dead:
		return
	var player := get_tree().get_first_node_in_group("player") as Node3D
	var far := player != null and global_position.distance_to(player.global_position) > 130.0
	if model != null:
		model.visible = not far
	if not is_on_floor():
		velocity.y -= _gravity * delta
	else:
		velocity.y = 0.0
	_check_cars()
	var dir := Vector3.ZERO
	var speed := WALK
	if fleeing:
		_flee_t -= delta
		dir = global_position - _flee_from
		dir.y = 0.0
		if _flee_t <= 0.0:
			fleeing = false
		speed = RUN
	else:
		var target := _corner_pos(corner)
		dir = target - global_position
		dir.y = 0.0
		if dir.length() < 1.5:
			corner += 1 if cw else -1
			dir = _corner_pos(corner) - global_position
			dir.y = 0.0
	if dir.length() > 0.01:
		dir = dir.normalized()
		# Keep to the loop while fleeing too: slide along the pavement rather than into the road or a wall.
		var want := Vector3(dir.x * speed, velocity.y, dir.z * speed)
		velocity.x = lerpf(velocity.x, want.x, minf(1.0, 10.0 * delta))
		velocity.z = lerpf(velocity.z, want.z, minf(1.0, 10.0 * delta))
		model.rotation.y = lerp_angle(model.rotation.y, atan2(dir.x, dir.z), minf(1.0, 9.0 * delta))
	move_and_slide()
	var sp := Vector2(velocity.x, velocity.z).length()
	if fleeing:
		_stuck = _stuck + delta if sp < 0.6 else 0.0
		if _stuck > 0.7:                   # cornered against a wall: turn around
			_flee_from = global_position + (global_position - _flee_from).rotated(Vector3.UP, PI * 0.5) * 0.5
			_stuck = 0.0
	if sp < 0.3:
		_play(&"idle")
	elif fleeing:
		_play(&"run", 1.1)
	else:
		_play(&"walk", clampf(sp / 2.1, 0.5, 1.2))


## A fast car close by frightens (and, at touching distance, hurts) the pedestrian.
func _check_cars() -> void:
	for n in get_tree().get_nodes_in_group("vehicles"):
		var v := n as Vehicle
		if v == null or not is_instance_valid(v):
			continue
		var d := v.global_position.distance_to(global_position)
		if d > 9.0:
			continue
		var sp := v.linear_velocity.length()
		if sp > 5.0 and d < 7.0:
			scare(v.global_position)
		if sp > 4.0 and d < 1.7 + v.cfg.length * 0.3 and _in_car_footprint(v):
			run_over(v, sp)
			return


func _in_car_footprint(v: Vehicle) -> bool:
	var l := v.to_local(global_position)
	return absf(l.x) < 1.2 and absf(l.z) < v.cfg.length * 0.55
