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
const SKYDIVE_Y := 240.0             # a match begins with every player falling from this height

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
	"nova_blaster": {"name": "NOVA BLASTER", "kind": "pierce", "range": 0.9, "force": 0.4, "cd": 0.35, "price": 0, "level": 0, "color": Color(0.35, 0.9, 1.0),
		"note": "A fast anime pistol: a bright bolt through a whole line of debris."},
	"genesis_cannon": {"name": "GENESIS CANNON", "kind": "meteor", "range": 0.8, "force": 1.0, "cd": 0.85, "price": 6000, "level": 18, "color": Color(0.7, 0.6, 1.0),
		"note": "The universal destruction weapon: one blast, a huge crater."},
}
## The match: damage (to people) and charge cost (fraction of the 60 s tank) per shot. Melee weapons cost nothing. The 15 gauntlets keep their block-breaking jobs too.
const DAMAGE := {
	"shift_gauntlet": {"dmg": 14.0, "cost": 0.12}, "vortex_blaster": {"dmg": 26.0, "cost": 0.30}, "quantum_breaker": {"dmg": 38.0, "cost": 0.35},
	"gravity_carver": {"dmg": 24.0, "cost": 0.20}, "plasma_magnet": {"dmg": 9.0, "cost": 0.25}, "sonic_impactor": {"dmg": 30.0, "cost": 0.25},
	"force_gauntlet": {"dmg": 52.0, "cost": 0.22}, "seismic_rebounder": {"dmg": 22.0, "cost": 0.28}, "saber_grapple": {"dmg": 14.0, "cost": 0.25},
	"orbital_crush": {"dmg": 36.0, "cost": 0.30}, "tactical_beamer": {"dmg": 24.0, "cost": 0.20}, "thermo_vaporizer": {"dmg": 34.0, "cost": 0.30},
	"chrono_sliders": {"dmg": 6.0, "cost": 0.45}, "nexus_tether": {"dmg": 10.0, "cost": 0.40}, "meteor_burster": {"dmg": 62.0, "cost": 0.60},
	"nova_blaster": {"dmg": 12.0, "cost": 0.10}, "genesis_cannon": {"dmg": 90.0, "cost": 0.75},
	"hammer": {"dmg": 46.0, "cost": 0.0}, "hammer_big": {"dmg": 82.0, "cost": 0.0}, "katana": {"dmg": 30.0, "cost": 0.0}, "axe": {"dmg": 42.0, "cost": 0.0},
	"spear": {"dmg": 34.0, "cost": 0.0},
}
const CHARGE_SECONDS := 60.0          # an emptied gauntlet needs a whole minute to be full again (and cannot fire until it is); every one refills while you use another
const VIEW_RADIUS := 50.0             # how far everybody sees: the same for all, nobody can raise it (no advantage)
const HAND_SLOTS := 5                 # weapons you can carry (the hammer included)
const MATCH_SECONDS := 360.0
const MAX_PLAYERS := 15
## The matchmaking server (server/server.py). Change it here or with the "server" key in the save file; see server/README.md.
const MATCH_SERVER := "p2p"          # no server: phones meet through a free public relay (P2PMatchmaker); or the ws:// address of server/server.py
const TEAM_SIZE := 4

## Melee: a swing in front of you. `reach` m, `arc` half-angle degrees, `cd` seconds, `smash` = also breaks blocks and trees around the hit.
const MELEE := {
	"hammer": {"name": "BREAKER HAMMER", "kind": "swing", "reach": 3.0, "arc": 55.0, "cd": 0.8, "smash": true, "color": Color(0.9, 0.7, 0.3), "model": "hammer", "len": 1.1,
		"note": "Breaks blocks, trees and bones. Everybody carries one."},
	"hammer_big": {"name": "TITAN SLEDGE", "kind": "swing", "reach": 4.2, "arc": 70.0, "cd": 1.3, "smash": true, "color": Color(1.0, 0.45, 0.2), "model": "hammer_big", "len": 1.6,
		"note": "Huge and slow. One hit takes most of a life."},
	"katana": {"name": "BLUE KATANA", "kind": "swing", "reach": 2.7, "arc": 45.0, "cd": 0.38, "smash": false, "color": Color(0.3, 0.8, 1.0), "model": "katana", "len": 1.2,
		"note": "Fast cuts."},
	"axe": {"name": "WAR AXE", "kind": "swing", "reach": 3.0, "arc": 60.0, "cd": 0.7, "smash": true, "color": Color(0.9, 0.3, 0.3), "model": "axe", "len": 1.3,
		"note": "Heavy and wide: breaks things too."},
	"spear": {"name": "GOLD SPEAR", "kind": "swing", "reach": 4.6, "arc": 25.0, "cd": 0.6, "smash": false, "color": Color(1.0, 0.85, 0.3), "model": "spear", "len": 2.2,
		"note": "Long reach, narrow thrust."},
}
const ABBR := {"shift_gauntlet": "SHF", "vortex_blaster": "VTX", "quantum_breaker": "QBK", "gravity_carver": "GRV", "plasma_magnet": "PLM", "sonic_impactor": "SNC",
	"force_gauntlet": "FRC", "seismic_rebounder": "SSM", "saber_grapple": "SBR", "orbital_crush": "ORB", "tactical_beamer": "TAC", "thermo_vaporizer": "THM",
	"chrono_sliders": "CHR", "nexus_tether": "NXS", "meteor_burster": "MTR", "nova_blaster": "NVA", "genesis_cannon": "GEN", "hammer": "HAM", "hammer_big": "TIT", "katana": "KAT", "axe": "AXE", "spear": "SPR"}
const MELEE_ORDER := ["hammer", "hammer_big", "katana", "axe", "spear"]

const WEAPON_ORDER := ["shift_gauntlet", "vortex_blaster", "quantum_breaker", "gravity_carver", "plasma_magnet", "sonic_impactor", "force_gauntlet", "seismic_rebounder",
	"saber_grapple", "orbital_crush", "tactical_beamer", "thermo_vaporizer", "chrono_sliders", "nexus_tether", "meteor_burster", "nova_blaster", "genesis_cannon"]

# ── the survivors ────────────────────────────────────────────────────────────
## model = file in assets/cast (a rigged glb; a built-in stand-in when it is missing), tint recolours the shared model of the variant.
const CAST := {
	"outlaw": {"name": "RYO KAGAMI", "short": "RYO", "title": "Crimson Drifter", "role": "Drifter with a red scarf", "model": "outlaw", "height": 1.78, "bright": 1.15, "speed": 6.4, "fuel": 100.0, "hp": 100.0, "tint": Color.WHITE,
		"perk": "Quick draw: gauntlet cooldown -15%.", "cd_mult": 0.85, "male": true},
	"tracker": {"name": "AKARI HOSHINO", "short": "AKARI", "title": "Sky Scout", "role": "Scout in orange", "model": "tracker", "height": 1.72, "speed": 6.8, "fuel": 110.0, "hp": 90.0, "tint": Color.WHITE,
		"perk": "Sky sense: debris is marked before it lands.", "mark": true, "male": false},
	"viper": {"name": "YUZU AMAKAWA", "short": "YUZU", "title": "Violet Viper", "role": "Purple-haired tracker", "model": "viper", "height": 1.68, "speed": 7.0, "fuel": 100.0, "hp": 90.0, "tint": Color.WHITE,
		"perk": "Light feet: jetpack fuel lasts 20% longer.", "fuel_mult": 1.2, "male": false, "price": 500},
	"engineer": {"name": "GORO IRONHEART", "short": "GORO", "title": "Bridge Titan", "role": "Builds bridges, takes hits", "model": "engineer", "height": 1.9, "speed": 5.6, "fuel": 90.0, "hp": 150.0, "tint": Color.WHITE,
		"perk": "Steel hands: bridge blocks last twice as long.", "bridge_mult": 2.0, "male": true, "price": 800},
	"ninja": {"name": "HAYATE KURO", "short": "HAYATE", "title": "Tech Ninja", "role": "Fast and quiet", "model": "ninja", "height": 1.75, "speed": 7.4, "fuel": 120.0, "hp": 80.0, "tint": Color.WHITE,
		"perk": "Blink: the air dash costs half the fuel.", "dash_mult": 0.5, "male": true, "price": 500},
	"mechanic": {"name": "MIKU TSUBAKI", "short": "MIKU", "title": "Scrap Sorceress", "role": "Fixes what falls", "model": "mechanic", "height": 1.72, "speed": 6.2, "fuel": 100.0, "hp": 110.0, "tint": Color.WHITE,
		"perk": "Repair kit: coins from shards +50%.", "coin_mult": 1.5, "male": false},
	"school": {"name": "SAKURA MIYAKE", "short": "SAKURA", "title": "Petal Sprinter", "role": "Sailor-suit sprinter", "model": "school", "height": 1.6, "speed": 7.1, "fuel": 100.0, "hp": 85.0, "tint": Color.WHITE,
		"perk": "Light as a petal: runs 10% faster.", "male": false, "price": 500},
	"kunoichi": {"name": "KAGE SHIRANUI", "short": "KAGE", "title": "Shadow Blossom", "role": "Purple-scarf kunoichi", "model": "kunoichi", "height": 1.65, "speed": 7.2, "fuel": 110.0, "hp": 85.0, "tint": Color.WHITE,
		"perk": "Shadow step: the air dash costs 40% less fuel.", "dash_mult": 0.6, "male": false, "price": 800},
	"cyber": {"name": "REN MIDORIKAWA", "short": "REN", "title": "Neon Rider", "role": "Goggles and a green jacket", "model": "cyber", "height": 1.7, "speed": 6.6, "fuel": 100.0, "hp": 95.0, "tint": Color.WHITE,
		"perk": "Overclock: the jetpack cools 35% faster.", "cool_mult": 1.35, "male": true, "price": 800},
	"samurai": {"name": "RYUJIN HONDA", "short": "RYUJIN", "title": "Crimson Blade", "role": "Red-armour swordsman", "model": "samurai", "height": 1.8, "speed": 6.3, "fuel": 95.0, "hp": 110.0, "tint": Color.WHITE,
		"perk": "Bushido: melee weapons hit 25% harder.", "melee_mult": 1.25, "male": true, "price": 1200},
	"mage": {"name": "YUKINE SHIRAYUKI", "short": "YUKINE", "title": "Frost Empress", "role": "Frost-robe mage", "model": "mage", "height": 1.62, "speed": 6.2, "fuel": 100.0, "hp": 80.0, "tint": Color.WHITE,
		"perk": "Arcane tank: gauntlets recharge 25% faster.", "charge_mult": 1.25, "male": false, "price": 1200},
	"monk": {"name": "GENSHO DAIGO", "short": "GENSHO", "title": "Stone Monk", "role": "Orange-robe warrior monk", "model": "monk", "height": 1.75, "speed": 6.0, "fuel": 100.0, "hp": 120.0, "tint": Color.WHITE,
		"perk": "Stone skin: takes 15% less damage.", "dmg_taken": 0.85, "male": true, "price": 1200},
	"pirate": {"name": "CAPTAIN KURO", "short": "KURO", "title": "Plunder King", "role": "Coat and tricorn", "model": "pirate", "height": 1.8, "speed": 6.2, "fuel": 100.0, "hp": 100.0, "tint": Color.WHITE,
		"perk": "Plunder: +50% coins from every match.", "coin_mult": 1.5, "male": true, "price": 1600},
	"knight": {"name": "LUMINA ARGENT", "short": "LUMINA", "title": "Silver Paladin", "role": "Silver-armour knight", "model": "knight", "height": 1.7, "speed": 5.8, "fuel": 90.0, "hp": 140.0, "tint": Color.WHITE,
		"perk": "Plate armour: 140 HP.", "male": false, "price": 1600},
	"kafu": {"name": "KAFU", "short": "KAFU", "title": "Silver Idol", "role": "Silver-haired idol in a lavender coat", "model": "kafu", "height": 1.58, "gait": "mdm", "speed": 6.9, "fuel": 105.0, "hp": 85.0, "tint": Color.WHITE,
		"perk": "Encore: gauntlets recharge 20% faster.", "charge_mult": 1.2, "male": false, "price": 2000},
	"rachel": {"name": "RACHEL GARDNER", "short": "RACHEL", "title": "Field Nurse", "role": "Gentle medic with endless blonde hair", "model": "rachel", "height": 1.68, "speed": 6.5, "fuel": 100.0, "hp": 100.0, "tint": Color.WHITE,
		"perk": "First aid: heals 4 HP a second when not hit for 5 s.", "regen": 4.0, "male": false, "price": 2000},
	"rina": {"name": "RINA NAKAJIMA", "short": "RINA", "title": "Crimson Cheer", "role": "Blonde sprinter in a red sport suit", "model": "rina", "height": 1.62, "speed": 7.2, "fuel": 100.0, "hp": 85.0, "tint": Color.WHITE,
		"perk": "Cheer up: the jetpack cools 30% faster.", "cool_mult": 1.3, "male": false, "price": 2000},
	"mococo": {"name": "MOCOCO ABYSSGARD", "short": "MOCOCO", "title": "Fox of the Abyss", "role": "Fox-girl with a big fluffy tail", "model": "mococo_full", "height": 1.55, "speed": 7.0, "fuel": 110.0, "hp": 85.0, "tint": Color.WHITE,
		"perk": "Fox reflexes: the air dash costs 40% less fuel.", "dash_mult": 0.6, "male": false, "price": 2000},
}
# tracker, mechanic and mage stay in CAST (old saves still load them) but are off the roster: their generated meshes were too broken
const CAST_ORDER := ["outlaw", "viper", "ninja", "school", "engineer", "kunoichi", "cyber", "samurai", "monk", "pirate", "knight", "kafu", "rachel", "rina", "mococo"]
## Free at the start; every other survivor is bought in the shop (a character has a small perk, never a weapon: nobody buys an advantage that matters).
const STARTERS := ["outlaw", "viper", "school"]

# ── skills ───────────────────────────────────────────────────────────────────
## Every hero has its own skill levels (0..SKILL_MAX), bought with coins on the SKILLS screen. Each level is a small bonus; none of them touches the 50 m view radius.
const SKILL_MAX := 10
const SKILLS := {
	"vitality": {"name": "VITALITY", "icon": "heart", "per": "+4% max health", "base": 80},
	"armor": {"name": "TOUGH SKIN", "icon": "shield", "per": "-2.5% damage taken", "base": 120},
	"sprint": {"name": "SPRINT", "icon": "bolt", "per": "+2.5% run speed", "base": 90},
	"tank": {"name": "JET TANK", "icon": "jet", "per": "+5% jetpack fuel", "base": 90},
	"cooling": {"name": "COOLING", "icon": "flame", "per": "+6% jetpack cooling", "base": 90},
	"dash": {"name": "AIR DASH", "icon": "burst", "per": "-4% dash fuel cost", "base": 100},
	"driving": {"name": "DRIVING", "icon": "wheel", "per": "+3% vehicle speed, +3% handling", "base": 110},
	"riding": {"name": "HORSEMANSHIP", "icon": "horse", "per": "+3% horse speed", "base": 100},
	"power": {"name": "FIREPOWER", "icon": "burst", "per": "+3% gauntlet damage", "base": 140},
	"efficiency": {"name": "EFFICIENCY", "icon": "cube", "per": "-3% charge used per shot", "base": 130},
	"melee": {"name": "MELEE MASTERY", "icon": "sword", "per": "+4% hammer, blade and axe damage", "base": 120},
	"builder": {"name": "BUILDER", "icon": "bridge", "per": "+6% bridge block life", "base": 80},
	"luck": {"name": "TREASURE HUNTER", "icon": "coin", "per": "+5% coins", "base": 100},
}
const SKILL_ORDER := ["vitality", "armor", "sprint", "tank", "cooling", "dash", "driving", "riding", "power", "efficiency", "melee", "builder", "luck"]


static func skill_level(save: Dictionary, cid: String, sid: String) -> int:
	return int(((save.get("skills", {}) as Dictionary).get(cid, {}) as Dictionary).get(sid, 0))


## "+12% max health": the skill's text with its percentages multiplied by the level.
static func skill_now(sid: String, lv: int) -> String:
	var per: String = SKILLS[sid].per
	var re := RegEx.new()
	re.compile("([+-])(\\d+(?:\\.\\d+)?)%")
	var out := ""
	var last := 0
	for m in re.search_all(per):
		out += per.substr(last, m.get_start() - last)
		var v := float(m.get_string(2)) * float(lv)
		out += "%s%s%%" % [m.get_string(1), ("%d" % int(v)) if is_equal_approx(v, round(v)) else ("%.1f" % v)]
		last = m.get_end()
	return "now " + out + per.substr(last)


## Coins for the next level of a skill, 0 when it is at the top.
static func skill_cost(level: int, sid: String) -> int:
	if level >= SKILL_MAX:
		return 0
	return int(round(float(SKILLS[sid].base) * pow(1.42, float(level)) / 10.0)) * 10


## "" when the next level can be bought now, else why not.
static func skill_buyable(save: Dictionary, cid: String, sid: String) -> String:
	var lv := skill_level(save, cid, sid)
	if lv >= SKILL_MAX:
		return "MAX"
	if int(save.get("coins", 0)) < skill_cost(lv, sid):
		return "needs $%d" % skill_cost(lv, sid)
	return ""


static func skill_buy(save: Dictionary, cid: String, sid: String) -> bool:
	if skill_buyable(save, cid, sid) != "":
		return false
	var lv := skill_level(save, cid, sid)
	save.coins = int(save.coins) - skill_cost(lv, sid)
	var all: Dictionary = save.get("skills", {})
	var mine: Dictionary = all.get(cid, {})
	mine[sid] = lv + 1
	all[cid] = mine
	save["skills"] = all
	return true


## The hero's stats with its skill levels folded in (what a player's own phone simulates).
static func effective(cid: String, save: Dictionary) -> Dictionary:
	var d: Dictionary = (CAST.get(cid, CAST["outlaw"]) as Dictionary).duplicate(true)
	var L := func(sid: String) -> float: return float(skill_level(save, cid, sid))
	d.hp = float(d.hp) * (1.0 + 0.04 * L.call("vitality"))
	d.dmg_taken = float(d.get("dmg_taken", 1.0)) * (1.0 - 0.025 * L.call("armor"))
	d.speed = float(d.speed) * (1.0 + 0.025 * L.call("sprint"))
	d.fuel_mult = float(d.get("fuel_mult", 1.0)) * (1.0 + 0.05 * L.call("tank"))
	d.cool_mult = float(d.get("cool_mult", 1.0)) * (1.0 + 0.06 * L.call("cooling"))
	d.dash_mult = float(d.get("dash_mult", 1.0)) * (1.0 - 0.04 * L.call("dash"))
	d.drive_mult = 1.0 + 0.03 * L.call("driving")
	d.ride_mult = 1.0 + 0.03 * L.call("riding")
	d.dmg_mult = float(d.get("dmg_mult", 1.0)) * (1.0 + 0.03 * L.call("power"))
	d.cost_mult = 1.0 - 0.03 * L.call("efficiency")
	d.melee_mult = float(d.get("melee_mult", 1.0)) * (1.0 + 0.04 * L.call("melee"))
	d.bridge_mult = float(d.get("bridge_mult", 1.0)) * (1.0 + 0.06 * L.call("builder"))
	d.coin_mult = float(d.get("coin_mult", 1.0)) * (1.0 + 0.05 * L.call("luck"))
	return d


## COMMON / RARE / EPIC / LEGENDARY by price: the colour of the battle card.
static func rarity_of(cid: String) -> String:
	var pr := int((CAST[cid] as Dictionary).get("price", 0))
	if pr == 0:
		return "COMMON"
	if pr <= 500:
		return "RARE"
	if pr <= 1200:
		return "EPIC"
	return "LEGENDARY"


## Three 0..1 numbers for the card: speed, health, fuel.
static func card_stats(cid: String) -> Array:
	var c: Dictionary = CAST[cid]
	return [clampf((float(c.speed) - 5.0) / 3.0, 0.1, 1.0), clampf(float(c.hp) / 150.0, 0.1, 1.0), clampf(float(c.fuel) * float(c.get("fuel_mult", 1.0)) / 125.0, 0.1, 1.0)]


# ── progression ──────────────────────────────────────────────────────────────
## Level from the best distance ever reached: 1 at the start, +1 per 600 m.
static func level_for(best_m: float) -> int:
	return 1 + int(best_m / 600.0)


static func is_melee(id: String) -> bool:
	return MELEE.has(id)


## Name, colour and the rest for any weapon id (gauntlet or melee).
static func info_of(id: String) -> Dictionary:
	return MELEE[id] if MELEE.has(id) else WEAPONS[id]


static func weapon_unlocked(id: String, save: Dictionary) -> bool:
	if MELEE.has(id):
		return true
	var w: Dictionary = WEAPONS[id]
	if int(w.price) == 0:
		return true
	return (save.get("weapons", []) as Array).has(id)


static func char_owned(id: String, save: Dictionary) -> bool:
	return STARTERS.has(id) or (save.get("chars", []) as Array).has(id)


## "" when it can be bought now, else why not.
static func char_buyable(id: String, save: Dictionary) -> String:
	if char_owned(id, save):
		return "owned"
	if int(save.get("coins", 0)) < int(CAST[id].price):
		return "needs $%d" % int(CAST[id].price)
	return ""


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
	var d := {"coins": 0, "best": 0.0, "weapons": [], "chars": [], "char": "outlaw", "weapon": "shift_gauntlet", "name": "PLAYER", "matches": 0, "wins": 0, "skills": {}, "settings": {"sens": 1.0, "assist": 2, "gfx": 1}}
	if FileAccess.file_exists(SAVE_PATH):
		var got = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
		if got is Dictionary:
			d.merge(got, true)
	return d


static func write_save(d: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(d))
