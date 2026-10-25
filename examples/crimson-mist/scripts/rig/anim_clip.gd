class_name AnimClip
extends RefCounted
## A motion made by MDM (tools/mdm_sample.py -> tools/joints_to_clip.py): PoseLib parameter frames at a fixed rate, sampled with interpolation.
## `speed` is the ground speed (m/s) the clip was captured at, so walk and run can be played at the character's real pace.

static var _cache := {}

var fps := 20.0
var loop := false
var hold := false
var speed := 0.0
var frames: Array = []


static func load_clip(name: String) -> AnimClip:
	if _cache.has(name):
		return _cache[name]
	var path := "res://assets/anim/%s.json" % name
	var clip: AnimClip = null
	if FileAccess.file_exists(path):
		var d = JSON.parse_string(FileAccess.get_file_as_string(path))
		if d is Dictionary:
			clip = AnimClip.new()
			clip.fps = float(d.get("fps", 20))
			clip.loop = bool(d.get("loop", false))
			clip.hold = bool(d.get("hold", false))
			clip.speed = float(d.get("speed", 0.0))
			for f in d["frames"]:
				var p := {}
				for k in f:
					p[k] = Vector3(f[k][0], f[k][1], f[k][2]) if f[k] is Array else float(f[k])
				clip.frames.append(p)
	_cache[name] = clip
	return clip


func duration() -> float:
	return frames.size() / fps


func sample(t: float) -> Dictionary:
	var n := frames.size()
	var x := t * fps
	if loop:
		x = fposmod(x, float(n))
	else:
		x = clampf(x, 0.0, n - 1.0)
	var i := int(floor(x))
	var j := (i + 1) % n if loop else mini(i + 1, n - 1)
	return PoseLib.mix(frames[i], frames[j], x - i)


## Pose at normalised progress 0..1 through the clip (no looping).
func at(progress: float) -> Dictionary:
	return sample(clampf(progress, 0.0, 1.0) * (frames.size() - 1) / fps)
