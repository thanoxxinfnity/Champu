class_name GauntletTool
extends Node3D
## The gauntlet on the player's arm. SHATTER WAVE fires the equipped weapon (15 kinds, see Data.WEAPONS: each is a `kind` handled below) — nothing here can
## hurt a person: it breaks, pushes, pulls and slows the DEBRIS. BRIDGE PLACE puts the next slab of the selected block type one step ahead (stepping on from
## the last slab, so three presses cross a coupling gap); a ghost slab shows where it lands. All the slabs are 36 pooled static bodies.

signal fired(weapon: String, origin: Vector3, dir: Vector3, point: Vector3)
signal placed(pos: Vector3, axis: int, kind: String)
signal inventory_changed
signal dropped(id: String)

const SLAB := Vector3(2.0, 0.5, 1.0)

var player: PlayerController
var weapon := "shift_gauntlet"
var block_kind := "steel"
var cd_left := 0.0
var firing_t := 0.0
var held: Node3D
var anim_t := 99.0                               # seconds since the last shot or swing (the weapon animation)
var equip_t := 1.0                               # 0..1 while a newly drawn weapon swings up into the hand
var ghost: MeshInstance3D
var slabs: Array[StaticBody3D] = []             # the pool
var live: Array[StaticBody3D] = []              # placed, oldest first
var _last_slab := Vector3.INF
var _last_slab_t := 0.0
var _axis := 0                                   # 0 = along Z (the train), 1 = along X
# timed effects
var _vortex_t := 0.0
var _vortex_col := Color.WHITE
var _vortex_at := Vector3.ZERO
var _vortex_dir := Vector3.FORWARD
var _magnet_t := 0.0
var _ring_t := 0.0
var _ring_at := Vector3.ZERO
var _grapple_to := Vector3.INF
var _grapple_t := 0.0
var _slow_t := 0.0
var shots := 0
# the match: what I carry and how full each gauntlet is (melee weapons need no charge)
var inventory: Array[String] = []
var charge := {}                                 # id -> 0..1
var locked := {}                                 # id -> true while an emptied gauntlet refills to 100 %


func _ready() -> void:
	for i in Data.BRIDGE_CAP:
		slabs.append(_make_slab())
	ghost = MeshInstance3D.new()
	ghost.mesh = Mat.box_mesh(SLAB)
	ghost.material_override = Mat.unlit(Color(0.6, 0.9, 1.0), 0.35)
	ghost.visible = false
	ghost.top_level = true
	add_child(ghost)
	equip(weapon)


func _make_slab() -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = 1
	b.collision_mask = 0
	b.top_level = true
	var mi := MeshInstance3D.new()
	mi.mesh = Mat.box_mesh(SLAB)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	b.add_child(mi)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = SLAB
	cs.shape = bs
	b.add_child(cs)
	b.set_meta("ttl", 0.0)
	b.set_meta("live", false)
	b.visible = false
	cs.disabled = true
	add_child(b)
	return b


func equip(id: String) -> void:
	if not Data.WEAPONS.has(id) and not Data.MELEE.has(id):
		return
	weapon = id
	if held != null:
		held.queue_free()
	held = WeaponModels.build(id, 1.0)
	anim_t = 99.0
	equip_t = 0.0
	if player != null and player.avatar != null:
		var h := player.avatar.height
		held.position = Vector3(0.36, h * 0.6, -0.1)
		player.avatar.holder().add_child(held)


func cooldown_for(id: String) -> float:
	if Data.MELEE.has(id):
		return float(Data.MELEE[id].cd)
	var w: Dictionary = Data.WEAPONS[id]
	return (0.25 + float(w.cd) * 1.1) * float(player.info.get("cd_mult", 1.0))


## Pick up a weapon: a new one goes into a free hand slot (the full pack swaps the one in my hand, which drops); one I already carry is simply refilled.
func give(id: String) -> bool:
	if not Data.WEAPONS.has(id) and not Data.MELEE.has(id):
		return false
	if inventory.has(id):
		charge[id] = 1.0
		locked.erase(id)
		inventory_changed.emit()
		return true
	if inventory.size() >= Data.HAND_SLOTS:
		var out := weapon if inventory.has(weapon) else inventory[inventory.size() - 1]
		inventory.erase(out)
		charge.erase(out)
		locked.erase(out)
		dropped.emit(out)
	inventory.append(id)
	charge[id] = 1.0
	equip(id)
	inventory_changed.emit()
	return true


## Everything but the free starting pair falls where I die.
func drop_all() -> Array[String]:
	var out: Array[String] = []
	for id in inventory:
		if id != "shift_gauntlet" and id != "hammer" and id != "nova_blaster":
			out.append(id)
	return out


func reset_loadout() -> void:
	inventory.clear()
	charge.clear()
	locked.clear()
	inventory.append("shift_gauntlet")
	inventory.append("hammer")
	inventory.append("nova_blaster")                 # everybody starts with the anime pistol
	charge["shift_gauntlet"] = 1.0
	charge["hammer"] = 1.0
	charge["nova_blaster"] = 1.0
	equip("shift_gauntlet")
	inventory_changed.emit()


func charge_of(id: String) -> float:
	return float(charge.get(id, 1.0))


func is_locked(id: String) -> bool:
	return bool(locked.get(id, false))


func cycle_block() -> String:
	var i := Data.BLOCK_ORDER.find(block_kind)
	block_kind = Data.BLOCK_ORDER[(i + 1) % Data.BLOCK_ORDER.size()]
	ghost.material_override = Mat.unlit(Data.BLOCKS[block_kind].color, 0.35)
	return block_kind


# ── firing ───────────────────────────────────────────────────────────────────

func fire() -> bool:
	if cd_left > 0.0 or player == null or player.stun > 0.0 or not player.alive:
		return false
	var melee := Data.MELEE.has(weapon)
	var match_on: bool = player.lethal
	if match_on and not melee and is_locked(weapon):
		player.game.toast("%s is recharging: %d s" % [String(Data.WEAPONS[weapon].name), int(ceil((1.0 - charge_of(weapon)) * Data.CHARGE_SECONDS))], 1.2)
		return false
	cd_left = cooldown_for(weapon)
	firing_t = 0.3
	player.avatar.attack_t = 0.3 if not melee else minf(0.45, cd_left * 0.7)
	player.avatar.melee_body = melee
	anim_t = 0.0
	shots += 1
	var origin := player.eye()
	var dir := player.aim_dir()
	if player.is_local and not player.is_bot:
		dir = player.assisted_dir(dir)               # Free-Fire-style lock: the shot goes at the enemy in the crosshair's cone
	if melee:
		_swing(origin, dir)
		fired.emit(weapon, origin, dir, origin + dir * float(Data.MELEE[weapon].reach))
		return true
	var w: Dictionary = Data.WEAPONS[weapon]
	if match_on:
		var left := charge_of(weapon) - float(Data.DAMAGE[weapon].cost) * float(player.info.get("cost_mult", 1.0))
		charge[weapon] = maxf(0.0, left)
		if left <= 0.001:
			locked[weapon] = true
			player.game.toast("%s is empty: 60 s to refill" % String(w.name), 1.6)
		inventory_changed.emit()
	var rng_m: float = lerpf(7.0, 42.0, float(w.range))
	var force: float = lerpf(6.0, 30.0, float(w.force))
	var point := origin + dir * rng_m
	var col: Color = w.color
	player.game.audio.play("zap" if float(w.force) < 0.6 else "zap_low", -3.0, randf_range(0.9, 1.1))
	player.game.fx.flash(_muzzle_point(), col, 0.8)
	match String(w.kind):
		"shove": _shove(origin, dir, rng_m, force, col)
		"vortex": _vortex(origin, dir, rng_m, force, col)
		"slam": _slam(rng_m, force, col)
		"carve": _line(origin, dir, rng_m, 0.7, col, true, 0.0)
		"magnet": _magnet(origin, dir, col)
		"pierce": _line(origin, dir, rng_m, 0.9, col, false, force)
		"punch": _punch(origin, dir, force, col)
		"ring": _ring(col, rng_m)
		"grapple": point = _grapple(origin, dir, rng_m, col)
		"crush": point = _crush(dir, rng_m, col)
		"beam": _line(origin, dir, rng_m, 0.4, col, true, 0.0)
		"vaporize": _vaporize(origin, dir, col)
		"slow": _slow(col)
		"tether": _tether(origin, col)
		"meteor": point = _meteor(dir, rng_m, force, col)
	_hurt(String(w.kind), origin, dir, rng_m, force, point)
	fired.emit(weapon, origin, dir, point)
	return true


## A melee swing: everybody in the arc is cut, and the heavy ones also smash blocks and trees where they land.
func _swing(origin: Vector3, dir: Vector3) -> void:
	var m: Dictionary = Data.MELEE[weapon]
	var reach: float = m.reach
	var col: Color = m.color
	var flat := Vector3(dir.x, 0.0, dir.z).normalized()
	var chest := player.global_position + Vector3(0, 1.2, 0)
	player.game.audio.play("whoosh", -4.0, randf_range(0.9, 1.2) if float(m.cd) < 0.5 else randf_range(0.6, 0.8))
	player.game.fx.slash(chest, flat, col, reach, float(m.arc))
	if player.lethal:
		var dmg: float = float(Data.DAMAGE[weapon].dmg) * float(player.info.get("melee_mult", 1.0))
		var hits := 0
		for t in Combat.in_cone(Combat.enemies(player), chest, flat, reach, float(m.arc)):
			if Combat.hurt(player, t, dmg, flat * (6.0 + dmg * 0.1) + Vector3(0, 3.5, 0)):
				player.game.fx.shards(Combat.center(t), col, 8, 6.0)
				hits += 1
		if hits > 0:
			player.game.shake(0.25 + minf(0.5, dmg * 0.005))
	if bool(m.smash):
		var p := chest + flat * reach * 0.7
		if player.spawner != null:
			for d in player.spawner.in_sphere(p, reach * 0.8):
				_shatter(d, 1)
		if player.world != null and player.world.has_method("smash"):
			if player.world.smash(p, reach * 0.9) > 0:
				player.game.shake(0.3)
		if player.world != null and player.world.has_method("damage_at"):
			if player.world.damage_at(p, reach * 0.8, float(Data.DAMAGE[weapon].dmg) * float(player.info.get("melee_mult", 1.0))) > 0:
				player.game.shake(0.35)
		player.game.fx.shards(p, col, 8, 5.0)
		player.game.fx.ring(Vector3(p.x, player.global_position.y + 0.1, p.z), col, reach * 0.8)


## What a gauntlet shot does to people (the block-breaking half is in the handlers above). Only in a match.
func _hurt(kind: String, origin: Vector3, dir: Vector3, rng_m: float, force: float, point: Vector3) -> void:
	if not player.lethal:
		return
	if player.world != null and player.world.has_method("damage_at"):
		player.world.damage_at(point, 2.2 + rng_m * 0.04, float(Data.DAMAGE[weapon].dmg) * 0.5 * float(player.info.get("dmg_mult", 1.0)))
	var dmg: float = Data.DAMAGE[weapon].dmg
	var foes := Combat.enemies(player)
	if foes.is_empty():
		return
	var up := Vector3(0, 3.5, 0)
	match kind:
		"shove":
			for t in Combat.in_cone(foes, origin, dir, rng_m * 0.55, 42.0):
				Combat.hurt(player, t, dmg, dir * force * 0.5 + up)
		"slam":
			var c := player.global_position + player.flat_forward() * 1.6
			for t in Combat.in_sphere(foes, c, lerpf(3.0, 5.5, rng_m / 42.0)):
				Combat.hurt(player, t, dmg, (Combat.center(t) - c).normalized() * force * 0.4 + up)
		"carve", "beam":
			var line := Combat.on_line(foes, origin, dir, rng_m, 0.7 if kind == "carve" else 0.4)
			if not line.is_empty():
				Combat.hurt(player, line[0], dmg, dir * 4.0)
				player.game.fx.flash(Combat.center(line[0]), Data.WEAPONS[weapon].color, 1.0)
		"pierce":
			for t in Combat.on_line(foes, origin, dir, rng_m, 0.9):
				Combat.hurt(player, t, dmg, dir * force * 0.4 + up)
		"magnet":
			for t in Combat.in_cone(foes, origin, dir, 16.0, 50.0):
				Combat.hurt(player, t, dmg, (player.global_position - t.global_position).normalized() * 11.0 + up)
		"punch":
			var c2 := Combat.in_cone(foes, origin, dir, 3.4, 45.0)
			if not c2.is_empty():
				Combat.hurt(player, c2[0], dmg, dir * force * 0.8 + Vector3(0, 5.0, 0))
		"ring":
			for t in Combat.in_sphere(foes, player.global_position, 8.0):
				Combat.hurt(player, t, dmg, (t.global_position - player.global_position).normalized() * 12.0 + up)
		"grapple":
			for t in Combat.in_sphere(foes, point, 2.6):
				Combat.hurt(player, t, dmg, (player.global_position - t.global_position).normalized() * 10.0 + up)
		"crush":
			for t in Combat.in_sphere(foes, point, 3.4):
				Combat.hurt(player, t, dmg, Vector3(0, 6.0, 0))
		"vaporize":
			for t in Combat.in_cone(foes, origin, dir, 9.0, 32.0):
				Combat.hurt(player, t, dmg, dir * 4.0)
		"slow":
			for t in Combat.in_sphere(foes, player.global_position, 12.0):
				Combat.hurt(player, t, dmg, Vector3.ZERO, 3.0)
		"tether":
			var n := 0
			for t in Combat.in_sphere(foes, origin, 26.0):
				Combat.hurt(player, t, dmg, Vector3.ZERO, 2.0)
				n += 1
				if n >= 3:
					break
		"meteor":
			for t in Combat.in_sphere(foes, point, 7.0):
				Combat.hurt(player, t, dmg, (Combat.center(t) - point).normalized() * force * 0.5 + Vector3(0, 7.0, 0))


## Everything weapons do to blocks goes through here (so coins and shatter sound stay in one place).
func _shatter(d: OptimizedSkySpawner.Debris, extra_coins := 0) -> void:
	player.spawner.shatter(d)
	if extra_coins > 0:
		player.game.add_coins(extra_coins, d.global_position)


func _beam_fx(from: Vector3, to: Vector3, col: Color, width := 0.14) -> void:
	player.game.fx.beam(from, to, col, width)


func _muzzle_point() -> Vector3:
	if held != null and is_instance_valid(held) and held.is_inside_tree():
		return held.global_transform * WeaponModels.muzzle(weapon)
	return player.eye()


func _shove(origin: Vector3, dir: Vector3, rng_m: float, force: float, col: Color) -> void:
	for d in player.spawner.in_cone(origin, dir, rng_m * 0.55, 42.0):
		var k := 1.0 - d.global_position.distance_to(origin) / (rng_m * 0.55)
		player.spawner.push(d, dir * force * (0.5 + k) + Vector3(0, 3.0, 0))
	player.game.fx.ring(_muzzle_point() + dir * 1.5, col, 3.0)


func _vortex(origin: Vector3, dir: Vector3, rng_m: float, force: float, col: Color) -> void:
	_vortex_at = origin + dir * minf(rng_m * 0.4, 9.0)
	_vortex_dir = dir
	_vortex_t = 1.1
	_vortex_col = col
	player.game.fx.ring(_vortex_at, col, 5.0)


func _slam(rng_m: float, force: float, col: Color) -> void:
	var c := player.global_position + player.flat_forward() * 1.6
	var r := lerpf(3.0, 5.5, rng_m / 42.0)
	for d in player.spawner.in_sphere(c, r):
		if d.size < 1.4:
			_shatter(d)
		else:
			player.spawner.push(d, (d.global_position - c).normalized() * force * 0.7 + Vector3(0, 6.0, 0))
	player.game.fx.ring(c + Vector3(0, 0.1, 0), col, r)
	player.game.fx.shards(c, col, 14, 7.0)
	player.game.shake(0.5)
	player.game.audio.play("boom", -8.0, 1.2)


## Beams: carve (shatter along the line), pierce (push along the line).
func _line(origin: Vector3, dir: Vector3, rng_m: float, radius: float, col: Color, shatter_all: bool, push_force: float) -> void:
	var hit := player.spawner.on_line(origin, dir, rng_m, radius)
	var n := 0
	for d in hit:
		if shatter_all:
			_shatter(d)
		else:
			if d.size < 1.0:
				_shatter(d)
			else:
				player.spawner.push(d, dir * push_force)
		n += 1
		if n >= 6:
			break
	_beam_fx(_muzzle_point(), origin + dir * rng_m, col, 0.12 + radius * 0.1)


func _magnet(origin: Vector3, dir: Vector3, col: Color) -> void:
	_magnet_t = 1.0
	player.game.fx.ring(origin + dir * 3.0, col, 4.0)


func _punch(origin: Vector3, dir: Vector3, force: float, col: Color) -> void:
	var best: OptimizedSkySpawner.Debris = null
	var bd := 5.0
	for d in player.spawner.in_cone(origin, dir, 5.0, 40.0):
		var dd := d.global_position.distance_to(origin)
		if dd < bd:
			bd = dd
			best = d
	if best != null:
		if best.size < 1.1:
			_shatter(best, 1)
		else:
			player.spawner.push(best, dir * force * 1.6 + Vector3(0, 4.0, 0))
		player.game.fx.shards(best.global_position, col, 10, 8.0)
		player.game.shake(0.3)
	player.game.fx.ring(origin + dir * 1.4, col, 2.0)


func _ring(col: Color, rng_m: float) -> void:
	_ring_at = player.global_position + Vector3(0, 0.2, 0)
	_ring_t = 0.7
	player.game.fx.ring(_ring_at, col, rng_m * 0.5)


func _grapple(origin: Vector3, dir: Vector3, rng_m: float, col: Color) -> Vector3:
	var p := target_point(rng_m)
	# a block near the hook point is pulled to you; otherwise you are pulled to the point
	var near := player.spawner.in_sphere(p, 2.0)
	if not near.is_empty():
		var d: OptimizedSkySpawner.Debris = near[0]
		player.spawner.push(d, (origin - d.global_position).normalized() * 16.0)
	else:
		_grapple_to = p
		_grapple_t = 0.9
	_beam_fx(_muzzle_point(), p, col, 0.08)
	return p


func _crush(dir: Vector3, rng_m: float, col: Color) -> Vector3:
	var p := target_point(rng_m)
	for d in player.spawner.in_sphere(p, 3.4):
		_shatter(d, 1)
	player.game.fx.ring(p, col, 3.4)
	player.game.fx.shards(p, col, 12, 6.0)
	_beam_fx(_muzzle_point(), p, col, 0.1)
	return p


func _vaporize(origin: Vector3, dir: Vector3, col: Color) -> void:
	for d in player.spawner.in_cone(origin, dir, 9.0, 32.0):
		_shatter(d, 3)
	player.game.fx.shards(origin + dir * 3.0, col, 14, 5.0)
	player.game.fx.ring(origin + dir * 3.0, col, 3.5)


func _slow(col: Color) -> void:
	_slow_t = 3.0
	player.speed_mult = 1.3
	for d in player.spawner.in_sphere(player.global_position, 12.0):
		d.slowed = 3.0
	player.game.fx.ring(player.global_position + Vector3(0, 0.2, 0), col, 12.0)


func _tether(origin: Vector3, col: Color) -> void:
	var near := player.spawner.in_sphere(origin, 26.0)
	var prev: OptimizedSkySpawner.Debris = null
	for d in near:
		player.game.fx.ring(Vector3(d.global_position.x, Data.DECK_Y + 0.05, d.global_position.z), col, 1.6)
		if prev != null and prev.global_position.distance_to(d.global_position) < 9.0:
			_beam_fx(prev.global_position, d.global_position, col, 0.06)
			player.spawner.push(prev, (d.global_position - prev.global_position).normalized() * 6.0)
			player.spawner.push(d, (prev.global_position - d.global_position).normalized() * 6.0)
		prev = d


func _meteor(dir: Vector3, rng_m: float, force: float, col: Color) -> Vector3:
	var p := target_point(rng_m)
	for d in player.spawner.in_sphere(p, 7.0):
		if d.size < 1.3:
			_shatter(d, 2)
		else:
			player.spawner.push(d, (d.global_position - p + Vector3(0, 0.5, 0)).normalized() * force)
	player.game.fx.ring(p, col, 7.0)
	player.game.fx.ring(p + Vector3(0, 0.3, 0), Color.WHITE, 4.0)
	player.game.fx.shards(p, col, 20, 10.0)
	player.game.shake(0.9)
	player.game.audio.play("boom", 0.0, 0.9)
	_beam_fx(p + Vector3(0, 18.0, 0), p, col, 0.5)
	return p


## The point a targeted weapon (grapple, crush, meteor) hits: a world hit within range, else the debris nearest to the crosshair (touch aim assist), else the
## roof where the crosshair line meets it, else ten metres ahead.
func target_point(max_range: float) -> Vector3:
	var origin := player.eye()
	var dir := player.aim_dir()
	var space := player.get_world_3d().direct_space_state
	var from := player.cam.global_position if player.cam != null else origin
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * (max_range + 4.0), 1)
	var hit := space.intersect_ray(q)
	if not hit.is_empty() and from.distance_to(hit.position) < max_range + 4.0:
		return hit.position
	var best: OptimizedSkySpawner.Debris = null
	var bd := 3.0
	for d in player.spawner.on_line(origin, dir, max_range, 2.2):
		var dd := d.global_position.distance_to(origin)
		if best == null or dd < bd or bd == 3.0:
			best = d
			bd = dd
	if best != null:
		return best.global_position
	if absf(dir.y) > 0.05:
		var t := (Data.DECK_Y - origin.y) / dir.y
		if t > 0.0 and t < max_range:
			return origin + dir * t
	return origin + dir * minf(max_range, 10.0)


# ── bridge slabs ─────────────────────────────────────────────────────────────

## Where the next slab goes (not placed): one step ahead of the last slab if it is fresh and near, else ahead of the player's feet.
func next_slab_pos() -> Vector3:
	var fwd := player.flat_forward()
	_axis = 0 if absf(fwd.z) >= absf(fwd.x) else 1
	var step := Vector3(0, 0, signf(fwd.z) * SLAB.z) if _axis == 0 else Vector3(signf(fwd.x) * SLAB.z, 0, 0)
	var feet := player.global_position
	if _last_slab != Vector3.INF and _last_slab_t < 6.0 and _last_slab.distance_to(feet) < 5.0:
		return _last_slab + step
	var base := feet + (step.normalized() * 1.7)
	var y := floorf(feet.y * 2.0) / 2.0 - SLAB.y * 0.5          # the top of the slab level with the floor under the feet
	if player.is_on_floor():
		y = feet.y - SLAB.y * 0.5
	return Vector3(snappedf(base.x, 0.5) if _axis == 0 else snappedf(base.x, SLAB.z), y, snappedf(base.z, SLAB.z) if _axis == 0 else snappedf(base.z, 0.5))


func place_bridge() -> bool:
	if player == null or player.stun > 0.0:
		return false
	return place_at(next_slab_pos(), _axis, block_kind, true)


func place_at(pos: Vector3, axis: int, kind: String, local := false) -> bool:
	var slab: StaticBody3D = null
	for s in slabs:
		if not bool(s.get_meta("live")):
			slab = s
			break
	if slab == null:
		slab = live.pop_front()                     # the oldest goes first
	if slab == null:
		return false
	_arm_slab(slab, pos, axis, kind)
	live.append(slab)
	if local:
		_last_slab = pos
		_last_slab_t = 0.0
		placed.emit(pos, axis, kind)
		player.game.audio.play("place", -2.0, 1.0 + 0.1 * float(live.size() % 3))
	player.game.fx.shards(pos, Data.BLOCKS[kind].color, 5, 3.0)
	return true


func _arm_slab(slab: StaticBody3D, pos: Vector3, axis: int, kind: String) -> void:
	slab.global_position = pos
	slab.rotation = Vector3(0, 0 if axis == 0 else PI * 0.5, 0)
	slab.visible = true
	(slab.get_child(1) as CollisionShape3D).disabled = false
	var mi := slab.get_child(0) as MeshInstance3D
	mi.material_override = Mat.flat(Data.BLOCKS[kind].color, 0.5)
	slab.set_meta("block", kind)
	slab.set_meta("live", true)
	var ttl: float = float(Data.BLOCKS[kind].ttl) * float(player.info.get("bridge_mult", 1.0)) if player != null else 20.0
	slab.set_meta("ttl", ttl)


func _free_slab(slab: StaticBody3D) -> void:
	slab.set_meta("live", false)
	slab.visible = false
	(slab.get_child(1) as CollisionShape3D).disabled = true
	slab.global_position = Vector3(0, -300, 0)
	slab.remove_meta("block")
	live.erase(slab)


func release_all() -> void:
	for s in live.duplicate():
		_free_slab(s)
	_last_slab = Vector3.INF


# ── per frame ────────────────────────────────────────────────────────────────

## The weapon in the hand every frame: it rests at the side, swings up when drawn, and moves through its shot or swing (WeaponAnim); the hero's arms
## follow the grip. A hero without a rig keeps the weapon at the fixed spot.
func _process(delta: float) -> void:
	if held == null or not is_instance_valid(held) or player == null or player.avatar == null:
		return
	anim_t += delta
	equip_t = minf(1.0, equip_t + delta / 0.35)
	var av := player.avatar
	if av.rig == null or not held.visible:
		av.grip_r = null
		av.grip_l = null
		return
	var f := WeaponAnim.frame(weapon, anim_t, av.height)
	var pos: Vector3 = f.pos
	var dir: Vector3 = f.dir
	var at_rest := anim_t >= WeaponAnim.duration(weapon)
	if at_rest:                                  # walking: the weapon sways with the stride
		pos.y += sin(Time.get_ticks_msec() * 0.011) * 0.025 * clampf(av.ground_speed / 5.0, 0.0, 1.0) * av.height / 1.75
	elif WeaponAnim.style_of(weapon) in ["shoot", "cannon"]:
		var aim := player.aim_dir()               # a shot points where the hero aims (up and down; sideways the body already faces it)
		dir = Vector3(dir.x, dir.y + aim.y * 1.1, dir.z).normalized()
	var e := equip_t
	var pop := 1.0 - pow(1.0 - e, 3.0)
	pos.y -= (1.0 - pop) * 0.55 * av.height / 1.75
	dir = dir.slerp(Vector3(0.0, -1.0, -0.2).normalized(), 1.0 - pop)
	held.transform = WeaponAnim.weapon_transform(weapon, pos, dir)
	held.scale = Vector3.ONE * lerpf(0.5, 1.0, minf(1.0, pop * 1.08))
	av.grip_r = pos
	if WeaponAnim.two_handed(weapon) and anim_t < WeaponAnim.duration(weapon) + 0.25:
		av.grip_l = pos + dir * 0.3 + Vector3(-0.05, 0.0, 0.0)
	else:
		av.grip_l = null


func _physics_process(delta: float) -> void:
	cd_left = maxf(0.0, cd_left - delta)
	if player != null and player.lethal:
		for id in inventory:
			if not Data.MELEE.has(id) and charge_of(id) < 1.0:
				charge[id] = minf(1.0, charge_of(id) + delta / Data.CHARGE_SECONDS * float(player.info.get("charge_mult", 1.0)))
				if is_locked(id) and charge_of(id) >= 0.999:
					locked.erase(id)
					charge[id] = 1.0
					inventory_changed.emit()
	firing_t = maxf(0.0, firing_t - delta)
	_last_slab_t += delta
	# slabs age out; a glass slab flickers before it breaks
	for s in live.duplicate():
		var ttl: float = float(s.get_meta("ttl")) - delta
		s.set_meta("ttl", ttl)
		if ttl < 2.0:
			s.visible = int(ttl * 8.0) % 2 == 0
		if ttl <= 0.0:
			player.game.fx.shards(s.global_position, Data.BLOCKS[String(s.get_meta("block"))].color, 6, 4.0)
			_free_slab(s)
	if player == null or not player.is_local:
		ghost.visible = false
		return
	# the ghost slab shows where the next one goes
	ghost.visible = true
	ghost.global_position = next_slab_pos()
	ghost.rotation = Vector3(0, 0 if _axis == 0 else PI * 0.5, 0)
	var spawner := player.spawner
	if _vortex_t > 0.0:
		_vortex_t -= delta
		for d in spawner.in_sphere(_vortex_at, 8.0):
			spawner.push(d, (_vortex_at - d.global_position).normalized() * 40.0 * delta)
		if _vortex_t <= 0.0:
			for d in spawner.in_sphere(_vortex_at, 3.0):
				spawner.push(d, _vortex_dir * 22.0 + Vector3(0, 4.0, 0))
			player.game.fx.ring(_vortex_at, _vortex_col, 4.0)
	if _magnet_t > 0.0:
		_magnet_t -= delta
		var hold := player.eye() + player.aim_dir() * 2.6
		for d in spawner.in_cone(player.eye(), player.aim_dir(), 16.0, 50.0):
			spawner.push(d, (hold - d.global_position).normalized() * 55.0 * delta)
	if _ring_t > 0.0:
		_ring_t -= delta
		var rr := lerpf(1.0, 14.0, 1.0 - _ring_t / 0.7)
		for d in spawner.in_sphere(_ring_at, rr + 1.0):
			var off := d.global_position - _ring_at
			if absf(off.length() - rr) < 1.4:
				off.y = 0.0
				spawner.push(d, off.normalized() * 18.0 * delta * 8.0 + Vector3(0, 5.0 * delta * 8.0, 0))
	if _grapple_t > 0.0 and _grapple_to != Vector3.INF:
		_grapple_t -= delta
		var to := _grapple_to - player.global_position
		if to.length() < 1.6:
			_grapple_t = 0.0
		else:
			player.velocity = to.normalized() * 22.0
	if _slow_t > 0.0:
		_slow_t -= delta
		if _slow_t <= 0.0:
			player.speed_mult = 1.0
