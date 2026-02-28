/**
 * Types for the POE2 passive skill tree JSON data.
 * Based on the tree.json format from PathOfBuilding-PoE2.
 */

export interface TreeData {
  tree: string;
  classes: TreeClass[];
  groups: (TreeGroup | null)[];
  nodes: Record<string, TreeNode>;
  extraImages: Record<string, { x: number; y: number; image: string }>;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  constants: {
    classes: Record<string, number>;
    characterAttributes: Record<string, number>;
    PSSCentreInnerRadius: number;
    skillsPerOrbit: number[];
    orbitRadii: number[];
    orbitAnglesByOrbit?: number[][];
  };
}

export interface TreeClass {
  name: string;
  base_str: number;
  base_dex: number;
  base_int: number;
  ascendancies: TreeAscendancy[];
}

export interface TreeAscendancy {
  id: string;
  name: string;
  flavourText?: string;
  flavourTextColour?: string;
}

export interface TreeGroup {
  x: number;
  y: number;
  ormask: number;
  orbits: number[];
  nodes: string[];
  background?: { image: string; isHalfImage?: boolean };
}

export interface TreeNode {
  skill: number; // node hash id
  name: string;
  icon: string;
  isNotable?: boolean;
  isKeystone?: boolean;
  isJewelSocket?: boolean;
  isMastery?: boolean;
  isOnlyImage?: boolean;
  isAscendancyStart?: boolean;
  ascendancyName?: string;
  classStartIndex?: number;
  group?: number;
  orbit?: number;
  orbitIndex?: number;
  connections: { id: number; orbit: number }[];
  out?: string[];
  in?: string[];
  stats: string[];
  reminderText?: string[];
  flavourText?: string[];
  grantedStrength?: number;
  grantedDexterity?: number;
  grantedIntelligence?: number;
  grantedPassivePoints?: number;
}

export interface ProcessedNode {
  id: string;
  hash: number;
  x: number;
  y: number;
  name: string;
  icon: string;
  stats: string[];
  type: "normal" | "notable" | "keystone" | "jewel" | "mastery" | "classStart" | "ascendancyStart";
  ascendancy?: string;
  connections: string[];
  size: number; // render radius
}
