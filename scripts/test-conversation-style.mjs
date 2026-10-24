/** node --experimental-strip-types --test scripts/test-conversation-style.mjs — the Opus 5.5 guidance inside the system prompt. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSystemPrompt } from '../src/lib/agent/system-prompt.ts';
import { OPUS_AGENT_ADDENDUM, OPUS_CONVERSATION_ADDENDUM } from '../src/lib/agent/opus-prompt.ts';

const SOURCE = '/tmp/cm/spl/repo/Anthropic/claude-opus-5.5.md';
const norm = (s) => s.replace(/\s+/g, ' ');

for (const lane of ['A', 'B']) {
  test(`lane ${lane}: the Opus 5.5 guidance sits after the identity and before the lane rules`, () => {
    const p = buildSystemPrompt({ lane });
    const agent = p.indexOf('## HOW AN AGENT WORKS WITH THE USER');
    const talk = p.indexOf('## HOW YOU TALK WITH PEOPLE');
    assert.ok(agent > p.indexOf('You are "Chomugiri"'));
    assert.ok(talk > agent);
    assert.ok(talk < p.indexOf('## ACTIVE LANE'));
  });
}

test('every behaviour section is there word for word, and the sentences that only fit Anthropic\'s products are not', () => {
  const t = norm(OPUS_CONVERSATION_ADDENDUM);
  for (const phrase of [
    'Claude never uses bullet points when declining a task; the additional care helps soften the blow.',
    'Claude avoids over-formatting with bold emphasis, headers, lists, and bullet points, using the minimum formatting needed for clarity.',
    'Claude doesn\'t always ask questions, but, when it does, it avoids more than one per response',
    'a request to explain, discuss, argue for, defend, or write persuasive content'.replace(/^a/, 'A'),
    'provides the factual information the person needs to make their own informed decision rather than confident recommendations, and notes that it isn\'t a lawyer or financial advisor.',
    'accountability without self-abasement, excessive apology, self-critique, or surrender',
    'Claude does not suggest substitution techniques for self-harm',
    'These child-safety requirements require special attention and care',
    'Claude does not reproduce song lyrics, poems, or passages from books and articles',
  ]) assert.ok(t.includes(norm(phrase)), phrase);
  assert.equal(/thumbs-down|claude\.ai|Anthropic may send/.test(OPUS_CONVERSATION_ADDENDUM), false);
});

test('the agent guidance carries the Claude Code lines and the terminal-description rule the chat sheet shows', () => {
  const t = OPUS_AGENT_ADDENDUM;
  assert.match(t, /You are an agent working with the user toward their goals, using your own judgment along the way\./);
  assert.match(t, /When you have enough information to act, act\./);
  assert.match(t, /desc="…"/);
  assert.match(t, /npm install → "Install package dependencies"/);
  assert.match(t, /find \. -name "\*\.tmp" -exec rm \{\} \\; → "Find and delete all \.tmp files recursively"/);
});

test('the quoted text really is in the published prompt (when the reference copy is on this machine)', { skip: !(() => { try { readFileSync(SOURCE); return true; } catch { return false; } })() }, () => {
  const src = norm(readFileSync(SOURCE, 'utf8'));
  for (const line of OPUS_CONVERSATION_ADDENDUM.split('\n').filter((l) => l.trim().length > 60 && !l.startsWith('The guidance below') && !l.startsWith('## HOW') && !l.startsWith('Claude does not write, explain, or work on malicious code') && !l.startsWith('<') && !/^\s*[-<]/.test(l))) {
    assert.ok(src.includes(norm(line)) , `not in the source: ${line.slice(0, 80)}`);
  }
});
