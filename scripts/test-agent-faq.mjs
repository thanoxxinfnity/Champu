/** node --experimental-strip-types --test scripts/test-agent-faq.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHIP_ANSWERS, faqAnswer, looksHinglish } from '../site/js/agent-faq.js';
import { DOWNLOADS } from '../site/js/agent-core.js';

test('the questions people actually ask are answered on the spot', () => {
  assert.match(faqAnswer('How do I install Chomugiri?'), new RegExp(DOWNLOADS.chomugiri.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  assert.match(faqAnswer('how to download the app'), /chomugiri-latest\/Chomugiri\.apk/);
  assert.match(faqAnswer('download horizon apk'), /latest-apk\/ChomuHorizon\.apk/);
  assert.match(faqAnswer('what maps are there in horizon'), /Horizon Hills[\s\S]*Wild Trail/);
  assert.match(faqAnswer('cars in horizon?'), /nine rides/);
  assert.match(faqAnswer('Which AI models does chomugiri use?'), /NVIDIA NIM/);
  assert.match(faqAnswer('does chomugiri have a terminal bridge'), /terminal bridge/);
});

test('it only answers when the question is about us', () => {
  for (const q of ['How do I install Python?', 'Is my data safe in WhatsApp?', 'Explain black holes simply', 'cars?', 'best cars in the world?', 'what is a bridge', 'Mere aas-paas kya dekhne layak hai?']) {
    assert.equal(faqAnswer(q), null, q);
  }
  // …unless an earlier message of theirs was about us
  assert.match(faqAnswer('and the cars?', ['tell me about Chomu Horizon']), /nine rides/);
  assert.equal(faqAnswer('and the cars?', ['explain black holes']), null);
  // but being "in context" does not turn other software's install into ours
  assert.equal(faqAnswer('how do i install python', ['tell me about chomugiri']), null);
});

test('the suggestion buttons always get a real answer, even worded in a way the patterns would miss', () => {
  for (const [chip, id] of Object.entries(CHIP_ANSWERS)) assert.ok(faqAnswer(chip), `${chip} (${id})`);
  assert.match(faqAnswer('Is my data safe?'), /no accounts and no analytics/);
});

test('it answers in the language it was asked in', () => {
  assert.ok(looksHinglish('install kaise karu chomugiri?') && !looksHinglish('How do I install Chomugiri?'));
  assert.match(faqAnswer('install kaise karu chomugiri?'), /lene ke liye/);
  assert.match(faqAnswer('How do I install Chomugiri?'), /To get Chomugiri/);
  assert.match(faqAnswer('Hi bro'), /Main Chomu agent/);
  assert.match(faqAnswer('hello'), /I'm Chomu agent/);
});

test('every answer is plain text with bare links, and none names what runs behind it', () => {
  for (const q of ['hello', 'install chomugiri', 'install horizon', 'maps in horizon', 'cars in horizon', 'controls in horizon', 'what is chomu horizon', 'research in chomugiri', 'terminal bridge in chomugiri', 'models in chomugiri', 'is chomugiri data safe', 'sessions in chomugiri', 'what can chomugiri build', 'what is chomugiri', 'voices on this site']) {
    for (const text of [faqAnswer(q), faqAnswer(`${q} kya hai`)]) {
      if (!text) continue;
      assert.ok(!/pollinations|gpt-?oss|openai/i.test(text), q);
      assert.ok(!/\]\(https?:/.test(text), `markdown link in: ${q}`);
    }
  }
});

test('"App not installed" gets the real cause and the fix, in both languages', () => {
  for (const q of ['App not installed', 'chomu horizon install nahi ho raha', 'the apk will not install']) {
    const a = faqAnswer(q);
    assert.ok(a, q);
    assert.match(a, /Uninstall/i);
  }
  assert.equal(faqAnswer('how do I install Python?'), null);
});
