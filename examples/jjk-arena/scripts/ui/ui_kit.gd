class_name UiKit
extends RefCounted
## Small helpers so every panel in the game shares one look: smoked glass, an orange accent, big readable type.

const ACCENT := Color(1.0, 0.54, 0.24)
const INK := Color(0.93, 0.93, 0.95)


static func panel_style(alpha := 0.88, radius := 14) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.06, 0.08, alpha)
	sb.set_corner_radius_all(radius)
	sb.set_border_width_all(1)
	sb.border_color = Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.55)
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 14
	sb.content_margin_bottom = 14
	return sb


static func button(text: String, size := Vector2(0, 44), font := 18) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = size
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", font)
	var n := StyleBoxFlat.new()
	n.bg_color = Color(0.14, 0.14, 0.17, 0.95)
	n.set_corner_radius_all(8)
	n.content_margin_left = 14
	n.content_margin_right = 14
	var h := n.duplicate() as StyleBoxFlat
	h.bg_color = Color(ACCENT.r, ACCENT.g, ACCENT.b, 0.9)
	b.add_theme_stylebox_override("normal", n)
	b.add_theme_stylebox_override("hover", h)
	b.add_theme_stylebox_override("pressed", h)
	b.add_theme_color_override("font_hover_color", Color.BLACK)
	return b


static func label(text: String, size := 18, color := INK) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", 4)
	return l
