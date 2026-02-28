import { create } from "zustand";
import type { PobBuild } from "../worker/build-decoder";

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

export type CalcStatus = "idle" | "loading" | "ready" | "calculating" | "error";

interface BuildState {
  // Build data
  build: PobBuild | null;
  importCode: string;

  // Calc engine state
  calcStatus: CalcStatus;
  calcError: string | null;
  stats: CalcStats | null;

  // Passive tree
  allocatedNodes: Set<number>;
  hoveredNode: number | null;

  // Actions
  setBuild: (build: PobBuild) => void;
  setImportCode: (code: string) => void;
  setCalcStatus: (status: CalcStatus, error?: string) => void;
  setStats: (stats: CalcStats) => void;
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
      allocatedNodes: new Set(),
      hoveredNode: null,
    }),
}));
