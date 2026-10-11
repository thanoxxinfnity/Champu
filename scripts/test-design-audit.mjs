/** node --experimental-strip-types --test scripts/test-design-audit.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { designAuditContext, wantsDesignAudit } from '../src/lib/suites/web/design-audit.ts';

test('a complaint about the look, in English or Hinglish, asks for the checklist', () => {
  assert.equal(wantsDesignAudit('this looks so generic, like every other landing page'), true);
  assert.equal(wantsDesignAudit('it looks like AI made this, no design sense at all'), true);
  assert.equal(wantsDesignAudit('site ka design accha nahi lag raha'), true);
  assert.equal(wantsDesignAudit('the hero section looks really boring'), true);
});

test('an unrelated request, or one about motion or a bug, does not', () => {
  assert.equal(wantsDesignAudit('add a contact form with three fields'), false);
  assert.equal(wantsDesignAudit('the button animation is too slow'), false);
  assert.equal(wantsDesignAudit('fix the bug where the form does not submit'), false);
});

test('the checklist puts the still frame before motion, and names concrete checks', () => {
  const c = designAuditContext();
  assert.match(c.text, /every animation switched off/i);
  assert.match(c.text, /Type scale/);
  assert.match(c.text, /Spacing rhythm/);
  assert.match(c.text, /Lorem ipsum/);
  assert.ok(c.text.length < 4000);
  assert.match(c.summary, /^::[a-z]+::/);
});
