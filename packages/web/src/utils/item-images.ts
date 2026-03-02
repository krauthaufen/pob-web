/**
 * Resolves item inventory icons from poe2wiki.net MediaWiki API.
 * Caches results in memory so repeated loads are instant.
 *
 * Some base items share icons with other items (e.g. "Warlord Cuirass" uses
 * the "Chieftain Cuirass" icon). The icon map handles these redirects.
 */
import type { EquippedItem, JewelInfo } from "@/worker/calc-api";
import iconMap from "./item-icon-map.json";

const WIKI_API = "https://www.poe2wiki.net/w/api.php";
const STORAGE_KEY = "pob-item-image-cache";
const imageCache = new Map<string, string>();
const missingCache = new Set<string>();

// Hydrate from localStorage on module load
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    for (const [k, v] of Object.entries(JSON.parse(stored))) {
      imageCache.set(k, v as string);
    }
  }
} catch {}

function persistCache() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(imageCache)));
  } catch {}
}

const iconRedirects = iconMap as Record<string, string>;

/** Get the wiki file title for an item name, using the redirect map for shared icons */
function fileTitle(name: string): string {
  const redirect = iconRedirects[name];
  if (redirect) return `File:${redirect}.png`;
  return `File:${name} inventory icon.png`;
}

/** Batch-resolve image URLs from poe2wiki for a list of file titles */
async function batchResolve(titles: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // MediaWiki allows up to 50 titles per query
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query",
      titles: batch.join("|"),
      prop: "imageinfo",
      iiprop: "url",
      format: "json",
      origin: "*",
    });
    try {
      const resp = await fetch(`${WIKI_API}?${params}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const pages = data?.query?.pages;
      if (!pages) continue;
      for (const page of Object.values(pages) as any[]) {
        const url = page?.imageinfo?.[0]?.url;
        if (url && page.title) {
          result.set(page.title, url);
        }
      }
    } catch {
      // Network error — skip this batch
    }
  }
  return result;
}

/**
 * Resolve rune/soul core images for socketed items.
 * Returns a map of rune name → image URL.
 */
export async function resolveRuneImages(
  items: EquippedItem[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const toQuery: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item.runeNames) continue;
    for (const name of item.runeNames) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const title = fileTitle(name);
      if (imageCache.has(title)) {
        result[name] = imageCache.get(title)!;
      } else if (!missingCache.has(title)) {
        toQuery.push(title);
      }
    }
  }

  if (toQuery.length === 0) return result;

  const resolved = await batchResolve(toQuery);
  for (const [title, url] of resolved) imageCache.set(title, url);
  for (const title of toQuery) {
    if (!resolved.has(title)) missingCache.add(title);
  }
  if (resolved.size > 0) persistCache();

  // Map back to rune names
  for (const name of seen) {
    if (result[name]) continue;
    const url = imageCache.get(fileTitle(name));
    if (url) result[name] = url;
  }

  return result;
}

/**
 * Resolve item images for a list of equipped items.
 * Returns a map of slot name → image URL.
 *
 * For unique items: tries unique name first, falls back to baseName.
 * For other rarities: uses baseName directly.
 */
export async function resolveItemImages(
  items: EquippedItem[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const toQuery: string[] = [];

  // Map from file title → { slot, priority } for deduplication
  const titleToSlots = new Map<string, { slot: string; priority: number }[]>();

  for (const item of items) {
    // Check cache first
    const uniqueTitle = item.rarity === "UNIQUE" && item.name ? fileTitle(item.name) : null;
    const baseTitle = item.baseName ? fileTitle(item.baseName) : null;

    // Try unique name from cache
    if (uniqueTitle && imageCache.has(uniqueTitle)) {
      result[item.slot] = imageCache.get(uniqueTitle)!;
      continue;
    }
    // Try base name from cache
    if (baseTitle && imageCache.has(baseTitle)) {
      result[item.slot] = imageCache.get(baseTitle)!;
      continue;
    }

    // Queue for batch resolution
    if (uniqueTitle && !missingCache.has(uniqueTitle)) {
      if (!titleToSlots.has(uniqueTitle)) {
        titleToSlots.set(uniqueTitle, []);
        toQuery.push(uniqueTitle);
      }
      titleToSlots.get(uniqueTitle)!.push({ slot: item.slot, priority: 1 });
    }
    if (baseTitle && !missingCache.has(baseTitle)) {
      if (!titleToSlots.has(baseTitle)) {
        titleToSlots.set(baseTitle, []);
        toQuery.push(baseTitle);
      }
      titleToSlots.get(baseTitle)!.push({ slot: item.slot, priority: 0 });
    }
  }

  if (toQuery.length === 0) return result;

  const resolved = await batchResolve(toQuery);

  // Process results
  for (const [title, url] of resolved) {
    imageCache.set(title, url);
  }
  if (resolved.size > 0) persistCache();

  // Mark unresolved titles as missing
  for (const title of toQuery) {
    if (!resolved.has(title)) {
      missingCache.add(title);
    }
  }

  // Assign URLs to slots (unique name takes priority over base name)
  for (const item of items) {
    if (result[item.slot]) continue; // already resolved from cache

    const uniqueTitle = item.rarity === "UNIQUE" && item.name ? fileTitle(item.name) : null;
    const baseTitle = item.baseName ? fileTitle(item.baseName) : null;

    const uniqueUrl = uniqueTitle ? imageCache.get(uniqueTitle) : undefined;
    const baseUrl = baseTitle ? imageCache.get(baseTitle) : undefined;

    if (uniqueUrl) {
      result[item.slot] = uniqueUrl;
    } else if (baseUrl) {
      result[item.slot] = baseUrl;
    }
  }

  return result;
}

/**
 * Resolve jewel images from poe2wiki.
 * Returns a map of jewel name → image URL.
 * Tries unique name first (for uniques), then baseName.
 */
export async function resolveJewelImages(
  jewels: Record<string, JewelInfo>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const toQuery: string[] = [];
  const seen = new Set<string>();

  for (const jewel of Object.values(jewels)) {
    if (!jewel.name || seen.has(jewel.name)) continue;
    seen.add(jewel.name);

    const uniqueTitle = jewel.rarity.toUpperCase() === "UNIQUE" ? fileTitle(jewel.name) : null;
    const baseTitle = jewel.baseName ? fileTitle(jewel.baseName) : null;

    if (uniqueTitle && imageCache.has(uniqueTitle)) {
      result[jewel.name] = imageCache.get(uniqueTitle)!;
      continue;
    }
    if (baseTitle && imageCache.has(baseTitle)) {
      result[jewel.name] = imageCache.get(baseTitle)!;
      continue;
    }

    if (uniqueTitle && !missingCache.has(uniqueTitle)) toQuery.push(uniqueTitle);
    if (baseTitle && !missingCache.has(baseTitle)) toQuery.push(baseTitle);
  }

  if (toQuery.length === 0) return result;

  const resolved = await batchResolve(toQuery);
  for (const [title, url] of resolved) imageCache.set(title, url);
  for (const title of toQuery) {
    if (!resolved.has(title)) missingCache.add(title);
  }
  if (resolved.size > 0) persistCache();

  for (const jewel of Object.values(jewels)) {
    if (!jewel.name || result[jewel.name]) continue;
    const uniqueTitle = jewel.rarity.toUpperCase() === "UNIQUE" ? fileTitle(jewel.name) : null;
    const baseTitle = jewel.baseName ? fileTitle(jewel.baseName) : null;
    const url = (uniqueTitle ? imageCache.get(uniqueTitle) : undefined) ??
                (baseTitle ? imageCache.get(baseTitle) : undefined);
    if (url) result[jewel.name] = url;
  }

  return result;
}
