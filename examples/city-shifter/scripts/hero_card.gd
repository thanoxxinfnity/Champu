class_name HeroCard
extends Control
## A collectible battle card: the hero's portrait on a rarity-coloured background with light rays, an ink frame, the rarity chip and stars, the name plate with the
## hero's title, and three stat bars (SPEED, HEALTH, JET). In "player" mode the same card is the player's own: their name, the hero they play, level, matches, wins.
## Every text is fitted into its box (UIKit.draw_text shrinks it), so nothing can run out of the card.

const RARITY := {
	"COMMON": {"top": Color(0.62, 0.78, 0.95), "bot": Color(0.35, 0.5, 0.78), "rim": Color(0.85, 0.93, 1.0), "stars": 1},
	"RARE": {"top": Color(0.45, 0.85, 1.0), "bot": Color(0.2, 0.45, 0.9), "rim": Color(0.75, 0.95, 1.0), "stars": 2},
	"EPIC": {"top": Color(0.8, 0.55, 1.0), "bot": Color(0.42, 0.25, 0.85), "rim": Color(0.93, 0.8, 1.0), "stars": 3},
	"LEGENDARY": {"top": Color(1.0, 0.85, 0.35), "bot": Color(0.95, 0.4, 0.55), "rim": Color(1.0, 0.95, 0.7), "stars": 4},
}

var hero_id := "outlaw":
	set(v):
		hero_id = v
		queue_redraw()
var locked := false:
	set(v):
		locked = v
		queue_redraw()
var skill_total := 0:
	set(v):
		skill_total = v
		queue_redraw()
var mode := "hero"                       # "hero" | "player"
var player := {}                         # player mode: {name, level, matches, wins, best}
var _tex := {}
var _t := 0.0


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_process(true)


func _process(delta: float) -> void:
	_t += delta
	if visible and Data.rarity_of(hero_id) == "LEGENDARY":
		queue_redraw()                   # the sparkles


func _portrait(id: String) -> Texture2D:
	if not _tex.has(id):
		var p := "res://assets/ui/cards/%s.png" % id
		_tex[id] = load(p) as Texture2D if ResourceLoader.exists(p) else null
	return _tex[id]


func _draw() -> void:
	var w := size.x
	var h := size.y
	if w < 40.0 or not Data.CAST.has(hero_id):
		return
	var info: Dictionary = Data.CAST[hero_id]
	var rar := Data.rarity_of(hero_id)
	var rc: Dictionary = RARITY[rar]
	var top: Color = rc.top
	var bot: Color = rc.bot
	var rim: Color = rc.rim
	var u := w / 300.0                   # everything below is designed for a 300-wide card
	# the body: a vertical gradient inside a rounded ink frame
	draw_style_box(UIKit.box(bot, UIKit.INK, int(24 * u), maxi(4, int(6 * u)), 0), Rect2(Vector2.ZERO, size))
	var gi := 7.0 * u
	draw_polygon(PackedVector2Array([Vector2(gi, gi + 14 * u), Vector2(w - gi, gi + 14 * u), Vector2(w - gi, h - gi), Vector2(gi, h - gi)]),
		PackedColorArray([top, top, bot, bot]))
	# light rays from behind the hero
	var ctr := Vector2(w * 0.5, h * 0.42)
	for i in 9:
		var a0 := float(i) / 9.0 * TAU + _t * 0.05
		var a1 := a0 + TAU / 18.0
		draw_colored_polygon(PackedVector2Array([ctr, ctr + Vector2(cos(a0), sin(a0)) * h, ctr + Vector2(cos(a1), sin(a1)) * h]), Color(1, 1, 1, 0.1))
	draw_circle(ctr, w * 0.34, Color(1, 1, 1, 0.16))
	draw_circle(ctr, w * 0.24, Color(1, 1, 1, 0.14))
	# the portrait, standing on the name plate
	var tex := _portrait(hero_id)
	var art := Rect2(gi + 2, h * 0.07, w - gi * 2 - 4, h * 0.66)
	if tex != null:
		var ts := tex.get_size()
		var k := minf(art.size.x / ts.x, art.size.y / ts.y) * 1.08
		var dr := Vector2(ts.x * k, ts.y * k)
		var tint := Color(1, 1, 1, 1) if not locked else Color(0.34, 0.28, 0.5, 1)
		draw_texture_rect(tex, Rect2(Vector2(w * 0.5 - dr.x * 0.5, art.end.y - dr.y + dr.y * 0.02), dr), false, tint)
	else:
		UIKit.draw_icon(self, "user", ctr, w * 0.4, Color(1, 1, 1, 0.8))
	# inner rim
	draw_style_box(_rim_box(rim, int(20 * u), maxi(2, int(3 * u))), Rect2(Vector2(gi, gi), size - Vector2(gi, gi) * 2.0))
	# the rarity chip (top-left) and the stars (top-right)
	var chip_w := 108.0 * u
	draw_style_box(UIKit.box(UIKit.INK, UIKit.INK, int(10 * u), 2, 0), Rect2(14 * u, 14 * u, chip_w, 26 * u))
	UIKit.draw_text(self, rar, Vector2(14 * u, 34 * u), int(17 * u), rim, true, HORIZONTAL_ALIGNMENT_CENTER, chip_w - 8.0 * u)
	for i in int(rc.stars):
		UIKit.draw_icon(self, "star", Vector2(w - 28 * u - float(i) * 24 * u, 28 * u), 22 * u, Color(1.0, 0.88, 0.3))
	if locked:
		UIKit.draw_icon(self, "lock", ctr, w * 0.3, UIKit.YELLOW)
	# the name plate
	var plate := Rect2(12 * u, h * 0.7, w - 24 * u, 58 * u)
	draw_style_box(UIKit.box(Color(UIKit.INK.r, UIKit.INK.g, UIKit.INK.b, 0.92), UIKit.INK, int(14 * u), 3, 0), plate)
	var nm := String(info.name) if mode == "hero" else String(player.get("name", "PLAYER"))
	UIKit.draw_text(self, nm, Vector2(plate.position.x + 8 * u, plate.position.y + 30 * u), int(28 * u), UIKit.CREAM, true, HORIZONTAL_ALIGNMENT_CENTER, plate.size.x - 16 * u)
	var sub := String(info.get("title", "")) if mode == "hero" else "plays %s" % String(info.get("short", info.name))
	UIKit.draw_text(self, sub, Vector2(plate.position.x + 8 * u, plate.position.y + 51 * u), int(16 * u), top.lightened(0.3), false, HORIZONTAL_ALIGNMENT_CENTER, plate.size.x - 16 * u)
	# the bottom: stat bars, or the player's record
	var by := plate.end.y + 8 * u
	if mode == "hero":
		var st := Data.card_stats(hero_id)
		var names := ["SPD", "HP", "JET"]
		var icons := ["bolt", "heart", "jet"]
		var cols := [Color(0.4, 0.85, 1.0), Color(1.0, 0.45, 0.62), Color(1.0, 0.65, 0.2)]
		for i in 3:
			var ry := by + float(i) * 15.0 * u
			UIKit.draw_icon(self, String(icons[i]), Vector2(24 * u, ry + 6 * u), 14 * u, cols[i])
			draw_style_box(UIKit.box(Color(0, 0, 0, 0.35), UIKit.INK, int(5 * u), 2, 0), Rect2(40 * u, ry, w - 80 * u, 12 * u))
			draw_style_box(UIKit.box(cols[i], UIKit.INK, int(5 * u), 2, 0), Rect2(40 * u, ry, maxf(10 * u, (w - 80 * u) * float(st[i])), 12 * u))
		if skill_total > 0:
			UIKit.draw_text(self, "LV %d" % skill_total, Vector2(w - 40 * u, by + 42 * u), int(13 * u), Color(1, 0.95, 0.6), true, HORIZONTAL_ALIGNMENT_RIGHT, 36 * u)
	else:
		var rows := [["LEVEL", str(int(player.get("level", 1)))], ["MATCHES", str(int(player.get("matches", 0)))], ["WINS", str(int(player.get("wins", 0)))]]
		for i in 3:
			var ry2 := by + float(i) * 15.0 * u
			UIKit.draw_text(self, String(rows[i][0]), Vector2(24 * u, ry2 + 11 * u), int(13 * u), UIKit.CREAM, false, HORIZONTAL_ALIGNMENT_LEFT, 110 * u)
			UIKit.draw_text(self, String(rows[i][1]), Vector2(w * 0.5, ry2 + 11 * u), int(15 * u), UIKit.YELLOW, true, HORIZONTAL_ALIGNMENT_RIGHT, w * 0.5 - 24 * u)
	# legendary sparkle
	if rar == "LEGENDARY" and not locked:
		for i in 6:
			var ph := _t * 1.4 + float(i) * 1.7
			var sp := Vector2(w * (0.12 + 0.76 * fmod(float(i) * 0.37 + 0.11, 1.0)), h * (0.1 + 0.5 * fmod(float(i) * 0.53 + 0.2, 1.0)))
			var sz := (6.0 + 5.0 * sin(ph)) * u
			if sz > 3.0:
				UIKit.draw_icon(self, "star", sp, sz * 2.0, Color(1, 1, 0.85, 0.9))


var _rim_cache := {}


func _rim_box(c: Color, radius: int, bw: int) -> StyleBoxFlat:
	var key := "%s%d%d" % [c, radius, bw]
	if not _rim_cache.has(key):
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0, 0, 0, 0)
		sb.draw_center = false
		sb.border_color = c
		sb.set_border_width_all(bw)
		sb.set_corner_radius_all(radius)
		_rim_cache[key] = sb
	return _rim_cache[key]
