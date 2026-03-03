import { create } from "zustand";
import type { PobBuild } from "../worker/build-decoder";
import type { SkillsData, CalcSection, JewelInfo, EquippedItem, DisplayStatGroup, GemsData } from "../worker/calc-api";

export interface CalcStats {
  // Offence
  totalDps: number;
  hitDps: number;
  dotDps: number;
  critChance: number;
  critMulti: number;
  attackSpeed: number;
  castSpeed: number;
  hitDamage: number;
  // Defence
  life: number;
  energyShield: number;
  mana: number;
  armour: number;
  evasion: number;
  blockChance: number;
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
  // Misc
  movementSpeed: number;
}

export interface DefenceStats {
  // Pool
  life: number;
  lifeUnreserved: number;
  lifeRegen: number;
  energyShield: number;
  esRegen: number;
  mana: number;
  manaUnreserved: number;
  manaRegen: number;
  ward: number;
  // Mitigation
  armour: number;
  evasion: number;
  physReduction: number;
  blockChance: number;
  spellBlockChance: number;
  // Resistances
  fireRes: number;
  coldRes: number;
  lightningRes: number;
  chaosRes: number;
  fireOverCap: number;
  coldOverCap: number;
  lightningOverCap: number;
  chaosOverCap: number;
  // EHP
  totalEhp: number;
  physMaxHit: number;
  fireMaxHit: number;
  coldMaxHit: number;
  lightningMaxHit: number;
  chaosMaxHit: number;
  // Misc
  movementSpeed: number;
}

export type CalcStatus = "idle" | "loading" | "ready" | "calculating" | "error";

interface BuildState {
  // Build data
  build: PobBuild | null;
  importCode: string;
  originalImportCode: string;

  // Calc engine state
  calcStatus: CalcStatus;
  calcError: string | null;
  stats: CalcStats | null;
  skillsData: SkillsData | null;
  defenceStats: DefenceStats | null;
  calcDisplay: CalcSection[] | null;
  displayStats: DisplayStatGroup[] | null;
  jewelData: Record<string, JewelInfo> | null;
  weaponSetNodes: Record<number, number> | null;
  equippedItems: EquippedItem[] | null;
  itemImageUrls: Record<string, string>;
  runeImageUrls: Record<string, string>;
  jewelImageUrls: Record<string, string>;
  gemsData: GemsData | null;
  gemImageUrls: Record<string, string>;

  // Node counts (from PoB's CountAllocNodes)
  passivesUsed: number;
  ascendancyUsed: number;
  weaponSet1Used: number;
  weaponSet2Used: number;

  // Skills
  selectedSkillGroup: number;

  // Passive tree
  allocatedNodes: Set<number>;
  hoveredNode: number | null;
  focusNodeHash: number | null;
  viewportResetCounter: number;

  // Actions
  setBuild: (build: PobBuild) => void;
  setImportCode: (code: string) => void;
  setOriginalImportCode: (code: string) => void;
  setCalcStatus: (status: CalcStatus, error?: string) => void;
  setStats: (stats: CalcStats) => void;
  setSkillsData: (data: SkillsData) => void;
  setDefenceStats: (data: DefenceStats) => void;
  setCalcDisplay: (data: CalcSection[]) => void;
  setDisplayStats: (data: DisplayStatGroup[]) => void;
  setJewelData: (data: Record<string, JewelInfo>) => void;
  setWeaponSetNodes: (data: Record<number, number>) => void;
  setEquippedItems: (data: EquippedItem[]) => void;
  setItemImageUrls: (urls: Record<string, string>) => void;
  setRuneImageUrls: (urls: Record<string, string>) => void;
  setJewelImageUrls: (urls: Record<string, string>) => void;
  setGemsData: (data: GemsData) => void;
  setGemImageUrls: (urls: Record<string, string>) => void;
  setNodeCounts: (passives: number, ascendancy: number, ws1: number, ws2: number) => void;
  setSelectedSkillGroup: (group: number) => void;
  toggleNode: (nodeId: number) => void;
  setAllocatedNodes: (nodes: number[]) => void;
  setHoveredNode: (nodeId: number | null) => void;
  focusNode: (nodeHash: number) => void;
  resetViewport: () => void;
  reset: () => void;
}

const emptyStats: CalcStats = {
  totalDps: 0, hitDps: 0, dotDps: 0,
  critChance: 0, critMulti: 0, attackSpeed: 0, castSpeed: 0, hitDamage: 0,
  life: 0, energyShield: 0, mana: 0, armour: 0, evasion: 0, blockChance: 0,
  fireRes: 0, coldRes: 0, lightningRes: 0, chaosRes: 0,
  movementSpeed: 0,
};

export const useBuildStore = create<BuildState>((set) => ({
  build: null,
  importCode: "",
  originalImportCode: "",
  calcStatus: "idle",
  calcError: null,
  stats: null,
  skillsData: null,
  defenceStats: null,
  calcDisplay: null,
  displayStats: null,
  jewelData: null,
  weaponSetNodes: null,
  equippedItems: null,
  itemImageUrls: {},
  runeImageUrls: {},
  jewelImageUrls: {},
  gemsData: null,
  gemImageUrls: {},
  passivesUsed: 0,
  ascendancyUsed: 0,
  weaponSet1Used: 0,
  weaponSet2Used: 0,
  selectedSkillGroup: 1,
  allocatedNodes: new Set(),
  hoveredNode: null,
  focusNodeHash: null,
  viewportResetCounter: 0,

  setBuild: (build) =>
    set({
      build,
      allocatedNodes: new Set(build.nodes),
      calcError: null,
    }),

  setImportCode: (importCode) => {
    set({ importCode });
    try { localStorage.setItem("pob-import-code", importCode); } catch {}
  },
  setOriginalImportCode: (originalImportCode) => set({ originalImportCode }),

  setCalcStatus: (calcStatus, error) =>
    set({ calcStatus, calcError: error ?? null }),

  setStats: (stats) => set({ stats, calcStatus: "ready" }),

  setSkillsData: (skillsData) => set({ skillsData, selectedSkillGroup: skillsData.mainSocketGroup }),

  setDefenceStats: (defenceStats) => set({ defenceStats }),
  setCalcDisplay: (calcDisplay) => set({ calcDisplay }),
  setDisplayStats: (displayStats) => set({ displayStats }),
  setJewelData: (jewelData) => set({ jewelData }),
  setWeaponSetNodes: (weaponSetNodes) => set({ weaponSetNodes }),
  setEquippedItems: (equippedItems) => set({ equippedItems }),
  setItemImageUrls: (itemImageUrls) => set({ itemImageUrls }),
  setRuneImageUrls: (runeImageUrls) => set({ runeImageUrls }),
  setJewelImageUrls: (jewelImageUrls) => set({ jewelImageUrls }),
  setGemsData: (gemsData) => set({ gemsData }),
  setGemImageUrls: (gemImageUrls) => set({ gemImageUrls }),
  setNodeCounts: (passivesUsed, ascendancyUsed, weaponSet1Used, weaponSet2Used) => set({ passivesUsed, ascendancyUsed, weaponSet1Used, weaponSet2Used }),
  setSelectedSkillGroup: (selectedSkillGroup) => set({ selectedSkillGroup }),

  toggleNode: (nodeId) =>
    set((state) => {
      const next = new Set(state.allocatedNodes);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return { allocatedNodes: next };
    }),

  setAllocatedNodes: (nodes) => set({ allocatedNodes: new Set(nodes) }),
  setHoveredNode: (hoveredNode) => set({ hoveredNode }),
  focusNode: (nodeHash) => set({ focusNodeHash: nodeHash }),
  resetViewport: () => set((state) => ({ viewportResetCounter: state.viewportResetCounter + 1 })),
  reset: () =>
    set({
      build: null,
      importCode: "",
      originalImportCode: "",
      calcStatus: "idle",
      calcError: null,
      stats: emptyStats,
      skillsData: null,
      defenceStats: null,
      calcDisplay: null,
      displayStats: null,
      jewelData: null,
      weaponSetNodes: null,
      equippedItems: null,
      itemImageUrls: {},
      runeImageUrls: {},
      jewelImageUrls: {},
      gemsData: null,
      gemImageUrls: {},
      passivesUsed: 0,
      ascendancyUsed: 0,
      weaponSet1Used: 0,
      weaponSet2Used: 0,
      selectedSkillGroup: 1,
      allocatedNodes: new Set(),
      hoveredNode: null,
      focusNodeHash: null,
    }),
}));
