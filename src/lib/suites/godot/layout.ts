/**
 * The place the game happens in.
 *
 * What was here before was a flat 64-metre square with sixteen crates at
 * hand-picked coordinates. Every one of those coordinates was *reasonable* and
 * the result still read as junk dropped on a car park, because scattering is
 * not layout. A place is made of the things people would have built there and
 * the gaps between them, and the gaps are the level.
 *
 * ── The rules this file follows ─────────────────────────────────────────────
 *
 * **Streets before buildings.** The empty space is designed first and the
 * buildings are what is left. A block laid out the other way round is a maze
 * with corridors that happen to exist.
 *
 * **Nothing is a dead end.** Every alley opens at both ends. A pocket with one
 * way in is where a player dies to the level rather than to the game, and they
 * are right to call that a bug.
 *
 * **Cover sits where someone put it.** Against a wall, at a corner, or in a
 * line down a street. Never floating in the middle of an open space, which is
 * the tell that a computer placed it.
 *
 * **A line of cover is a slalom, not a wall.** Alternating sides down the long
 * street gives a route with decisions in it. Three in a row gives a barricade.
 *
 * **One landmark, taller than everything else.** Without something to steer by,
 * four similar quadrants are a maze. With it, the block is legible from the
 * first corner you turn.
 *
 * **One way up.** A flat arena is a flat fight. A ramp to a roof over the
 * plaza turns "where do I stand" into a question — and it is a ramp rather
 * than a ledge because a `CharacterBody3D` walks up a slope under
 * `floor_max_angle` and cannot climb a step taller than its jump.
 *
 * **Enemies arrive down the streets.** The ring-spawn this replaced dropped
 * them at a fixed radius from the origin, which with buildings in the way means
 * inside one. They come from the mouths of the streets and the alleys instead,
 * which is also where a player would expect to see them.
 *
 * Coordinates are metres, x east and z south, the origin at the centre of the
 * plaza where the player starts.
 */

export interface Building {
  /** Node name in the scene, so a wall can be found and edited by hand. */
  name: string;
  /** Centre, on the ground plane. */
  at: [number, number];
  /** Width (x), height (y), depth (z). */
  size: [number, number, number];
  /** Which of the three wall materials it wears. */
  material: 0 | 1 | 2;
}

export interface Block {
  /** Half the width of the ground slab. Walls sit on this. */
  extent: number;
  buildings: Building[];
  /** Where a piece of cover stands, on the ground. */
  cover: Array<[number, number]>;
  /** Street and alley mouths the horde walks in from. */
  spawns: Array<[number, number]>;
  /** The ramp up to the overlook: centre, size, and its tilt in radians. */
  ramp: { at: [number, number, number]; size: [number, number, number]; tilt: number };
  /** The roof it leads to. */
  overlook: { at: [number, number, number]; size: [number, number, number] };
}

/** Half-width of the two streets that cross at the plaza. */
const STREET = 6;
/** Buildings stop here, leaving a service road inside the wall. */
const LOTS = 27;

/**
 * The block.
 *
 * Two twelve-metre streets cross at the plaza and cut the ground into four
 * lots. Each lot holds two or three buildings with a four-metre alley through
 * it, and the alleys are turned a different way in each lot so they do not line
 * up into one long shooting gallery.
 */
export function cityBlock(): Block {
  const buildings: Building[] = [
    // North-west: one long face on the street, a six-metre alley behind it.
    // Four metres was the first try and it is not an alley, it is a trap: a
    // 2.4m crate in it leaves 0.8m each side and the player is 0.8m wide.
    { name: 'Warehouse', at: [-23, -17.5], size: [8, 11, 19], material: 0 },
    { name: 'WarehouseAnnex', at: [-10.5, -17.5], size: [5, 6, 19], material: 2 },
    // North-east: the alley runs the other way, so the four do not line up into
    // one long shooting gallery through the middle of the map.
    { name: 'Depot', at: [17.5, -23.5], size: [19, 7, 7], material: 1 },
    { name: 'Store', at: [17.5, -11.5], size: [19, 12, 7], material: 0 },
    // South-west.
    { name: 'Sheds', at: [-17.5, 11], size: [19, 6, 6], material: 2 },
    { name: 'Hall', at: [-17.5, 23.5], size: [19, 9, 7], material: 1 },
    // South-east. The tower is the landmark: half as tall again as anything
    // else, so it is visible over every roof from anywhere on the block.
    { name: 'Watchtower', at: [10.5, 12], size: [5, 18, 8], material: 1 },
    { name: 'YardBlock', at: [10.5, 22.5], size: [5, 5, 9], material: 2 },
    { name: 'EastWarehouse', at: [23, 17.5], size: [8, 7, 19], material: 0 },
  ];

  // Against a face, at a corner of the plaza, or down the middle of the long
  // street — and never in the open, which is where nothing would ever be.
  const cover: Array<[number, number]> = [
    // Hugging the annex, down the north street. Kept 2.6m off each building
    // face, because the crate is 2.4m across and one that clips a wall is a
    // wall you can shoot through.
    [-6.5, -22],
    [-6.5, -16],
    [-6.5, -10],
    // The other side of the same street, against the north-east lot.
    [6.5, -23],
    [6.5, -14],
    // The south street.
    [-6.5, 10],
    [-6.5, 20],
    [6.5, 9],
    [6.5, 24],
    // The plaza's corners, where the two streets meet: the first cover a
    // player reaches, and the last they fall back to.
    [-6.5, -6.5],
    [6.5, -6.5],
    [-6.5, 6.5],
    // A slalom down the run to the gate, alternating sides so it is a route
    // with choices rather than a barricade.
    [-3, 13],
    [3, 18],
    [-3, 23],
    // Each alley gets one, set to one side so there is still a way past.
    [15.5, 13],
    [-16, 17],
    [-16, -17],
  ];

  // Street and alley mouths, all of them on the service road.
  const spawns: Array<[number, number]> = [
    [-3, -29],
    [3, -29],
    [-3, 29],
    [3, 29],
    [-29, -3],
    [-29, 3],
    [29, -3],
    [29, 3],
    [-29, -29],
    [29, -29],
    [-29, 29],
    [29, 29],
    // The alleys, so the horde can come out of somewhere unlit.
    [-16, -29],
    [16, 29],
    [-29, 17],
    [29, -18],
  ];

  // A ramp off the east street up to the Store's roof line. Rise 4 over run 8
  // is 26.6°, comfortably under the 45° a CharacterBody3D will walk up, and a
  // slope is the only way up that does not depend on the jump height.
  const rise = 4;
  const run = 8;
  const slope = Math.hypot(run, rise);
  const tilt = Math.atan2(rise, run);
  // Thick enough that the wedge is solid all the way down.
  //
  // The first ramp was a 40cm tilted slab, and Godot ran it exactly as built: a
  // thin plank held up in the air, with a gap underneath that widened as it
  // climbed. A slab whose underside clears the floor is a bridge, and a bridge
  // you can walk under is a bridge you will walk under.
  const thickness = 4.5;

  const deckTop = 4.25;
  /** The deck's far edge, hard against the Store's south face. */
  const deckFar = -8;
  const rampCentreZ = 0;

  // Both corners of the walkable surface, from the box's own geometry rather
  // than from a guess. Half the length along the slope, plus half the thickness
  // out along the surface normal.
  const alongZ = (Math.cos(tilt) * slope) / 2;
  const alongY = (Math.sin(tilt) * slope) / 2;
  const outZ = (Math.sin(tilt) * thickness) / 2;
  const outY = (Math.cos(tilt) * thickness) / 2;

  const centreY = deckTop - (alongY + outY);
  /** Where the climb ends. The deck has to start here or you walk off it. */
  const rampTopZ = rampCentreZ - alongZ + outZ;

  return {
    extent: 32,
    buildings,
    cover,
    spawns,
    ramp: { at: [16.5, round(centreY), rampCentreZ], size: [5, thickness, slope], tilt },
    // Sized to meet the ramp, never set by hand. Set by hand it was a metre
    // short, and a metre short is a player who climbs the whole ramp, steps off
    // the top into thin air, and lands wedged against the front of the roof
    // they were trying to get onto.
    overlook: {
      at: [18, deckTop - 0.25, round((deckFar + rampTopZ) / 2)],
      size: [12, 0.5, round(rampTopZ - deckFar)],
    },
  };
}

function round(n: number): number {
  return Number(n.toFixed(3));
}

/** The top and bottom of the walkable surface: where the climb starts and ends. */
export function rampEnds(block: Block): { foot: [number, number]; top: [number, number] } {
  const { at, size, tilt } = block.ramp;
  const alongZ = (Math.cos(tilt) * size[2]) / 2;
  const alongY = (Math.sin(tilt) * size[2]) / 2;
  const outZ = (Math.sin(tilt) * size[1]) / 2;
  const outY = (Math.cos(tilt) * size[1]) / 2;
  return {
    // z, y — the low end is at +z because the slope climbs towards -z.
    foot: [at[2] + alongZ + outZ, at[1] - alongY + outY],
    top: [at[2] - alongZ + outZ, at[1] + alongY + outY],
  };
}

/**
 * A `Transform3D` basis, as Godot writes it in a `.tscn`.
 *
 * **Row-major, and this cost an afternoon.** The twelve-float form is
 * `Transform3D(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)`, and those nine
 * are the basis *rows* — `Basis(xx, xy, …)` documents itself as "the given
 * `[i][j]` elements". It is the `Basis(Vector3, Vector3, Vector3)` constructor
 * that takes columns, and building the same rotation in code with that one and
 * writing it into a scene file are therefore transposes of each other.
 *
 * A transposed rotation is still a perfectly valid rotation, which is why
 * nothing complains: the ramp was simply tilted the other way. It loaded, it
 * rendered, it collided — and the player walking at it hit the end cap, whose
 * normal came back `(0, 0.447, 0.894)`. That is 63° off vertical, over the
 * default `floor_max_angle` of 45°, so Godot called it a wall and the player
 * stood there for the rest of the match. The same numbers fed to
 * `Basis(Vector3…)` in a test scene climbed perfectly, which is what finally
 * gave it away.
 *
 * The four wall transforms elsewhere in this suite are quarter turns of a
 * symmetric box, so they are their own transpose and never revealed this.
 */
export function tiltedBasis(tilt: number): string {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  // Rows of a rotation about X. The columns are (1,0,0), (0,c,s), (0,-s,c);
  // these are those read the other way.
  return [1, 0, 0, 0, c, -s, 0, s, c].map((n) => Number(n.toFixed(4))).join(', ');
}

/** Whether any two of these overlap on the ground — which would be a hole. */
export function overlaps(a: Building, b: Building): boolean {
  const gapX = Math.abs(a.at[0] - b.at[0]) - (a.size[0] + b.size[0]) / 2;
  const gapZ = Math.abs(a.at[1] - b.at[1]) - (a.size[2] + b.size[2]) / 2;
  return gapX < -0.001 && gapZ < -0.001;
}

/** Whether a point on the ground is inside a building. */
export function inside(block: Block, x: number, z: number, margin = 0): boolean {
  return block.buildings.some(
    (b) =>
      Math.abs(x - b.at[0]) < b.size[0] / 2 + margin && Math.abs(z - b.at[1]) < b.size[2] / 2 + margin,
  );
}

/** One line per landmark, for the README. */
export function describeBlock(block: Block): string {
  const tallest = block.buildings.reduce((a, b) => (b.size[1] > a.size[1] ? b : a));
  return [
    `Two twelve-metre streets cross at the plaza where you start, cutting the block`,
    `into four lots. Each lot has an alley through it, turned a different way, and`,
    `every alley is open at both ends. **${tallest.name}** is the tallest thing on the`,
    `map at ${tallest.size[1]}m — if you are lost, it is the thing to steer by. A ramp off the`,
    `east street climbs to a roof overlooking the plaza, which is the only high`,
    `ground and worth holding. The horde comes in from the street and alley mouths`,
    `around the edge, never out of thin air.`,
  ].join('\n');
}
