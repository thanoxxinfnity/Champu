import type { FileArtifact } from '@/lib/agent/artifacts';
import type { DetectedPack } from './pack';

/**
 * Textures for a generated pack.
 *
 * A language model cannot emit a PNG, so every generated add-on arrived with
 * its textures missing: Minecraft imports it and renders the item or mob in
 * magenta-and-black, which is the game's way of saying "this file is not
 * there". The pack itself was correct — it just had holes where the art should
 * be. Chomugiri already has image generation, so the holes can be filled.
 *
 * What makes this work is the *downscale*, not the generation. A 1024px
 * painting shrunk with smooth interpolation becomes a blurry smudge at 16px.
 * Minecraft art is pixel art: nearest-neighbour sampling, hard alpha, and a
 * small palette. That is done here rather than asked of the image model,
 * because no prompt reliably produces a true 16×16 grid.
 */

export interface PlannedTexture {
  /** Path inside the resource pack, always ending in .png. */
  path: string;
  /** What the texture is for, used as the generation prompt. */
  subject: string;
  /** Square edge in pixels. Items and blocks are 16; entities get more room. */
  size: number;
  kind: 'item' | 'block' | 'entity';
}

const ITEM_SIZE = 16;
const ENTITY_SIZE = 64;

/** Strips a namespace and tidies an identifier into something promptable. */
export function subjectFromKey(key: string): string {
  return key
    .replace(/^[a-z0-9_]+:/i, '')
    .replace(/[_\-/]+/g, ' ')
    .replace(/\.(png|tga)$/i, '')
    .trim();
}

function withPng(path: string): string {
  return /\.(png|tga)$/i.test(path) ? path.replace(/\.tga$/i, '.png') : `${path}.png`;
}

interface TextureMap {
  texture_data?: Record<string, { textures?: string | string[] }>;
}

interface ClientEntity {
  'minecraft:client_entity'?: { description?: { identifier?: string; textures?: Record<string, string> } };
}

/**
 * Which textures the pack refers to but does not contain.
 *
 * Reads the same files Minecraft reads — item_texture.json, terrain_texture.json
 * and each entity's client file — so a texture this misses is one the game
 * would not have looked for either.
 */
export function plannedTextures(packs: DetectedPack[]): PlannedTexture[] {
  const files = packs.flatMap((p) => p.files);
  const resourceRoot = packs.find((p) => p.kind === 'resource')?.root ?? '';
  const prefix = resourceRoot ? `${resourceRoot}/` : '';

  const present = new Set(files.filter((f) => /\.(png|tga)$/i.test(f.path)).map((f) => f.path.toLowerCase()));
  const planned = new Map<string, PlannedTexture>();

  const want = (rawPath: string, subject: string, kind: PlannedTexture['kind'], size: number) => {
    const rel = withPng(rawPath.replace(/^\/+/, ''));
    const full = rel.startsWith(prefix) ? rel : `${prefix}${rel}`;
    if (present.has(full.toLowerCase()) || planned.has(full)) return;
    planned.set(full, { path: full, subject: subject || subjectFromKey(rel), kind, size });
  };

  for (const file of files) {
    const isItemMap = /item_texture\.json$/i.test(file.path);
    const isBlockMap = /terrain_texture\.json$/i.test(file.path);

    if (isItemMap || isBlockMap) {
      try {
        const parsed = JSON.parse(file.content) as TextureMap;
        for (const [key, value] of Object.entries(parsed.texture_data ?? {})) {
          const paths = Array.isArray(value?.textures) ? value.textures : value?.textures ? [value.textures] : [];
          for (const p of paths) want(p, subjectFromKey(key), isItemMap ? 'item' : 'block', ITEM_SIZE);
        }
      } catch {
        // A broken map is reported by the pack validator; nothing to plan here.
      }
      continue;
    }

    if (/\.entity\.json$/i.test(file.path)) {
      try {
        const desc = (JSON.parse(file.content) as ClientEntity)['minecraft:client_entity']?.description;
        const name = subjectFromKey(desc?.identifier ?? file.path);
        for (const p of Object.values(desc?.textures ?? {})) want(p, name, 'entity', ENTITY_SIZE);
      } catch {
        /* likewise */
      }
    }
  }

  return [...planned.values()];
}

/** The prompt for one texture. Written for pixel art, not for a painting. */
export function texturePrompt(texture: PlannedTexture): string {
  const frame =
    texture.kind === 'entity'
      ? 'flat entity texture sheet, front-facing, no shading gradients'
      : texture.kind === 'block'
        ? 'seamless tileable block face'
        : 'single centred object, no background scenery';

  return (
    `${texture.subject}, Minecraft texture, ${frame}. ` +
    `Pixel art, ${texture.size}x${texture.size}, limited palette, hard edges, bold readable silhouette, ` +
    `flat colours, transparent background, no text, no watermark, no frame, no border.`
  );
}

/**
 * Redraws a generated image as pixel art of the given size.
 *
 * Nearest-neighbour on the way down is the whole point: smoothing turns a 16px
 * icon into mush. Alpha is hard-thresholded because Minecraft's item renderer
 * treats semi-transparent pixels as opaque, so a soft edge becomes a grey halo.
 */
export async function toPixelArt(dataUrl: string, size: number): Promise<string> {
  const image = await loadImage(dataUrl);

  // The background has to go first, at full resolution.
  //
  // Image models answer with an opaque JPEG however firmly the prompt asks for
  // transparency, and in game an opaque texture is a white box around the item.
  // Knocking the background out here — with far more pixels to work from than
  // 16×16 offers — is what makes the result look like a Minecraft item instead
  // of a sticker.
  const full = document.createElement('canvas');
  full.width = image.naturalWidth || 512;
  full.height = image.naturalHeight || 512;
  const fullCtx = full.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) throw new Error('Canvas is unavailable, so the texture cannot be prepared.');

  fullCtx.drawImage(image, 0, 0);
  const source = fullCtx.getImageData(0, 0, full.width, full.height);
  // Imported here rather than at the top: the matting code is browser-only,
  // and the planning half of this module is pure and worth testing on its own.
  const { matteImageData } = await import('@/lib/suites/assets/matte');
  // No feather: a soft edge survives the downscale as a grey fringe.
  matteImageData(source.data, full.width, full.height, { tolerance: 30, feather: 0, despill: true });
  fullCtx.putImageData(source, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable, so the texture cannot be resized.');

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(full, 0, 0, size, size);

  const frame = ctx.getImageData(0, 0, size, size);
  hardenAlpha(frame.data);
  ctx.putImageData(frame, 0, 0);

  return canvas.toDataURL('image/png');
}

/** Semi-transparent pixels become fully on or fully off. */
function hardenAlpha(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] < 128 ? 0 : 255;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The generated texture could not be decoded.'));
    img.src = src;
  });
}

/** A generated texture, as a file the rest of the pipeline already understands. */
export function textureArtifact(path: string, pngDataUrl: string): FileArtifact {
  return {
    kind: 'file',
    path,
    language: 'png',
    // Carried as a data URL so it travels through the same file map, history and
    // export path as every other generated file; the zip builder decodes it.
    content: pngDataUrl,
    complete: true,
    bytes: Math.round((pngDataUrl.length - pngDataUrl.indexOf(',') - 1) * 0.75),
  };
}
