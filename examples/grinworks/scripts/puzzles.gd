class_name Puzzles
extends RefCounted
## The four puzzles of Grinworks as plain data and pure functions, so the game
## and the tests use the very same rules. Every puzzle here has exactly one answer,
## and tests/puzzles_test.gd proves it by brute force.

# ── 1. The beds (Nap room) ─────────────────────────────────────────────────
# Four toys, four beds numbered 1-4 from left to right along the wall. The name
# tags are gone; four clues on two notes say who sleeps where.

# Four toys, four beds. Pip the bunny, Bruno the bear, Zippy the robot, Quackers the duck.
const CREW: Array[String] = ["Bruno", "Pip", "Zippy", "Quackers"]


## `bunks` maps a name to its bunk number.
static func bunk_clues_hold(bunks: Dictionary) -> bool:
	return (
		bunks["Pip"] < bunks["Bruno"]                                 # Pip sleeps left of Bruno
		and absi(bunks["Quackers"] - bunks["Pip"]) == 1               # Quackers is right next to Pip
		and bunks["Zippy"] % 2 == 0                                   # Zippy's number is even
		and bunks["Pip"] != 1                                         # Pip will not take bed 1
	)


## Every way of seating the crew that fits the clues. Exactly one, by design.
static func bunk_solutions() -> Array:
	var out: Array = []
	var nums := [1, 2, 3, 4]
	for a in nums:
		for b in nums:
			for c in nums:
				for d in nums:
					if a == b or a == c or a == d or b == c or b == d or c == d:
						continue
					var bunks := {"Bruno": a, "Pip": b, "Zippy": c, "Quackers": d}
					if bunk_clues_hold(bunks):
						out.append(bunks)
	return out


## The cubby code: the bed numbers of Bruno, Pip, Zippy and Quackers, in that order.
static func locker_code() -> String:
	var s: Dictionary = bunk_solutions()[0]
	return "%d%d%d%d" % [s["Bruno"], s["Pip"], s["Zippy"], s["Quackers"]]


## Pip's bed number is also the intercom's cipher shift (the note in the cubby says so).
static func cipher_shift() -> int:
	return int(bunk_solutions()[0]["Pip"])


# ── 5. The gate lock (Delivery bay) ───────────────────────────────────────────
# Four numbers the player counts with their own eyes in four rooms. The note at the intercom says what to count;
# tests/map_test.gd counts the same things in the built world, so the code can never drift from the rooms.

const GATE_ROBOTS_ON_BENCHES := 2
const GATE_TERMINALS_IN_OFFICE := 2


## beds in the nap room, steam valves, robots sitting on the lab benches, glowing terminals in the mascot office.
static func gate_code() -> String:
	return "%d%d%d%d" % [CREW.size(), VALVES.size(), GATE_ROBOTS_ON_BENCHES, GATE_TERMINALS_IN_OFFICE]


# ── 2. The steam valves (Boiler room) ──────────────────────────────────────────────

const VALVES: Array[String] = ["A", "B", "C", "D", "E"]


## `open` maps a valve letter to true/false. Five rules from two pages of the manual.
static func valve_rules_hold(open: Dictionary) -> bool:
	var n := 0
	for v in VALVES:
		if open[v]:
			n += 1
	return (
		not (open["A"] and open["C"])            # A and C are never open together
		and (not open["B"] or open["D"])         # if B is open, D is open too
		and n == 3                               # exactly three are open
		and (not open["E"] or open["A"])         # E may only be open while A is
		and (open["A"] != open["D"])             # exactly one of A and D
	)


static func valve_solutions() -> Array:
	var out: Array = []
	for mask in range(32):
		var open := {}
		for i in range(5):
			open[VALVES[i]] = (mask >> i) & 1 == 1
		if valve_rules_hold(open):
			out.append(open)
	return out


static func valve_answer() -> String:
	var s: Dictionary = valve_solutions()[0]
	var out := ""
	for v in VALVES:
		if s[v]:
			out += v
	return out


# ── 3. The breakers (Toy lab) ─────────────────────────────────────────────
# A 3x3 board. Flipping a switch flips it and the switches touching it (up, down,
# left, right). All nine must end up ON. The start is made by flipping a few
# switches on a solved board, so it can always be solved.

const BREAKER_SCRAMBLE: Array[int] = [0, 4, 5, 7]   # cells pressed to make the start position


static func breaker_press(state: Array, cell: int) -> Array:
	var s := state.duplicate()
	var r := cell / 3
	var c := cell % 3
	for d in [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]:
		var rr: int = r + d[0]
		var cc: int = c + d[1]
		if rr >= 0 and rr < 3 and cc >= 0 and cc < 3:
			s[rr * 3 + cc] = not s[rr * 3 + cc]
	return s


static func breaker_start() -> Array:
	var s: Array = [true, true, true, true, true, true, true, true, true]
	for cell in BREAKER_SCRAMBLE:
		s = breaker_press(s, cell)
	return s


static func breaker_solved(state: Array) -> bool:
	for v in state:
		if not v:
			return false
	return true


## The fewest presses that solve `state` (breadth-first), or -1.
static func breaker_min_presses(state: Array) -> int:
	var seen := {}
	var frontier: Array = [state]
	seen[str(state)] = true
	var depth := 0
	while not frontier.is_empty():
		var nxt: Array = []
		for s in frontier:
			if breaker_solved(s):
				return depth
			for cell in range(9):
				var t := breaker_press(s, cell)
				if not seen.has(str(t)):
					seen[str(t)] = true
					nxt.append(t)
		frontier = nxt
		depth += 1
	return -1


# ── 4. The intercom (Mascot office) ──────────────────────────────────────────────

const LAUNCH_WORD := "BALLOON"


## Letters moved `shift` places forward through the alphabet.
static func caesar(text: String, shift: int) -> String:
	var out := ""
	for i in range(text.length()):
		var code := text.unicode_at(i)
		if code >= 65 and code <= 90:
			out += char(65 + (code - 65 + shift) % 26)
		else:
			out += text[i]
	return out


## What the whiteboard in the toy lab shows: the gate word, shifted forward.
static func scrambled_word() -> String:
	return caesar(LAUNCH_WORD, cipher_shift())
