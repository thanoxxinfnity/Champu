class_name Data
extends RefCounted
## Everything the game is made of, as plain tables: the 15 gauntlet weapons, the 6 survivors, the 4 block types, and the numbers of the train.

const SAVE_PATH := "user://city_shifter.json"

# ── the train ────────────────────────────────────────────────────────────────
const CARS := 6
const CAR_LEN := 12.0
const CAR_GAP := 3.0                  # the coupling gap between two cars: the thing the bridges are for
const CAR_W := 4.4
const DECK_Y := 3.0                   # the roof of the train
const TRAIN_SPEED := 22.0             # m/s the world slides past; "progress" counts it

# ── player ───────────────────────────────────────────────────────────────────
const PLAYER_SPEED := 6.2
const JET_FUEL := 100.0
const JET_THRUST := 28.0
const FALL_Y := -8.0

# ── debris / blocks ──────────────────────────────────────────────────────────
const DEBRIS_CAP := 50
const DEBRIS_TTL := 15.0
const DEBRIS_BEHIND := 50.0
const DEBRIS_FLOOR := -10.0
const BRIDGE_TTL := 24.0
const BRIDGE_CAP := 36

## Block types the SELECT BLOCK button cycles through.
const BLOCKS := {
	"steel": {"name": "STEEL", "color": Color(0.62, 0.7, 0.8), "ttl": 24.0, "note": "plain bridge"},
	"bounce": {"name": "BOUNCE", "color": Color(0.2, 0.9, 0.55), "ttl": 18.0, "note": "launches you up"},
	"glass": {"name": "GLASS", "color": Color(0.5, 0.85, 1.0), "ttl": 8.0, "note": "breaks after a few seconds"},
	"boost": {"name": "BOOST", "color": Color(1.0, 0.6, 0.15), "ttl": 18.0, "note": "speeds you forward"},
}
const BLOCK_ORDER := ["steel", "bounce", "glass", "boost"]

# ── weapons ──────────────────────────────────────────────────────────────────
## id: name, kind (what the shot does, see GauntletTool), range / force / cd as 0..1 bars (and the real numbers), how it is unlocked.
## `price` = coins, `level` = player level needed (0 = none). The first one is free.
const WEAPONS := {
	"shift_gauntlet": {"name": "SHIFT GAUNTLET", "kind": "shove", "range": 0.45, "force": 0.4, "cd": 0.75, "price": 0, "level": 0, "color": Color(0.2, 0.7, 1.0),
		"note": "A wide shove: pushes blocks and debris away."},
	"vortex_blaster": {"name": "VORTEX BLASTER", "kind": "vortex", "range": 0.55, "force": 0.55, "cd": 0.5, "price": 500, "level": 0, "color": Color(1.0, 0.65, 0.1),
		"note": "A spinning vortex that drags debris into a heap, then flings it."},
	"quantum_breaker": {"name": "QUANTUM BREAKER", "kind": "slam", "range": 0.3, "force": 0.9, "cd": 0.35, "price": 500, "level": 0, "color": Color(1.0, 0.35, 0.15),
		"note": "A hammer slam that shatters everything around you."},
	"gravity_carver": {"name": "GRAVITY CARVER", "kind": "carve", "range": 0.75, "force": 0.5, "cd": 0.6, "price": 500, "level": 0, "color": Color(0.25, 1.0, 0.5),
		"note": "A beam that carves blocks out of a line of rubble."},
	"plasma_magnet": {"name": "PLASMA MAGNET", "kind": "magnet", "range": 0.5, "force": 0.45, "cd": 0.55, "price": 500, "level": 0, "color": Color(0.3, 0.6, 1.0),
		"note": "Pulls debris to you; hold to keep it close."},
	"sonic_impactor": {"name": "SONIC IMPACTOR", "kind": "pierce", "range": 0.85, "force": 0.45, "cd": 0.7, "price": 900, "level": 6, "color": Color(1.0, 0.85, 0.2),
		"note": "A sound lance: pierces a whole line of debris."},
	"force_gauntlet": {"name": "FORCE GAUNTLET", "kind": "punch", "range": 0.2, "force": 1.0, "cd": 0.45, "price": 1100, "level": 7, "color": Color(0.7, 0.35, 1.0),
		"note": "A high-velocity punch: huge force on one target."},
	"seismic_rebounder": {"name": "SEISMIC REBOUNDER", "kind": "ring", "range": 0.6, "force": 0.7, "cd": 0.5, "price": 1300, "level": 8, "color": Color(0.8, 0.85, 0.95),
		"note": "A shockwave that runs along the roof and bounces back."},
	"saber_grapple": {"name": "SABER GRAPPLING", "kind": "grapple", "range": 0.8, "force": 0.4, "cd": 0.65, "price": 1500, "level": 9, "color": Color(0.3, 0.95, 1.0),
		"note": "A hook that pulls you across a gap, or pulls blocks to you."},
	"orbital_crush": {"name": "ORBITAL CRUSH", "kind": "crush", "range": 0.55, "force": 0.8, "cd": 0.45, "price": 1800, "level": 10, "color": Color(0.8, 0.35, 1.0),
		"note": "A gravity ball that crushes debris into shards."},
	"tactical_beamer": {"name": "TACTICAL BEAMER", "kind": "beam", "range": 1.0, "force": 0.3, "cd": 0.8, "price": 2200, "level": 11, "color": Color(0.2, 0.95, 1.0),
		"note": "A long beam that slices far-off debris."},
	"thermo_vaporizer": {"name": "THERMO VAPORIZER", "kind": "vaporize", "range": 0.35, "force": 0.3, "cd": 0.5, "price": 2500, "level": 12, "color": Color(1.0, 0.25, 0.2),
		"note": "A flame cone that turns debris into coin dust."},
	"chrono_sliders": {"name": "CHRONO SLIDERS", "kind": "slow", "range": 0.5, "force": 0.2, "cd": 0.85, "price": 2800, "level": 13, "color": Color(0.3, 0.7, 1.0),
		"note": "Slows time around you: debris crawls, you do not."},
	"nexus_tether": {"name": "NEXUS TETHER", "kind": "tether", "range": 0.7, "force": 0.35, "cd": 0.6, "price": 3200, "level": 14, "color": Color(1.0, 0.8, 0.2),
		"note": "Marks falling blocks and ties them together."},
	"meteor_burster": {"name": "METEOR BURSTER", "kind": "meteor", "range": 0.65, "force": 1.0, "cd": 0.2, "price": 4000, "level": 15, "color": Color(0.4, 1.0, 0.4),
		"note": "A meteor of gravity: a massive impact where you aim."},
}
const WEAPON_ORDER := ["shift_gauntlet", "vortex_blaster", "quantum_breaker", "gravity_carver", "plasma_magnet", "sonic_impactor", "force_gauntlet", "seismic_rebounder",
	"saber_grapple", "orbital_crush", "tactical_beamer", "thermo_vaporizer", "chrono_sliders", "nexus_tether", "meteor_burster"]

# ── the survivors ────────────────────────────────────────────────────────────
## model = file in assets/cast (a rigged glb; a built-in stand-in when it is missing), tint recolours the shared model of the variant.
const CAST := {
	"outlaw": {"name": "OUTLAW", "role": "Drifter with a red scarf", "model": "outlaw", "height": 1.78, "speed": 6.4, "fuel": 100.0, "hp": 100.0, "tint": Color.WHITE,
		"perk": "Quick draw: gauntlet cooldown -15%.", "cd_mult": 0.85, "male": true},
	"tracker": {"name": "TRACKER", "role": "Scout in orange", "model": "tracker", "height": 1.72, "speed": 6.8, "fuel": 110.0, "hp": 90.0, "tint": Color.WHITE,
		"perk": "Sky sense: debris is marked before it lands.", "mark": true, "male": false},
	"viper": {"name": "VIPER", "role": "Purple-haired tracker", "model": "tracker2", "height": 1.72, "speed": 7.0, "fuel": 100.0, "hp": 90.0, "tint": Color.WHITE,
		"perk": "Light feet: jetpack fuel lasts 20% longer.", "fuel_mult": 1.2, "male": false},
	"engineer": {"name": "HEAVY ENGINEER", "role": "Builds bridges, takes hits", "model": "engineer", "height": 1.9, "speed": 5.6, "fuel": 90.0, "hp": 150.0, "tint": Color.WHITE,
		"perk": "Steel hands: bridge blocks last twice as long.", "bridge_mult": 2.0, "male": true},
	"ninja": {"name": "TECH-NINJA", "role": "Fast and quiet", "model": "ninja", "height": 1.75, "speed": 7.4, "fuel": 120.0, "hp": 80.0, "tint": Color.WHITE,
		"perk": "Blink: the air dash costs half the fuel.", "dash_mult": 0.5, "male": true},
	"mechanic": {"name": "MECHANIC", "role": "Fixes what falls", "model": "mechanic", "height": 1.72, "speed": 6.2, "fuel": 100.0, "hp": 110.0, "tint": Color.WHITE,
		"perk": "Repair kit: coins from shards +50%.", "coin_mult": 1.5, "male": false},
}
const CAST_ORDER := ["outlaw", "tracker", "engineer", "viper", "ninja", "mechanic"]

# ── progression ──────────────────────────────────────────────────────────────
## Level from the best distance ever reached: 1 at the start, +1 per 600 m.
static func level_for(best_m: float) -> int:
	return 1 + int(best_m / 600.0)


static func weapon_unlocked(id: String, save: Dictionary) -> bool:
	var w: Dictionary = WEAPONS[id]
	if int(w.price) == 0:
		return true
	return (save.get("weapons", []) as Array).has(id)


static func weapon_buyable(id: String, save: Dictionary) -> String:
	## "" when it can be bought now, otherwise why not.
	var w: Dictionary = WEAPONS[id]
	if weapon_unlocked(id, save):
		return "owned"
	if level_for(float(save.get("best", 0.0))) < int(w.level):
		return "needs level %d" % int(w.level)
	if int(save.get("coins", 0)) < int(w.price):
		return "needs $%d" % int(w.price)
	return ""


static func load_save() -> Dictionary:
	var d := {"coins": 0, "best": 0.0, "weapons": [], "char": "outlaw", "weapon": "shift_gauntlet"}
	if FileAccess.file_exists(SAVE_PATH):
		var got = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if got is Dictionary:
			d.merge(got, true)
	return d


static func write_save(d: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
