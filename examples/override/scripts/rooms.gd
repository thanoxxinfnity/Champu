class_name Rooms
extends RefCounted
## The map as data. A room is an inner rectangle (x0, x1, z0, z1) on the metre grid; two rooms are always
## one wall (Data.WALL) apart, and a doorway is a gap of Data.DOOR_W cells in that wall. Everything in a room
## (props, pick-ups, switches, enemies) is listed here and only built when the streamer loads the room.

# palette ids are keys of Level.PALETTE
const LIST := {
	# ── Chapter 1: The Safe Room ────────────────────────────────────────────
	"c1_cryo": {"ch": 1, "r": [0, 10, 0, 8], "h": 3.2, "pal": "clean", "name": "Cryo chamber"},
	"c1_hall": {"ch": 1, "r": [11, 27, 2, 6], "h": 3.2, "pal": "dark", "name": "Hall"},
	"c1_server": {"ch": 1, "r": [11, 21, 7, 15], "h": 3.2, "pal": "dark", "name": "Server closet"},
	"c1_store": {"ch": 1, "r": [11, 21, -7, 1], "h": 3.2, "pal": "dark", "name": "Store room"},
	"c1_lift": {"ch": 1, "r": [28, 32, 2, 6], "h": 3.2, "pal": "lift", "name": "Lift"},
	# ── Chapter 2: Sparking Corridors ───────────────────────────────────────
	"c2_lobby": {"ch": 2, "r": [100, 114, 0, 12], "h": 4.0, "pal": "wet", "name": "Flooded lobby"},
	"c2_pipe": {"ch": 2, "r": [115, 129, 4, 8], "h": 3.0, "pal": "wet", "name": "Pipe tunnel"},
	"c2_ctrl": {"ch": 2, "r": [115, 125, 9, 17], "h": 3.2, "pal": "wet", "name": "Control room"},
	"c2_pump": {"ch": 2, "r": [130, 142, 0, 10], "h": 3.6, "pal": "wet", "name": "Pump room"},
	"c2_lift": {"ch": 2, "r": [143, 147, 3, 7], "h": 3.2, "pal": "lift", "name": "Lift"},
	# ── Chapter 3: The Factory ──────────────────────────────────────────────
	"c3_floor": {"ch": 3, "r": [200, 228, 0, 16], "h": 5.0, "pal": "factory", "name": "Assembly floor"},
	"c3_lockers": {"ch": 3, "r": [200, 210, 17, 24], "h": 3.2, "pal": "factory", "name": "Locker room"},
	"c3_office": {"ch": 3, "r": [212, 226, 17, 25], "h": 3.2, "pal": "factory", "name": "Foreman's office"},
	"c3_work": {"ch": 3, "r": [229, 241, 2, 12], "h": 3.6, "pal": "factory", "name": "Workshop"},
	"c3_lift": {"ch": 3, "r": [242, 246, 4, 8], "h": 3.2, "pal": "lift", "name": "Lift"},
	# ── Chapter 4: The Core Escape ──────────────────────────────────────────
	"c4_lobby": {"ch": 4, "r": [300, 306, 2, 8], "h": 3.2, "pal": "lift", "name": "Lift lobby"},
	"c4_corr": {"ch": 4, "r": [307, 321, 4, 7], "h": 3.0, "pal": "core", "name": "Descent"},
	"c4_reactor": {"ch": 4, "r": [322, 340, -2, 12], "h": 6.0, "pal": "core", "name": "Reactor"},
	"c4_waste": {"ch": 4, "r": [322, 340, 13, 21], "h": 4.0, "pal": "core", "name": "Waste hall"},
	"c4_return": {"ch": 4, "r": [307, 321, 15, 19], "h": 3.0, "pal": "core", "name": "Return tunnel"},
	"c4_exit": {"ch": 4, "r": [300, 306, 14, 20], "h": 3.2, "pal": "lift", "name": "Exit lift"},
}

## Doorways: [room a, room b, axis of the wall, position of the wall's near face, [from, to] along the wall].
## Axis "x" means the wall is a plane x = const (the two rooms are west/east of each other).
const DOORS := [
	{"id": "d_cryo_hall", "a": "c1_cryo", "b": "c1_hall", "axis": "x", "at": 10, "span": [2, 5]},
	{"id": "d_hall_server", "a": "c1_hall", "b": "c1_server", "axis": "z", "at": 6, "span": [14, 17]},
	{"id": "d_hall_store", "a": "c1_store", "b": "c1_hall", "axis": "z", "at": 1, "span": [14, 17]},
	{"id": "d_hall_lift", "a": "c1_hall", "b": "c1_lift", "axis": "x", "at": 27, "span": [3, 6], "locked": "lift1"},
	{"id": "d_lobby_pipe", "a": "c2_lobby", "b": "c2_pipe", "axis": "x", "at": 114, "span": [4, 7]},
	{"id": "d_pipe_ctrl", "a": "c2_pipe", "b": "c2_ctrl", "axis": "z", "at": 8, "span": [118, 121]},
	{"id": "d_pipe_pump", "a": "c2_pipe", "b": "c2_pump", "axis": "x", "at": 129, "span": [4, 7]},
	{"id": "d_pump_lift", "a": "c2_pump", "b": "c2_lift", "axis": "x", "at": 142, "span": [3, 6], "locked": "lift2"},
	{"id": "d_floor_lockers", "a": "c3_floor", "b": "c3_lockers", "axis": "z", "at": 16, "span": [203, 206]},
	{"id": "d_floor_office", "a": "c3_floor", "b": "c3_office", "axis": "z", "at": 16, "span": [216, 219], "locked": "office"},
	{"id": "d_floor_work", "a": "c3_floor", "b": "c3_work", "axis": "x", "at": 228, "span": [5, 8]},
	{"id": "d_work_lift", "a": "c3_work", "b": "c3_lift", "axis": "x", "at": 241, "span": [4, 7], "locked": "lift3"},
	{"id": "d_lobby_corr", "a": "c4_lobby", "b": "c4_corr", "axis": "x", "at": 306, "span": [4, 7]},
	{"id": "d_corr_reactor", "a": "c4_corr", "b": "c4_reactor", "axis": "x", "at": 321, "span": [4, 7]},
	{"id": "d_reactor_waste", "a": "c4_reactor", "b": "c4_waste", "axis": "z", "at": 12, "span": [329, 332]},
	{"id": "d_waste_return", "a": "c4_return", "b": "c4_waste", "axis": "x", "at": 321, "span": [15, 18]},
	{"id": "d_return_exit", "a": "c4_exit", "b": "c4_return", "axis": "x", "at": 306, "span": [15, 18], "locked": "exit"},
]

## Where each chapter begins (the room, and the spot in it) and which lift leads on.
const CHAPTERS := {
	1: {"room": "c1_cryo", "spawn": Vector3(5, 0, 4), "yaw": -90.0},
	2: {"room": "c2_lobby", "spawn": Vector3(102, 0, 6), "yaw": -90.0},
	3: {"room": "c3_floor", "spawn": Vector3(202, 0, 8), "yaw": -90.0},
	4: {"room": "c4_lobby", "spawn": Vector3(302, 0, 5), "yaw": -90.0},
}

## The room a point is in, "" in a wall or outside.
static func at(p: Vector3) -> String:
	for id in LIST:
		var r: Array = LIST[id].r
		if p.x >= r[0] and p.x <= r[1] and p.z >= r[2] and p.z <= r[3]:
			return id
	return ""


static func neighbours(id: String) -> Array:
	var out: Array = []
	for d in DOORS:
		if d.a == id:
			out.append(d.b)
		elif d.b == id:
			out.append(d.a)
	return out
