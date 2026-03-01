/**
 * Message types for the PoB calculation Web Worker.
 */

export type CalcRequest =
  | { type: "init" }
  | { type: "loadBuild"; xml: string }
  | { type: "getStats" }
  | { type: "getSkills" }
  | { type: "getDefence" }
  | { type: "getCalcDisplay" }
  | { type: "getJewels" }
  | { type: "getWeaponSetNodes" }
  | { type: "getItems" }
  | { type: "switchMainSkill"; index: number }
  | { type: "allocNode"; nodeId: number }
  | { type: "deallocNode"; nodeId: number }
  | { type: "calcNodeImpact"; nodeId: number }
  | { type: "getNodePower"; stat: "dps" | "life" | "es" }
  | { type: "getDisplayStats" }
  | { type: "exportBuild" }
  | { type: "exec"; code: string };

/** Per-skill DPS entry from PoB's calcFullDPS (output.SkillDPS) */
export interface SkillDpsEntry {
  name: string;
  dps: number;
  count: number;
  trigger?: string;
  skillPart?: string;
}

/** Socket group metadata for the dropdown */
export interface SocketGroupInfo {
  index: number;
  label: string;
  enabled: boolean;
  slot: string;
  activeSkillNames: string[];
  includeInFullDPS: boolean;
}

/** Detailed stats for the currently selected main skill */
export interface MainSkillStats {
  TotalDPS: number;
  CombinedDPS: number;
  TotalDot: number;
  BleedDPS: number;
  IgniteDPS: number;
  PoisonDPS: number;
  Speed: number;
  CastSpeed: number;
  CritChance: number;
  CritMultiplier: number;
  AverageDamage: number;
  ManaCost: number;
}

/** Full skills data returned by getSkills */
export interface SkillsData {
  mainSocketGroup: number;
  fullDps: number;
  skills: SkillDpsEntry[];
  mainSkillStats?: MainSkillStats;
  groups: SocketGroupInfo[];
}

/** A single stat delta from PoB's CalculatePowerStat */
export interface ImpactDelta {
  value: number;
  label: string;
}

/** Node impact — deltas computed by PoB's CalcsTab functions, labels from data.powerStatList */
export interface NodeImpact {
  deltas: Record<string, ImpactDelta>;
  pathCount: number;
}

/** Response from switchMainSkill */
export interface SwitchSkillResult {
  stats: MainSkillStats;
  fullDps: number;
  skills: SkillDpsEntry[];
  display?: CalcSection[];
}

/** CalcDisplay: PoB's CalcSections-based structured output */
export interface CalcStatValue { key: string; value: number; decimals: number; }
export interface CalcStatRow { label: string; values: CalcStatValue[]; }
export interface CalcSubSection { label: string; stats: CalcStatRow[]; }
export interface CalcSection { id: string; group: number; subsections: CalcSubSection[]; }

/** Jewel socket data */
export interface JewelInfo {
  name: string;
  baseName: string;
  rarity: string;
  implicitMods: string[];
  explicitMods: string[];
  enchantMods: string[];
  runeMods: string[];
}

/** Equipped item data from PoB's ItemsTab */
export interface EquippedItem {
  slot: string;
  name: string;
  baseName: string;
  rarity: string;
  quality: number;
  levelReq: number;
  implicitMods: string[];
  explicitMods: string[];
  craftedMods: string[];
  enchantMods: string[];
  runeMods: string[];
}

/** PoB sidebar display stat (from BuildDisplayStats.lua) */
export interface DisplayStat { label: string; value: string; color?: string; }
export type DisplayStatGroup = DisplayStat[];

/** Response from allocNode / deallocNode */
export interface AllocResult {
  success: boolean;
  allocatedNodes: number[];
  display?: CalcSection[];
}

export type CalcResponse =
  | { type: "init"; success: boolean; error?: string }
  | { type: "loadBuild"; success: boolean; error?: string }
  | { type: "stats"; data: Record<string, number>; error?: string }
  | { type: "skills"; data: SkillsData; error?: string }
  | { type: "defence"; data: Record<string, number>; error?: string }
  | { type: "switchMainSkill"; data: SwitchSkillResult; error?: string }
  | { type: "allocNode"; data: AllocResult; error?: string }
  | { type: "deallocNode"; data: AllocResult; error?: string }
  | { type: "calcDisplay"; data: CalcSection[]; error?: string }
  | { type: "displayStats"; data: DisplayStatGroup[]; error?: string }
  | { type: "jewels"; data: Record<string, JewelInfo>; error?: string }
  | { type: "weaponSetNodes"; data: Record<string, number>; error?: string }
  | { type: "items"; data: { items: EquippedItem[] }; error?: string }
  | { type: "nodePower"; data: Record<number, number>; error?: string }
  | { type: "nodeImpact"; data: NodeImpact; error?: string }
  | { type: "exportBuild"; data: { code: string }; error?: string }
  | { type: "error"; message: string }
  | { type: "log"; message: string }
  | { type: "exec"; result?: string; error?: string };
