extends Node
## Best scores and settings, kept between runs (user://chomu_save.cfg).
## Autoload name: Save

const PATH := "user://chomu_save.cfg"

var _cfg := ConfigFile.new()
## Lives only for this launch of the game: lets "Retry" restart without going back to the title.
var session := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_cfg.load(PATH)


func get_setting(key: String, default_value: Variant = null) -> Variant:
	return _cfg.get_value("settings", key, default_value)


func set_setting(key: String, value: Variant) -> void:
	_cfg.set_value("settings", key, value)
	_cfg.save(PATH)


## The best score stored under `key`, or `fallback` when there is none yet.
func best(key: String, fallback: float = 0.0) -> float:
	return float(_cfg.get_value("best", key, fallback))


func has_best(key: String) -> bool:
	return _cfg.has_section_key("best", key)


## Records `value`; returns true when it is a new best.
func submit(key: String, value: float, higher_is_better: bool = true) -> bool:
	var better := not has_best(key) or (value > best(key) if higher_is_better else value < best(key))
	if better:
		_cfg.set_value("best", key, value)
		_cfg.save(PATH)
	return better
