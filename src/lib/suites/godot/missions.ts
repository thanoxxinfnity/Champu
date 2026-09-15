/**
 * Missions.
 *
 * One arena with endless waves is a score attack. What makes a zombie game a
 * game you come back to is a *reason* each time: clear the block, find the
 * keys, hold the roof for ninety seconds, get out alive. The objective is what
 * turns the same arena into a different night.
 *
 * Kept deliberately small in kind — five objective types, composed — rather
 * than one script per mission. Five types that combine give dozens of missions
 * and one code path to keep working; a script per mission gives one code path
 * per mission and nineteen of them rot.
 *
 * Every objective is expressed as data the director can check each frame. No
 * mission has its own logic, so a mission cannot have its own bug.
 */

export type ObjectiveKind =
  /** Kill N of them. The baseline. */
  | 'eliminate'
  /** Stay alive for N seconds, however many arrive. */
  | 'survive'
  /** Reach a marked place on the map. */
  | 'reach'
  /** Pick up N things scattered around. */
  | 'collect'
  /** Keep something alive, or stay inside a zone, for N seconds. */
  | 'defend';

export interface Objective {
  kind: ObjectiveKind;
  /** Kills, seconds, or things — whatever the kind counts. */
  target: number;
  /** One line, shown on the HUD while it is the current objective. */
  text: string;
  /** For `reach` and `defend`: where on the map. */
  at?: [number, number, number];
}

export interface Mission {
  id: string;
  name: string;
  /** Two lines of setup, shown before it starts. */
  brief: string;
  objectives: Objective[];
  /** Multiplies zombie speed and health. 1 is the first night. */
  difficulty: number;
  /** How many zombies the first wave brings. */
  firstWave: number;
}

/**
 * The campaign.
 *
 * Ordered so each one introduces exactly one new demand: the first is only
 * shooting, the second adds a clock, the third adds moving while being chased,
 * the fourth adds holding ground, the fifth combines them. A difficulty curve
 * is a teaching order, not a multiplier.
 */
export function campaign(gameName: string): Mission[] {
  return [
    {
      id: 'first-night',
      name: 'First Night',
      brief: `Something went wrong in the yard. Whatever it is, it is still moving.\nClear it out.`,
      objectives: [{ kind: 'eliminate', target: 12, text: 'Kill 12 zombies' }],
      difficulty: 1,
      firstWave: 4,
    },
    {
      id: 'hold-out',
      name: 'Hold Out',
      brief: `Help is ninety seconds away. They are closer than that.\nStay alive.`,
      objectives: [{ kind: 'survive', target: 90, text: 'Survive 90 seconds' }],
      difficulty: 1.25,
      firstWave: 6,
    },
    {
      id: 'supply-run',
      name: 'Supply Run',
      brief: `The ammo crates are still out there, scattered where they fell.\nGet them, then get out.`,
      objectives: [
        { kind: 'collect', target: 5, text: 'Collect 5 supply crates' },
        { kind: 'reach', target: 1, text: 'Get to the gate', at: [0, 0.25, 30] },
      ],
      difficulty: 1.5,
      firstWave: 6,
    },
    {
      id: 'the-generator',
      name: 'The Generator',
      brief: `The lights come back on if the generator runs for a minute.\nNothing else can touch it.`,
      objectives: [{ kind: 'defend', target: 60, text: 'Defend the generator for 60 seconds', at: [0, 0.25, 0] }],
      difficulty: 1.75,
      firstWave: 8,
    },
    {
      id: 'last-stand',
      name: 'Last Stand',
      brief: `No help this time. No gate.\nSee how long ${gameName} lasts.`,
      objectives: [
        { kind: 'eliminate', target: 40, text: 'Kill 40 zombies' },
        { kind: 'survive', target: 120, text: 'Survive 2 minutes' },
      ],
      difficulty: 2.25,
      firstWave: 10,
    },
  ];
}

/** GDScript for the campaign, as a table the mission runner reads. */
export function missionData(missions: Mission[]): string {
  const entry = (m: Mission): string => {
    const objectives = m.objectives
      .map((o) => {
        const at = o.at ? `, "at": Vector3(${o.at.join(', ')})` : '';
        return `\t\t\t{"kind": "${o.kind}", "target": ${o.target}, "text": "${o.text.replace(/"/g, '\\"')}"${at}}`;
      })
      .join(',\n');
    return `\t{
\t\t"id": "${m.id}",
\t\t"name": "${m.name.replace(/"/g, '\\"')}",
\t\t"brief": "${m.brief.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
\t\t"difficulty": ${m.difficulty},
\t\t"first_wave": ${m.firstWave},
\t\t"objectives": [
${objectives}
\t\t]
\t}`;
  };

  return `extends Node
## The campaign, as data.
##
## Every mission is objectives the runner already knows how to check, so a new
## mission is a row here rather than a new script — and a mission cannot have a
## bug of its own.

const MISSIONS: Array = [
${missions.map(entry).join(',\n')}
]


func count() -> int:
	return MISSIONS.size()


func get_mission(index: int) -> Dictionary:
	if index < 0 or index >= MISSIONS.size():
		return {}
	return MISSIONS[index]


## The furthest mission the player has finished, kept between sessions.
func unlocked() -> int:
	var config := ConfigFile.new()
	if config.load("user://progress.cfg") != OK:
		return 0
	# Typed explicitly: ConfigFile returns a Variant, and := through one is a
	# parse error rather than a warning.
	var reached: int = config.get_value("progress", "unlocked", 0)
	return clampi(reached, 0, MISSIONS.size() - 1)


func unlock(index: int) -> void:
	if index <= unlocked():
		return
	var config := ConfigFile.new()
	config.load("user://progress.cfg")
	config.set_value("progress", "unlocked", mini(index, MISSIONS.size() - 1))
	config.save("user://progress.cfg")
`;
}

/**
 * The runner.
 *
 * Checks every objective each frame against numbers the game is already
 * keeping. It deliberately knows nothing about *how* a zombie dies or a crate
 * is picked up — it is told, and it counts.
 */
export function missionRunner(): string {
  return `extends Node
## Runs one mission's objectives and says when they are done.

signal objective_changed(text: String, progress: int, target: int)
signal mission_complete(name: String)
signal mission_failed(reason: String)

var mission: Dictionary = {}
var _index: int = 0
var _progress: float = 0.0
var _elapsed: float = 0.0
var _done: bool = false

@onready var _player: Node3D = get_parent().get_node_or_null("Player")


func start(data: Dictionary) -> void:
	mission = data
	_index = 0
	_progress = 0.0
	_elapsed = 0.0
	_done = false
	_announce()


func current() -> Dictionary:
	var objectives: Array = mission.get("objectives", [])
	if _index < 0 or _index >= objectives.size():
		return {}
	return objectives[_index]


## Told by the game, not worked out here. A kill is a kill whether it came from
## a bullet, a fall or a script, and the runner should not have opinions.
func record(kind: String, amount: float = 1.0) -> void:
	if _done:
		return
	var objective := current()
	if objective.is_empty() or objective.get("kind", "") != kind:
		return
	_progress += amount
	_check()


func _process(delta: float) -> void:
	if _done or mission.is_empty():
		return
	_elapsed += delta

	var objective := current()
	if objective.is_empty():
		return

	var kind: String = objective.get("kind", "")
	if kind == "survive" or kind == "defend":
		_progress += delta
		_check()
	elif kind == "reach" and _player != null:
		# Squared distance: a square root every frame, for a comparison against
		# a constant, is a square root that never needed doing.
		var here: Vector3 = objective.get("at", Vector3.ZERO)
		if _player.global_position.distance_squared_to(here) < 9.0:
			_progress = 1.0
			_check()


func _check() -> void:
	var objective := current()
	if objective.is_empty():
		return
	var target: float = float(objective.get("target", 1))
	objective_changed.emit(String(objective.get("text", "")), int(_progress), int(target))

	if _progress < target:
		return

	_index += 1
	_progress = 0.0
	if _index >= (mission.get("objectives", []) as Array).size():
		_done = true
		mission_complete.emit(String(mission.get("name", "Mission")))
	else:
		_announce()


func fail(reason: String) -> void:
	if _done:
		return
	_done = true
	mission_failed.emit(reason)


func _announce() -> void:
	var objective := current()
	if objective.is_empty():
		return
	objective_changed.emit(String(objective.get("text", "")), 0, int(objective.get("target", 1)))
`;
}

/**
 * The mission select screen.
 *
 * Its own scene rather than a menu overlay, because it is the thing the game
 * opens to and a menu that hides a running game has to deal with a running
 * game. Built in code for the same reason the HUD is: a Control tree in a .tscn
 * is more resources whose ids have to line up, and it looks identical.
 */
export function missionSelect(gameName: string): string {
  return `extends Control
## Where the game starts: pick a mission, or carry on from the furthest one.

const GAME_SCENE := "res://main.tscn"

@onready var _list: VBoxContainer = $Panel/Scroll/List
@onready var _missions: Node = $Missions


func _ready() -> void:
	# The mouse is visible here even when the game captures it, or the player
	# cannot click the mission they want.
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	_build()


func _build() -> void:
	for child in _list.get_children():
		child.queue_free()

	var unlocked: int = _missions.unlocked()
	for i in _missions.count():
		var mission: Dictionary = _missions.get_mission(i)
		var button := Button.new()
		var locked: bool = i > unlocked
		button.text = "%d. %s%s" % [i + 1, mission.get("name", "Mission"), " (locked)" if locked else ""]
		button.disabled = locked
		button.custom_minimum_size = Vector2(0, 52)
		button.pressed.connect(_play.bind(i))
		_list.add_child(button)

		var brief := Label.new()
		brief.text = String(mission.get("brief", "")).replace("\\n", "  ")
		brief.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		brief.modulate = Color(1, 1, 1, 0.55)
		_list.add_child(brief)


func _play(index: int) -> void:
	# Carried through the scene change in a global rather than a constructor
	# argument, because change_scene_to_file cannot take one.
	var config := ConfigFile.new()
	config.load("user://progress.cfg")
	config.set_value("progress", "playing", index)
	config.save("user://progress.cfg")
	get_tree().change_scene_to_file(GAME_SCENE)
`;
}

/** One line per mission, for the README the project ships with. */
export function describeMissions(missions: Mission[]): string {
  return missions.map((m, i) => `${i + 1}. **${m.name}** — ${m.objectives.map((o) => o.text).join(', then ')}.`).join('\n');
}
