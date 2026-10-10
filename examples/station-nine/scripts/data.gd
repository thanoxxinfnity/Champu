class_name Data
extends RefCounted
## Constants, the notes the player can read, and the table of 3D models.

# Physics layers.
const L_WORLD := 1
const L_PLAYER := 2
const L_ENEMY := 4
const L_USE := 8

const BATTERY_MAX := 100.0

# Zones. A zone is either lit or dark; the Hollow can only be in dark ones.
const ZONES: Array[String] = ["airlock", "hub", "corN", "corE", "corS", "corW", "control", "lab", "engine", "dorm", "pod"]

# Name -> {face: degrees to turn the generated model so its front is -Z, size: default height}
# Pixal3D hands back models facing +Z; `face` is only for the ones where that is not true.
const MODELS := {
	"hollow": {"face": 180.0, "shoulder": 0.2, "hip": 0.06, "tpose": 0.5},
}

# Everything you can read. `id` -> {title, body}. Notes found are kept in the journal.
const NOTES := {
	"intro": {
		"title": "STATION NINE — automated log",
		"body": "Station Nine lost contact 41 days ago.\n\nBackup power failed in every section. Something living in the dark has taken the corridors.\n\nIT HUNTS BY SOUND. Walking is quiet, running is loud, crouching is nearly silent.\nIT FEARS LIGHT. Hold your torch on it and it will recoil. It cannot enter a lit room.\n\nRestore power to a section and that section is safe.\n\nThe escape pod in the Pod Bay needs THREE power cells: Engine room, Laboratory, Control room.",
	},
	"dorm_diary": {
		"title": "Anya's diary — page 41",
		"body": "The bunks are numbered 1 to 4, left to right along the wall as you face it. Somebody took the name plates, so we keep getting each other's pillows.\n\nMeera sleeps somewhere to the LEFT of Ravi — she can hear him snore through the frame.\n\nI am right NEXT to Meera. She talks in her sleep and I hear every word.",
	},
	"dorm_scribble": {
		"title": "Scratched into a bunk frame",
		"body": "TOMAS: my bunk number is EVEN. No wonder it is the cold one.\n\nMeera refuses bunk 1. Too close to the door, she says.",
	},
	"dorm_locker": {
		"title": "Captain's memo",
		"body": "Crew locker 7 holds the spare fuse. The code is the BUNK NUMBERS of Ravi, Meera, Tomas and Anya — in that order.\n\nDo not write it down anywhere. — Capt. Iyer",
	},
	"locker_note": {
		"title": "Note inside the locker",
		"body": "Radio cipher key:\n\nShift every letter FORWARD by the bunk number of the quietest sleeper — Meera.\n\nThe Lab whiteboard has the scrambled test word.",
	},
	"engine_manual1": {
		"title": "Generator manual — page 1",
		"body": "COOLANT VALVES A to E. Before starting the generator:\n\n1. Valves A and C must NEVER be open together (steam hammer).\n2. If B is open, D must be open too.\n3. Exactly THREE valves are open.\n\n(Page 2 is torn off. Try the desk.)",
	},
	"engine_manual2": {
		"title": "Generator manual — page 2",
		"body": "4. Valve E may only be open while A is open.\n5. Exactly ONE of A and D is open — never both, never neither.\n\nWrong settings make the pipes hammer. It can be heard all over the station.",
	},
	"engine_log": {
		"title": "Ravi's maintenance log",
		"body": "Coil is dead until the coolant is routed. Start button is on the panel by the door.\n\nI tried guessing the valves. Don't. The noise brought IT down the south corridor.",
	},
	"lab_board": {
		"title": "Lab whiteboard",
		"body": "RADIO TEST WORD (scrambled for security):\n\n        U W T H C E G\n\nKey is in the crew locker memo. — Anya\n\nBREAKER PANEL: each switch flips ITSELF and the switches touching it (up, down, left, right). All nine must be ON.",
	},
	"control_note": {
		"title": "Launch protocol",
		"body": "Enter the decoded test word on the radio to unlock the Pod Bay shutter and release the radio's power cell.\n\nThen put all three cells into the pod console. Launch takes 25 seconds. Lights will fail while the pod charges. Keep your torch up.",
	},
	"hub_scrawl": {
		"title": "Scrawled on the hub wall",
		"body": "IT WON'T COME IN WHEN THE LIGHTS ARE ON.\n\nIT HEARS FOOTSTEPS. IT HEARS VALVES. IT HEARS THE CRANK.\n\nHide in a locker before it sees you.",
	},
}

# Tutorial toasts, shown once.
const HINTS := {
	"look": "Drag the right side of the screen to look. Left stick to move.",
	"use": "Tap USE when a prompt appears. Notes go into your JOURNAL.",
	"torch": "Your torch drains. HOLD CRANK to recharge it — but cranking is loud.",
	"hide": "Lockers hide you. Enter one before it sees you.",
	"light": "Lit rooms are safe. It cannot cross a lit doorway.",
}
