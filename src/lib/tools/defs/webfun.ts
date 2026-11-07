import { area, B, err, escapeHtml, list, N, num, pick, rand, S, sel, stats, table, text, tog, txt, lines } from '../helpers.ts';
import { parseCsv } from './dev.ts';
import type { ToolDef } from '../types.ts';

const EMOJI: Array<[string, string]> = [['😀', 'grin smile happy'], ['😂', 'laugh tears joy'], ['😍', 'love heart eyes'], ['😎', 'cool sunglasses'], ['🤔', 'think hmm'], ['😭', 'cry sad'], ['😡', 'angry mad'], ['🥳', 'party celebrate'], ['😴', 'sleep tired'], ['🤯', 'mind blown'], ['👍', 'thumbs up yes ok'], ['👎', 'thumbs down no'], ['🙏', 'pray thanks please namaste'], ['👏', 'clap applause'], ['💪', 'strong muscle'], ['🔥', 'fire hot lit'], ['✨', 'sparkles magic'], ['💯', 'hundred perfect'], ['❤️', 'heart love red'], ['💔', 'broken heart'], ['🎉', 'party popper tada'], ['🎂', 'cake birthday'], ['☕', 'coffee tea chai'], ['🍕', 'pizza food'], ['🍔', 'burger food'], ['🍜', 'noodles ramen food'], ['🚀', 'rocket launch fast'], ['🌍', 'earth world globe'], ['🌙', 'moon night'], ['☀️', 'sun day'], ['🌧️', 'rain cloud'], ['⚡', 'lightning bolt power'], ['🐶', 'dog puppy'], ['🐱', 'cat kitten'], ['🦁', 'lion'], ['🐢', 'turtle slow'], ['🎮', 'game controller play'], ['🎧', 'headphones music'], ['📱', 'phone mobile'], ['💻', 'laptop computer'], ['📷', 'camera photo'], ['💡', 'idea bulb'], ['🔒', 'lock secure'], ['🔑', 'key'], ['⭐', 'star favourite'], ['✅', 'check done tick'], ['❌', 'cross wrong no'], ['⚠️', 'warning caution'], ['🏆', 'trophy win'], ['🇮🇳', 'india flag']];
const PROVERBS = ['A stitch in time saves nine.', 'Slow and steady wins the race.', 'Where there is a will, there is a way.', 'The early bird catches the worm.', 'Every cloud has a silver lining.', 'Practice makes perfect.', 'Well begun is half done.', 'Rome was not built in a day.', 'Actions speak louder than words.', 'Look before you leap.', 'Many hands make light work.', 'Fortune favours the bold.'];
const TRUTHS = ['What is the most embarrassing thing in your phone gallery?', 'What is a skill you pretend to have?', 'Who was your first crush?', 'What is the last lie you told?', 'What is your most-used emoji and why?', 'What song do you secretly love?'];
const DARES = ['Do 10 jumping jacks right now.', 'Speak in an accent for the next 3 minutes.', 'Send a heart emoji to the 5th person in your chats.', 'Sing the chorus of your favourite song.', 'Balance a spoon on your nose for 10 seconds.', 'Let the group pick your next profile picture.'];

export const webFunTools: ToolDef[] = [
  {
    id: 'json-ld', name: 'JSON-LD generator', cat: 'web', glyph: '{ld}', blurb: 'Structured data for articles, FAQs or a business, for Google rich results.',
    fields: [sel('type', 'Type', ['Article', 'FAQPage', 'LocalBusiness'], 'Article'), txt('name', 'Title / business name', { default: 'How to make chai' }), area('desc', 'Description (FAQ: "Q? | A" per line)', { rows: 3, default: 'A simple guide.' }), txt('url', 'URL', { default: 'https://chomu.app/chai' }), txt('author', 'Author / phone', { default: 'Asha' })], example: { type: 'Article', name: 'How to make chai', desc: 'A simple guide.', url: 'https://chomu.app/chai', author: 'Asha' },
    run: (v) => { const t = S(v, 'type'); const data = t === 'FAQPage' ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: lines(S(v, 'desc')).filter((l) => l.includes('|')).map((l) => { const [q, a] = l.split('|'); return { '@type': 'Question', name: q!.trim(), acceptedAnswer: { '@type': 'Answer', text: a!.trim() } }; }) } : t === 'LocalBusiness' ? { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: S(v, 'name'), description: S(v, 'desc'), url: S(v, 'url'), telephone: S(v, 'author') } : { '@context': 'https://schema.org', '@type': 'Article', headline: S(v, 'name'), description: S(v, 'desc'), url: S(v, 'url'), author: { '@type': 'Person', name: S(v, 'author') } }; return text(`<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`, 'html'); },
  },
  {
    id: 'sitemap-xml', name: 'Sitemap maker', cat: 'web', glyph: '🗺', blurb: 'sitemap.xml from a list of URLs.',
    fields: [area('u', 'URLs (one per line)', { rows: 5, default: 'https://chomu.app/\nhttps://chomu.app/tools\nhttps://chomu.app/about' }), sel('freq', 'Change frequency', ['daily', 'weekly', 'monthly', 'yearly'], 'weekly')], example: { u: 'https://chomu.app/\nhttps://chomu.app/tools', freq: 'weekly' },
    run: (v) => { const urls = lines(S(v, 'u')).map((x) => x.trim()).filter(Boolean); if (!urls.length) return err('Add some URLs.'); return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${escapeHtml(u)}</loc>\n    <changefreq>${S(v, 'freq')}</changefreq>\n  </url>`).join('\n')}\n</urlset>`, 'xml'); },
  },
  {
    id: 'htaccess-redirects', name: 'Redirect rules', cat: 'web', glyph: '↪', blurb: 'Apache .htaccess and Nginx redirects from "old new" pairs.',
    fields: [area('t', 'Old path → New URL (one pair per line)', { rows: 4, default: '/old-page /new-page\n/blog https://example.com/blog' }), sel('code', 'Type', [{ value: '301', label: '301 permanent' }, { value: '302', label: '302 temporary' }], '301')], example: { t: '/old-page /new-page\n/blog https://example.com/blog', code: '301' },
    run: (v) => { const pairs = lines(S(v, 't')).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2); if (!pairs.length) return err('Add lines like "/old /new".'); return { kind: 'multi', parts: [{ title: '.htaccess', out: text(pairs.map(([a, b]) => `Redirect ${S(v, 'code')} ${a} ${b}`).join('\n')) }, { title: 'Nginx', out: text(pairs.map(([a, b]) => `location = ${a} { return ${S(v, 'code')} ${b}; }`).join('\n')) }] }; },
  },
  {
    id: 'html-table', name: 'CSV → HTML table', cat: 'web', glyph: '▦<>', blurb: 'A clean HTML table from pasted rows.',
    fields: [area('t', 'CSV (first row = header)', { rows: 5, default: 'Name,Role\nAsha,Designer\nRavi,Dev' }), tog('style', 'Add basic styling', true)], example: { t: 'Name,Role\nAsha,Designer\nRavi,Dev', style: true },
    run: (v) => { const rows = parseCsv(S(v, 't')); if (!rows.length) return err('Add some rows.'); const st = B(v, 'style') ? ' style="border-collapse:collapse;width:100%"' : ''; const cell = B(v, 'style') ? ' style="border:1px solid #ddd;padding:8px;text-align:left"' : ''; return text(`<table${st}>\n  <thead>\n    <tr>${rows[0]!.map((c) => `<th${cell}>${escapeHtml(c)}</th>`).join('')}</tr>\n  </thead>\n  <tbody>\n${rows.slice(1).map((r) => `    <tr>${r.map((c) => `<td${cell}>${escapeHtml(c)}</td>`).join('')}</tr>`).join('\n')}\n  </tbody>\n</table>`, 'html'); },
  },
  {
    id: 'share-links', name: 'Social share links', cat: 'web', glyph: '↗', blurb: 'Share URLs for WhatsApp, X, Telegram, LinkedIn, Facebook and e-mail.',
    fields: [txt('u', 'Page URL', { default: 'https://chomu.app/' }), txt('t', 'Message', { default: 'Check this out!' })], example: { u: 'https://chomu.app/', t: 'Check this out!' },
    run: (v) => { const u = encodeURIComponent(S(v, 'u')), t = encodeURIComponent(S(v, 't')); return table(['Network', 'Link'], [['WhatsApp', `https://wa.me/?text=${t}%20${u}`], ['X / Twitter', `https://twitter.com/intent/tweet?text=${t}&url=${u}`], ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`], ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`], ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`], ['E-mail', `mailto:?subject=${t}&body=${u}`]]); },
  },
  {
    id: 'coin-flip', name: 'Coin flip', cat: 'fun', glyph: '🪙', blurb: 'Heads or tails, once or many times.',
    fields: [num('n', 'Flips', { default: 1, min: 1, max: 1000 })], example: { n: 10 }, manual: true,
    run: (v) => { const r = rand(); const n = Math.max(1, Math.min(1000, N(v, 'n', 1))); let h = 0; const seq: string[] = []; for (let i = 0; i < n; i++) { const x = r() < 0.5; if (x) h++; if (i < 40) seq.push(x ? 'H' : 'T'); } return stats([[n === 1 ? 'Result' : 'Heads', n === 1 ? (h ? 'Heads' : 'Tails') : String(h)], ...(n > 1 ? ([['Tails', String(n - h)], ['Sequence', seq.join(' ') + (n > 40 ? ' …' : '')]] as Array<[string, string]>) : [])]); },
  },
  {
    id: 'dice-roller', name: 'Dice roller', cat: 'fun', glyph: '🎲', blurb: 'Roll any dice: d4, d6, d20, 3d8+2…',
    fields: [txt('d', 'Dice', { default: '2d6+1', mono: true })], example: { d: '2d6+1' }, manual: true,
    run: (v) => { const m = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(S(v, 'd')); if (!m) return err('Use a format like 2d6+1 or d20.'); const n = Math.min(100, Number(m[1] || 1)), s = Number(m[2]), mod = Number((m[3] ?? '0').replace(/\s/g, '')); if (s < 2 || s > 1000) return err('Sides: 2 to 1000.'); const r = rand(); const rolls = Array.from({ length: n }, () => 1 + Math.floor(r() * s)); return stats([['Rolls', rolls.join(', ')], ['Total', rolls.reduce((a, b) => a + b, 0) + mod]]); },
  },
  {
    id: 'magic-8-ball', name: 'Magic 8-ball', cat: 'fun', glyph: '🎱', blurb: 'Ask a yes/no question.',
    fields: [txt('q', 'Your question', { default: 'Will it rain tomorrow?' })], example: { q: 'Will it rain tomorrow?' }, manual: true,
    run: (v) => { const r = rand(); return text(S(v, 'q').trim() ? pick(r, ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Signs point to yes.', 'Ask again later.', 'Cannot predict now.', 'Better not tell you now.', "Don't count on it.", 'My sources say no.', 'Very doubtful.', 'Outlook not so good.']) : 'Ask a question first.'); },
  },
  {
    id: 'team-splitter', name: 'Team splitter', cat: 'fun', glyph: '👥', blurb: 'Split names into fair random teams.',
    fields: [area('t', 'Names (one per line)', { rows: 6, default: 'Asha\nRavi\nMeera\nKaran\nNeha\nSahil\nZoya' }), num('k', 'Teams', { default: 2, min: 2, max: 10 })], example: { t: 'Asha\nRavi\nMeera\nKaran\nNeha\nSahil\nZoya', k: 3 }, manual: true,
    run: (v) => { const a = lines(S(v, 't')).map((x) => x.trim()).filter(Boolean), k = Math.max(2, Math.min(10, N(v, 'k', 2))); if (a.length < k) return err('Add more names than teams.'); const r = rand(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } const teams: string[][] = Array.from({ length: k }, () => []); a.forEach((x, i) => teams[i % k]!.push(x)); return table(teams.map((_, i) => `Team ${i + 1}`), Array.from({ length: Math.max(...teams.map((x) => x.length)) }, (_, r2) => teams.map((t) => t[r2] ?? ''))); },
  },
  {
    id: 'yes-no-maybe', name: 'Decision maker', cat: 'fun', glyph: '⚖', blurb: 'Can\'t decide? Let chance pick between your options.',
    fields: [area('t', 'Options (one per line)', { rows: 4, default: 'Pizza\nBiryani\nMomos' })], example: { t: 'Pizza\nBiryani\nMomos' }, manual: true,
    run: (v) => { const a = lines(S(v, 't')).map((x) => x.trim()).filter(Boolean); return a.length < 2 ? err('Give at least two options.') : stats([['Go with', pick(rand(), a)]]); },
  },
  {
    id: 'truth-or-dare', name: 'Truth or dare', cat: 'fun', glyph: '🎭', blurb: 'A clean truth or dare for a group.',
    fields: [sel('k', 'Pick', ['truth', 'dare', 'either'], 'either')], example: { k: 'truth' }, manual: true,
    run: (v) => { const r = rand(); const k = S(v, 'k') === 'either' ? (r() < 0.5 ? 'truth' : 'dare') : S(v, 'k'); return stats([[k === 'truth' ? 'Truth' : 'Dare', pick(r, k === 'truth' ? TRUTHS : DARES)]]); },
  },
  {
    id: 'proverb-picker', name: 'Proverb of the day', cat: 'fun', glyph: '📜', blurb: 'A random proverb, or one fixed for today.',
    fields: [tog('today', 'Same one all day', true)], example: { today: false }, manual: true,
    run: (v) => { const i = B(v, 'today') ? Math.floor(Date.now() / 86400000) % PROVERBS.length : Math.floor(rand()() * PROVERBS.length); return text(PROVERBS[i]!); },
  },
  {
    id: 'emoji-search', name: 'Emoji finder', cat: 'fun', glyph: '😀', blurb: 'Search emoji by what they mean.',
    fields: [txt('q', 'Search', { placeholder: 'fire, love, chai…' })], example: { q: 'love' },
    run: (v) => { const q = S(v, 'q').toLowerCase().trim(); const r = EMOJI.filter(([, k]) => !q || k.includes(q)); return r.length ? list(r.map(([e, k]) => `${e}   ${k}`)) : text('No emoji found.'); },
  },
  {
    id: 'bingo-card', name: 'Bingo card', cat: 'fun', glyph: 'B-I-N', blurb: 'A random 5×5 bingo card (free space in the middle).',
    fields: [num('seed', 'Seed (0 = random)', { default: 0 })], example: { seed: 9 }, manual: true,
    run: (v) => { const r = rand(N(v, 'seed')); const col = (lo: number): number[] => { const p = Array.from({ length: 15 }, (_, i) => lo + i); for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j]!, p[i]!]; } return p.slice(0, 5); }; const c = [1, 16, 31, 46, 61].map(col); return table(['B', 'I', 'N', 'G', 'O'], Array.from({ length: 5 }, (_, row) => c.map((cc, k) => (row === 2 && k === 2 ? '★' : cc[row]!)))); },
  },
  {
    id: 'rock-paper-scissors', name: 'Rock paper scissors', cat: 'fun', glyph: '✊', blurb: 'Play against the computer.',
    fields: [sel('me', 'Your move', ['rock', 'paper', 'scissors'], 'rock')], example: { me: 'rock' }, manual: true,
    run: (v) => { const mv = ['rock', 'paper', 'scissors'], c = pick(rand(), mv), m = S(v, 'me'); const win = (m === 'rock' && c === 'scissors') || (m === 'paper' && c === 'rock') || (m === 'scissors' && c === 'paper'); return stats([['You', m], ['Computer', c], ['Result', m === c ? 'Draw' : win ? 'You win! 🎉' : 'Computer wins']]); },
  },
];
void list;
