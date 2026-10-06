/**
 * What kind of work the bubble is showing, from the words it is already showing.
 *
 * The bubble says the stage the run is really in ("Writing main.gd…", "Running Godot…"). The kind of work
 * decides how it moves: a download fills a bar, a terminal blinks a cursor, painting lays down strokes. Judged
 * from the phrase alone so nothing upstream has to pass a second value around and the two can never disagree.
 */
export type Activity =
  | 'think'
  | 'write'
  | 'terminal'
  | 'download'
  | 'paint'
  | 'build'
  | 'search'
  | 'deploy'
  | 'audio'
  | 'plan'
  | 'read';

const RULES: Array<[RegExp, Activity]> = [
  [/^(deploy|publish)/i, 'deploy'],
  [/\bto vercel\b/i, 'deploy'],
  [/^(download|fetch|unpack|sync)/i, 'download'],
  [/^(research|check(ing)? the live web|search)/i, 'search'],
  [/^(paint)/i, 'paint'],
  [/soundtrack|\bmusic\b|\baudio\b|\bsound\b/i, 'audio'],
  [/^(build|compil|export|packag|install)/i, 'build'],
  [/^(decompos|plan)/i, 'plan'],
  [/^(read(ing)?\b|reading what came back)/i, 'read'],
  [/^(writ|polish|creat|updat|draft)/i, 'write'],
  [/^(running|run )/i, 'terminal'],
];

export function activityOf(phrase: string): Activity {
  const text = phrase.trim();
  for (const [pattern, kind] of RULES) if (pattern.test(text)) return kind;
  return 'think';
}
