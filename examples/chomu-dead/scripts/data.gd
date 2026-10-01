class_name Data
extends RefCounted
## Everything that is a number or a line of text rather than behaviour:
## weapons, enemy types, how each TRELLIS model is scaled and turned, and the
## story. Changing balance or wording happens here and nowhere else.

## Collision layers.
const L_WORLD := 1
const L_PLAYER := 2
const L_ENEMY := 4

## Weapons. dmg is per pellet, rate is seconds between shots, spread in degrees,
## len is the on-screen length of the TRELLIS model in metres.
const WEAPONS := {
	"pistol": {
		"name": "M9 PISTOL", "model": "gun_pistol", "len": 0.30, "dmg": 30.0, "rate": 0.26, "mag": 12,
		"reserve": 48, "spread": 1.0, "pellets": 1, "auto": false, "reload": 1.1, "range": 70.0,
		"sfx": "pistol", "kick": 0.012,
	},
	"shotgun": {
		"name": "PUMP SHOTGUN", "model": "gun_shotgun", "len": 0.95, "dmg": 15.0, "rate": 0.85, "mag": 6,
		"reserve": 24, "spread": 5.5, "pellets": 8, "auto": false, "reload": 2.1, "range": 28.0,
		"sfx": "shotgun", "kick": 0.05,
	},
	"smg": {
		"name": "MP7 SMG", "model": "gun_smg", "len": 0.55, "dmg": 17.0, "rate": 0.075, "mag": 30,
		"reserve": 150, "spread": 2.8, "pellets": 1, "auto": true, "reload": 1.6, "range": 55.0,
		"sfx": "smg", "kick": 0.012,
	},
	"rifle": {
		"name": "AK-47 RIFLE", "model": "gun_rifle", "len": 0.95, "dmg": 36.0, "rate": 0.11, "mag": 30,
		"reserve": 120, "spread": 1.6, "pellets": 1, "auto": true, "reload": 1.9, "range": 90.0,
		"sfx": "rifle", "kick": 0.02,
	},
}
const WEAPON_ORDER := ["pistol", "shotgun", "smg", "rifle"]

## Enemy types. hp, speed (m/s), damage per hit, size = standing height (m).
const ENEMIES := {
	"walker": {
		"model": "zombie_walker", "hp": 70.0, "speed": 1.5, "dmg": 9.0, "size": 1.8, "reach": 1.5,
		"sense": 22.0, "arms": 1.0, "tint": Color(0.88, 0.95, 0.85), "score": 10,
	},
	"runner": {
		"model": "zombie_runner", "hp": 45.0, "speed": 4.6, "dmg": 7.0, "size": 1.75, "reach": 1.4,
		"sense": 34.0, "arms": 0.4, "tint": Color(1.0, 0.92, 0.9), "score": 15,
	},
	"cop": {
		"model": "zombie_cop", "hp": 150.0, "speed": 2.2, "dmg": 14.0, "size": 1.85, "reach": 1.6,
		"sense": 26.0, "arms": 1.0, "tint": Color(0.9, 0.95, 1.0), "score": 25,
	},
	"nurse": {
		"model": "zombie_nurse", "hp": 80.0, "speed": 2.6, "dmg": 8.0, "size": 1.7, "reach": 1.4,
		"sense": 26.0, "arms": 1.0, "tint": Color(1.0, 0.95, 0.95), "score": 15,
	},
	"bloater": {
		"model": "zombie_bloater", "hp": 320.0, "speed": 1.1, "dmg": 22.0, "size": 2.2, "reach": 2.0,
		"sense": 24.0, "arms": 0.7, "tint": Color(0.85, 1.0, 0.8), "score": 60,
	},
	"warden": {
		"model": "boss_warden", "hp": 1800.0, "speed": 2.8, "dmg": 34.0, "size": 3.6, "reach": 3.0,
		"sense": 120.0, "arms": 1.0, "tint": Color(1.0, 0.9, 0.85), "score": 500,
	},
}

## How each model is stood up in the world. `face` is the extra yaw (degrees) that
## turns the model's front to Godot's forward (-Z); `h` is the height in metres
## (guns use the length instead, from WEAPONS). Filled in by looking at the models.
const MODELS := {
	# Raw TRELLIS people face +Z, so they are turned 180 degrees to face Godot's -Z.
	# `tpose` is how far the arms must be lowered (1 = T-pose, 0 = already hanging),
	# `shoulder` where the shoulder joint sits as a fraction of the model width.
	"player": {"face": 180.0, "h": 1.8, "tpose": 0.7, "shoulder": 0.2, "hip": 0.07},
	"zombie_walker": {"face": 180.0, "h": 1.8, "tpose": 1.0, "shoulder": 0.12, "hip": 0.06},
	"zombie_runner": {"face": 180.0, "h": 1.75, "tpose": 1.0, "shoulder": 0.12, "hip": 0.06},
	"zombie_cop": {"face": 180.0, "h": 1.85, "tpose": 1.0, "shoulder": 0.12, "hip": 0.06},
	"zombie_nurse": {"face": 180.0, "h": 1.7, "tpose": 1.0, "shoulder": 0.12, "hip": 0.06},
	"zombie_bloater": {"face": 180.0, "h": 2.2, "tpose": 0.35, "shoulder": 0.2, "hip": 0.09},
	"boss_warden": {"face": 180.0, "h": 3.6, "tpose": 1.0, "shoulder": 0.1, "hip": 0.05},
	"gun_pistol": {"face": -90.0, "len": 0.3},
	"gun_shotgun": {"face": 180.0, "len": 0.95},
	"gun_smg": {"face": 180.0, "len": 0.55},
	"gun_rifle": {"face": 180.0, "len": 0.95},
}

## The story, one chapter at a time. `radio` lines are (speaker, text) pairs
## played when the chapter starts; `goal` is where the objective marker points
## (null: no marker); `kind` decides how the chapter is completed.
const CHAPTERS := [
	{
		"title": "CHAPTER 1 — THE WARD",
		"kind": "reach", "goal": Vector3(8, 0, -61),
		"objective": "Find a weapon, then get out of the clinic",
		"radio": [
			["", "Saint Aster Clinic. 02:14 AM. You wake up to the sound of something dragging itself across the floor."],
			["ROHAN", "Nobody at the desk. No doctors. The lights keep dying... I need something to defend myself."],
		],
		"done": [
			["ROHAN", "That door leads outside. Whatever happened here, it did not stop at the clinic."],
		],
	},
	{
		"title": "CHAPTER 2 — DEAD STREETS",
		"kind": "reach", "goal": Vector3(4, 0, -36),
		"objective": "Reach the police car on Main Street",
		"radio": [
			["", "The whole town is dark. Cars sit abandoned with their doors open."],
			["ROHAN", "That police car still has its lights on. There might be a radio."],
		],
		"done": [
			["RADIO", "...anyone... this is Doctor Iyer at Saint Aster Church. We are alive. There are children here."],
			["RADIO", "The church yard is gated and chained. Get to the gas station and find bolt cutters. Please hurry!"],
		],
	},
	{
		"title": "CHAPTER 3 — THE GAS STATION",
		"kind": "collect", "goal": Vector3(-34, 0, 3),
		"objective": "Find the bolt cutters at the gas station",
		"radio": [
			["ROHAN", "Gas station is west of here. Something big is moving between the pumps."],
		],
		"done": [
			["ROHAN", "Bolt cutters. And a shotgun under the counter. Now the church."],
		],
	},
	{
		"title": "CHAPTER 4 — THE CHURCH",
		"kind": "gate", "goal": Vector3(26, 0, 24),
		"objective": "Cut the chain on the church gate",
		"radio": [
			["IYER", "I can see you from the bell tower. The gate is on the east path. Careful, they hear everything."],
		],
		"done": [
			["IYER", "You made it! Listen: there is a helicopter at the hospital yard. The pilot is gone, but I can fly it."],
			["IYER", "Hold the yard while I power up the radio. They are coming. All of them."],
		],
	},
	{
		"title": "CHAPTER 5 — THE LONG NIGHT",
		"kind": "survive", "goal": Vector3(48, 0, 26),
		"objective": "Survive the horde in the church yard",
		"radio": [
			["IYER", "Here they come! Keep them off the steps. Thirty seconds of radio, that is all I need!"],
		],
		"done": [
			["IYER", "Signal sent! The helicopter is waiting at the hospital. Rifle in the vestry, take it. Go!"],
		],
	},
	{
		"title": "CHAPTER 6 — THE WARDEN",
		"kind": "boss", "goal": Vector3(0, 0, 100),
		"objective": "Reach the hospital yard and stop the Warden",
		"radio": [
			["ROHAN", "The helicopter is just past the hospital gates. Something is standing between us and it."],
		],
		"done": [
			["ROHAN", "It's down. It's finally down."],
		],
	},
	{
		"title": "CHAPTER 7 — ESCAPE",
		"kind": "reach", "goal": Vector3(0, 0, 112),
		"objective": "Get to the helicopter",
		"radio": [
			["IYER", "Rotors are spinning! Run, Rohan, RUN!"],
		],
		"done": [],
	},
]

## Notes lying around the town. Reading one is a walk-over.
const NOTES := [
	{"pos": Vector3(-12, 0.9, -66), "text": "NURSE STATION LOG: Patient in bed 6 will not stop screaming. Dr. Aziz says sedate him. The night shift has not answered the intercom in an hour."},
	{"pos": Vector3(12, 0.9, -80), "text": "Do NOT open the basement. They are not patients anymore. The sound from below gets louder every time the lights flicker."},
	{"pos": Vector3(-8, 0.9, -28), "text": "Sheriff's note: Road is closed at both ends. Radio says the infected respond to light and sound. Move quietly. Keep the torch low."},
	{"pos": Vector3(-30, 0.9, 12), "text": "Gas station receipt, scrawled on the back: 'Cutters in the back room, shotgun under the register. If you read this, I did not make it past the pumps.'"},
	{"pos": Vector3(46, 0.9, 40), "text": "Graveyard keeper: the dead were restless before the town fell. Everyone blamed the water. I blame the Warden's hospital on the south road."},
	{"pos": Vector3(0, 0.9, 84), "text": "The Warden was our biggest patient. Chains do not hold him anymore. Aim for the head, and keep moving. — last page of Dr. Aziz's diary"},
]
