class_name UiArt
extends RefCounted
## The HUD drawables (assets/ui, made by tools/make_ui.py): white frosted-glass discs, panels, pills and glyphs. Everything falls back to nothing when a
## file is missing, so the HUD code can keep a plain-shape fallback and headless tests never depend on the PNGs.

const DIR := "res://assets/ui/"

static var _tex := {}
static var _box := {}

# button id on the HUD -> glyph
const GLYPH := {"attack": "attack", "dodge": "dodge", "shoot": "shoot", "use": "use", "reload": "reload", "bandage": "heal", "flare": "flare", "sprint": "run",
	"pause": "pause", "light": "lamp", "bag": "bag"}


static func tex(name: String) -> Texture2D:
	if DisplayServer.get_name() == "headless":
		return null
	if not _tex.has(name):
		var path := "%s%s.png" % [DIR, name]
		_tex[name] = load(path) if ResourceLoader.exists(path) else null
	return _tex[name]


## A nine-patch from a panel texture: `margin` pixels of the picture stay un-stretched on every side.
static func box(name: String, margin: int) -> StyleBoxTexture:
	var key := "%s/%d" % [name, margin]
	if not _box.has(key):
		var t := tex(name)
		if t == null:
			_box[key] = null
		else:
			var sb := StyleBoxTexture.new()
			sb.texture = t
			sb.texture_margin_left = margin
			sb.texture_margin_right = margin
			sb.texture_margin_top = margin
			sb.texture_margin_bottom = margin
			_box[key] = sb
	return _box[key]
