class_name UIKit
extends RefCounted
## The anime look of the menus: thick ink outlines, hard offset shadows, bright pastel fills, a comic title font, round bold text, and icons drawn in code (no image
## files): play, team, globe, shop, user, gear, coin, sword, back, lock, check, plus, star, crown, bolt, key, map, home, train, heart, skull, flag.

const INK := Color(0.13, 0.09, 0.24)
const CREAM := Color(1.0, 0.97, 0.9)
const PINK := Color(1.0, 0.42, 0.62)
const SKY := Color(0.36, 0.74, 1.0)
const YELLOW := Color(1.0, 0.82, 0.28)
const MINT := Color(0.42, 0.92, 0.7)
const PURPLE := Color(0.62, 0.45, 1.0)
const ORANGE := Color(1.0, 0.58, 0.25)

static var _title: Font
static var _body: Font


static func title_font() -> Font:
	if _title == null:
		_title = load("res://assets/ui/fonts/Bangers-Regular.ttf") as Font if ResourceLoader.exists("res://assets/ui/fonts/Bangers-Regular.ttf") else ThemeDB.fallback_font
	return _title


static func body_font() -> Font:
	if _body == null:
		_body = load("res://assets/ui/fonts/MPLUSRounded1c-Bold.ttf") as Font if ResourceLoader.exists("res://assets/ui/fonts/MPLUSRounded1c-Bold.ttf") else ThemeDB.fallback_font
	return _body


## A rounded box with an ink border and a hard shadow (the comic-panel look).
static func box(fill: Color, border := INK, radius := 18, bw := 4, shadow := 6) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = fill
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.shadow_color = Color(INK.r, INK.g, INK.b, 0.55)
	s.shadow_size = 0
	s.shadow_offset = Vector2(0, shadow)
	s.set_content_margin_all(12)
	s.anti_aliasing = true
	return s


static func label(text: String, parent: Node, size := 20, color := CREAM, title := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", title_font() if title else body_font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", INK)
	l.add_theme_constant_override("outline_size", maxi(4, size / 5))
	if parent != null:
		parent.add_child(l)
	return l


static func panel(parent: Node, fill := Color(0.98, 0.94, 0.88, 0.96), radius := 22) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(fill, INK, radius))
	if parent != null:
		parent.add_child(p)
	return p


## Draw an icon `name` centred on `c` in a square of side `s`: filled in `col`, outlined in ink.
static func draw_icon(ci: CanvasItem, name: String, c: Vector2, s: float, col: Color) -> void:
	var h := s * 0.5
	var lw := maxf(2.0, s * 0.09)
	match name:
		"play":
			var pts := PackedVector2Array([c + Vector2(-h * 0.55, -h * 0.8), c + Vector2(h * 0.85, 0), c + Vector2(-h * 0.55, h * 0.8)])
			ci.draw_colored_polygon(pts, col)
			ci.draw_polyline(PackedVector2Array([pts[0], pts[1], pts[2], pts[0]]), INK, lw)
		"team":
			for k in [-1, 1]:
				var o := c + Vector2(k * h * 0.5, 0)
				ci.draw_circle(o + Vector2(0, -h * 0.4), h * 0.34, col)
				ci.draw_arc(o + Vector2(0, -h * 0.4), h * 0.34, 0, TAU, 16, INK, lw * 0.8)
				ci.draw_circle(o + Vector2(0, h * 0.55), h * 0.5, col)
				ci.draw_arc(o + Vector2(0, h * 0.55), h * 0.5, PI, TAU, 12, INK, lw * 0.8)
		"user":
			ci.draw_circle(c + Vector2(0, -h * 0.35), h * 0.4, col)
			ci.draw_arc(c + Vector2(0, -h * 0.35), h * 0.4, 0, TAU, 16, INK, lw)
			ci.draw_circle(c + Vector2(0, h * 0.85), h * 0.75, col)
			ci.draw_arc(c + Vector2(0, h * 0.85), h * 0.75, PI, TAU, 14, INK, lw)
		"globe":
			ci.draw_circle(c, h * 0.85, col)
			ci.draw_arc(c, h * 0.85, 0, TAU, 24, INK, lw)
			ci.draw_arc(c, h * 0.85, 0, TAU, 24, INK, lw)
			ci.draw_line(c + Vector2(-h * 0.85, 0), c + Vector2(h * 0.85, 0), INK, lw * 0.7)
			ci.draw_arc(c, h * 0.85, -PI * 0.5, PI * 0.5, 12, INK, lw * 0.7)
			ci.draw_arc(c + Vector2(h * 0.3, 0), h * 0.55, PI * 0.5, PI * 1.5, 12, INK, lw * 0.7)
		"shop":
			var r := Rect2(c + Vector2(-h * 0.8, -h * 0.35), Vector2(h * 1.6, h * 1.25))
			ci.draw_rect(r, col)
			ci.draw_rect(r, INK, false, lw)
			ci.draw_arc(c + Vector2(0, -h * 0.35), h * 0.4, PI, TAU, 12, INK, lw)
		"gear":
			for i in 8:
				var a := float(i) / 8.0 * TAU
				ci.draw_line(c + Vector2(cos(a), sin(a)) * h * 0.6, c + Vector2(cos(a), sin(a)) * h * 0.95, INK, lw * 1.4)
			ci.draw_circle(c, h * 0.62, col)
			ci.draw_arc(c, h * 0.62, 0, TAU, 20, INK, lw)
			ci.draw_circle(c, h * 0.22, INK)
		"coin":
			ci.draw_circle(c, h * 0.9, col)
			ci.draw_arc(c, h * 0.9, 0, TAU, 24, INK, lw)
			ci.draw_arc(c, h * 0.58, 0, TAU, 20, Color(INK.r, INK.g, INK.b, 0.5), lw * 0.6)
			ci.draw_line(c + Vector2(0, -h * 0.35), c + Vector2(0, h * 0.35), INK, lw)
		"sword":
			ci.draw_line(c + Vector2(-h * 0.7, h * 0.7), c + Vector2(h * 0.7, -h * 0.7), INK, lw * 2.2)
			ci.draw_line(c + Vector2(-h * 0.7, h * 0.7), c + Vector2(h * 0.7, -h * 0.7), col, lw)
			ci.draw_line(c + Vector2(-h * 0.45, h * 0.1), c + Vector2(-h * 0.1, h * 0.45), INK, lw * 1.6)
		"back":
			var pts2 := PackedVector2Array([c + Vector2(h * 0.7, -h * 0.7), c + Vector2(-h * 0.7, 0), c + Vector2(h * 0.7, h * 0.7)])
			ci.draw_polyline(pts2, INK, lw * 2.4)
			ci.draw_polyline(pts2, col, lw)
		"lock":
			var r2 := Rect2(c + Vector2(-h * 0.6, -h * 0.1), Vector2(h * 1.2, h * 0.95))
			ci.draw_arc(c + Vector2(0, -h * 0.1), h * 0.42, PI, TAU, 12, INK, lw * 1.4)
			ci.draw_rect(r2, col)
			ci.draw_rect(r2, INK, false, lw)
		"check":
			var pts3 := PackedVector2Array([c + Vector2(-h * 0.7, 0), c + Vector2(-h * 0.2, h * 0.55), c + Vector2(h * 0.75, -h * 0.55)])
			ci.draw_polyline(pts3, INK, lw * 2.4)
			ci.draw_polyline(pts3, col, lw)
		"plus":
			ci.draw_line(c + Vector2(-h * 0.6, 0), c + Vector2(h * 0.6, 0), INK, lw * 2.4)
			ci.draw_line(c + Vector2(0, -h * 0.6), c + Vector2(0, h * 0.6), INK, lw * 2.4)
			ci.draw_line(c + Vector2(-h * 0.6, 0), c + Vector2(h * 0.6, 0), col, lw)
			ci.draw_line(c + Vector2(0, -h * 0.6), c + Vector2(0, h * 0.6), col, lw)
		"star":
			var st := PackedVector2Array()
			for i in 10:
				var a2 := -PI * 0.5 + float(i) / 10.0 * TAU
				st.append(c + Vector2(cos(a2), sin(a2)) * h * (0.95 if i % 2 == 0 else 0.42))
			ci.draw_colored_polygon(st, col)
			st.append(st[0])
			ci.draw_polyline(st, INK, lw * 0.9)
		"crown":
			var cr := PackedVector2Array([c + Vector2(-h * 0.8, h * 0.6), c + Vector2(-h * 0.8, -h * 0.5), c + Vector2(-h * 0.4, 0), c + Vector2(0, -h * 0.7), c + Vector2(h * 0.4, 0),
				c + Vector2(h * 0.8, -h * 0.5), c + Vector2(h * 0.8, h * 0.6)])
			ci.draw_colored_polygon(cr, col)
			cr.append(cr[0])
			ci.draw_polyline(cr, INK, lw)
		"bolt":
			var bz := PackedVector2Array([c + Vector2(h * 0.2, -h * 0.9), c + Vector2(-h * 0.5, h * 0.1), c + Vector2(-h * 0.05, h * 0.1), c + Vector2(-h * 0.25, h * 0.9),
				c + Vector2(h * 0.55, -h * 0.2), c + Vector2(h * 0.1, -h * 0.2)])
			ci.draw_colored_polygon(bz, col)
			bz.append(bz[0])
			ci.draw_polyline(bz, INK, lw)
		"key":
			ci.draw_circle(c + Vector2(-h * 0.45, 0), h * 0.4, col)
			ci.draw_arc(c + Vector2(-h * 0.45, 0), h * 0.4, 0, TAU, 14, INK, lw)
			ci.draw_line(c + Vector2(-h * 0.05, 0), c + Vector2(h * 0.85, 0), INK, lw * 2.2)
			ci.draw_line(c + Vector2(-h * 0.05, 0), c + Vector2(h * 0.85, 0), col, lw)
			ci.draw_line(c + Vector2(h * 0.55, 0), c + Vector2(h * 0.55, h * 0.4), INK, lw * 1.6)
		"map":
			var mp := PackedVector2Array([c + Vector2(-h * 0.85, -h * 0.6), c + Vector2(-h * 0.28, -h * 0.8), c + Vector2(h * 0.28, -h * 0.6), c + Vector2(h * 0.85, -h * 0.8),
				c + Vector2(h * 0.85, h * 0.6), c + Vector2(h * 0.28, h * 0.8), c + Vector2(-h * 0.28, h * 0.6), c + Vector2(-h * 0.85, h * 0.8)])
			ci.draw_colored_polygon(mp, col)
			mp.append(mp[0])
			ci.draw_polyline(mp, INK, lw)
		"home":
			var hm := PackedVector2Array([c + Vector2(-h * 0.8, 0), c + Vector2(0, -h * 0.85), c + Vector2(h * 0.8, 0), c + Vector2(h * 0.6, 0), c + Vector2(h * 0.6, h * 0.8),
				c + Vector2(-h * 0.6, h * 0.8), c + Vector2(-h * 0.6, 0)])
			ci.draw_colored_polygon(hm, col)
			hm.append(hm[0])
			ci.draw_polyline(hm, INK, lw)
		"train":
			var tr := Rect2(c + Vector2(-h * 0.85, -h * 0.55), Vector2(h * 1.7, h * 1.1))
			ci.draw_rect(tr, col)
			ci.draw_rect(tr, INK, false, lw)
			for k in 3:
				ci.draw_rect(Rect2(c + Vector2(-h * 0.65 + float(k) * h * 0.5, -h * 0.3), Vector2(h * 0.35, h * 0.4)), INK)
			ci.draw_circle(c + Vector2(-h * 0.45, h * 0.7), h * 0.15, INK)
			ci.draw_circle(c + Vector2(h * 0.45, h * 0.7), h * 0.15, INK)
		"heart":
			ci.draw_circle(c + Vector2(-h * 0.35, -h * 0.2), h * 0.45, col)
			ci.draw_circle(c + Vector2(h * 0.35, -h * 0.2), h * 0.45, col)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-h * 0.78, 0.0), c + Vector2(h * 0.78, 0.0), c + Vector2(0, h * 0.85)]), col)
		"skull":
			ci.draw_circle(c + Vector2(0, -h * 0.1), h * 0.75, col)
			ci.draw_arc(c + Vector2(0, -h * 0.1), h * 0.75, 0, TAU, 20, INK, lw)
			ci.draw_circle(c + Vector2(-h * 0.3, -h * 0.15), h * 0.2, INK)
			ci.draw_circle(c + Vector2(h * 0.3, -h * 0.15), h * 0.2, INK)
		"jet":
			# a jetpack: two canisters with flames under them
			for k in [-1.0, 1.0]:
				var cx: float = c.x + k * h * 0.42
				var can := Rect2(Vector2(cx - h * 0.28, c.y - h * 0.85), Vector2(h * 0.56, h * 1.1))
				ci.draw_rect(can, col)
				ci.draw_rect(can, INK, false, lw)
				var fl := PackedVector2Array([Vector2(cx - h * 0.2, c.y + h * 0.3), Vector2(cx + h * 0.2, c.y + h * 0.3), Vector2(cx, c.y + h * (0.95 + 0.0))])
				ci.draw_colored_polygon(fl, Color(1.0, 0.7, 0.2))
				ci.draw_polyline(PackedVector2Array([fl[0], fl[2], fl[1]]), INK, lw * 0.8)
		"burst":
			var bs := PackedVector2Array()
			for i in 16:
				var a3 := float(i) / 16.0 * TAU
				bs.append(c + Vector2(cos(a3), sin(a3)) * h * (0.95 if i % 2 == 0 else 0.5))
			ci.draw_colored_polygon(bs, col)
			bs.append(bs[0])
			ci.draw_polyline(bs, INK, lw)
			ci.draw_circle(c, h * 0.22, INK)
		"cube":
			var top := PackedVector2Array([c + Vector2(0, -h * 0.85), c + Vector2(h * 0.8, -h * 0.4), c + Vector2(0, h * 0.05), c + Vector2(-h * 0.8, -h * 0.4)])
			var left := PackedVector2Array([c + Vector2(-h * 0.8, -h * 0.4), c + Vector2(0, h * 0.05), c + Vector2(0, h * 0.9), c + Vector2(-h * 0.8, h * 0.45)])
			var right := PackedVector2Array([c + Vector2(h * 0.8, -h * 0.4), c + Vector2(0, h * 0.05), c + Vector2(0, h * 0.9), c + Vector2(h * 0.8, h * 0.45)])
			ci.draw_colored_polygon(top, col.lightened(0.25))
			ci.draw_colored_polygon(left, col)
			ci.draw_colored_polygon(right, col.darkened(0.25))
			for poly in [top, left, right]:
				var pl: PackedVector2Array = poly
				pl.append(pl[0])
				ci.draw_polyline(pl, INK, lw * 0.9)
		"bridge":
			for k in 3:
				var pr := Rect2(c + Vector2(-h * 0.9 + float(k) * h * 0.62, -h * 0.2 + float(k) * h * 0.05), Vector2(h * 0.5, h * 0.9))
				ci.draw_rect(pr, col)
				ci.draw_rect(pr, INK, false, lw * 0.9)
			ci.draw_line(c + Vector2(-h * 0.95, -h * 0.35), c + Vector2(h * 0.95, -h * 0.25), INK, lw)
		"wheel":
			ci.draw_circle(c, h * 0.85, col)
			ci.draw_arc(c, h * 0.85, 0, TAU, 24, INK, lw * 1.3)
			ci.draw_circle(c, h * 0.3, INK)
			for i in 5:
				var a4 := float(i) / 5.0 * TAU
				ci.draw_line(c, c + Vector2(cos(a4), sin(a4)) * h * 0.7, INK, lw * 0.9)
		"pause":
			for k in [-1.0, 1.0]:
				var br := Rect2(c + Vector2(k * h * 0.4 - h * 0.17, -h * 0.65), Vector2(h * 0.34, h * 1.3))
				ci.draw_rect(br, col)
				ci.draw_rect(br, INK, false, lw)
		"trophy":
			var cup := PackedVector2Array([c + Vector2(-h * 0.6, -h * 0.75), c + Vector2(h * 0.6, -h * 0.75), c + Vector2(h * 0.45, h * 0.1), c + Vector2(h * 0.12, h * 0.4), c + Vector2(-h * 0.12, h * 0.4), c + Vector2(-h * 0.45, h * 0.1)])
			ci.draw_colored_polygon(cup, col)
			cup.append(cup[0])
			ci.draw_polyline(cup, INK, lw)
			ci.draw_rect(Rect2(c + Vector2(-h * 0.1, h * 0.38), Vector2(h * 0.2, h * 0.3)), INK)
			ci.draw_rect(Rect2(c + Vector2(-h * 0.45, h * 0.66), Vector2(h * 0.9, h * 0.2)), col)
			ci.draw_rect(Rect2(c + Vector2(-h * 0.45, h * 0.66), Vector2(h * 0.9, h * 0.2)), INK, false, lw * 0.8)
		"flame":
			var fm := PackedVector2Array([c + Vector2(0, -h * 0.95), c + Vector2(h * 0.55, -h * 0.1), c + Vector2(h * 0.45, h * 0.6), c + Vector2(0, h * 0.9), c + Vector2(-h * 0.45, h * 0.6), c + Vector2(-h * 0.55, -h * 0.1)])
			ci.draw_colored_polygon(fm, col)
			fm.append(fm[0])
			ci.draw_polyline(fm, INK, lw * 0.9)
		"people":
			ci.draw_circle(c + Vector2(-h * 0.35, -h * 0.3), h * 0.3, col)
			ci.draw_circle(c + Vector2(h * 0.35, -h * 0.3), h * 0.3, col)
			ci.draw_circle(c + Vector2(0, h * 0.7), h * 0.55, col)
		"flag":
			ci.draw_line(c + Vector2(-h * 0.6, h * 0.9), c + Vector2(-h * 0.6, -h * 0.9), INK, lw * 1.6)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-h * 0.6, -h * 0.85), c + Vector2(h * 0.8, -h * 0.4), c + Vector2(-h * 0.6, 0.0)]), col)
		_:
			ci.draw_circle(c, h * 0.7, col)


## The biggest font size (<= size) at which `s` is at most `max_w` wide: nothing drawn with draw_text can leave its box.
static func fit_px(s: String, size: int, max_w: float, title := false, min_px := 9) -> int:
	if max_w <= 0.0:
		return size
	var f := title_font() if title else body_font()
	var fs := size
	while fs > min_px and f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > max_w:
		fs -= 1
	return fs


## Text with the ink outline (for custom drawing). With a `width` the text shrinks until it fits it.
static func draw_text(ci: CanvasItem, s: String, pos: Vector2, size: int, col := CREAM, title := false, align := HORIZONTAL_ALIGNMENT_LEFT, width := -1.0) -> void:
	var f := title_font() if title else body_font()
	var fs := fit_px(s, size, width, title)
	ci.draw_string_outline(f, pos, s, align, width, fs, maxi(4, fs / 5), INK)
	ci.draw_string(f, pos, s, align, width, fs, col)


## Wrapped text inside a box: lines are broken at `width`, at most `max_lines`, the size shrinks until it all fits (`line_h` = line height factor).
static func draw_wrapped(ci: CanvasItem, s: String, pos: Vector2, size: int, col: Color, width: float, max_lines: int, outline := false, line_h := 1.18) -> void:
	var f := body_font()
	var fs := size
	var lines := 99
	while fs >= 10:
		lines = f.get_multiline_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, width, fs, max_lines + 4).y / (f.get_height(fs))
		if int(round(lines)) <= max_lines:
			break
		fs -= 1
	if outline:
		ci.draw_multiline_string_outline(f, pos, s, HORIZONTAL_ALIGNMENT_LEFT, width, fs, max_lines, maxi(3, fs / 6), INK)
	ci.draw_multiline_string(f, pos, s, HORIZONTAL_ALIGNMENT_LEFT, width, fs, max_lines, col)


## A comic button: ink border, hard shadow, a diagonal shine, an icon on the left and the text in the middle. Press = it sinks.
class AnimeButton:
	extends Button
	var icon_name := ""
	var accent := UIKit.PINK
	var sub := ""
	var font_px := 26
	var locked := false
	var _hover := false

	func _ready() -> void:
		flat = true
		focus_mode = Control.FOCUS_NONE
		for st in ["normal", "hover", "pressed", "disabled", "focus"]:
			add_theme_stylebox_override(st, StyleBoxEmpty.new())
		mouse_entered.connect(func() -> void:
			_hover = true
			queue_redraw())
		mouse_exited.connect(func() -> void:
			_hover = false
			queue_redraw())
		button_down.connect(queue_redraw)
		button_up.connect(queue_redraw)

	func _draw() -> void:
		var down := button_pressed and not disabled
		var off := 5.0 if down else 0.0
		var r := Rect2(Vector2(3, 2 + off), size - Vector2(6, 10))
		var fill := accent if not disabled else accent.darkened(0.55).lerp(Color(0.5, 0.5, 0.55), 0.5)
		if _hover and not disabled:
			fill = fill.lightened(0.12)
		var sb := UIKit.box(fill, UIKit.INK, 18, 4, 0 if down else 6)
		draw_style_box(sb, r)
		# the shine: a lighter diagonal band along the top-left
		var sh := PackedVector2Array([r.position + Vector2(10, 8), r.position + Vector2(r.size.x * 0.55, 8), r.position + Vector2(r.size.x * 0.4, r.size.y * 0.45), r.position + Vector2(10, r.size.y * 0.45)])
		draw_colored_polygon(sh, Color(1, 1, 1, 0.16))
		var has_icon := icon_name != ""
		var ix := r.position.x + (r.size.y * 0.55 if has_icon else 0.0)
		if has_icon:
			UIKit.draw_icon(self, icon_name, Vector2(ix, r.position.y + r.size.y * 0.5), r.size.y * 0.62, UIKit.CREAM if not disabled else Color(0.8, 0.8, 0.85))
		var tx := r.position.x + (r.size.y * 1.05 if has_icon else 0.0)
		var tw := r.end.x - tx - 10.0
		if sub == "":
			UIKit.draw_text(self, text, Vector2(tx, r.position.y + r.size.y * 0.5 + font_px * 0.36), font_px, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER if not has_icon else HORIZONTAL_ALIGNMENT_LEFT, tw)
		else:
			UIKit.draw_text(self, text, Vector2(tx, r.position.y + r.size.y * 0.5 - 2.0), font_px, UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_LEFT, tw)
			UIKit.draw_text(self, sub, Vector2(tx, r.position.y + r.size.y * 0.5 + font_px * 0.62), maxi(12, font_px / 2), Color(1, 1, 1, 0.9), false, HORIZONTAL_ALIGNMENT_LEFT, tw)
		if locked:
			UIKit.draw_icon(self, "lock", Vector2(r.end.x - 26, r.position.y + 26), 28.0, UIKit.YELLOW)


static func button(text: String, parent: Node, icon := "", accent := PINK, size := Vector2(260, 64), font_px := 26, sub := "") -> AnimeButton:
	var b := AnimeButton.new()
	b.text = text
	b.icon_name = icon
	b.accent = accent
	b.sub = sub
	b.font_px = font_px
	b.custom_minimum_size = size
	if parent != null:
		parent.add_child(b)
	return b
