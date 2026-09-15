/** node --experimental-strip-types --test scripts/test-plan.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferDimension,
  inferEntities,
  inferGenre,
  inferName,
  inferPlayer,
  inferView,
  planBrief,
  planGame,
  planSummary,
  playerParts,
  article,
  GENRE_CUES,
  looksLikeGame,
} from '../src/lib/suites/godot/plan.ts';
import { classifyLocal } from '../src/lib/agent/router.ts';

test('the genre comes from the prompt, not from the template', () => {
  // The whole point: without this every prompt produced the same game, because
  // the same scene template was all that decided it.
  assert.equal(inferGenre('an endless runner on a rooftop').genre, 'runner');
  assert.equal(inferGenre('a first person shooter in a space station').genre, 'shooter');
  assert.equal(inferGenre('a kart racing game').genre, 'racing');
  assert.equal(inferGenre('a platformer where you jump between islands').genre, 'platformer');
  assert.equal(inferGenre('a sokoban style puzzle').genre, 'puzzle');
  assert.equal(inferGenre('survive the zombie horde at night').genre, 'survival');
});

test('a more specific cue wins over a looser one', () => {
  // "endless runner where you jump" is a runner. Ordering the cues wrong makes
  // it a platformer, which is a different game.
  assert.equal(inferGenre('an endless runner where you jump over gaps').genre, 'runner');
  assert.equal(inferGenre('a racing game where you shoot other cars').genre, 'racing');
});

test('an unreadable prompt gets a default that is marked as a guess', () => {
  const { genre, stated } = inferGenre('something fun');
  assert.equal(genre, 'adventure');
  assert.equal(stated, false, 'the default is flagged so it can be shown as an assumption');
});

test('the camera follows the prompt when it says, and the genre when it does not', () => {
  assert.deepEqual(inferView('a first person shooter', 'shooter'), { view: 'first-person', stated: true });
  assert.deepEqual(inferView('a top down dungeon', 'adventure'), { view: 'top-down', stated: true });
  // A platformer is side-on by default, but an explicit request overrides it.
  assert.equal(inferView('a platformer', 'platformer').view, 'side-on');
  assert.equal(inferView('a third person platformer', 'platformer').view, 'third-person');
});

test('2D is only chosen when asked for', () => {
  // The suite writes Godot 3D nodes; silently switching to 2D would emit a
  // project whose scripts do not match its nodes.
  assert.deepEqual(inferDimension('a 2d pixel art platformer'), { dimension: '2d', stated: true });
  assert.deepEqual(inferDimension('a 3d racing game'), { dimension: '3d', stated: true });
  assert.deepEqual(inferDimension('a racing game'), { dimension: '3d', stated: false });
});

test('a name the user gave is used as given', () => {
  assert.equal(inferName('make a game called Sky Runner').name, 'Sky Runner');
  assert.equal(inferName('a game named "Deep Dark"').name, 'Deep Dark');
  assert.equal(inferName("a platformer titled Pixel Leap").name, 'Pixel Leap');
});

test('an invented name uses the idea, not the first words of the sentence', () => {
  // "Make Me" is the kind of name that makes generated work feel generated.
  const { name, stated } = inferName('please make me a game about a ninja in a temple');
  assert.equal(stated, false);
  assert.ok(!/make|please|me\b/i.test(name), `"${name}" should not be built from filler words`);
  assert.match(name, /Ninja|About|Temple/);
});

test('the player is the subject of the sentence, not every noun in it', () => {
  // "a ninja fights robots" must not make the player a robot.
  assert.equal(inferPlayer('a game where a ninja fights robots').description, 'ninja');
  assert.equal(inferPlayer('you play as a dragon').description, 'a dragon'.replace('a ', ''));
  assert.equal(inferPlayer('you are a wolf in the forest').description.includes('wolf'), true);
});

test('the body plan follows what the player is', () => {
  // A wolf on a biped rig walks on two legs, which reads as broken.
  assert.equal(inferPlayer('you play as a wolf').body, 'quadruped');
  assert.equal(inferPlayer('you play as a bird').body, 'flying');
  assert.equal(inferPlayer('a game where a ninja fights robots').body, 'biped');
});

test('enemies and pickups named in the prompt end up in the plan', () => {
  const entities = inferEntities('collect coins and avoid the zombies', 'platformer');
  const names = entities.map((e) => e.name);
  assert.ok(names.includes('Zombie'), `expected a Zombie in ${names.join(', ')}`);
  assert.ok(names.includes('Coin'), `expected a Coin in ${names.join(', ')}`);
  assert.equal(entities.find((e) => e.name === 'Zombie').role, 'enemy');
  assert.equal(entities.find((e) => e.name === 'Coin').role, 'pickup');
});

test('a genre with nothing named still gets something to interact with', () => {
  // Otherwise the output is a walking simulator on an empty plane, which is
  // exactly the generic result this module exists to stop.
  const shooter = inferEntities('a shooter', 'shooter');
  assert.ok(shooter.some((e) => e.role === 'enemy'));
  const platformer = inferEntities('a platformer', 'platformer');
  assert.ok(platformer.some((e) => e.role === 'pickup'));
  assert.ok(platformer.some((e) => e.role === 'obstacle'));
});

test('the entity list is capped, so the plan stays buildable', () => {
  const crowded = inferEntities(
    'zombies robots monsters aliens dragons ghosts slimes bandits wolves skeletons coins gems stars keys',
    'adventure',
  );
  assert.ok(crowded.length <= 6, `${crowded.length} entities is more than one build will finish`);
});

test('a plan is deterministic — the same prompt reads the same way twice', () => {
  // It has to work offline and it has to be correctable; a reading that drifts
  // between runs is neither.
  const prompt = 'an endless runner called Sky Dash where a ninja dodges robots and collects coins';
  assert.deepEqual(planGame(prompt), planGame(prompt));
});

test('a full plan reads the whole prompt, not one part of it', () => {
  const plan = planGame('an endless runner called Sky Dash where a ninja dodges robots and collects coins');
  assert.equal(plan.name, 'Sky Dash');
  assert.equal(plan.genre, 'runner');
  assert.equal(plan.player.description, 'ninja');
  assert.ok(plan.entities.some((e) => e.name === 'Robot'));
  assert.ok(plan.entities.some((e) => e.name === 'Coin'));
  assert.ok(plan.mechanics.length > 0);
  assert.ok(plan.controls.length > 0);
});

test('every guess is recorded, and a fully specified prompt guesses nothing', () => {
  // A silent guess is indistinguishable from a bug.
  const vague = planGame('make a game');
  assert.ok(vague.assumptions.length >= 3, 'a vague prompt should admit what it decided');

  const specific = planGame('a 3d first person shooter called Red Hour where you play as a soldier fighting aliens');
  assert.deepEqual(specific.assumptions, [], `nothing should be guessed: ${specific.assumptions.join(' | ')}`);
});

test('the summary shows the assumptions rather than burying them', () => {
  const summary = planSummary(planGame('make a game'));
  assert.match(summary, /say if any of this is wrong/i);
  assert.match(summary, /\*\*Goal\.\*\*/);
  assert.match(summary, /Controls/);
});

test('the brief tells the model to build the plan, not something simpler', () => {
  // The failure this guards: quietly producing the same flat-plane template and
  // presenting it as what was asked for.
  const brief = planBrief(planGame('a first person shooter with aliens'));
  assert.match(brief, /Genre: shooter/);
  assert.match(brief, /View: first-person/);
  assert.match(brief, /Do not substitute a different genre or camera/);
  assert.match(brief, /say which part and why/);
});

test('the plan hands real parts to the model builder', () => {
  const parts = playerParts(planGame('you play as a wolf'));
  assert.ok(parts.length > 0);
  // A quadruped has four legs; a biped plan here would be the wrong animal.
  assert.equal(parts.filter((p) => /leg/i.test(p.name)).length, 4);
  for (const part of parts) {
    assert.equal(part.size.length, 3);
    assert.equal(part.at.length, 3);
  }
});

test('the player is not listed as their own enemy', () => {
  // "a wolf jumps between islands" matched the wolf against the enemy list and
  // put the player in the world as something to fight.
  const plan = planGame('a platformer where a wolf jumps between islands collecting gems');
  assert.equal(plan.player.description, 'wolf');
  assert.ok(!plan.entities.some((e) => e.name === 'Wolf'), `Wolf should not be an entity: ${plan.entities.map((e) => e.name).join(', ')}`);
  assert.ok(plan.entities.some((e) => e.name === 'Gem'));
});

test('the summary is written in English, not template English', () => {
  // "a adventure game" reads as a bug in the output even when the plan is right.
  assert.equal(article('adventure'), 'an');
  assert.equal(article('runner'), 'a');
  const summary = planSummary(planGame('make a game'));
  assert.ok(!/\ba (adventure|enemy|obstacle|alien|orb|apple)\b/.test(summary), summary);
});

// ── Routing ─────────────────────────────────────────────────────────────────

test('game prompts reach the Godot suite, so the plan applies at all', () => {
  // These were falling through to plain chat: the suite only matched tooling
  // words like "godot" and "gdscript", which is exactly what a user describing
  // a game in their own words does not say.
  for (const prompt of [
    'an endless runner called Sky Dash where a ninja dodges robots',
    'a first person shooter in a space station',
    'make me a game about a wolf',
    'a 2d platformer with gems',
    'a kart racing game',
    'build a tower defence game',
  ]) {
    assert.equal(classifyLocal(prompt).suite, 'godot', prompt);
  }
});

test('widening the game match did not swallow other prompts', () => {
  // "game" is a common enough word that a loose match would hijack unrelated
  // requests — the reason the rule requires a genre or a build verb.
  assert.equal(classifyLocal('a minecraft addon with a custom mob').suite, 'minecraft');
  assert.notEqual(classifyLocal('what is the game plan for this sprint').suite, 'godot');
  assert.notEqual(classifyLocal('explain how css grid works').suite, 'godot');
});

test('anything the planner can plan, the router sends to the suite', () => {
  // These drifted apart and the drift was silent: "zombie survival shooter"
  // planned perfectly as a shooter and never reached the suite, because the
  // router carried its own shorter list and only knew "first person shooter".
  // One list cannot disagree with itself.
  const prompts = [
    'a kart racing game',
    'an endless runner on a rooftop',
    'a zombie survival shooter',
    'a sokoban style puzzle',
    'survive the horde at night',
    'a platformer with moving ledges',
    'a top-down dungeon crawl',
    'an open world adventure rpg',
  ];
  for (const prompt of prompts) {
    assert.ok(looksLikeGame(prompt), `"${prompt}" is a game the planner understands`);
    assert.equal(classifyLocal(prompt).suite, 'godot', prompt);
    // And it really is planned, not just matched.
    assert.ok(planGame(prompt).entities.length > 0, prompt);
  }
  // Every genre the planner knows is covered by the list above.
  assert.equal(new Set(prompts.map((p) => planGame(p).genre)).size, GENRE_CUES.length);
});

test('describing a game is asking for one, even with no build verb in it', () => {
  // "a zombie survival shooter called Chomu Game where you fight zombies" has
  // no make/build/create anywhere, scored zero, and came back as conversation.
  // Nobody describes a zombie shooter in order to have it discussed.
  const c = classifyLocal('a zombie survival shooter called Chomu Game where you fight zombies');
  assert.equal(c.suite, 'godot');
  assert.equal(c.lane, 'B', c.reason);
  assert.match(c.reason, /godot suite builds/);
});

test('naming a suite does not turn a question into a build', () => {
  // The suite bonus must not override an actual question, or asking how
  // something works answers with a zip.
  for (const question of [
    'what is the difference between a platformer and a runner?',
    'why does my godot scene load with missing nodes?',
    'explain how a game loop works',
  ]) {
    assert.equal(classifyLocal(question).lane, 'A', question);
  }
});
