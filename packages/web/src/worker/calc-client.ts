/**
 * Client-side wrapper for the PoB calculation Web Worker.
 * Provides a promise-based API for sending commands and receiving results.
 */
import type { CalcRequest, CalcResponse, SkillsData, SwitchSkillResult, NodeImpact, AllocResult, CalcSection, JewelInfo, EquippedItem, DisplayStatGroup, NodePowerData, ConfigData } from "./calc-api";

export class CalcClient {
  private worker: Worker;
  private pending = new Map<string, { resolve: (v: CalcResponse) => void; reject: (e: Error) => void }>();
  private idCounter = 0;
  private onLog?: (msg: string) => void;

  constructor(onLog?: (msg: string) => void) {
    this.onLog = onLog;
    this.worker = new Worker(new URL("./calc-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<CalcResponse & { _id?: string }>) => {
      const { _id, ...response } = e.data;
      if (response.type === "log") {
        this.onLog?.(response.message);
        return;
      }
      if (_id && this.pending.has(_id)) {
        this.pending.get(_id)!.resolve(response);
        this.pending.delete(_id);
      }
    };
    this.worker.onerror = (e) => {
      console.error("[CalcClient] Worker error:", e);
    };
  }

  private send(msg: CalcRequest): Promise<CalcResponse> {
    const _id = String(++this.idCounter);
    return new Promise((resolve, reject) => {
      this.pending.set(_id, { resolve, reject });
      this.worker.postMessage({ ...msg, _id });
    });
  }

  async init(): Promise<boolean> {
    const res = await this.send({ type: "init" });
    if (res.type === "init") return res.success;
    return false;
  }

  async loadBuild(xml: string): Promise<{ success: boolean; error?: string; allocatedNodes?: number[] }> {
    const res = await this.send({ type: "loadBuild", xml });
    if (res.type === "loadBuild") return { success: res.success, error: res.error, allocatedNodes: res.allocatedNodes };
    return { success: false, error: "unexpected response" };
  }

  async getStats(): Promise<Record<string, number>> {
    const res = await this.send({ type: "getStats" });
    if (res.type === "stats") return res.data;
    return {};
  }

  async getSkills(): Promise<SkillsData> {
    const res = await this.send({ type: "getSkills" });
    if (res.type === "skills") return res.data;
    return { mainSocketGroup: 1, fullDps: 0, skills: [], groups: [] };
  }

  async switchMainSkill(index: number): Promise<SwitchSkillResult> {
    const res = await this.send({ type: "switchMainSkill", index });
    if (res.type === "switchMainSkill") return res.data;
    return { stats: {} as any, fullDps: 0, skills: [] };
  }

  async getDefence(): Promise<Record<string, number>> {
    const res = await this.send({ type: "getDefence" });
    if (res.type === "defence") return res.data;
    return {};
  }

  async getDisplayStats(): Promise<DisplayStatGroup[]> {
    const res = await this.send({ type: "getDisplayStats" });
    if (res.type === "displayStats") return res.data;
    return [];
  }

  async getCalcDisplay(): Promise<CalcSection[]> {
    const res = await this.send({ type: "getCalcDisplay" });
    if (res.type === "calcDisplay") return res.data;
    return [];
  }

  async getJewels(): Promise<Record<string, JewelInfo>> {
    const res = await this.send({ type: "getJewels" });
    if (res.type === "jewels") return res.data;
    return {};
  }

  async getWeaponSetNodes(): Promise<Record<string, number>> {
    const res = await this.send({ type: "getWeaponSetNodes" });
    if (res.type === "weaponSetNodes") return res.data;
    return {};
  }

  async getItems(): Promise<EquippedItem[]> {
    const res = await this.send({ type: "getItems" });
    if (res.type === "items") return res.data.items;
    return [];
  }

  async allocNode(nodeId: number): Promise<AllocResult> {
    const res = await this.send({ type: "allocNode", nodeId });
    if (res.type === "allocNode") return res.data;
    return { success: false, allocatedNodes: [] };
  }

  async deallocNode(nodeId: number): Promise<AllocResult> {
    const res = await this.send({ type: "deallocNode", nodeId });
    if (res.type === "deallocNode") return res.data;
    return { success: false, allocatedNodes: [] };
  }

  async calcNodeImpact(nodeId: number, singleNode?: boolean): Promise<NodeImpact> {
    const res = await this.send({ type: "calcNodeImpact", nodeId, singleNode });
    if (res.type === "nodeImpact") return res.data;
    return { deltas: {}, pathCount: 1, pathNodes: [] };
  }

  async getNodePower(): Promise<NodePowerData> {
    const res = await this.send({ type: "getNodePower" });
    if (res.type === "nodePower") return res.data;
    return { nodes: {}, max: { off: 0, def: 0 }, topNodes: [] };
  }

  async getConfigOptions(): Promise<ConfigData> {
    const res = await this.send({ type: "getConfigOptions" });
    if (res.type === "configOptions") return res.data;
    return { sections: [] };
  }

  async setConfig(varName: string, value: boolean | number | string | null): Promise<{ success: boolean }> {
    const res = await this.send({ type: "setConfig", var: varName, value } as any);
    if (res.type === "setConfig") return res.data;
    return { success: false };
  }

  async exportBuild(): Promise<string> {
    const res = await this.send({ type: "exportBuild" });
    if (res.type === "exportBuild") return res.data.code;
    return "";
  }

  async exec(code: string): Promise<string | undefined> {
    const res = await this.send({ type: "exec", code });
    if (res.type === "exec") return res.result ?? res.error;
    return undefined;
  }

  terminate() {
    this.worker.terminate();
  }
}
