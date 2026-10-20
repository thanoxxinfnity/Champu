class_name AnimClip
extends RefCounted
## A motion captured from a video (tools/video_to_pose.py): a list of PoseLib parameter frames at a fixed rate, sampled with interpolation.

static var _cache := {}

var fps := 12.0
var frames: Array = []

static func load_clip(name: String) -> AnimClip:
	if _cache.has(name):
		return _cache[name]
	var path := "res://assets/anim/%s.json" % name
	if not FileAccess.file_exists(path):
		return null
	var d = JSON.parse_string(FileAccess.get_file_as_string(path))
	if d == null:
		return null
	var c := AnimClip.new()
	c.fps = d["fps"]
	for f in d["frames"]:
		var p := {}
		for k in f:
			p[k] = Vector3(f[k][0], f[k][1], f[k][2]) if f[k] is Array else float(f[k])
		c.frames.append(p)
	_cache[name] = c
	return c

func duration() -> float:
	return frames.size() / fps

func sample(t: float, loop := true) -> Dictionary:
	var x := t * fps
	var n := frames.size()
	if loop:
		x = fposmod(x, float(n))
	else:
		x = clampf(x, 0.0, n - 1.0)
	var i := int(floor(x))
	var j := (i + 1) % n if loop else mini(i + 1, n - 1)
	return PoseLib.mix(frames[i], frames[j], x - i)
