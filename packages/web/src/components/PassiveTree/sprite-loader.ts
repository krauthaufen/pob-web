/**
 * Loads sprite atlas metadata and creates PixiJS 8 textures for tree nodes.
 *
 * Atlas JSON format (from convert-sprites.mjs):
 * { sheet: "filename.png", cellW, cellH, sprites: { "Name": { x, y, w, h } } }
 */
import { Texture, Rectangle, Assets } from "pixi.js";

export interface SpriteAtlas {
  sheet: string;
  cellW: number;
  cellH: number;
  sprites: Record<string, { x: number; y: number; w: number; h: number }>;
}

const BASE = "/data/sprites/";
const textureCache = new Map<string, Texture>();
const atlasCache = new Map<string, SpriteAtlas>();

export async function loadAtlas(name: string): Promise<SpriteAtlas | null> {
  if (atlasCache.has(name)) return atlasCache.get(name)!;
  try {
    const resp = await fetch(`${BASE}${name}.json`);
    if (!resp.ok) return null;
    const atlas: SpriteAtlas = await resp.json();
    atlasCache.set(name, atlas);
    await Assets.load(`${BASE}${atlas.sheet}`);
    return atlas;
  } catch {
    return null;
  }
}

export function getSpriteTexture(atlas: SpriteAtlas, spriteName: string): Texture | null {
  const cacheKey = `${atlas.sheet}:${spriteName}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey)!;

  const info = atlas.sprites[spriteName];
  if (!info) return null;

  const baseUrl = `${BASE}${atlas.sheet}`;
  const baseTex = Texture.from(baseUrl);
  if (!baseTex.source) return null;

  const tex = new Texture({
    source: baseTex.source,
    frame: new Rectangle(info.x, info.y, info.w, info.h),
  });
  textureCache.set(cacheKey, tex);
  return tex;
}

/** Load essential atlases for rendering the tree */
export async function loadTreeAtlases(): Promise<Record<string, SpriteAtlas>> {
  const names = [
    // Node frames
    "group-background_104_104_BC7",
    "group-background_152_156_BC7",
    "group-background_220_224_BC7",
    // Skill icons — 128x128 has best coverage (323 icons), 64x64 as fallback
    "skills_128_128_BC1",
    "skills-disabled_128_128_BC1",
    "skills_64_64_BC1",
    "skills-disabled_64_64_BC1",
    // Jewel sockets
    "jewel-sockets_152_156_BC7",
    // Mastery overlays
    "mastery-active-effect_776_768_BC7",
    // Ascendancy node frames
    "group-background_160_164_BC7",
    "group-background_208_208_BC7",
    // Tree background (290KB)
    "background_1024_1024_BC7",
    // Ascendancy backgrounds (downsampled)
    "ascendancy-background_1000_1000_BC7",
    "ascendancy-background_250_250_BC7",
  ];

  const results = await Promise.all(names.map(loadAtlas));
  const atlases: Record<string, SpriteAtlas> = {};
  for (let i = 0; i < names.length; i++) {
    if (results[i]) atlases[names[i]!] = results[i]!;
  }
  return atlases;
}

export type NodeType = "normal" | "notable" | "keystone" | "jewel" | "mastery" | "classStart" | "ascendancyStart";

/** Get frame texture for a node */
export function getFrameTexture(
  atlases: Record<string, SpriteAtlas>,
  nodeType: NodeType,
  allocated: boolean,
): Texture | null {
  switch (nodeType) {
    case "normal": {
      const atlas = atlases["group-background_104_104_BC7"];
      if (!atlas) return null;
      return getSpriteTexture(atlas, allocated ? "PSSkillFrameActive" : "PSSkillFrame");
    }
    case "notable": {
      const atlas = atlases["group-background_152_156_BC7"];
      if (!atlas) return null;
      return getSpriteTexture(atlas, allocated ? "NotableFrameAllocated" : "NotableFrameUnallocated");
    }
    case "keystone": {
      const atlas = atlases["group-background_220_224_BC7"];
      if (!atlas) return null;
      return getSpriteTexture(atlas, allocated ? "KeystoneFrameAllocated" : "KeystoneFrameUnallocated");
    }
    case "jewel": {
      const atlas = atlases["group-background_152_156_BC7"];
      if (!atlas) return null;
      return getSpriteTexture(atlas, allocated ? "JewelFrameAllocated" : "JewelFrameUnallocated");
    }
    default:
      return null;
  }
}

/** Get ascendancy node frame texture using per-node overlay names */
export function getAscFrameTexture(
  atlases: Record<string, SpriteAtlas>,
  overlay: { alloc: string; path: string; unalloc: string },
  allocated: boolean,
): Texture | null {
  const name = allocated ? overlay.alloc : overlay.unalloc;
  // Small frames are in 160 atlas, large in 208
  const smallAtlas = atlases["group-background_160_164_BC7"];
  if (smallAtlas) {
    const tex = getSpriteTexture(smallAtlas, name);
    if (tex) return tex;
  }
  const largeAtlas = atlases["group-background_208_208_BC7"];
  if (largeAtlas) {
    const tex = getSpriteTexture(largeAtlas, name);
    if (tex) return tex;
  }
  return null;
}

/** Get jewel socket texture by jewel name from the jewel-sockets atlas.
 *  Tries exact item name first, then baseName (e.g. "Ruby", "Diamond"). */
export function getJewelTexture(
  atlases: Record<string, SpriteAtlas>,
  jewelName: string,
  baseName?: string,
): Texture | null {
  const atlas = atlases["jewel-sockets_152_156_BC7"];
  if (!atlas) return null;
  // Try exact item name first (works for unique jewels like "Controlled Metamorphosis")
  const tex = getSpriteTexture(atlas, jewelName);
  if (tex) return tex;
  // Fall back to base type name (e.g. "Ruby", "Diamond", "Time-Lost Sapphire")
  if (baseName) {
    return getSpriteTexture(atlas, baseName);
  }
  return null;
}

/** Get skill icon texture for a node, trying 128x128 first then 64x64 */
export function getIconTexture(
  atlases: Record<string, SpriteAtlas>,
  iconPath: string,
  allocated: boolean,
): Texture | null {
  if (!iconPath) return null;

  // Try 128x128 first (323 icons), then 64x64 (164 icons)
  const primaryAtlas = atlases[allocated ? "skills_128_128_BC1" : "skills-disabled_128_128_BC1"];
  if (primaryAtlas) {
    const tex = getSpriteTexture(primaryAtlas, iconPath);
    if (tex) return tex;
  }

  const fallbackAtlas = atlases[allocated ? "skills_64_64_BC1" : "skills-disabled_64_64_BC1"];
  if (fallbackAtlas) {
    const tex = getSpriteTexture(fallbackAtlas, iconPath);
    if (tex) return tex;
  }

  return null;
}
