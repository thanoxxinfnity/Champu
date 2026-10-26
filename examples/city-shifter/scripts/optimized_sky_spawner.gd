class_name OptimizedSkySpawner
extends Node3D
## The sky siege: blocks of debris rain on the train. Built for a 4 GB phone:
##  · exactly DEBRIS_CAP (50) rigid bodies are made once and recycled — a block is "freed" by going back into the pool (nothing is allocated while playing);
##  · a block is released when it falls below Y -10, when it has been carried more than 50 m behind the train, or after 15 s;
##  · a block that has left the roof stops being a rigid body: it becomes a cheap kinematic faller that drifts back with the world;
##  · a block off screen for a few seconds on its way down is released early (VisibleOnScreenNotifier3D);
##  · blocks are plain boxes in 6 cached colours (a handful of draw calls), shards on impact are the Fx multimesh.
## The host decides what rains (`spawned` is replicated to the other phones, which simulate the same block locally).

signal spawned(id: int, pos: Vector3, size: float, vel: Vector3, color_i: int)
signal broken(pos: Vector3, size: float, color: Color)
signal incoming(landing: Vector3, eta: float)

const CRATES := ["res://assets/props/crate_a.glb"]
const COLORS := [Color(0.95, 0.35, 0.3), Color(1.0, 0.7, 0.2), Color(0.35, 0.8, 0.5), Color(0.3, 0.65, 1.0), Color(0.75, 0.45, 1.0), Color(0.9, 0.9, 0.95)]

class Debris:
	extends RigidBody3D
	var id := -1
	var size := 1.0
	var color_i := 0
	var age := 0.0
	var active := false
	var faller := false            # left the roof: kinematic fall
	var fall_v := 0.0
	var spin := Vector3.ZERO
	var off_screen := 0.0
	var on_screen := true
	var slowed := 0.0              # CHRONO SLIDERS: time scale of this block (0 = normal)
	var hit_cd := 0.0
	var mesh: Node3D                # holder of the crate models (two looks, one shown)
	var looks: Array[Node3D] = []
	var shape: CollisionShape3D
	var notifier: VisibleOnScreenNotifier3D

var world: TrainWorld
var fx: Fx
var pool: Array[Debris] = []
var active: Array[Debris] = []
var rate := 0.9                    # blocks per second at difficulty 1
var difficulty := 1.0
var enabled := true
var authority := true              # false on a client: it only spawns what the host tells it to
var focus_z := -10.0               # where the rain is centred (the players' average z, set by the game)
var cull_offscreen := true
var _next_id := 1
var _acc := 0.0
var _rng := RandomNumberGenerator.new()
var _shared_box := BoxMesh.new()
var impacts := 0


func _ready() -> void:
	_rng.randomize()
	_shared_box.size = Vector3.ONE
	for i in Data.DEBRIS_CAP:
		pool.append(_make())


func _make() -> Debris:
	var d := Debris.new()
	d.collision_layer = 2
	d.collision_mask = 1
	d.mass = 2.0
	d.gravity_scale = 1.0
	d.linear_damp = 0.05
	d.angular_damp = 0.4
	d.contact_monitor = true
	d.max_contacts_reported = 1
	d.can_sleep = true
	d.mesh = Node3D.new()
	d.add_child(d.mesh)
	for path in CRATES:
		var look := ModelKit.fitted(path, 1.0, "center")      # a 1 m crate; the whole holder is scaled to the block's size
		if look == null:
			look = Node3D.new()
			var box := MeshInstance3D.new()
			box.mesh = _shared_box
			look.add_child(box)
		look.visible = false
		d.mesh.add_child(look)
		d.looks.append(look)
	d.shape = CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3.ONE
	d.shape.shape = bs
	d.add_child(d.shape)
	d.notifier = VisibleOnScreenNotifier3D.new()
	d.notifier.aabb = AABB(Vector3(-0.8, -0.8, -0.8), Vector3(1.6, 1.6, 1.6))
	d.notifier.screen_entered.connect(func() -> void: d.on_screen = true)
	d.notifier.screen_exited.connect(func() -> void: d.on_screen = false)
	d.add_child(d.notifier)
	d.body_entered.connect(_on_hit.bind(d))
	add_child(d)
	_park(d)
	return d


func _park(d: Debris) -> void:
	d.active = false
	d.faller = false
	d.freeze = true
	d.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	d.visible = false
	d.shape.set_deferred("disabled", true)
	d.global_position = Vector3(0, -400, 0)
	d.linear_velocity = Vector3.ZERO
	d.angular_velocity = Vector3.ZERO


func active_count() -> int:
	return active.size()


## Starts one block. Returns null at the cap.
func spawn_block(pos: Vector3, size: float, vel: Vector3, color_i: int, id := -1) -> Debris:
	if pool.is_empty():
		return null
	var d: Debris = pool.pop_back()
	d.id = id if id >= 0 else _next_id
	_next_id = maxi(_next_id, d.id + 1)
	d.size = size
	d.color_i = color_i % COLORS.size()
	d.age = 0.0
	d.faller = false
	d.fall_v = 0.0
	d.off_screen = 0.0
	d.slowed = 0.0
	d.hit_cd = 0.0
	d.on_screen = true
	d.active = true
	d.visible = true
	d.mesh.scale = Vector3.ONE * size
	for k in d.looks.size():
		d.looks[k].visible = k == d.color_i % d.looks.size()
	(d.shape.shape as BoxShape3D).size = Vector3.ONE * size
	d.mass = 1.0 + size * size
	d.freeze = false
	d.shape.set_deferred("disabled", false)
	d.global_position = pos
	d.rotation = Vector3(_rng.randf(), _rng.randf(), _rng.randf()) * TAU
	d.linear_velocity = vel
	d.angular_velocity = Vector3(_rng.randf_range(-3, 3), _rng.randf_range(-3, 3), _rng.randf_range(-3, 3))
	active.append(d)
	return d


## Host: choose a block for the rain and tell everybody.
func rain_one() -> void:
	var span := Vector2(-Data.CAR_W * 0.5 + 0.4, Data.CAR_W * 0.5 - 0.4)
	var pos := Vector3(_rng.randf_range(span.x, span.y), _rng.randf_range(30.0, 38.0), clampf(focus_z + _rng.randf_range(-14.0, 14.0), -85.0, -2.0))
	var size := _rng.randf_range(0.7, 1.5) + minf(difficulty * 0.08, 0.5)
	var vel := Vector3(0, -_rng.randf_range(6.0, 11.0) - difficulty, 0)
	var ci := _rng.randi() % COLORS.size()
	var d := spawn_block(pos, size, vel, ci)
	if d == null:
		return
	spawned.emit(d.id, pos, size, vel, ci)
	incoming.emit(Vector3(pos.x, Data.DECK_Y, pos.z), 2.2)


func _physics_process(delta: float) -> void:
	if not authority:
		_follow(delta)
		return
	if enabled and authority:
		_acc += delta * rate * (0.6 + difficulty * 0.4)
		while _acc >= 1.0:
			_acc -= 1.0
			if active.size() < Data.DEBRIS_CAP:
				rain_one()
	var i := active.size() - 1
	while i >= 0:
		var d := active[i]
		d.age += delta
		d.hit_cd = maxf(0.0, d.hit_cd - delta)
		var dt := delta * (0.25 if d.slowed > 0.0 else 1.0)
		d.slowed = maxf(0.0, d.slowed - delta)
		var pos := d.global_position
		if not d.faller and pos.y < Data.DECK_Y - 0.9:
			_to_faller(d)
		if d.faller:
			d.fall_v += 22.0 * dt
			d.global_position += Vector3(0, -d.fall_v * dt, (world.speed if world != null else Data.TRAIN_SPEED) * dt)
			d.rotation += d.spin * dt
			pos = d.global_position
		if _should_release(d, pos):
			_release(d)
		elif cull_offscreen and not d.on_screen:
			d.off_screen += delta
			if d.faller and d.off_screen > 2.5:
				_release(d)
		else:
			d.off_screen = 0.0
		i -= 1


func _to_faller(d: Debris) -> void:
	d.faller = true
	d.fall_v = maxf(0.0, -d.linear_velocity.y)
	d.spin = d.angular_velocity
	d.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	d.freeze = true
	d.shape.set_deferred("disabled", true)


## The three rules (plus a sanity bound at the sides).
func _should_release(d: Debris, pos: Vector3) -> bool:
	return pos.y < Data.DEBRIS_FLOOR or pos.z > Data.DEBRIS_BEHIND or d.age > Data.DEBRIS_TTL or absf(pos.x) > 140.0


func _release(d: Debris) -> void:
	var k := active.find(d)
	if k >= 0:
		active.remove_at(k)
	_park(d)
	pool.append(d)


func release_all() -> void:
	for d in active.duplicate():
		_release(d)


func _on_hit(body: Node, d: Debris) -> void:
	if d.active and not d.faller and d.linear_velocity.length() > 5.0 and fx != null:
		impacts += 1
		fx.shards(d.global_position + Vector3(0, -d.size * 0.4, 0), COLORS[d.color_i], 5, 4.0)


## Break one block into shards (a weapon did it). The coins are the game's business (signal).
func shatter(d: Debris) -> void:
	if not d.active:
		return
	if fx != null:
		fx.shards(d.global_position, COLORS[d.color_i], 12, 7.0)
	broken.emit(d.global_position, d.size, COLORS[d.color_i])
	_release(d)


# ── queries for the weapons ──────────────────────────────────────────────────

func in_sphere(center: Vector3, radius: float) -> Array[Debris]:
	var out: Array[Debris] = []
	for d in active:
		if d.global_position.distance_to(center) <= radius + d.size * 0.5:
			out.append(d)
	return out


func in_cone(origin: Vector3, dir: Vector3, range_m: float, half_angle_deg: float) -> Array[Debris]:
	var out: Array[Debris] = []
	var cosv := cos(deg_to_rad(half_angle_deg))
	for d in active:
		var to := d.global_position - origin
		var dist := to.length()
		if dist > range_m or dist < 0.01:
			continue
		if to.normalized().dot(dir) >= cosv:
			out.append(d)
	return out


func on_line(origin: Vector3, dir: Vector3, range_m: float, radius: float) -> Array[Debris]:
	var out: Array[Debris] = []
	for d in active:
		var to := d.global_position - origin
		var t := to.dot(dir)
		if t < 0.0 or t > range_m:
			continue
		if (to - dir * t).length() <= radius + d.size * 0.5:
			out.append(d)
	return out


## Push a block: the force goes to the body when it is still a rigid body; a faller only gets a nudge (it is leaving anyway).
func push(d: Debris, impulse: Vector3) -> void:
	if d.faller:
		d.fall_v = maxf(0.0, d.fall_v - impulse.y * 0.1)
		return
	d.freeze = false
	d.apply_central_impulse(impulse * d.mass)


## Blocks that hit a player: moving fast, close, not just hit. Returns the blocks (the player takes the damage and the knockback).
func hits_on(pos: Vector3, radius: float) -> Array[Debris]:
	var out: Array[Debris] = []
	for d in active:
		if d.faller or d.hit_cd > 0.0:
			continue
		if d.linear_velocity.length() < 4.0:
			continue
		if d.global_position.distance_to(pos + Vector3(0, 0.9, 0)) <= radius + d.size * 0.5:
			d.hit_cd = 0.6
			out.append(d)
	return out


# ── replication (host -> clients) ────────────────────────────────────────────

const STRIDE := 9           # id, x, y, z, size, color, rx, ry, rz

## The host's blocks as one flat array (cheap to send at ~8 Hz).
func pack_snapshot() -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for d in active:
		var r := d.global_rotation
		out.append_array(PackedFloat32Array([float(d.id), d.global_position.x, d.global_position.y, d.global_position.z, d.size, float(d.color_i), r.x, r.y, r.z]))
	return out


var _targets := {}          # id -> [pos, rot, last_seen]
var _clock := 0.0


## A client: blocks the host does not list any more go away; the others are created or steered to the new place.
func apply_snapshot(p: PackedFloat32Array) -> void:
	_clock += 0.0
	var seen := {}
	var i := 0
	while i + STRIDE <= p.size():
		var id := int(p[i])
		seen[id] = true
		var pos := Vector3(p[i + 1], p[i + 2], p[i + 3])
		var rot := Vector3(p[i + 6], p[i + 7], p[i + 8])
		var d := _by_id(id)
		if d == null:
			d = spawn_block(pos, p[i + 4], Vector3.ZERO, int(p[i + 5]), id)
			if d != null:
				d.freeze = true
				d.shape.set_deferred("disabled", true)
		if d != null:
			_targets[id] = [pos, rot, Time.get_ticks_msec()]
		i += STRIDE
	for d in active.duplicate():
		if not seen.has(d.id):
			_targets.erase(d.id)
			if fx != null:
				fx.shards(d.global_position, COLORS[d.color_i], 6, 5.0)
			_release(d)


func _by_id(id: int) -> Debris:
	for d in active:
		if d.id == id:
			return d
	return null


func _follow(delta: float) -> void:
	for d in active:
		var t: Array = _targets.get(d.id, [])
		if t.is_empty():
			continue
		d.global_position = d.global_position.lerp(t[0], minf(1.0, delta * 14.0))
		d.global_rotation = Vector3(lerp_angle(d.global_rotation.x, t[1].x, minf(1.0, delta * 10.0)), lerp_angle(d.global_rotation.y, t[1].y, minf(1.0, delta * 10.0)), lerp_angle(d.global_rotation.z, t[1].z, minf(1.0, delta * 10.0)))
