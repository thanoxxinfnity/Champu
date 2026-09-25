class_name DriveHUD
extends Control
## Driving HUD: speedometer with rev arc and gear, drift score with combo,
## skill points, a minimap of the loop, and toasts (camera mode, speed trap,
## drift zone). Everything is drawn in one _draw pass: no per-frame node
## churn, one canvas item.

const ACCENT := Color(1.0, 0.45, 0.08)

var vehicle: VehicleController
var world: WorldBuilder
var show_fps := true

var _map_pts: PackedVector2Array
var _map_min := Vector2.ZERO
var _map_scale := 1.0
var _toasts: Array = []          # [text, sub, time_left, color]
var _drift_flash := 0.0
var _last_banked := 0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func bind(v: VehicleController, w: WorldBuilder) -> void:
	vehicle = v
	world = w
	_map_pts = w.minimap_points()
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for p in _map_pts:
		lo = lo.min(p)
		hi = hi.max(p)
	_map_min = lo
	_map_scale = 170.0 / maxf(hi.x - lo.x, hi.y - lo.y)
	v.drift_banked.connect(func(pts: int) -> void:
		_last_banked = pts
		toast("DRIFT  +%s" % _fmt(pts), "SKILL CHAIN BANKED", ACCENT))
	v.drift_failed.connect(func() -> void: toast("CRASHED", "DRIFT CHAIN LOST", Color(1, 0.25, 0.2)))


func toast(text: String, sub: String = "", color: Color = Color.WHITE, time: float = 2.2) -> void:
	_toasts.append([text, sub, time, color])
	if _toasts.size() > 3:
		_toasts.pop_front()


static func _fmt(n: int) -> String:
	var s := str(n)
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out


func _process(delta: float) -> void:
	if not visible:
		return
	for t in _toasts:
		t[2] -= delta
	_toasts = _toasts.filter(func(t: Array) -> bool: return t[2] > 0.0)
	_drift_flash = maxf(_drift_flash - delta, 0.0)
	queue_redraw()


func _draw() -> void:
	if vehicle == null or not is_instance_valid(vehicle):
		return
	var font := get_theme_default_font()
	var w := size.x
	var h := size.y
	var s := clampf(h / 720.0, 0.75, 1.6)

	# ── speedometer ──
	var c := Vector2(w * 0.5, h - 92 * s)
	var r := 82.0 * s
	draw_circle(c, r + 10 * s, Color(0.02, 0.025, 0.035, 0.55))
	var a0 := PI * 0.8
	var a1 := PI * 2.2
	draw_arc(c, r, a0, a1, 64, Color(1, 1, 1, 0.12), 8 * s, true)
	var rpm_f := clampf((vehicle.rpm - 800.0) / 7200.0, 0.0, 1.0)
	var red := rpm_f > 0.88
	draw_arc(c, r, a0, lerpf(a0, a1, rpm_f), 64, Color(1, 0.2, 0.15) if red else ACCENT, 8 * s, true)
	for i in 9:
		var ta := lerpf(a0, a1, float(i) / 8.0)
		var d := Vector2(cos(ta), sin(ta))
		draw_line(c + d * (r - 16 * s), c + d * (r - 8 * s), Color(1, 1, 1, 0.5), 2.0)
	var spd := str(int(vehicle.speed_kmh))
	_center_text(font, spd, c + Vector2(0, 10 * s), int(46 * s), Color.WHITE)
	_center_text(font, "KM/H", c + Vector2(0, 34 * s), int(13 * s), Color(1, 1, 1, 0.55))
	var gear_txt := "R" if vehicle.gear == -1 else ("N" if vehicle.speed_kmh < 1.0 and vehicle.in_throttle == 0.0 else str(vehicle.gear))
	_center_text(font, gear_txt, c + Vector2(0, -34 * s), int(22 * s), ACCENT)

	# ── nitro bar under the gauge ──
	var nb := Rect2(c + Vector2(-70 * s, r + 16 * s), Vector2(140 * s, 7 * s))
	if nb.end.y < h:
		draw_rect(nb, Color(1, 1, 1, 0.12))
		draw_rect(Rect2(nb.position, Vector2(nb.size.x * vehicle.nitro, nb.size.y)), Color(0.3, 0.8, 1.0))

	# ── drift score (live) ──
	if vehicle.is_drifting and vehicle.drift_points > 5.0:
		var dc := Vector2(w * 0.5, 150 * s)
		_center_text(font, "DRIFT", dc + Vector2(0, -34 * s), int(18 * s), Color(1, 1, 1, 0.75))
		_center_text(font, _fmt(int(vehicle.drift_points)), dc + Vector2(0, 12 * s), int(44 * s), ACCENT)
		if vehicle.drift_combo > 1:
			_center_text(font, "x%d" % vehicle.drift_combo, dc + Vector2(0, 42 * s), int(22 * s), Color.WHITE)
		_center_text(font, "%d°" % int(absf(vehicle.slip_angle)), dc + Vector2(90 * s, 12 * s), int(16 * s), Color(1, 1, 1, 0.6))

	# ── skill points ──
	var sk := "SKILL  " + _fmt(vehicle.skill_total)
	var sw := font.get_string_size(sk, HORIZONTAL_ALIGNMENT_LEFT, -1, int(16 * s)).x
	draw_string(font, Vector2(w * 0.5 - sw * 0.5, 34 * s), sk, HORIZONTAL_ALIGNMENT_LEFT, -1, int(16 * s), Color(1, 1, 1, 0.85))

	# ── toasts ──
	var ty := 225.0 * s
	for t in _toasts:
		var alpha := clampf(t[2] / 0.4, 0.0, 1.0)
		var col: Color = t[3]
		col.a = alpha
		_center_text(font, t[0], Vector2(w * 0.5, ty), int(30 * s), col)
		if t[1] != "":
			_center_text(font, t[1], Vector2(w * 0.5, ty + 24 * s), int(14 * s), Color(1, 1, 1, 0.7 * alpha))
		ty += 62 * s

	# ── minimap ──
	var box := Rect2(Vector2(w - 212 * s, 18 * s), Vector2(194 * s, 194 * s))
	draw_circle(box.get_center(), box.size.x * 0.5, Color(0.02, 0.025, 0.035, 0.55))
	draw_arc(box.get_center(), box.size.x * 0.5, 0, TAU, 64, Color(1, 1, 1, 0.2), 1.5, true)
	if _map_pts.size() > 2:
		var pts := PackedVector2Array()
		for p in _map_pts:
			pts.append(_map(p, box, s))
		pts.append(pts[0])
		draw_polyline(pts, Color(1, 1, 1, 0.7), 3.0 * s, true)
		var dz := world.drift_zone
		var zp := PackedVector2Array()
		var i := dz.x
		while true:
			zp.append(_map(Vector2(world.samples[i].x, world.samples[i].z), box, s))
			if i == dz.y:
				break
			i = (i + 1) % world.samples.size()
		if zp.size() > 1:
			draw_polyline(zp, ACCENT, 3.0 * s, true)
		var st := world.samples[world.speed_trap_index]
		draw_circle(_map(Vector2(st.x, st.z), box, s), 5 * s, Color(0.3, 0.8, 1.0))
	var cp := _map(Vector2(vehicle.global_position.x, vehicle.global_position.z), box, s)
	var fwd := Vector2(vehicle.global_basis.z.x, vehicle.global_basis.z.z).normalized()
	var side := Vector2(-fwd.y, fwd.x)
	var k := 8.0 * s
	draw_colored_polygon(PackedVector2Array([cp + fwd * k * 1.3, cp - fwd * k * 0.8 + side * k * 0.8, cp - fwd * k * 0.8 - side * k * 0.8]), ACCENT)

	if show_fps:
		draw_string(font, Vector2(w - 212 * s, 232 * s), "%d FPS" % Engine.get_frames_per_second(), HORIZONTAL_ALIGNMENT_LEFT, -1, int(12 * s), Color(1, 1, 1, 0.45))


func _map(p: Vector2, box: Rect2, s: float) -> Vector2:
	var q := (p - _map_min) * _map_scale * s
	# World +X is screen left when looking north (+Z up the map).
	return Vector2(box.end.x - 12 * s - q.x, box.end.y - 12 * s - q.y)


func _center_text(font: Font, text: String, at: Vector2, fs: int, col: Color) -> void:
	var tw := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_string(font, Vector2(at.x - tw * 0.5, at.y), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
