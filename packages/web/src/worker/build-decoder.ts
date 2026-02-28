/**
 * Decodes PoB build share codes.
 *
 * Format: URL-safe base64 encoded deflate-compressed XML
 * Steps: replace(-→+, _→/) → base64 decode → inflate → XML string
 */
import pako from "pako";

export function decodeBuildCode(code: string): string {
  // Strip any URL prefix (e.g. from pobb.in or similar)
  let cleaned = code.trim();

  // Handle pobb.in and similar URL formats
  const urlMatch = cleaned.match(/(?:pobb\.in|poe\.ninja)\/[^/]*\/([A-Za-z0-9_-]+)/);
  if (urlMatch) {
    cleaned = urlMatch[1]!;
  }

  // URL-safe base64 → standard base64
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");

  // Decode base64 to binary
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Inflate (decompress)
  const xml = pako.inflate(bytes, { to: "string" });
  return xml;
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
