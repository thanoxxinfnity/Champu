/**
 * GIF and video export — real pixel renders, sampled frame-by-frame from the same `drawFrame()` the live
 * stage uses (see render.ts's header for why that matters). Both are deterministic: every frame is drawn
 * at an exact chosen `t`, not captured off a real-time playback loop, so export never drops a frame under
 * load and always matches what scrubbing to that instant shows.
 *
 * Video goes through `canvas.captureStream(0)` + `track.requestFrame()` — a stream that only advances
 * when explicitly told to, which lets a real (browser-native) MediaRecorder encode a video from frames
 * paced by this loop instead of by the wall clock. GIF goes through this project's own encoder (gif.ts).
 *
 * Both only run in a browser (they need a real canvas and, for video, MediaRecorder); this is a client
 * module, exercised live rather than under `node --test`.
 */
import { drawFrame } from './render.ts';
import { buildPalette, encodeGif, quantizeFrame, type GifFrame, type RgbaFrame } from './gif.ts';
import type { MotionProject } from './project.ts';

/** Lets the tab breathe between frames — without this, rendering dozens of frames blocks the main thread solid, the page looks hung, and the browser itself can start timing out pending UI work. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface ExportImages {
  images?: Map<string, HTMLImageElement>;
}

function makeCanvas(project: MotionProject): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser has no 2D canvas context.');
  return { canvas, ctx };
}

export async function renderGif(project: MotionProject, opts: ExportImages = {}, fps = 15): Promise<Uint8Array> {
  const { ctx } = makeCanvas(project);
  const step = 1 / fps;
  const rgbaFrames: RgbaFrame[] = [];
  for (let t = 0; t < project.duration; t += step) {
    drawFrame(ctx, project, t, { images: opts.images });
    const { data } = ctx.getImageData(0, 0, project.width, project.height);
    rgbaFrames.push({ width: project.width, height: project.height, data });
    await yieldToBrowser();
  }
  if (rgbaFrames.length === 0) {
    drawFrame(ctx, project, 0, { images: opts.images });
    rgbaFrames.push({ width: project.width, height: project.height, data: ctx.getImageData(0, 0, project.width, project.height).data });
  }

  const palette = buildPalette(rgbaFrames[0]!.data, 255);
  const delayCs = Math.max(2, Math.round(100 / fps));
  const gifFrames: GifFrame[] = [];
  for (const f of rgbaFrames) {
    gifFrames.push({ width: f.width, height: f.height, delayCs, indices: quantizeFrame(f, palette) });
    await yieldToBrowser();
  }
  return encodeGif(gifFrames, palette, true);
}

export interface PngFrame {
  name: string;
  bytes: Uint8Array;
}

/** One PNG file per frame, numbered — for a frame-by-frame compositing/VFX pipeline downstream rather than a baked video. */
export async function renderPngSequence(project: MotionProject, opts: ExportImages = {}, fps = 24): Promise<PngFrame[]> {
  const { canvas, ctx } = makeCanvas(project);
  const step = 1 / fps;
  const frames: PngFrame[] = [];
  const total = Math.max(1, Math.ceil(project.duration / step));
  const digits = String(total).length;
  let i = 0;
  for (let t = 0; t < project.duration; t += step, i++) {
    drawFrame(ctx, project, t, { images: opts.images });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    frames.push({ name: `frame_${String(i + 1).padStart(digits, '0')}.png`, bytes });
    await yieldToBrowser();
  }
  return frames;
}

interface VideoCodecChoice {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const VIDEO_CANDIDATES: VideoCodecChoice[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

/** The best video container/codec this browser's MediaRecorder actually supports, or null if none do. */
export function pickVideoCodec(): VideoCodecChoice | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return VIDEO_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

export interface VideoResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

/** Chrome ≥126 can record 'video/mp4' directly; everywhere else this falls back to WebM — both are real, playable video files, just not always literally an .mp4. */
export async function renderVideo(project: MotionProject, opts: ExportImages = {}, fps = 30): Promise<VideoResult> {
  const codec = pickVideoCodec();
  if (!codec) throw new Error('This browser cannot record video (no MediaRecorder video/mp4 or video/webm support).');
  const { canvas, ctx } = makeCanvas(project);
  const stream = (canvas as HTMLCanvasElement & { captureStream(frameRate?: number): MediaStream }).captureStream(0);
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;

  const recorder = new MediaRecorder(stream, { mimeType: codec.mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  recorder.start();
  const step = 1 / fps;
  for (let t = 0; t < project.duration; t += step) {
    drawFrame(ctx, project, t, { images: opts.images });
    track?.requestFrame?.();
    await new Promise((r) => setTimeout(r, 0)); // yield a tick so the captured frame is actually read
  }
  drawFrame(ctx, project, project.duration, { images: opts.images });
  track?.requestFrame?.();
  await new Promise((r) => setTimeout(r, 50));
  recorder.stop();
  await stopped;

  return { blob: new Blob(chunks, { type: codec.mimeType }), mimeType: codec.mimeType, extension: codec.extension };
}
