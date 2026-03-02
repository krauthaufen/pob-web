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
  | { type: "calcNodeImpact"; nodeId: number; singleNode?: boolean }
  | { type: "getNodePower" }
  | { type: "getDisplayStats" }
  | { type: "exportBuild" }
  | { type: "getConfigOptions" }
  | { type: "setConfig"; var: string; value: boolean | number | string | null }
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
  pathNodes: number[];
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
  radius?: { inner: number; outer: number };
  radiusCenters?: { x: number; y: number; name: string }[];
}

/** Equipped item data from PoB's ItemsTab */
export interface ModLine {
  line: string;
  crafted?: boolean;
  fractured?: boolean;
  desecrated?: boolean;
  mutated?: boolean;
  bonded?: boolean;
}

export interface EquippedItem {
  slot: string;
  name: string;
  baseName: string;
  itemType: string;
  rarity: string;
  quality: number;
  catalystType?: string;
  catalystQuality?: number;
  levelReq: number;
  corrupted: boolean;
  doubleCorrupted: boolean;
  mirrored: boolean;
  fractured: boolean;
  influences: string[];
  implicitMods: ModLine[];
  enchantMods: ModLine[];
  runeMods: ModLine[];
  explicitMods: ModLine[];
  buffMods?: ModLine[];
  weapon?: {
    physMin?: number; physMax?: number; physDps?: number;
    fireMin?: number; fireMax?: number; fireDps?: number;
    coldMin?: number; coldMax?: number; coldDps?: number;
    lightningMin?: number; lightningMax?: number; lightningDps?: number;
    chaosMin?: number; chaosMax?: number; chaosDps?: number;
    elemDps?: number;
    totalDps?: number;
    aps?: number;
    critChance?: number;
    range?: number;
  };
  armour?: {
    armour?: number;
    evasion?: number;
    energyShield?: number;
    ward?: number;
    blockChance?: number;
  };
  flask?: {
    lifeTotal?: number; lifeGradual?: number; lifeInstant?: number;
    manaTotal?: number; manaGradual?: number; manaInstant?: number;
    duration?: number; chargesUsed?: number; chargesMax?: number;
  };
  charm?: {
    duration?: number; chargesUsed?: number; chargesMax?: number;
  };
  spirit?: number;
  sockets?: number;
  runeNames?: string[];
  requirements?: { str: number; dex: number; int: number };
}

/** PoB sidebar display stat (from BuildDisplayStats.lua) */
export interface DisplayStat { label: string; value: string; color?: string; }
export type DisplayStatGroup = DisplayStat[];

/** Single entry in the power report ranked list */
export interface NodePowerEntry {
  hash: number;
  name: string;
  type: string;
  off: number;
  def: number;
  pathDist: number;
  count: number;
}

/** Node power heatmap data — combined offence/defence per node */
export interface NodePowerData {
  nodes: Record<string, { off: number; def: number }>;
  max: { off: number; def: number };
  topNodes: NodePowerEntry[];
}

/** A single config option from PoB's ConfigOptions varList */
export interface ConfigOption {
  var: string;
  type: "check" | "count" | "integer" | "countAllowZero" | "float" | "list" | "text";
  label: string;
  visible: boolean;
  value: boolean | number | string | null;
  placeholder?: number | string;
  tooltip?: string;
  list?: { val: string | number; label: string }[];
  hideIfInvalid?: boolean;
}

/** A section of config options */
export interface ConfigSection {
  name: string;
  options: ConfigOption[];
}

/** Full config data returned by getConfigOptions */
export interface ConfigData {
  sections: ConfigSection[];
}

/** Response from allocNode / deallocNode */
export interface AllocResult {
  success: boolean;
  allocatedNodes: number[];
  display?: CalcSection[];
}

export type CalcResponse =
  | { type: "init"; success: boolean; error?: string }
  | { type: "loadBuild"; success: boolean; error?: string; allocatedNodes?: number[] }
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
  | { type: "nodePower"; data: NodePowerData; error?: string }
  | { type: "nodeImpact"; data: NodeImpact; error?: string }
  | { type: "exportBuild"; data: { code: string }; error?: string }
  | { type: "configOptions"; data: ConfigData; error?: string }
  | { type: "setConfig"; data: { success: boolean }; error?: string }
  | { type: "error"; message: string }
  | { type: "log"; message: string }
  | { type: "exec"; result?: string; error?: string };
