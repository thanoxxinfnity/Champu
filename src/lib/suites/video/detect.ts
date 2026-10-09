/**
 * Is this request a video to be made from code (HyperFrames or Remotion), and with which?
 *
 * Judged on the request alone. "A video game", "a video player app", "a landing page with a video background" and "download this
 * video" all contain the word and none of them is a request to render a film.
 */
import { wantsSite } from '../../agent/router.ts';

const NOUN = /\b(videos?|reels?|shorts?|tiktok|promo|promos|explainer|trailer|intro|outro|slideshow|mp4|animated (ad|logo|clip|video)|motion graphics?|lyric video|title (card|sequence))\b/i;
const VERB = /\b(make|create|build|generate|render|produce|design|edit|animate|banao|bana do|bana de|banado|banana|chahiye|likho)\b|\b(ka|ki|ke) (video|reel|promo|intro)\b/i;
const NOT =
  /\b(video ?games?|games?|video (player|call|calls|chat|streaming|downloader|editor app|conferenc\w*)|youtube (downloader|clone|api)|download(ing)? (a |the |this )?video|play(ing)? (a |the )?video|<video|video (tag|element|embed|background|bg)|video[- ]to[- ]text|transcribe)\b/i;
const SHORT_FORM = /\b(reels?|shorts?|tiktok|vertical|portrait|9:16|story|stories)\b/i;

export function wantsCodeVideo(text: string): boolean {
  if (!NOUN.test(text) || NOT.test(text)) return false;
  if (wantsSite(text) && !/\b(make|create|generate|render|produce)\b.{0,20}\bvideo\b/i.test(text)) return false;
  return VERB.test(text) || /^\s*(a |an |ek )?\d*[- ]?(second |sec |min |minute )?(promo|explainer|reel|trailer|video)\b/i.test(text);
}

export type VideoEngine = 'hyperframes' | 'remotion';

/** HyperFrames unless Remotion is asked for by name: it has no licence conditions and is a single HTML file. */
export function videoEngine(text: string): VideoEngine {
  return /\b(remotion|react video|react composition|tsx video)\b/i.test(text) ? 'remotion' : 'hyperframes';
}

/** The frame the video is made in: 1080×1920 for the vertical short-form kinds, 1920×1080 otherwise. */
export function videoSize(text: string): { width: number; height: number; vertical: boolean } {
  const vertical = SHORT_FORM.test(text);
  return vertical ? { width: 1080, height: 1920, vertical } : { width: 1920, height: 1080, vertical };
}
