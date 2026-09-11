'use client';

/**
 * Alternative drafts.
 *
 * Two completions run in parallel against the same prompt with different framing,
 * and the user picks one. The value is not "two rolls of the dice" — it is that
 * the *angles* differ, so the pair brackets the space instead of returning the
 * same answer twice at different temperatures.
 *
 * Angles are chosen from the lane and the detected suite, so a Minecraft build
 * request gets a different pair than an architecture question.
 */

import type { Lane } from './router';
import type { SuiteId } from '@/lib/db/schema';

export interface DraftAngle {
  label: string;
  angle: string;
  /** Appended to the system prompt for this draft only. */
  directive: string;
  temperature: number;
}

/** Discussion angles — different shapes of answer, not different wordings. */
const LANE_A_ANGLES: DraftAngle[] = [
  {
    label: 'Direct',
    angle: 'verdict first',
    directive:
      'Lead with the verdict in one sentence, then the mechanism that justifies it. Shortest defensible answer. No preamble, no options survey.',
    temperature: 0.25,
  },
  {
    label: 'Thorough',
    angle: 'trade-offs',
    directive:
      'Give the answer, then the trade-offs that would change it. Name the specific conditions under which the other choice wins. Quantify wherever a number exists.',
    temperature: 0.5,
  },
  {
    label: 'Worked',
    angle: 'by example',
    directive:
      'Answer through a concrete worked example with real code or real numbers. Derive the general rule from it at the end.',
    temperature: 0.4,
  },
  {
    label: 'Adversarial',
    angle: 'what breaks',
    directive:
      'Answer, then attack it. What breaks this at scale, under failure, or in six months? Be specific about the failure mode, not vague about "complexity".',
    temperature: 0.45,
  },
];

/** Build angles — different architectures, not different formatting. */
const LANE_B_ANGLES: DraftAngle[] = [
  {
    label: 'Minimal',
    angle: 'smallest thing that works',
    directive:
      'Build the smallest thing that fully satisfies the request. No abstraction that is not load-bearing today. Fewer files, less indirection.',
    temperature: 0.25,
  },
  {
    label: 'Structured',
    angle: 'built to extend',
    directive:
      'Build it with clear seams — separated concerns, typed boundaries, testable units. Justify each seam by naming the change it makes cheap.',
    temperature: 0.45,
  },
  {
    label: 'Hardened',
    angle: 'failure-first',
    directive:
      'Build it assuming things fail: validate inputs, handle the error path explicitly, make failures legible. Cover the edge cases the happy path hides.',
    temperature: 0.4,
  },
  {
    label: 'Fast',
    angle: 'performance-led',
    directive:
      'Build for the hot path. Choose data structures and I/O patterns deliberately and say what they cost. Avoid work that can be avoided.',
    temperature: 0.35,
  },
];

const SUITE_ANGLES: Partial<Record<SuiteId, DraftAngle[]>> = {
  minecraft: [
    {
      label: 'Vanilla-true',
      angle: 'fits the base game',
      directive: 'Stay close to vanilla Bedrock conventions and balance. Reuse existing components and behaviours rather than inventing parallel systems.',
      temperature: 0.3,
    },
    {
      label: 'Ambitious',
      angle: 'distinctive mechanics',
      directive: 'Push for mechanics the base game does not have, but only where Bedrock actually supports them. Say plainly where the Script API is required.',
      temperature: 0.6,
    },
  ],
  studio: [
    {
      label: 'Editorial',
      angle: 'restrained and typographic',
      directive: 'Restrained, typographic, generous whitespace. Let the content carry it. Minimal ornament.',
      temperature: 0.4,
    },
    {
      label: 'Expressive',
      angle: 'bold and visual',
      directive: 'Bold colour, strong hierarchy, motion that supports the argument. Visually memorable without becoming noisy.',
      temperature: 0.65,
    },
  ],
  assets: [
    {
      label: 'Iconic',
      angle: 'simple and scalable',
      directive: 'Simple, geometric, legible at 16px. Few shapes, high contrast, one clear idea.',
      temperature: 0.4,
    },
    {
      label: 'Rich',
      angle: 'detailed and textured',
      directive: 'Richer detail, depth and material. Keep the silhouette readable so it still works small.',
      temperature: 0.7,
    },
  ],
};

/** Pick two distinct angles for this request. */
export function pickAngles(lane: Lane, suite?: SuiteId): [DraftAngle, DraftAngle] {
  const suiteAngles = suite ? SUITE_ANGLES[suite] : undefined;
  if (suiteAngles && suiteAngles.length >= 2) return [suiteAngles[0], suiteAngles[1]];

  const pool = lane === 'B' ? LANE_B_ANGLES : LANE_A_ANGLES;

  // Random, but never the same angle twice — two identical framings is the one
  // outcome that makes the feature pointless.
  const first = Math.floor(Math.random() * pool.length);
  let second = Math.floor(Math.random() * (pool.length - 1));
  if (second >= first) second += 1;

  return [pool[first], pool[second]];
}

export function draftSystemSuffix(angle: DraftAngle): string {
  return `## DRAFT DIRECTIVE — "${angle.label}"\n${angle.directive}\n\nProduce one complete answer under this directive. Do not mention that alternatives exist or that this is a draft.`;
}
