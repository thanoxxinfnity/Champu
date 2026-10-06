import type { Activity } from './activity.ts';

/**
 * The pictures that go with each kind of work, as plain SVG / HTML strings.
 *
 * Strings rather than JSX because two very different places draw them: the React thinking bubble, and the
 * markdown renderer that builds the chat's code blocks as HTML. One source means a command block and the
 * bubble underneath it show the very same moving icon.
 */

const PATHS: Record<Exclude<Activity, 'think'>, string> = {
  terminal:
    '<rect x="1.5" y="3" width="17" height="14" rx="3"/><path d="M5 8l3 2-3 2"/><path class="t-cursor" d="M10.5 13h4"/>',
  write:
    '<path class="w-line w1" d="M3 6h9"/><path class="w-line w2" d="M3 10h12"/><path class="w-line w3" d="M3 14h7"/><g class="w-pen"><path d="M13 17l5-5-1.6-1.6-5 5z" fill="currentColor" stroke="none"/></g>',
  download:
    '<path class="d-arrow" d="M10 2v9m-4-4l4 4 4-4"/><path d="M3 14v2.5h14V14"/><path class="d-fill" d="M3 16.5h14" stroke-width="2.4"/>',
  paint:
    '<path class="p-stroke ps1" d="M3 15c3-8 5-8 7 0s4 8 7 0"/><circle class="p-drop" cx="16" cy="4.5" r="1.6" fill="currentColor" stroke="none"/><circle class="p-drop pd2" cx="4" cy="4.5" r="1.2" fill="currentColor" stroke="none"/>',
  build:
    '<g class="b-gear"><circle cx="10" cy="10" r="3"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></g>',
  search: '<g class="s-orbit"><circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2L17 17"/></g>',
  deploy:
    '<g class="r-rocket"><path d="M10 2c3 2 4 5 3.5 9h-7C6 7 7 4 10 2z"/><circle cx="10" cy="7.5" r="1.3"/><path class="r-flame" d="M8.5 13.5L10 18l1.5-4.5"/></g>',
  audio:
    '<path class="a-bar a1" d="M4 10v0" stroke-width="2.6"/><path class="a-bar a2" d="M8 10v0" stroke-width="2.6"/><path class="a-bar a3" d="M12 10v0" stroke-width="2.6"/><path class="a-bar a4" d="M16 10v0" stroke-width="2.6"/>',
  plan:
    '<path class="l-tick lt1" d="M3 5.5l1.7 1.7L7.6 4"/><path class="l-tick lt2" d="M3 11l1.7 1.7L7.6 9.5"/><path class="l-tick lt3" d="M3 16.5l1.7 1.7L7.6 15" transform="translate(0 -1.2)"/><path d="M10.5 5.5H17M10.5 11H17M10.5 15.8H15" opacity=".55"/>',
  read:
    '<path d="M2.5 4.5c2.5-1 5-1 7.5 1v11c-2.5-2-5-2-7.5-1zM17.5 4.5c-2.5-1-5-1-7.5 1v11c2.5-2 5-2 7.5-1z"/><path class="rd-scan" d="M4.5 9h3M12.5 9h3"/>',
};

const SPARK =
  '<path class="spark-lg" d="M8 0.8 L9.5 6.5 L15.2 8 L9.5 9.5 L8 15.2 L6.5 9.5 L0.8 8 L6.5 6.5 Z" fill="currentColor" stroke="none"/><path class="spark-sm" d="M13 1 L13.7 3.3 L16 4 L13.7 4.7 L13 7 L12.3 4.7 L10 4 L12.3 3.3 Z" fill="currentColor" stroke="none"/>';

/** The moving icon: an <svg> string, coloured by the surrounding `--act`. */
export function iconHtml(kind: Activity): string {
  if (kind === 'think') {
    return `<span class="act-icon act-think" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none">${SPARK}</svg></span>`;
  }
  return `<span class="act-icon act-${kind}" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PATHS[kind]}</svg></span>`;
}

/** Drifting particles behind the words: eight of them, shaped and moved by CSS per kind and variant. */
export const SCENE_HTML = '<span class="act-scene" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></span>';

/** The few marks that end the line (a cursor, a bar, three swatches…). */
export const TAIL_HTML = '<span class="act-tail" aria-hidden="true"><i></i><i></i><i></i></span>';

/** A small stable number from text, for picking a look that stays put while a block streams. */
export function pick(text: string, of: number): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h % of;
}

export const VARIANTS = 3;
