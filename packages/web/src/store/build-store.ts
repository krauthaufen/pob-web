import { create } from "zustand";
import type { PobBuild } from "../worker/build-decoder";
import type { SkillsData, CalcSection, JewelInfo } from "../worker/calc-api";

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

  // Calc engine state
  calcStatus: CalcStatus;
  calcError: string | null;
  stats: CalcStats | null;
  skillsData: SkillsData | null;
  defenceStats: DefenceStats | null;
  calcDisplay: CalcSection[] | null;
  jewelData: Record<string, JewelInfo> | null;

  // Passive tree
  allocatedNodes: Set<number>;
  hoveredNode: number | null;

  // Actions
  setBuild: (build: PobBuild) => void;
  setImportCode: (code: string) => void;
  setCalcStatus: (status: CalcStatus, error?: string) => void;
  setStats: (stats: CalcStats) => void;
  setSkillsData: (data: SkillsData) => void;
  setDefenceStats: (data: DefenceStats) => void;
  setCalcDisplay: (data: CalcSection[]) => void;
  setJewelData: (data: Record<string, JewelInfo>) => void;
  toggleNode: (nodeId: number) => void;
  setAllocatedNodes: (nodes: number[]) => void;
  setHoveredNode: (nodeId: number | null) => void;
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
  calcStatus: "idle",
  calcError: null,
  stats: null,
  skillsData: null,
  defenceStats: null,
  calcDisplay: null,
  jewelData: null,
  allocatedNodes: new Set(),
  hoveredNode: null,

  setBuild: (build) =>
    set({
      build,
      allocatedNodes: new Set(build.nodes),
      calcError: null,
    }),

  setImportCode: (importCode) => set({ importCode }),

  setCalcStatus: (calcStatus, error) =>
    set({ calcStatus, calcError: error ?? null }),

  setStats: (stats) => set({ stats, calcStatus: "ready" }),

  setSkillsData: (skillsData) => set({ skillsData }),

  setDefenceStats: (defenceStats) => set({ defenceStats }),
  setCalcDisplay: (calcDisplay) => set({ calcDisplay }),
  setJewelData: (jewelData) => set({ jewelData }),

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
  reset: () =>
    set({
      build: null,
      importCode: "",
      calcStatus: "idle",
      calcError: null,
      stats: emptyStats,
      skillsData: null,
      defenceStats: null,
      calcDisplay: null,
      jewelData: null,
      allocatedNodes: new Set(),
      hoveredNode: null,
    }),
}));
