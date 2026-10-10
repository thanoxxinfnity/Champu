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
		"body": "Say the decoded test word on the intercom to unlock the delivery bay shutter and release the intercom's power cell.\n\nThen put all three cells into the gate controls. The gate takes 25 seconds to open. The lights fail while it charges. Keep your torch up.\n\nThe gate lock wants the foreman's MORNING COUNT, four numbers, in this order:\n  1. the toy beds in the nap room\n  2. the steam valves in the boiler room\n  3. the robots sitting ON the lab benches\n  4. the terminals glowing in this office\n\nCount them yourself. Nobody wrote them down.",
	},
	"lore_gas": {
		"title": "PRESS RELEASE — for immediate release",
		"body": "GRINWORKS TOY COMPANY regrets to confirm that an industrial gas leak has forced the permanent closure of its main factory. No employees were harmed.\n\nThere were forty-one employees on the night shift.\n\nThere is nothing to see here.\n\n(Stapled to the back, in pen: they never even sent a car.)",
	},
	"lore_ceo": {
		"title": "MEMO — Board of Directors, STRICTLY PRIVATE",
		"body": "The SMILE PROTOCOL is approved. A mascot that never sleeps, never tires, and learns what children love by listening.\n\nThe cell inside him learns from whoever is nearest. We need a teacher. The foreman has volunteered.\n\nDo not tell the night shift what the cell is made of.\n\n— Chairman",
	},
	"lore_eng": {
		"title": "Engineer's log, night 9",
		"body": "The cell is not learning the way we planned. It repeats the foreman. His walk. His laugh. The way he counts the beds every morning.\n\nToday it said my name through the PA. Nobody had taught it my name.\n\nThe bright flash tubes hurt it. I think they hurt it because they are the last thing it remembers. I think it remembers being switched on.",
	},
	"lore_guard": {
		"title": "Night guard — recorded on the office tape",
		"body": "02:14. The lights have gone out on the east side. Something is walking the halls. It walks like Mr. Grinwell.\n\n02:31. I locked myself in a cubby. I can hear him counting. One, two, three, four. He stops at four. He always stops at four.\n\n02:40. He knows the cubbies. He is opening them one by one.\n\n(the tape ends)",
	},
	"lore_child": {
		"title": "A child's drawing, left on a bed",
		"body": "A crayon picture. A tall yellow man with a huge smile holds a small child's hand. Underneath, in wobbly letters:\n\nMR GRIN IS MY FRIEND. HE SAYS THE LIGHTS ARE TOO BRIGHT AND HE IS SORRY.\n\nOn the back, in a grown-up's hand: Please. Take them out. Do not leave the children alone with him.",
	},
	"lore_anya": {
		"title": "Anya's diary, last page",
		"body": "I am hiding in cubby 7, because he does not check the sevens. He thinks the sevens are lucky. That is the foreman's superstition. He is still in there somewhere.\n\nIf you read this: the gate lock opens with the foreman's morning count. He counted everything. Beds. Valves. Robots. Terminals. He said a man who counts is a man who is still himself.\n\nHe is trying to remember, I think. Every night. He walks the halls and counts. That is why he never stops.",
	},
	"lore_last": {
		"title": "Foreman Grinwell — his last note, by the gate",
		"body": "If you are reading this you have found the lights. I am so tired. The cell will not let me stop smiling.\n\nI built the gate so the children could get out. I could not build one for myself.\n\nWhen you open it, the factory will go quiet. The cell has no power without the building. Please do not stay to say goodbye.\n\nThank you for the light.",
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


## The notes that tell the story of the factory (nothing in them is needed to escape). Finding them all changes the ending.
const LORE: Array[String] = ["lore_gas", "lore_ceo", "lore_eng", "lore_guard", "lore_child", "lore_anya", "lore_last"]


# Tutorial toasts, shown once.
const HINTS := {
	"look": "Drag the right side of the screen to look. Left stick to move.",
	"use": "Tap USE when a prompt appears. Notes go into your JOURNAL.",
	"torch": "Your torch shows you the way — and shows you to Mr. Grin from far away. Tap TORCH to sneak in the dark; crouch to be quieter.",
	"crank": "The torch is running down. HOLD CRANK to charge it — but cranking is loud.",
	"hide": "Cubbies hide you. Climb into one before Mr. Grin sees you.",
	"light": "Lit rooms are safe. Mr. Grin cannot cross a lit doorway.",
}
