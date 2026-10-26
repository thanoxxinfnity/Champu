class_name Bestiary
extends RefCounted
## Every kind of Mist-touched creature in Harrow Cove: 35 of them (34 ordinary kinds + the Bellkeeper), men and women, built from a few body types, a
## behaviour trait each, and their own stats. A kind is `{name, sex, body, trait, tint, ...overrides}`; the trait supplies the numbers a kind does not
## override. Data.ENEMIES keeps the four original kinds and the boss; everything else is here. `Bestiary.def(kind)` finds either.
##
## Traits (what makes a kind play differently):
##   shambler  walks, hits       runner   fast, fragile            brute    slow, huge hits           armored   takes a fraction of normal damage
##   burning   scorches anyone close     spitter  spits acid from range    screamer  its scream wakes everything near
##   leaper    telegraphs, then lunges   burst    bursts into spores       crawl     low and fast                stalker   quiet, patient, sees far
##   weeper    freezes while looked at

## Damage dealt to the player per kind (a balance tally the playthrough bot prints).
static var dealt := {}


static func note(kind: String, amount: float) -> void:
	dealt[kind] = float(dealt.get(kind, 0.0)) + amount


const TRAITS := {
	"shambler": {"hp": 60.0, "speed": 1.8, "patrol": 0.8, "dmg": 13.0, "sight": 15.0, "hear": 20.0, "reach": 1.5, "cd": 1.2},
	"runner": {"hp": 36.0, "speed": 4.5, "patrol": 1.4, "dmg": 9.0, "sight": 17.0, "hear": 24.0, "reach": 1.4, "cd": 0.8},
	"brute": {"hp": 190.0, "speed": 1.5, "patrol": 0.6, "dmg": 27.0, "sight": 13.0, "hear": 17.0, "reach": 1.9, "cd": 1.7},
	"armored": {"hp": 110.0, "speed": 1.7, "patrol": 0.7, "dmg": 17.0, "sight": 15.0, "hear": 18.0, "reach": 1.6, "cd": 1.3, "armor": 0.45},
	"burning": {"hp": 75.0, "speed": 2.1, "patrol": 0.8, "dmg": 8.0, "sight": 15.0, "hear": 20.0, "reach": 1.5, "cd": 1.2, "aura": 5.0},
	"spitter": {"hp": 46.0, "speed": 1.7, "patrol": 0.7, "dmg": 12.0, "sight": 20.0, "hear": 22.0, "reach": 1.4, "cd": 1.2, "spit": 2.8},
	"screamer": {"hp": 52.0, "speed": 2.2, "patrol": 0.9, "dmg": 11.0, "sight": 19.0, "hear": 24.0, "reach": 1.4, "cd": 1.2, "scream": 9.0},
	"leaper": {"hp": 50.0, "speed": 2.5, "patrol": 1.1, "dmg": 16.0, "sight": 16.0, "hear": 22.0, "reach": 1.4, "cd": 1.0, "lunge": 3.2},
	"burst": {"hp": 100.0, "speed": 1.2, "patrol": 0.6, "dmg": 6.0, "sight": 13.0, "hear": 18.0, "reach": 1.8, "cd": 1.6, "burst": true},
	"crawl": {"hp": 34.0, "speed": 4.2, "patrol": 1.2, "dmg": 8.0, "sight": 12.0, "hear": 26.0, "reach": 1.2, "cd": 0.9},
	"stalker": {"hp": 62.0, "speed": 3.0, "patrol": 1.3, "dmg": 20.0, "sight": 24.0, "hear": 14.0, "reach": 1.5, "cd": 1.1},
	"weeper": {"hp": 50.0, "speed": 4.0, "patrol": 0.0, "dmg": 22.0, "sight": 22.0, "hear": 30.0, "reach": 1.4, "cd": 1.4},
}

## Which clip table (CharacterView.CLIPS) a trait walks with.
const STYLE := {"crawl": "crawler", "burst": "bloater", "weeper": "weeper", "brute": "zombie", "runner": "zombie"}

# id: [name, sex, body, trait, tint, overrides]
const TYPES := {
	# the four originals (stats in Data.ENEMIES) are listed too, so the bestiary and the tests see all of them
	"mist_walker": ["Mist Walker", "M", "rig_mist_walker", "shambler", Color(0.85, 0.7, 0.72), {}],
	"crawler": ["Crawler", "M", "rig_mist_walker", "crawl", Color(0.8, 0.65, 0.7), {"height": 0.8, "crawl_body": true}],
	"bloater": ["Bloater", "M", "rig_bloater", "burst", Color(0.9, 0.6, 0.6), {"height": 2.0}],
	"weeper": ["Veil Weeper", "F", "rig_weeper", "weeper", Color(0.9, 0.9, 1.0), {"height": 1.7}],
	# harbour folk
	"harbour_hand": ["Harbour Hand", "M", "z_fisherman", "shambler", Color(0.8, 0.85, 0.82), {"hp": 70.0}],
	"drowned_girl": ["Drowned Swimmer", "F", "z_swimmer", "crawl", Color(0.7, 0.85, 0.85), {"hp": 44.0, "speed": 3.4, "reach": 1.5}],
	"tide_weeper": ["Tide Weeper", "F", "rig_weeper", "spitter", Color(0.7, 0.9, 0.95), {"hp": 40.0}],
	"captains_crew": ["Captain's Crew", "F", "npc_fisher", "brute", Color(0.95, 0.85, 0.5), {"hp": 150.0}],
	# town and work
	"patrolman": ["Patrolman", "M", "z_police", "armored", Color(0.75, 0.8, 0.95), {"hp": 100.0}],
	"ashen_trooper": ["Ashen Trooper", "M", "z_soldier", "armored", Color(0.8, 0.85, 0.7), {"hp": 150.0, "armor": 0.35, "speed": 1.5}],
	"cleaver_cook": ["Cleaver Cook", "M", "z_butcher", "brute", Color(1.0, 0.8, 0.8), {"dmg": 31.0}],
	"hard_hat": ["Hard Hat", "M", "z_builder", "brute", Color(1.0, 0.9, 0.6), {"hp": 220.0, "speed": 1.3}],
	"late_commuter": ["Late Commuter", "M", "z_salaryman", "runner", Color(0.85, 0.85, 0.9), {}],
	"plague_doctor": ["Plague Doctor", "M", "z_doctor", "spitter", Color(0.8, 1.0, 0.85), {"hp": 55.0}],
	"grocer": ["Grocer", "M", "npc_shopkeeper", "shambler", Color(0.75, 0.95, 0.75), {"hp": 66.0}],
	"fallen_priest": ["Fallen Priest", "M", "npc_priest", "screamer", Color(0.85, 0.8, 0.95), {"hp": 70.0}],
	"cinder_fighter": ["Cinder Fighter", "M", "z_firefighter", "burning", Color(1.0, 0.7, 0.5), {"hp": 95.0}],
	"red_veined": ["Red-Veined", "M", "rig_mist_walker", "runner", Color(1.0, 0.55, 0.55), {"hp": 44.0, "dmg": 12.0}],
	"pale_stalker": ["Pale Stalker", "M", "rig_mist_walker", "stalker", Color(0.85, 0.9, 1.0), {}],
	"bell_hand": ["Bell Hand", "M", "rig_bloater", "armored", Color(1.0, 0.85, 0.6), {"hp": 170.0, "speed": 1.2, "height": 2.0}],
	"bloated_baker": ["Swollen Baker", "M", "z_butcher", "burst", Color(1.0, 0.9, 0.7), {"hp": 130.0}],
	# women
	"pale_bride": ["Pale Bride", "F", "z_bride", "screamer", Color(1.0, 1.0, 1.0), {"hp": 58.0}],
	"office_lady": ["Office Lady", "F", "z_officelady", "shambler", Color(0.9, 0.85, 0.9), {"speed": 2.1}],
	"night_jogger": ["Night Jogger", "F", "z_jogger", "runner", Color(0.9, 1.0, 0.9), {"speed": 5.0, "hp": 30.0}],
	"hungry_waitress": ["Hungry Waitress", "F", "z_waitress", "leaper", Color(1.0, 0.9, 0.85), {}],
	"lost_tourist": ["Lost Tourist", "F", "z_tourist", "shambler", Color(1.0, 0.95, 0.75), {"hp": 56.0, "sight": 18.0}],
	"punk_girl": ["Punk Girl", "F", "z_punk", "leaper", Color(0.95, 0.7, 0.95), {"hp": 56.0, "dmg": 18.0}],
	"housewife": ["Housewife", "F", "z_housewife", "brute", Color(1.0, 0.85, 0.8), {"hp": 140.0, "dmg": 22.0}],
	"spore_mother": ["Spore Mother", "F", "z_housewife", "burst", Color(0.8, 1.0, 0.7), {"hp": 120.0}],
	"infected_nurse": ["Infected Nurse", "F", "npc_nurse", "spitter", Color(1.0, 0.8, 0.85), {}],
	"cinder_nurse": ["Cinder Nurse", "F", "npc_nurse", "burning", Color(1.0, 0.65, 0.55), {"hp": 85.0}],
	"lost_student": ["Lost Student", "F", "npc_student", "runner", Color(0.9, 0.9, 1.0), {"speed": 4.8}],
	"granny_creeper": ["Granny Creeper", "F", "npc_granny", "crawl", Color(0.95, 0.9, 0.85), {"speed": 3.6, "hp": 48.0, "reach": 1.4}],
	"wet_widow": ["Wet Widow", "F", "z_swimmer", "stalker", Color(0.6, 0.8, 0.9), {"hp": 66.0}],
}

const HEIGHT := {"M": 1.75, "F": 1.66}


static func ids() -> Array:
	return TYPES.keys()


static func count() -> int:
	return TYPES.size() + 1      # + the Bellkeeper


static func is_known(kind: String) -> bool:
	return TYPES.has(kind) or Data.ENEMIES.has(kind)


## The full definition of a kind: the trait's numbers, then the kind's own, in the shape enemy.gd reads (hp, speed, dmg, ... model, tint).
static func def(kind: String) -> Dictionary:
	if Data.ENEMIES.has(kind):
		var o: Dictionary = (Data.ENEMIES[kind] as Dictionary).duplicate()
		o["burst"] = kind == "bloater"
		if kind == "mist_walker" or kind == "bloater" or kind == "crawler":
			o["sex"] = "M"
		elif kind == "weeper":
			o["sex"] = "F"
		return o
	var t: Array = TYPES[kind]
	var d: Dictionary = (TRAITS[t[3]] as Dictionary).duplicate()
	d.merge(t[5], true)
	d["name"] = t[0]
	d["sex"] = t[1]
	d["body"] = t[2]
	d["trait"] = t[3]
	d["tint"] = t[4]
	d["model"] = "mist_walker"
	d["style"] = STYLE.get(t[3], "zombie")
	if not d.has("height"):
		d["height"] = HEIGHT[t[1]]
	return d


static func sex_of(kind: String) -> String:
	if TYPES.has(kind):
		return TYPES[kind][1]
	return "F" if kind == "weeper" else "M"


static func trait_of(kind: String) -> String:
	if TYPES.has(kind):
		return TYPES[kind][3]
	return {"mist_walker": "shambler", "crawler": "crawl", "bloater": "burst", "weeper": "weeper", "bellkeeper": "brute"}.get(kind, "shambler")


## The kinds that belong to a zone, weighted so each zone has its own mix (and its own handful of newcomers).
const ZONES := {
	"clinic": ["mist_walker", "infected_nurse", "office_lady", "crawler", "late_commuter"],
	"market": ["mist_walker", "grocer", "lost_tourist", "hungry_waitress", "cleaver_cook", "late_commuter", "night_jogger", "plague_doctor", "pale_bride", "punk_girl", "bloater", "harbour_hand", "red_veined", "housewife", "crawler"],
	"church": ["weeper", "fallen_priest", "pale_bride", "lost_student", "pale_stalker", "spore_mother", "granny_creeper", "tide_weeper"],
	"road": ["patrolman", "ashen_trooper", "cinder_fighter", "hard_hat", "cinder_nurse", "bell_hand", "bloated_baker", "wet_widow", "drowned_girl", "captains_crew", "punk_girl", "crawler"],
	"arena": ["crawler", "red_veined", "night_jogger", "lost_student", "granny_creeper"],
}


## A kind for a spawn slot: the story's own pick, or one drawn (deterministically) from the zone's list.
static func pick(zone: String, slot: int, preferred := "") -> String:
	var pool: Array = ZONES.get(zone, ["mist_walker"])
	if preferred != "" and not pool.has(preferred):
		pool = pool + [preferred]
	var h := int(hash("%s/%d" % [zone, slot]))
	return pool[absi(h) % pool.size()]
