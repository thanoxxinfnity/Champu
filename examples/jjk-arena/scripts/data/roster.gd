class_name Roster
extends RefCounted
## Playable characters. Gojo has two looks (blindfold / open eyes) and the player picks either; both share one rig and one move set.

const CHARACTERS := [
	{"id": "gojo_open", "name": "Gojo (open eyes)", "model": "res://assets/characters/gojo_free.glb", "domain": "infinite_void", "moves": "gojo"},
	{"id": "gojo_blindfold", "name": "Gojo (blindfold)", "model": "res://assets/characters/gojo_blindfold_tv.glb", "domain": "infinite_void", "moves": "gojo"},
	{"id": "sukuna", "name": "Sukuna", "model": "res://assets/characters/sukuna_FINAL.glb", "domain": "malevolent_shrine", "moves": "sukuna"},
	{"id": "mahoraga", "name": "Mahoraga", "model": "res://assets/characters/mahoraga_rigged.glb", "domain": "", "moves": "mahoraga"},
	{"id": "red_creature", "name": "Red Beast", "model": "res://assets/characters/creature_rigged.glb", "domain": "", "moves": "beast"},
]

static func find(id: String) -> Dictionary:
	for c in CHARACTERS:
		if c["id"] == id:
			return c
	return {}

static func gojo_variants() -> Array:
	return CHARACTERS.filter(func(c: Dictionary) -> bool: return c["moves"] == "gojo")
