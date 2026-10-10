class_name Data
extends RefCounted
## Constants, the notes the player can read, and the table of 3D models.

# Physics layers.
const L_WORLD := 1
const L_PLAYER := 2
const L_ENEMY := 4
const L_USE := 8

const BATTERY_MAX := 100.0

# Zones. A zone is either lit or dark; Mr. Grin can only be in dark ones.
const ZONES: Array[String] = ["airlock", "hub", "corN", "corE", "corS", "corW", "control", "lab", "engine", "dorm", "pod"]

# Name -> {face: degrees to turn the generated model so its front is -Z, size: default height}
# Pixal3D hands back models facing +Z; `face` is only for the ones where that is not true.
const MODELS := {
	"mr_grin": {"face": 180.0, "shoulder": 0.2, "hip": 0.06, "tpose": 1.0},
}

# Everything you can read. `id` -> {title, body}. Notes found are kept in the journal.
const NOTES := {
	"intro": {
		"title": "GRINWORKS — night-shift memo",
		"body": "Grinworks Toy Factory closed eleven years ago. Tonight the lights are out in every room, and somebody has to turn them on.\n\nThe factory mascot, MR. GRIN, was never switched off. He still smiles. He still walks the halls.\n\nHE HEARS EVERYTHING. Walking is quiet, running is loud, crouching is nearly silent.\nHE HATES BRIGHT LIGHT. Hold your torch on him and he will flinch. He cannot step into a lit room.\n\nGet the power back on, one room at a time. Then open the factory gate: it needs THREE power cells (Boiler room, Toy lab, Mascot office).",
	},
	"dorm_diary": {
		"title": "Nap-room list, page 1",
		"body": "The four toy beds are numbered 1 to 4, left to right along the wall as you face it. The name tags fell off, so nobody knows who sleeps where.\n\nPip the bunny sleeps somewhere to the LEFT of Bruno the bear.\n\nQuackers the duck sleeps right NEXT to Pip. Pip hums in her sleep.",
	},
	"dorm_scribble": {
		"title": "Scribbled on a bed frame, in crayon",
		"body": "ZIPPY: my bed number is EVEN.\n\nPip will not take bed 1. It is too close to the door and the draught makes her ears wiggle.",
	},
	"dorm_locker": {
		"title": "Foreman's memo",
		"body": "Cubby 7 holds the spare fuse. The code is the BED NUMBERS of Bruno, Pip, Zippy and Quackers, in that order.\n\nDo not write it on the cubby. — Foreman Grinwell",
	},
	"locker_note": {
		"title": "Note inside cubby 7",
		"body": "Intercom cipher key:\n\nShift every letter FORWARD by Pip's bed number.\n\nThe toy lab whiteboard has the scrambled test word.",
	},
	"engine_manual1": {
		"title": "Boiler manual — page 1",
		"body": "STEAM VALVES A to E. Before starting the generator:\n\n1. Valves A and C must NEVER be open together (steam hammer).\n2. If B is open, D must be open too.\n3. Exactly THREE valves are open.\n\n(Page 2 is torn off. Try the desk.)",
	},
	"engine_manual2": {
		"title": "Boiler manual — page 2",
		"body": "4. Valve E may only be open while A is open.\n5. Exactly ONE of A and D is open: never both, never neither.\n\nWrong settings make the pipes hammer. It can be heard all over the factory.",
	},
	"engine_log": {
		"title": "Night engineer's log",
		"body": "The generator is dead until the steam is routed. The start switch is on the cabinet by the door.\n\nI tried guessing the valves. Don't. The noise brought Mr. Grin down the south hall, smiling.",
	},
	"lab_board": {
		"title": "Toy lab whiteboard",
		"body": "INTERCOM TEST WORD (scrambled for security):\n\n        %WORD%\n\nThe key is in the foreman's memo cubby.\n\nBREAKER BOX: each switch flips ITSELF and the switches touching it (up, down, left, right). All nine must be ON.",
	},
	"control_note": {
		"title": "Gate protocol",
		"body": "Say the decoded test word on the intercom to unlock the delivery bay shutter and release the intercom's power cell.\n\nThen put all three cells into the gate controls. The gate takes 25 seconds to open. The lights fail while it charges. Keep your torch up.",
	},
	"hub_scrawl": {
		"title": "Painted on the main hall wall",
		"body": "HE WON'T COME IN WHEN THE LIGHTS ARE ON.\n\nHE HEARS FOOTSTEPS. HE HEARS VALVES. HE HEARS THE CRANK.\n\nHide in a cubby before he sees you.",
	},
}

## A note's text; the whiteboard's scrambled word is filled in from the puzzle, never typed twice.
static func note_body(id: String) -> String:
	var body: String = NOTES[id].body
	return body.replace("%WORD%", "  ".join(Puzzles.scrambled_word().split("")))


# Tutorial toasts, shown once.
const HINTS := {
	"look": "Drag the right side of the screen to look. Left stick to move.",
	"use": "Tap USE when a prompt appears. Notes go into your JOURNAL.",
	"torch": "Your torch shows you the way — and shows you to Mr. Grin from far away. Tap TORCH to sneak in the dark; crouch to be quieter.",
	"crank": "The torch is running down. HOLD CRANK to charge it — but cranking is loud.",
	"hide": "Cubbies hide you. Climb into one before Mr. Grin sees you.",
	"light": "Lit rooms are safe. Mr. Grin cannot cross a lit doorway.",
}
