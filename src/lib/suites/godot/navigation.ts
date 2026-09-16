/**
 * Getting there.
 *
 * The arena used to be an open square, so "walk straight at the player" was a
 * complete AI. Then it became a city block, and a test that put one zombie on
 * every spawn point and waited found that **ten of sixteen never arrived**:
 * they pressed into the corner of a building and stayed there for the rest of
 * the match. The four diagonal spawns all jammed at the same coordinate, which
 * is what a wall looks like from the outside.
 *
 * That is not a difficulty setting, it is the wave never clearing — and a
 * mission that asks for forty kills cannot be finished at all.
 *
 * Godot has had the answer since 4.0 and this suite was not reaching for it.
 *
 * ── Why the mesh is baked at runtime ────────────────────────────────────────
 *
 * A `NavigationMesh` is baked vertex and polygon data. In a project a person
 * edits, it is baked in the editor and saved into the scene. Nothing here can
 * do that: the level arrives as text that has never been opened in an editor,
 * and a language model cannot emit a polygon soup that matches geometry it
 * described in metres a moment earlier.
 *
 * So the region bakes itself in `_ready()` from the static colliders under it.
 * It costs a fraction of a second at load, it is always correct for the level
 * that actually shipped, and it keeps working when the layout changes — which
 * is the whole point of generating levels rather than drawing them.
 *
 * ── And why the straight line is still in there ─────────────────────────────
 *
 * If the bake fails, or an enemy asks for a path before the first bake lands,
 * the agent returns its own position and the enemy stands still. Standing still
 * is worse than the bug this replaces. So a path that has not arrived falls
 * back to walking at the player, which is wrong in the same way it was always
 * wrong, and never worse.
 */

/** Agent sizing. These have to match the enemy's capsule or it paths through walls. */
export const CELL = 0.25;

export const AGENT = {
  /**
   * The capsule is 0.4, and this is two cells exactly.
   *
   * Radius is **ceiled** to `cell_size`, so 0.55 does not mean 0.55 — it means
   * 0.75, an agent half again as wide as intended, too fat for gaps a zombie
   * physically fits through. Three of sixteen stopped at a wall because of it.
   */
  radius: 0.5,
  /**
   * Height and climb are voxelised to `cell_height` — height is ceiled, climb
   * is floored — so anything that is not a multiple of the cell is quietly
   * rounded and Godot warns about losing precision. Given as exact multiples,
   * the numbers in the file are the numbers the bake uses.
   */
  height: 2.0,
  /** Kerbs and the foot of the ramp, not crates. Two cells. */
  maxClimb: 0.5,
  /**
   * Below the ramp's 26.6°, deliberately.
   *
   * At 45° the bake makes the ramp walkable, and then the whole thing goes
   * wrong in a way that took three attempts to see: the pathfinder happily
   * routes an enemy up it, the enemy cannot get on — a `CharacterBody3D` has no
   * step-up, and everything but the very foot of a wedge is a step — and it
   * grinds against the edge for the rest of the match, one waypoint from a path
   * that was otherwise perfect.
   *
   * Under the slope, the ramp bakes as an obstacle instead. Enemies route
   * around it, and the roof becomes what it was designed to be: high ground
   * that is yours. If a level wants enemies to use a ramp, raise this **and**
   * give the ramp a flat landing at both ends, because the navigation mesh will
   * promise a step the character controller cannot make.
   */
  maxSlope: 20,
} as const;

/**
 * The `NavigationMesh` resource, as a `.tscn` sub-resource.
 *
 * `cell_size` and `cell_height` must match the navigation map's, which come
 * from `navigation/2d|3d/default_cell_*` in the project settings. Mismatched,
 * Godot logs "Attempted to update a navigation region with a navigation mesh
 * that uses a cell_height of X while assigned to a navigation map set to Y" and
 * the region's mesh is rejected — so every path query fails and every enemy
 * silently falls back to walking into a wall, which is the bug this file exists
 * to fix. 0.25 is the engine default for both.
 */
export function navigationMeshResource(id: string): string {
  return `[sub_resource type="NavigationMesh" id="${id}"]
agent_radius = ${AGENT.radius}
agent_height = ${AGENT.height}
agent_max_climb = ${AGENT.maxClimb}
agent_max_slope = ${AGENT.maxSlope}
cell_size = ${CELL}
cell_height = ${CELL}
geometry_parsed_geometry_type = 1
geometry_collision_mask = 1`;
}

/**
 * The script on the region.
 *
 * Baking is asynchronous and the first wave starts almost immediately, so this
 * announces when it is finished rather than leaving every enemy to guess.
 */
export function navigationScript(): string {
  return `extends NavigationRegion3D
## Bakes the walkable surface out of the level, once, at load.
##
## The level is generated, so there is no editor pass in which a navigation mesh
## could have been baked and saved. It is built here instead, from the static
## collision shapes underneath this node — which means it is always the mesh for
## the level that actually shipped, however the layout changed.

## Emitted when enemies can start asking for paths.
signal navigation_ready


func _ready() -> void:
	if navigation_mesh == null:
		push_warning("No NavigationMesh resource: the horde will walk in straight lines.")
		return
	# Deferred, because baking walks the scene tree and the tree is still being
	# built while _ready runs — an immediate bake sees a level with holes in it.
	_bake.call_deferred()


func _bake() -> void:
	await get_tree().process_frame
	bake_finished.connect(_on_baked, CONNECT_ONE_SHOT)
	bake_navigation_mesh(true)


func _on_baked() -> void:
	# One more frame: the server takes the new mesh on its own sync, and a path
	# requested before that comes back empty.
	await get_tree().physics_frame
	navigation_ready.emit()
`;
}

/**
 * What the enemy does with it.
 *
 * Returned as a block to splice into the enemy script rather than a separate
 * node script, because the enemies are built in code by the director and every
 * extra node it has to assemble is another thing that can be forgotten.
 */
export const ENEMY_NAVIGATION = {
  /** Exports and state the pathing needs. */
  fields: `## How often the destination is refreshed. Every frame is a path query per
## zombie per frame, which at wave ten is most of the frame; three times a
## second is more than enough to follow someone running.
@export var repath_seconds: float = 0.33

var _agent: NavigationAgent3D
var _repath: float = 0.0`,

  /** Built in `_ready`, so an enemy assembled in code gets one too. */
  ready: `	# Built here rather than expected from the scene: the director assembles
	# these in code, and a node it forgets to add is an enemy that walks into a
	# wall with no error anywhere.
	_agent = NavigationAgent3D.new()
	_agent.radius = 0.5
	_agent.height = 1.9
	_agent.path_desired_distance = 0.6
	_agent.target_desired_distance = 1.2
	# Slightly larger than the capsule, so a zombie rounding a corner does not
	# clip the brickwork and stop dead.
	_agent.path_max_distance = 3.0
	_agent.avoidance_enabled = false
	add_child(_agent)`,

  /**
   * The direction to walk in.
   *
   * Falls back to the straight line whenever the path is not usable, because a
   * zombie that stands still reads as broken in a way that one taking a silly
   * route does not.
   */
  direction: `## Which way to walk, this frame.
##
## The path when there is one, the straight line when there is not. Never
## nothing: a zombie standing still because the navigation server has not
## finished its first sync is worse than a zombie walking into a wall.
func _walk_direction(to_target: Vector3, delta: float) -> Vector3:
	if _agent == null:
		return to_target.normalized()

	_repath -= delta
	if _repath <= 0.0:
		_repath = repath_seconds
		_agent.target_position = target.global_position

	if _agent.is_navigation_finished():
		return to_target.normalized()

	var next: Vector3 = _agent.get_next_path_position()
	var step: Vector3 = next - global_position
	step.y = 0.0
	# An agent with no map yet answers with its own position. That is a zero
	# vector, and normalising it gives a zombie that has decided to stop.
	if step.length_squared() < 0.0004:
		return to_target.normalized()
	return step.normalized()`,
} as const;
