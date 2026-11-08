/**
 * Action Buttons: ready-made jobs for Handoff, ordered by what the app knows about the user (memory), the time of day and what
 * they ran before. A button whose prompt has a {slot} goes into the task box for the user to finish; the others run at a tap.
 * Pure: no storage, no clock unless one is passed in.
 */
import type { Mode } from './actions.ts';

export interface ActionButton {
  id: string;
  title: string;
  /** An icon name from handoff/Icon.tsx. */
  icon: string;
  /** The job given to Handoff. "{…}" marks a part the user fills in first. */
  prompt: string;
  mode: Mode;
  tag: 'research' | 'shopping' | 'travel' | 'work' | 'dev' | 'daily' | 'learn' | 'again';
  /** Words in the user's memory that make this button more relevant. */
  boost?: string[];
  hours?: [number, number];
}

export const CATALOG: ActionButton[] = [
  { id: 'news-brief', title: 'Morning news brief', icon: 'news', tag: 'daily', mode: 'browser', hours: [5, 12], prompt: 'Give me a short morning brief: the 6 most important news stories today in India and the world, one line each with the source link.' },
  { id: 'weather', title: 'Weather today', icon: 'cloud', tag: 'daily', mode: 'browser', prompt: 'Find today’s and tomorrow’s weather for {my city}: temperature, rain chance and anything to watch out for.' },
  { id: 'plan-tomorrow', title: 'Plan my tomorrow', icon: 'calendar', tag: 'daily', mode: 'browser', hours: [17, 24], prompt: 'Help me plan tomorrow: ask me what I must get done, then make a realistic time-blocked plan with breaks.' },
  { id: 'compare-prices', title: 'Compare prices', icon: 'tag', tag: 'shopping', mode: 'browser', boost: ['buy', 'phone', 'laptop', 'shopping', 'price'], prompt: 'Compare the price of {product} on Amazon.in, Flipkart and one more store. Give a table with price, delivery time and rating, and the best pick. Do not buy anything.' },
  { id: 'best-under', title: 'Best under a budget', icon: 'wallet', tag: 'shopping', mode: 'browser', boost: ['budget', 'buy'], prompt: 'Find the 3 best {thing} under ₹{budget} right now, using recent reviews. Short pros/cons and links. Do not buy anything.' },
  { id: 'order-food', title: 'Find food nearby', icon: 'food', tag: 'shopping', mode: 'browser', hours: [11, 23], prompt: 'Find 5 well-rated places for {dish} near {area} with price range and a link. Do not place an order unless I approve.' },
  { id: 'trip-plan', title: 'Plan a trip', icon: 'plane', tag: 'travel', mode: 'browser', boost: ['travel', 'trip', 'goa', 'manali', 'flight'], prompt: 'Plan a {days}-day trip to {place} from {city}: how to get there with rough prices, where to stay, a day-by-day plan and a budget.' },
  { id: 'train-flight', title: 'Trains & flights', icon: 'train', tag: 'travel', mode: 'browser', boost: ['train', 'flight', 'travel'], prompt: 'Find trains and flights from {from} to {to} on {date}: times, duration and prices. Do not book anything.' },
  { id: 'research-topic', title: 'Research anything', icon: 'search', tag: 'research', mode: 'browser', prompt: 'Research {topic} on the web and give me a clear summary with 5 key points and the sources you used.' },
  { id: 'fact-check', title: 'Fact-check a claim', icon: 'check', tag: 'research', mode: 'browser', prompt: 'Is this true? “{claim}”. Check reliable sources and tell me what is true, what is not, with links.' },
  { id: 'summarise-page', title: 'Summarise a website', icon: 'file', tag: 'research', mode: 'browser', prompt: 'Open {url} and summarise it in 8 bullet points, plus anything I should act on.' },
  { id: 'job-search', title: 'Find jobs', icon: 'briefcase', tag: 'work', mode: 'browser', boost: ['job', 'developer', 'internship', 'resume'], prompt: 'Find 8 recent {role} jobs or internships in {location} (or remote) with company, pay if shown and link. Do not apply.' },
  { id: 'competitor', title: 'Look at a competitor', icon: 'chart', tag: 'work', mode: 'browser', boost: ['startup', 'business', 'app'], prompt: 'Look at {company}’s public website and give me their product, pricing, target users and what they do better than us.' },
  { id: 'email-draft', title: 'Draft an email', icon: 'mail', tag: 'work', mode: 'browser', prompt: 'Draft a polite, short email to {who} about {what}. Show it to me; do not send anything.' },
  { id: 'github-trending', title: 'Trending on GitHub', icon: 'star', tag: 'dev', mode: 'browser', boost: ['github', 'code', 'developer', 'react', 'godot', 'ai'], prompt: 'Open GitHub trending for today and list the 8 most interesting repos for me (one line each: what it does, stars, link).' },
  { id: 'npm-check', title: 'Check a library', icon: 'package', tag: 'dev', mode: 'browser', boost: ['npm', 'react', 'next', 'node'], prompt: 'Look up the {package} library: latest version, licence, weekly downloads, last release date and any known issues.' },
  { id: 'disk-check', title: 'Check my computer', icon: 'monitor', tag: 'dev', mode: 'browser', boost: ['bridge', 'terminal', 'server', 'linux'], prompt: 'Using only read-only terminal commands, check the bridge machine: disk space, memory, uptime, Node and Python versions. Report anything that looks wrong.' },
  { id: 'site-check', title: 'Test my website', icon: 'globe', tag: 'dev', mode: 'browser', boost: ['website', 'site', 'vercel', 'deploy'], prompt: 'Open {my site url}, click through the main pages and report broken links, errors, slow pages and anything that looks wrong on a phone.' },
  { id: 'desktop-app', title: 'Use a desktop app', icon: 'compass', tag: 'dev', mode: 'desktop', prompt: 'On the screen, open {app} and {what to do in it}. Show me the result.' },
  { id: 'learn-explain', title: 'Learn something fast', icon: 'learn', tag: 'learn', mode: 'browser', boost: ['learn', 'study', 'exam', 'course'], prompt: 'Teach me {topic} in 10 minutes: a simple explanation, an example, and 3 good free resources from the web.' },
  { id: 'yt-summary', title: 'Summarise a YouTube video', icon: 'play', tag: 'learn', mode: 'browser', boost: ['youtube', 'video'], prompt: 'Open {youtube link}, read its description and captions if available, and summarise what it teaches in 8 points.' },
  { id: 'exam-news', title: 'Exam & result updates', icon: 'edit', tag: 'learn', mode: 'browser', boost: ['exam', 'result', 'college', 'board'], prompt: 'Find the latest official updates for {exam name}: dates, notices and results, only from official sites, with links.' },
];

const SLOT = /\{[^}]+\}/;
export const needsInput = (b: ActionButton): boolean => SLOT.test(b.prompt);
/** The first part the user must fill in, e.g. "product". */
export const firstSlot = (b: ActionButton): string | null => SLOT.exec(b.prompt)?.[0].slice(1, -1) ?? null;

const inHours = (h: number, [a, b]: [number, number]) => (a <= b ? h >= a && h < b : h >= a || h < b);

export function suggestActions(ctx: { now?: Date; memories?: string[]; recent?: Array<{ task: string; mode: Mode }>; desktop?: boolean; limit?: number } = {}): ActionButton[] {
  const now = ctx.now ?? new Date();
  const hour = now.getHours();
  const mem = (ctx.memories ?? []).join(' ').toLowerCase();
  const scored = CATALOG
    .filter((b) => b.mode !== 'desktop' || ctx.desktop)
    .map((b, i) => {
      let score = 0;
      if (b.hours) score += inHours(hour, b.hours) ? 3 : -4;
      for (const w of b.boost ?? []) if (new RegExp(`\\b${w}`, 'i').test(mem)) score += 2;
      if (!needsInput(b)) score += 0.5;
      return { b, score: score - i * 0.01 };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.b);
  const seen = new Set<string>();
  const again: ActionButton[] = (ctx.recent ?? []).filter((r) => r.task && !seen.has(r.task) && seen.add(r.task)).slice(0, 2).map((r, i) => ({
    id: `again-${i}`, title: `Again: ${r.task.length > 34 ? `${r.task.slice(0, 34)}…` : r.task}`, icon: 'refresh', tag: 'again', mode: r.mode, prompt: r.task,
  }));
  return [...again, ...scored].slice(0, ctx.limit ?? 8);
}
