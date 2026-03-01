/**
 * Resolves item inventory icons from poe2wiki.net MediaWiki API.
 * Caches results in memory so repeated loads are instant.
 *
 * Some base items share icons with other items (e.g. "Warlord Cuirass" uses
 * the "Chieftain Cuirass" icon). The icon map handles these redirects.
 */
import type { EquippedItem } from "@/worker/calc-api";
import iconMap from "./item-icon-map.json";

const WIKI_API = "https://www.poe2wiki.net/w/api.php";
const imageCache = new Map<string, string>();
const missingCache = new Set<string>();

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
