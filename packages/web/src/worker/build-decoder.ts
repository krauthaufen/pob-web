/**
 * Decodes PoB build share codes.
 *
 * Format: URL-safe base64 encoded deflate-compressed XML
 * Steps: replace(-→+, _→/) → base64 decode → inflate → XML string
 */
import pako from "pako";

/**
 * Check if input is a poe.ninja character URL and extract account/character.
 * Supports formats:
 *   https://poe.ninja/poe2/profile/{account}/character/{character}
 *   https://poe.ninja/poe2/builds/{league}/character/{account}/{character}
 */
export function parsePoeNinjaUrl(input: string): { account: string; character: string } | null {
  const trimmed = input.trim();
  // /profile/{account}/character/{character}
  const profileMatch = trimmed.match(
    /poe\.ninja\/poe2\/profile\/([^/]+)\/character\/([^/?#]+)/
  );
  if (profileMatch) return { account: profileMatch[1]!, character: profileMatch[2]! };
  // /builds/{league}/character/{account}/{character}
  const buildsMatch = trimmed.match(
    /poe\.ninja\/poe2\/builds\/[^/]+\/character\/([^/]+)\/([^/?#]+)/
  );
  if (buildsMatch) return { account: buildsMatch[1]!, character: buildsMatch[2]! };
  return null;
}

/**
 * Fetch a PoB build code from a poe.ninja character profile.
 * Uses a proxy in dev (/poe-ninja-api) to avoid CORS.
 */
// Catalyst type name → PoB catalyst list index (1-based, matching Item.lua catalystList)
const CATALYST_MAP: Record<string, number> = {
  "Life Modifiers": 1, "Mana Modifiers": 2, "Defense Modifiers": 3,
  "Physical": 4, "Fire Modifiers": 5, "Cold Modifiers": 6,
  "Lightning Modifiers": 7, "Chaos Modifiers": 8, "Attack Modifiers": 9,
  "Caster Modifiers": 10, "Speed Modifiers": 11, "Attribute Modifiers": 12,
};
const CATALYST_NAMES = [
  "", "Flesh", "Neural", "Carapace", "Uul-Netol's", "Xoph's",
  "Tul's", "Esh's", "Chayula's", "Reaver", "Sibilant", "Skittering", "Adaptive",
];

/** Extract catalyst quality info from poe.ninja item properties */
function extractCatalystPatches(items: any[]): Map<string, { catalyst: string; quality: number }> {
  const patches = new Map<string, { catalyst: string; quality: number }>();
  for (const entry of items) {
    const item = entry.itemData;
    if (!item?.properties) continue;
    for (const prop of item.properties) {
      const m = prop.name?.match(/^Quality \((.+?)\)$/);
      if (m && prop.values?.[0]?.[0]) {
        const typeName = m[1]!;
        const idx = CATALYST_MAP[typeName];
        if (idx) {
          const quality = parseInt(prop.values[0][0].replace(/[+%]/g, ""), 10);
          if (quality > 0) {
            // Use item name + base type as key for matching XML items
            const key = ((item.name || "") + " " + (item.typeLine || "")).trim();
            patches.set(key, { catalyst: CATALYST_NAMES[idx]!, quality });
          }
        }
      }
    }
  }
  return patches;
}

/** Inject Catalyst/CatalystQuality lines into PoB XML for items missing them */
function patchXmlWithCatalysts(xml: string, patches: Map<string, { catalyst: string; quality: number }>): string {
  if (patches.size === 0) return xml;
  return xml.replace(/<Item id="[^"]*">([\s\S]*?)<\/Item>/g, (match, content: string) => {
    if (content.includes("Catalyst:")) return match;
    const lines = content.trim().split("\n").map((l: string) => l.trim());
    const rarity = lines[0]?.replace("Rarity: ", "") ?? "";
    let itemKey = "";
    let baseName = "";
    if (rarity === "RARE" || rarity === "UNIQUE") {
      itemKey = ((lines[1] || "") + " " + (lines[2] || "")).trim();
      baseName = (lines[2] || "").trim();
    } else {
      itemKey = (lines[1] || "").trim();
      baseName = itemKey;
    }
    const patch = patches.get(itemKey);
    if (!patch || !baseName) return match;
    // Insert quality + catalyst lines right after the base name line
    const injection = `\nQuality: ${patch.quality}\nCatalyst: ${patch.catalyst}\nCatalystQuality: ${patch.quality}`;
    // Find the base name line in the raw content and insert after it
    const idx = content.indexOf(baseName);
    if (idx < 0) return match;
    const endOfLine = content.indexOf("\n", idx);
    if (endOfLine < 0) return match;
    const patched = content.slice(0, endOfLine) + injection + content.slice(endOfLine);
    return match.replace(content, patched);
  });
}

export async function fetchPoeNinjaBuild(account: string, character: string): Promise<string> {
  // Both dev (Vite proxy) and prod (nginx proxy) serve /poe-ninja-api
  const base = "/poe-ninja-api";
  const url = `${base}/poe2/api/profile/characters/${encodeURIComponent(account)}/${encodeURIComponent(character)}/model/0`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`poe.ninja returned ${resp.status}`);

  const data = await resp.json();
  if (!data.hasData || !data.charModel?.pathOfBuildingExport) {
    throw new Error("Character not found or has no PoB export");
  }

  let code = data.charModel.pathOfBuildingExport as string;

  // Patch catalyst quality into the PoB export if raw item data is available
  if (data.charModel.items?.length) {
    try {
      const patches = extractCatalystPatches(data.charModel.items);
      if (patches.size > 0) {
        const xml = decodeBuildCode(code);
        const patched = patchXmlWithCatalysts(xml, patches);
        if (patched !== xml) {
          code = encodeBuildCode(patched);
        }
      }
    } catch {
      // Non-critical — if patching fails, use original export
    }
  }

  return code;
}

export function decodeBuildCode(code: string): string {
  const cleaned = code.trim();

  // URL-safe base64 → standard base64
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");

  // Decode base64 to binary
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Inflate (decompress)
  const inflated = pako.inflate(bytes);
  return new TextDecoder().decode(inflated);
}

export function encodeBuildCode(xml: string): string {
  // Deflate compress
  const compressed = pako.deflate(new TextEncoder().encode(xml));

  // Binary to base64
  let binary = "";
  for (let i = 0; i < compressed.length; i++) {
    binary += String.fromCharCode(compressed[i]!);
  }
  const b64 = btoa(binary);

  // Standard base64 → URL-safe
  return b64.replace(/\+/g, "-").replace(/\//g, "_");
}

export interface PobBuild {
  className: string;
  ascendancy: string;
  level: number;
  nodes: number[];
  mainSkillIndex: number;
  items: PobItem[];
  skills: PobSkillGroup[];
  config: Record<string, string>;
  notes: string;
  rawXml: string;
}

export interface PobItem {
  slot: string;
  rarity: string;
  name: string;
  base: string;
  rawText: string;
}

export interface PobSkillGroup {
  label: string;
  enabled: boolean;
  slot: string;
  gems: PobGem[];
}

export interface PobGem {
  skillId: string;
  nameSpec: string;
  level: number;
  quality: number;
  enabled: boolean;
}

export function parseBuildXml(xml: string): PobBuild {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  // Build info
  const buildEl = doc.querySelector("Build");
  const className = buildEl?.getAttribute("className") ?? "Unknown";
  const ascendancy = buildEl?.getAttribute("ascendClassName") ?? "";
  const level = parseInt(buildEl?.getAttribute("level") ?? "1", 10);
  const mainSkillIndex = parseInt(buildEl?.getAttribute("mainSocketGroup") ?? "1", 10);

  // Passive tree nodes
  const specEl = doc.querySelector("Spec[treeVersion]") ?? doc.querySelector("Spec");
  const nodesStr = specEl?.getAttribute("nodes") ?? "";
  const nodes = nodesStr
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  // Items
  const items: PobItem[] = [];
  const itemsEl = doc.querySelector("Items");
  if (itemsEl) {
    for (const itemEl of itemsEl.querySelectorAll("Item")) {
      const rawText = (itemEl.textContent ?? "").trim();
      const lines = rawText.split("\n").map((l) => l.trim());
      const rarity = lines.find((l) => l.startsWith("Rarity:"))?.slice(8) ?? "Normal";
      const name = lines[1] ?? "";
      const base = rarity === "Unique" || rarity === "Rare" ? lines[2] ?? "" : lines[1] ?? "";
      items.push({ slot: "", rarity, name, base, rawText });
    }

    // Map slots
    for (const slotEl of itemsEl.querySelectorAll("Slot")) {
      const slotName = slotEl.getAttribute("name") ?? "";
      const itemId = parseInt(slotEl.getAttribute("itemId") ?? "0", 10);
      if (itemId > 0 && itemId <= items.length) {
        items[itemId - 1]!.slot = slotName;
      }
    }
  }

  // Skills
  const skills: PobSkillGroup[] = [];
  const skillsEl = doc.querySelector("Skills");
  if (skillsEl) {
    for (const groupEl of skillsEl.querySelectorAll("Skill")) {
      const gems: PobGem[] = [];
      for (const gemEl of groupEl.querySelectorAll("Gem")) {
        gems.push({
          skillId: gemEl.getAttribute("skillId") ?? "",
          nameSpec: gemEl.getAttribute("nameSpec") ?? gemEl.getAttribute("skillId") ?? "",
          level: parseInt(gemEl.getAttribute("level") ?? "1", 10),
          quality: parseInt(gemEl.getAttribute("quality") ?? "0", 10),
          enabled: gemEl.getAttribute("enabled") !== "false",
        });
      }
      skills.push({
        label: groupEl.getAttribute("label") ?? "",
        enabled: groupEl.getAttribute("enabled") !== "false",
        slot: groupEl.getAttribute("slot") ?? "",
        gems,
      });
    }
  }

  // Config
  const config: Record<string, string> = {};
  const configEl = doc.querySelector("Config");
  if (configEl) {
    for (const inputEl of configEl.querySelectorAll("Input")) {
      const name = inputEl.getAttribute("name");
      const val = inputEl.getAttribute("boolean") ?? inputEl.getAttribute("number") ?? inputEl.getAttribute("string") ?? "";
      if (name) config[name] = val;
    }
  }

  // Notes
  const notesEl = doc.querySelector("Notes");
  const notes = (notesEl?.textContent ?? "").trim();

  return {
    className,
    ascendancy,
    level,
    nodes,
    mainSkillIndex,
    items,
    skills,
    config,
    notes,
    rawXml: xml,
  };
}
