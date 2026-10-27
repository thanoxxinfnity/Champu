class_name HorseRig
extends RefCounted
## The animation of a rigged horse (bones made by tools/autorig_quad.py): idle (breathing, ear and tail flicks, a slow head turn), walk (four-beat), trot
## (diagonal pairs), canter/gallop (rotary four-beat with the back flexing and the neck reaching) and a jump. Every joint is a swing about the horse's own
## side-to-side axis, driven by sine gaits with the foot phases of a real horse, and written to the Skeleton3D as bone poses (no AnimationPlayer needed, so
## the gait follows the real speed exactly and blends smoothly between the gaits).
##
## A bone is turned about the model's X axis (the side axis) *after* its parent: pose = rest⁻¹ · (parent_global⁻¹ · Rx(θ) · parent_global) · rest.

const LEGS := ["FL", "FR", "HL", "HR"]
const FRONT := {"FL": true, "FR": true, "HL": false, "HR": false}
# foot phase (0..1 of the stride) per gait: [FL, FR, HL, HR]
const PHASE_WALK := {"FL": 0.25, "FR": 0.75, "HL": 0.0, "HR": 0.5}
const PHASE_TROT := {"FL": 0.0, "FR": 0.5, "HL": 0.5, "HR": 0.0}
const PHASE_GALLOP := {"FL": 0.52, "FR": 0.62, "HL": 0.0, "HR": 0.1}

var skel: Skeleton3D
var ids := {}                            # bone name -> index
var parent_of := {}                      # bone index -> parent index
var order: Array = []                    # indices, parents first
var _rest := {}                          # index -> Quaternion (rest rotation, local)
var _glob := {}                          # index -> Basis (new global rotation, this frame)
var phase := 0.0                         # stride phase, 0..1
var _t := 0.0
var _w_walk := 0.0
var _w_trot := 0.0
var _w_gallop := 0.0
var _w_air := 0.0
var bob := 0.0                           # metres the body rises (the holder uses it)
var pitch := 0.0                         # radians the whole horse tips forward (+) on the jump or a rear (-)


func setup(sk: Skeleton3D) -> bool:
	skel = sk
	for i in sk.get_bone_count():
		ids[sk.get_bone_name(i)] = i
		parent_of[i] = sk.get_bone_parent(i)
		_rest[i] = sk.get_bone_rest(i).basis.get_rotation_quaternion()
	# parents first
	var seen := {}
	var left := range(sk.get_bone_count())
	var guard := 0
	while not left.is_empty() and guard < 200:
		guard += 1
		for i in left.duplicate():
			var p: int = parent_of[i]
			if p < 0 or seen.has(p):
				order.append(i)
				seen[i] = true
				left.erase(i)
	return ids.has("Pelvis") and ids.has("FL_Upper") and ids.has("HL_Thigh")


## One frame. `speed` m/s along the facing, `airborne` while jumping, `steer` -1..1 (the neck and spine bend into the turn).
func update(delta: float, speed: float, airborne: bool, steer: float, mood := 0.0) -> void:
	_t += delta
	var s := absf(speed)
	# gait weights follow the speed with a smooth blend
	var want_walk := clampf(1.0 - absf(s - 1.8) / 1.6, 0.0, 1.0) if s > 0.15 else 0.0
	var want_trot := clampf(1.0 - absf(s - 5.2) / 2.2, 0.0, 1.0)
	var want_gallop := clampf((s - 7.0) / 2.5, 0.0, 1.0)
	var k := minf(1.0, delta * 7.0)
	_w_walk = lerpf(_w_walk, want_walk, k)
	_w_trot = lerpf(_w_trot, want_trot, k)
	_w_gallop = lerpf(_w_gallop, want_gallop, k)
	_w_air = lerpf(_w_air, 1.0 if airborne else 0.0, minf(1.0, delta * 9.0))
	# stride rate: cycles per second by gait (a horse's legs go faster as it speeds up)
	var rate := 0.0
	if s > 0.15:
		rate = lerpf(lerpf(0.8, 1.4, clampf(s / 4.0, 0.0, 1.0)), 2.2, clampf((s - 4.0) / 6.0, 0.0, 1.0)) * (1.0 + 0.05 * s)
		rate = clampf(s / 2.1 if s < 3.0 else rate, 0.4, 3.2)
	phase = fposmod(phase + rate * delta * (1.0 if speed >= 0.0 else -1.0), 1.0)
	var moving := clampf(s / 1.2, 0.0, 1.0)
	_glob.clear()
	var amp_walk := 0.5
	var amp_trot := 0.62
	var amp_gallop := 0.95
	# per-joint targets (radians about X; + swings the lower end forward)
	var th := {}
	for leg in LEGS:
		var fr: bool = FRONT[leg]
		var up := 0.0
		var lo := 0.0
		var ca := 0.0
		var ho := 0.0
		for g in 3:
			var w: float = [_w_walk, _w_trot, _w_gallop][g]
			if w < 0.001:
				continue
			var ph: float = [PHASE_WALK, PHASE_TROT, PHASE_GALLOP][g][leg]
			var amp: float = [amp_walk, amp_trot, amp_gallop][g]
			var a := TAU * (phase + ph)
			var swing := sin(a)
			var lift := maxf(0.0, cos(a))            # the leg is up and moving forward while cos > 0
			up += w * amp * swing * (0.9 if fr else 1.0)
			# front: the knee folds back under the forearm in the swing; hind: the hock folds
			lo += w * amp * (1.5 if fr else -1.2) * lift * (-1.0 if fr else 1.0) * (1.0 if g == 2 else 0.8)
			ca += w * amp * 0.45 * lift * (1.0 if fr else -1.0)
			ho += w * 0.3 * lift
		# idle: the weight shifts a little onto one hind leg now and then
		var idle := 1.0 - maxf(maxf(_w_walk, _w_trot), _w_gallop)
		if leg == "HR":
			up += idle * 0.05 * sin(_t * 0.4) * moving * 0.0
		# in the air: front legs tucked forward, hind legs back
		var air := _w_air
		if fr:
			up = lerpf(up, 0.95, air)
			lo = lerpf(lo, -1.5, air)
			ca = lerpf(ca, 0.3, air)
		else:
			up = lerpf(up, -0.7, air)
			lo = lerpf(lo, 0.8, air)
			ca = lerpf(ca, -0.4, air)
		th[leg] = [up, lo, ca, ho]
	var gallop := _w_gallop
	var spine := sin(TAU * (phase + 0.1)) * 0.07 * gallop + sin(TAU * (phase + 0.3)) * 0.025 * _w_trot
	var neck := sin(TAU * (phase + 0.35)) * (0.1 * gallop + 0.04 * _w_trot + 0.03 * _w_walk)
	var breath := sin(_t * 1.7) * 0.012
	var idle_w := 1.0 - maxf(maxf(_w_walk, _w_trot), maxf(_w_gallop, _w_air))
	# the body rises twice per stride in the trot, once in the gallop
	bob = (sin(TAU * phase * 2.0) * 0.025 * _w_trot + absf(sin(TAU * (phase + 0.1))) * 0.07 * gallop + sin(TAU * phase * 2.0) * 0.01 * _w_walk) + breath * 0.2
	pitch = lerpf(0.0, -0.12, _w_air) + spine * 0.0
	# apply, parents first
	for i in order:
		var nm := skel.get_bone_name(i)
		var ang := 0.0
		var tw := 0.0           # a twist about the vertical (steering) for the neck/head
		if nm == "Pelvis":
			ang = -spine * 0.5 + breath * 0.5 + _w_air * 0.12
		elif nm == "Spine1":
			ang = spine * 0.6
		elif nm == "Spine2":
			ang = spine * 0.4 - _w_air * 0.05
		elif nm == "Chest":
			ang = breath * 0.7 + spine * 0.2
		elif nm == "Neck1":
			ang = neck * 0.6 + sin(_t * 0.5) * 0.03 * idle_w + _w_air * 0.12
			tw = -steer * 0.18
		elif nm == "Neck2":
			ang = neck * 0.5 + sin(_t * 0.5 + 0.8) * 0.05 * idle_w
			tw = -steer * 0.22 + sin(_t * 0.23) * 0.22 * idle_w
		elif nm == "Head":
			ang = neck * 0.4 - 0.05 * gallop + sin(_t * 0.9) * 0.03 * idle_w
			tw = -steer * 0.15
		elif nm == "EarL" or nm == "EarR":
			ang = sin(_t * 3.1 + (0.0 if nm == "EarL" else 2.0)) * 0.05 * idle_w + (-0.35 * gallop)
		elif nm.begins_with("Tail"):
			var n := int(nm.substr(4))
			ang = sin(_t * (2.0 + gallop * 3.0) - float(n) * 0.9) * (0.1 + 0.05 * n) * (1.0 + gallop) + gallop * 0.25 * float(n == 0)
			tw = sin(_t * 1.3 - float(n) * 0.7) * 0.08 * idle_w
		elif nm.length() > 3 and th.has(nm.substr(0, 2)):
			var v: Array = th[nm.substr(0, 2)]
			var part := nm.substr(3)
			if part == "Upper" or part == "Thigh":
				ang = v[0]
			elif part == "Lower" or part == "Shin":
				ang = v[1]
			elif part == "Cannon":
				ang = v[2]
			elif part == "Hoof":
				ang = v[3]
		_pose(i, ang, tw)


func _pose(i: int, ang: float, twist: float) -> void:
	var p: int = parent_of[i]
	var gp: Basis = _glob.get(p, Basis.IDENTITY) if p >= 0 else Basis.IDENTITY
	var rest_q: Quaternion = _rest[i]
	var world_rot := Basis(Vector3.RIGHT, ang)
	if twist != 0.0:
		world_rot = Basis(Vector3.UP, twist) * world_rot
	var local_rot: Basis = gp.inverse() * world_rot * gp
	var q := rest_q.inverse() * local_rot.get_rotation_quaternion() * rest_q
	skel.set_bone_pose_rotation(i, q)
	_glob[i] = gp * Basis(rest_q) * Basis(q) if p >= 0 else Basis(rest_q) * Basis(q)
