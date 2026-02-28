/**
 * Client-side wrapper for the PoB calculation Web Worker.
 * Provides a promise-based API for sending commands and receiving results.
 */
import type { CalcRequest, CalcResponse } from "./calc-api";

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

  async loadBuild(xml: string): Promise<boolean> {
    const res = await this.send({ type: "loadBuild", xml });
    if (res.type === "loadBuild") return res.success;
    return false;
  }

  async getStats(): Promise<Record<string, number>> {
    const res = await this.send({ type: "getStats" });
    if (res.type === "stats") return res.data;
    return {};
  }

  async getNodePower(stat: "dps" | "life" | "es"): Promise<Record<number, number>> {
    const res = await this.send({ type: "getNodePower", stat });
    if (res.type === "nodePower") return res.data;
    return {};
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
