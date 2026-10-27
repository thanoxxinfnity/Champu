class_name Combat
extends RefCounted
## Who a weapon can hurt. Everybody in a match (me, the bots, the other phones' players) is a PlayerController in the "actors" group; a weapon asks for the enemies
## (alive, not on my team) inside a cone, a sphere or along a line, and `hurt` applies the damage — on this phone for me and my bots, over the network for another
## phone's player (that phone is the judge of its own player: the hit arrives as a message, see MultiplayerController.send_hit).

const BODY := Vector3(0, 0.95, 0)          # the middle of a person, for the distance maths


static func enemies(p: PlayerController) -> Array:
	var out: Array = []
	for a in p.get_tree().get_nodes_in_group("actors"):
		var o := a as PlayerController
		if o != null and o != p and o.alive and o.team != p.team and o.is_inside_tree():
			out.append(o)
	return out


static func center(t: PlayerController) -> Vector3:
	return t.global_position + BODY


static func in_sphere(foes: Array, c: Vector3, r: float) -> Array:
	var out: Array = []
	for t in foes:
		if center(t).distance_to(c) <= r + 0.4:
			out.append(t)
	return out


static func in_cone(foes: Array, origin: Vector3, dir: Vector3, reach: float, half_deg: float) -> Array:
	var out: Array = []
	var cosv := cos(deg_to_rad(half_deg))
	for t in foes:
		var to := center(t) - origin
		var d := to.length()
		if d > reach + 0.4 or d < 0.01:
			continue
		if d < 1.2 or to.normalized().dot(dir) >= cosv:
			out.append(t)
	return out


## Along a ray: whoever's body is within `radius` of the line, nearest first.
static func on_line(foes: Array, origin: Vector3, dir: Vector3, reach: float, radius: float) -> Array:
	var hits: Array = []
	for t in foes:
		var to := center(t) - origin
		var along := to.dot(dir)
		if along < 0.0 or along > reach:
			continue
		if (to - dir * along).length() <= radius + 0.5:
			hits.append([along, t])
	hits.sort_custom(func(a: Array, b: Array) -> bool: return float(a[0]) < float(b[0]))
	var out: Array = []
	for h in hits:
		out.append(h[1])
	return out


## Apply `dmg` (and a shove) to `t` for `by`. Returns true when it was a hit. A kill is reported by the victim's own `died` signal.
static func hurt(by: PlayerController, t: PlayerController, dmg: float, knock := Vector3.ZERO, slow := 0.0) -> bool:
	if t == null or not t.alive or t.team == by.team:
		return false
	var amount := dmg * float(by.info.get("dmg_mult", 1.0))
	if t.is_local or t.is_bot:
		t.take_damage(amount, by, knock, slow)
	else:
		by.game.send_hit(t.peer_id, amount, knock, slow)
	if by.is_local and not by.is_bot and by.game != null:
		by.game.hit_marker(amount, Combat.center(t))
	return true
