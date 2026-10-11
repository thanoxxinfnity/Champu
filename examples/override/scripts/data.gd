class_name Data
extends RefCounted
## Project OVERRIDE: constants, the items and recipes, and every piece of paper the player can read.

# Physics layers, as the design document fixes them: the player on 1, enemies and falling debris on 2.
const L_PLAYER := 1
const L_ENEMY := 2
const L_WORLD := 4
const L_USE := 8
const L_BLOCK := 16          # only creatures feel this layer: the barrier round a safe station

const CELL := 1.0           # navmesh cell, metres
const WALL := 1.0           # thickness of the concrete between two rooms
const DOOR_W := 3
const STUN_SECONDS := 25.0    # how long the stunner holds anything
const FUSES_NEEDED := 2       # fuses the first lift needs (there are three in the rooms: one is a spare)
const PACK_SLOTS := 25        # a 5 x 5 pack

# ── items ────────────────────────────────────────────────────────────────────

## id -> colour used by the inventory glyph (drawn in code, no text on screen)
const ITEMS := {
	"fuse": Color(0.95, 0.75, 0.2),
	"cable": Color(0.35, 0.65, 1.0),
	"wiring": Color(0.9, 0.35, 0.25),
	"timer": Color(0.4, 0.85, 1.0),
	"gel": Color(0.4, 1.0, 0.45),
	"detonator": Color(1.0, 0.25, 0.2),
	"keycard": Color(0.95, 0.95, 0.4),
	"mega_bomb": Color(1.0, 0.55, 0.15),
	"scrap": Color(0.75, 0.78, 0.85),   # a bolt-and-bracket lump: thrown, it clangs where it lands
	# gadgets: used from the button on the screen, one at a time, in this order
	"shield": Color(0.35, 0.7, 1.0),    # an energy shield: nothing can hurt you for a while
	"medkit": Color(0.95, 0.95, 0.95),  # heals two points
	"hush": Color(0.6, 0.55, 0.8),      # soft soles: your steps carry a quarter as far for half a minute
	"beeper": Color(1.0, 0.35, 0.3),    # a decoy that beeps where you put it
}
const GADGETS := ["shield", "medkit", "hush", "beeper"]
const SHIELD_SECONDS := 12.0
const HUSH_SECONDS := 30.0
const BEEPER_SECONDS := 14.0

## item -> [model, size]: what a dropped item looks like lying on the floor.
const ITEM_MODEL := {
	"fuse": ["fuse", 0.12], "cable": ["cable", 0.22], "wiring": ["wiring", 0.22], "timer": ["timer", 0.22], "gel": ["gel", 0.3],
	"detonator": ["detonator", 0.2], "keycard": ["keycard", 0.12], "mega_bomb": ["mega_bomb", 0.3], "scrap": ["scrap", 0.18],
	"shield": ["shield", 0.22], "medkit": ["medkit", 0.22], "hush": ["hush", 0.25], "beeper": ["beeper", 0.2],
}

## Two things combined make a third. Order does not matter.
const RECIPES := [
	{"a": "wiring", "b": "timer", "out": "detonator"},
	{"a": "detonator", "b": "gel", "out": "mega_bomb"},
]

static func recipe(a: String, b: String) -> String:
	for r in RECIPES:
		if (r.a == a and r.b == b) or (r.a == b and r.b == a):
			return r.out
	return ""


# ── the generator's lever puzzle (chapter 2) ─────────────────────────────────
# Three levers, one of them must be thrown first, and the note says in what order. Exactly one order fits.
const LEVERS: Array[String] = ["red", "blue", "green"]


static func lever_rules_hold(order: Array) -> bool:
	var pos := {}
	for i in range(order.size()):
		pos[order[i]] = i
	return (
		pos["blue"] < pos["red"]               # blue before red
		and pos["green"] != 0                   # green is never first
		and pos["red"] != 2                     # red is never last
	)


static func lever_solutions() -> Array:
	var out: Array = []
	for a in LEVERS:
		for b in LEVERS:
			for c in LEVERS:
				if a == b or a == c or b == c:
					continue
				if lever_rules_hold([a, b, c]):
					out.append([a, b, c])
	return out


# ── the story, on paper ──────────────────────────────────────────────────────
# Every word the game shows is on one of these. Nothing floats in the air.

const PAPERS := {
	"p_wake": {"chapter": 1, "title": "TEST SUBJECT 9", "body": "If you can read this, the cryo-lock failed the way we feared it would.\n\nThe lights are out on every floor. The lift needs [b]two fuses[/b] and a length of [b]wiring[/b] to run. They are in the server closet and the store room, just off the hall.\n\nTake the stunner from the table. It will hold anything that walks for twenty-five seconds. The charger by the water will fill it again. It will not kill it. Nothing here can be killed.\n\n[i]They crawl towards sound. Walk, do not run.[/i]"},
	"p_fusebox": {"chapter": 1, "title": "FUSE BOX 14", "body": "Two fuses, in any order. Then the lift."},
	"p_ch1_log": {"chapter": 1, "title": "Dr. Okoye, log 41", "body": "OVERRIDE was meant to guard us. When the breach came it decided that the safest facility is an empty one.\n\nIt woke the old maintenance units first. They were never made to think. They only learned to want quiet, and the noise of the living is the opposite of quiet."},
	"p_flood": {"chapter": 2, "title": "Pump room — notice", "body": "The basement flooded when the pumps failed, and the current from the broken mains runs through all of it. [b]Keep to the dry planks.[/b]\n\nThe generator starts only with the three levers thrown in the right order. The engineer's note, taped to the wall:\n\n[b]BLUE goes before RED.\nGREEN is never first.\nRED is never last.[/b]\n\nThe hunters down here have no eyes. They hear water. Every splash is a shout."},
	"p_ch2_log": {"chapter": 2, "title": "Dr. Okoye, log 58", "body": "The blind ones were my idea. I thought if they could not see us they could not hate us. I was right about that. They do not hate. They only follow the sound until it stops.\n\nIf you must cross, cross slowly. A held breath is the only thing that is still."},
	"p_factory": {"chapter": 3, "title": "Shift board — Assembly", "body": "Nothing on this line has been assembled for thirty years. Something is still being built.\n\n[b]To leave:[/b] a keycard from the foreman's office, and a detonator. The workshop bench makes one from wiring and a timer. Open your pack and put the two together.\n\nThe Warden walks this floor. Lockers are bolted open on purpose. Get inside before it sees you."},
	"p_ch3_log": {"chapter": 3, "title": "Dr. Okoye, log 77", "body": "The Warden is OVERRIDE's hands. It cannot be hurt, so do not try. When it comes, its footsteps will find you first. Count them.\n\nThe core is the only thing that can stop it, and the core is the only thing that cannot be turned off from the outside. Someone has to carry the charge down."},
	"p_core": {"chapter": 4, "title": "Reactor 1 — emergency", "body": "[b]Mega-bomb:[/b] a detonator and a canister of gel. Combine them in your pack.\n\nPlant it on the core. You will have three minutes. The exit lift is where you came in, on the far side of the waste hall.\n\nThe Warden is awake and it is angry. Everything else is following it."},
	"p_end": {"chapter": 4, "title": "Dr. Okoye, last entry", "body": "If you are reading this, you made it out, or you are about to. Whoever you are: I am sorry I put you in the cold for this.\n\nThe facility is quiet now. It was always going to be quiet. It just needed the right person to turn it off."},
}
