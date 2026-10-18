class_name GameState
extends Node
## Everything that survives a save: money, the outfit, which car is the player's, how far the story has got. Wanted level lives here
## too because the HUD, the phone and the police all read it.

signal changed
signal wanted_changed(stars: int)

const SAVE_PATH := "user://crimson_metropolis.cfg"
const OUTFITS := [
	{"name": "Street Hacker", "tint": Color(1, 1, 1)},
	{"name": "Night Suit", "tint": Color(0.34, 0.36, 0.45)},
	{"name": "Crimson Jacket", "tint": Color(1.0, 0.45, 0.42)},
]

var cash := 14582
var bank := 120000
var outfit := 0
var garage_car := "sedan"
var mission_stage := 0          # 0 not started, 1.. steps of "The Penthouse Deal", 99 finished
var stars := 0
var play_hours := 0.0
var slept_nights := 0
var save_path := SAVE_PATH


func add_cash(n: int) -> void:
	cash = maxi(0, cash + n)
	changed.emit()


func transfer_to_bank(n: int) -> bool:
	if n <= 0 or n > cash:
		return false
	cash -= n
	bank += n
	changed.emit()
	return true


func withdraw(n: int) -> bool:
	if n <= 0 or n > bank:
		return false
	bank -= n
	cash += n
	changed.emit()
	return true


func set_stars(n: int) -> void:
	n = clampi(n, 0, 5)
	if n == stars:
		return
	stars = n
	wanted_changed.emit(stars)
	changed.emit()


func raise_stars(to: int) -> void:
	if to > stars:
		set_stars(to)


func set_outfit(i: int) -> void:
	outfit = posmod(i, OUTFITS.size())
	changed.emit()


func save() -> bool:
	var c := ConfigFile.new()
	for k in ["cash", "bank", "outfit", "garage_car", "mission_stage", "play_hours", "slept_nights"]:
		c.set_value("game", k, get(k))
	return c.save(save_path) == OK


func load_save() -> bool:
	var c := ConfigFile.new()
	if c.load(save_path) != OK:
		return false
	for k in ["cash", "bank", "outfit", "garage_car", "mission_stage", "play_hours", "slept_nights"]:
		if c.has_section_key("game", k):
			set(k, c.get_value("game", k))
	changed.emit()
	return true
