/**
 * Message types for the PoB calculation Web Worker.
 */

export type CalcRequest =
  | { type: "init" }
  | { type: "loadBuild"; xml: string }
  | { type: "getStats" }
  | { type: "allocNode"; nodeId: number }
  | { type: "deallocNode"; nodeId: number }
  | { type: "setNodes"; nodeIds: number[] }
  | { type: "getNodePower"; stat: "dps" | "life" | "es" }
  | { type: "exec"; code: string };

export type CalcResponse =
  | { type: "init"; success: boolean; error?: string }
  | { type: "loadBuild"; success: boolean; error?: string }
  | { type: "stats"; data: Record<string, number>; error?: string }
  | { type: "nodePower"; data: Record<number, number>; error?: string }
  | { type: "error"; message: string }
  | { type: "log"; message: string }
  | { type: "exec"; result?: string; error?: string };
