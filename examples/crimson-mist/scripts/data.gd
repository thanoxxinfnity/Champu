class_name Data
extends RefCounted
## Every number and every line of text that is not logic: the cast, the monsters, items and recipes, the six missions of Chapter 1.

const L_WORLD := 1
const L_PLAYER := 2
const L_ENEMY := 4
const L_PROP := 8

const SAVE_PATH := "user://crimson_mist.json"

## Playable cast. `model` is looked up in assets/cast (public stand-ins) and private/models (licensed packs kept out of git).
const CAST := {
	"rachel": {"name": "Rachel Gardner", "role": "Ex-nurse", "model": "rachel", "height": 1.60, "hp": 100.0, "speed": 4.0, "stamina": 100.0, "carry": 10,
		"perk": "Field Medic — bandages heal 50% more.", "tint": Color(0.95, 0.85, 0.55), "voice": 1.0},
	"kafu": {"name": "Kafu", "role": "Idol streamer", "model": "kafu", "height": 1.58, "hp": 85.0, "speed": 4.4, "stamina": 110.0, "carry": 8,
		"perk": "Drone Eye — enemies near you are marked through walls.", "tint": Color(0.6, 0.65, 1.0), "voice": 1.2},
	"mococo": {"name": "Mococo Abyssgard", "role": "Fox courier", "model": "mococo", "height": 1.52, "hp": 80.0, "speed": 5.0, "stamina": 130.0, "carry": 9,
		"perk": "Quick Paws — dodge is cheaper and recovers fast.", "tint": Color(1.0, 0.7, 0.8), "voice": 1.35},
	"rina": {"name": "Rina Nakajima", "role": "Quiet scavenger", "model": "rina", "height": 1.58, "hp": 95.0, "speed": 4.2, "stamina": 100.0, "carry": 12,
		"perk": "Scavenger — finds one extra piece of every loot.", "tint": Color(1.0, 0.6, 0.6), "voice": 0.9},
	# the men of the last bus (equal numbers with the women)
	"ren": {"name": "Ren Takagi", "role": "Paramedic", "model": "ren", "height": 1.76, "hp": 105.0, "speed": 4.2, "stamina": 105.0, "carry": 10,
		"perk": "Triage — bandages heal 30% more and a first-aid kit is worth two.", "tint": Color(0.6, 0.9, 0.7), "voice": 0.78, "heal_mult": 1.3},
	"daichi": {"name": "Daichi Mori", "role": "Firefighter", "model": "daichi", "height": 1.86, "hp": 140.0, "speed": 3.7, "stamina": 95.0, "carry": 11,
		"perk": "Heavy Coat — takes 25% less damage from every hit.", "tint": Color(0.85, 0.85, 0.9), "voice": 0.68, "dmg_taken": 0.75},
	"haru": {"name": "Haru Sato", "role": "Student photographer", "model": "haru", "height": 1.66, "hp": 85.0, "speed": 4.8, "stamina": 120.0, "carry": 8,
		"perk": "Quick Feet — stamina comes back faster and the dodge is cheaper.", "tint": Color(0.65, 0.8, 1.0), "voice": 0.95, "regen": 36.0, "roll_cost": 14.0},
	"oda": {"name": "Captain Oda", "role": "Fisherman", "model": "oda", "height": 1.74, "hp": 120.0, "speed": 3.9, "stamina": 110.0, "carry": 12,
		"perk": "Sea Legs — hits harder with the crowbar and carries more.", "tint": Color(0.9, 0.8, 0.6), "voice": 0.72, "melee_mult": 1.2},
}
const CAST_ORDER := ["rachel", "ren", "kafu", "daichi", "mococo", "haru", "rina", "oda"]
## Who becomes the first and second companion when the player is not that character (a woman first, then a man, and so on).
const ALLY_ORDER := ["kafu", "ren", "mococo", "daichi", "rina", "haru", "rachel", "oda"]

const ENEMIES := {
	"mist_walker": {"name": "Mist Walker", "hp": 60.0, "speed": 1.7, "patrol": 0.8, "dmg": 12.0, "height": 1.75, "sight": 15.0, "hear": 20.0, "reach": 1.5,
		"cd": 1.3, "model": "mist_walker", "tint": Color(0.85, 0.7, 0.72)},
	"crawler": {"name": "Crawler", "hp": 34.0, "speed": 4.3, "patrol": 1.2, "dmg": 8.0, "height": 0.8, "sight": 12.0, "hear": 26.0, "reach": 1.2,
		"cd": 0.9, "model": "crawler", "tint": Color(0.8, 0.65, 0.7)},
	"bloater": {"name": "Bloater", "hp": 120.0, "speed": 1.1, "patrol": 0.6, "dmg": 6.0, "height": 2.0, "sight": 13.0, "hear": 18.0, "reach": 1.8,
		"cd": 1.6, "model": "bloater", "tint": Color(0.9, 0.6, 0.6)},
	"weeper": {"name": "Veil Weeper", "hp": 50.0, "speed": 4.0, "patrol": 0.0, "dmg": 22.0, "height": 1.7, "sight": 22.0, "hear": 30.0, "reach": 1.4,
		"cd": 1.4, "model": "weeper", "tint": Color(0.9, 0.9, 1.0)},
	"bellkeeper": {"name": "The Bellkeeper", "hp": 900.0, "speed": 1.9, "patrol": 0.0, "dmg": 30.0, "height": 4.2, "sight": 60.0, "hear": 60.0, "reach": 3.2,
		"cd": 2.2, "model": "bellkeeper", "tint": Color(1.0, 0.85, 0.7)},
}

const ITEMS := {
	"scrap": {"name": "Scrap", "icon": "S"}, "cloth": {"name": "Cloth", "icon": "C"}, "alcohol": {"name": "Alcohol", "icon": "A"},
	"fuel": {"name": "Fuel", "icon": "F"}, "fuse": {"name": "Fuse", "icon": "Z"}, "ammo": {"name": "Pistol ammo", "icon": "B"},
	"bandage": {"name": "Bandage", "icon": "+"}, "flare": {"name": "Flare", "icon": "!"}, "crowbar_plus": {"name": "Reinforced crowbar", "icon": "P"},
	"crowbar": {"name": "Crowbar", "icon": "P"}, "pistol": {"name": "Pistol", "icon": "G"}, "key": {"name": "Radio shop key", "icon": "K"},
}
const RECIPES := {
	"bandage": {"name": "Bandage", "needs": {"cloth": 1, "alcohol": 1}, "makes": 1},
	"flare": {"name": "Flare", "needs": {"scrap": 1, "fuel": 1}, "makes": 1},
	"crowbar_plus": {"name": "Reinforce crowbar", "needs": {"scrap": 2, "cloth": 1}, "makes": 1},
}
const WEAPONS := {
	"crowbar": {"dmg": 28.0, "reach": 2.2, "arc": 110.0, "rate": 0.62, "stam": 9.0, "knock": 3.0},
	"crowbar_plus": {"dmg": 42.0, "reach": 2.4, "arc": 120.0, "rate": 0.58, "stam": 9.0, "knock": 4.5},
	"pistol": {"dmg": 34.0, "range": 38.0, "rate": 0.32, "mag": 12, "reload": 1.3},
}

const MISSIONS := [
	{"id": "wake", "title": "1 · Red Dawn", "goal": "Search the ward for something to defend yourself with."},
	{"id": "power", "title": "2 · Lights On", "goal": "Restore the generator — find a fuel can and a fuse."},
	{"id": "rescue", "title": "3 · Static", "goal": "Cross Market Street to the radio shop and free {ally1}."},
	{"id": "craft", "title": "4 · Make Do", "goal": "Craft a bandage, a flare and a reinforced crowbar at the workbench."},
	{"id": "road", "title": "5 · The Bell Road", "goal": "Burn the barricade on the bell road and clear the way."},
	{"id": "boss", "title": "6 · The Bellkeeper", "goal": "Stop the Bellkeeper before the bell tolls again."},
]

const NOTES := [
	"Harbour log, 6:41 pm — the bell on the hill rang with nobody in the tower. The mist came up from the water right after. Don't breathe it. — Dock foreman",
	"Clinic memo — generator in the back room needs a fuse and fuel. Nurse desk has a spare fuse. Storage has the fuel. Keep the lights on, they don't like the light.",
	"Radio shop door sign: 'GONE TO THE CHURCH. TAKE WHAT YOU NEED. The workbench is in the back.'",
	"Torn page — the ones that don't move when you look at them are worse. Never turn your back on a weeping one.",
	"Church wall, scrawled in red — The Bellkeeper sleeps in the bell. Every toll wakes the mist.",
]


static func ally_name(owner: String, slot: int) -> String:
	var n := 0
	for id in ALLY_ORDER:
		if id == owner:
			continue
		n += 1
		if n == slot:
			return CAST[id].name.split(" ")[0]
	return "Someone"


static func ally_id(owner: String, slot: int) -> String:
	var n := 0
	for id in ALLY_ORDER:
		if id == owner:
			continue
		n += 1
		if n == slot:
			return id
	return ""


static func load_save() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var d = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	return d if d is Dictionary else {}


static func write_save(d: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
