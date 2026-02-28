/**
 * Web Worker that runs the PoB Lua calculation engine via WASM.
 *
 * This worker:
 * 1. Initializes the Lua 5.2 WASM module
 * 2. Loads PoB-PoE2 source files into the virtual filesystem
 * 3. Runs HeadlessWrapper.lua to boot the PoB engine
 * 4. Accepts commands via postMessage to load builds, run calcs, etc.
 */
import type { CalcRequest, CalcResponse } from "./calc-api";

// These will be set once the WASM module loads
let Module: any = null;
let bridge_exec: (code: string) => string | null;
let bridge_dofile: (path: string) => string | null;
let bridge_set_string: (name: string, value: string) => void;
let bridge_get_string: (name: string) => string | null;
let bridge_call_json: (func: string, arg: string) => string;
let bridge_init: () => number;
let initialized = false;

function log(msg: string) {
  self.postMessage({ type: "log", message: msg } as CalcResponse);
}

function respond(id: string | undefined, response: CalcResponse) {
  self.postMessage({ ...response, _id: id });
}

async function initEngine(): Promise<boolean> {
  if (initialized) return true;

  try {
    log("Loading Lua WASM module...");

    // Dynamic import of the Emscripten-generated module
    // In production this will be the built lua.mjs
    // For now, we'll set up the infrastructure
    const createModule = (await import("../../wasm/lua.mjs")).default;
    Module = await createModule();

    bridge_init = Module.cwrap("bridge_init", "number", []);
    bridge_exec = Module.cwrap("bridge_exec", "string", ["string"]);
    bridge_dofile = Module.cwrap("bridge_dofile", "string", ["string"]);
    bridge_set_string = Module.cwrap("bridge_set_string", null, ["string", "string"]);
    bridge_get_string = Module.cwrap("bridge_get_string", "string", ["string"]);
    bridge_call_json = Module.cwrap("bridge_call_json", "string", ["string", "string"]);

    const result = bridge_init();
    if (result !== 0) throw new Error("bridge_init failed");

    log("Lua WASM initialized.");

    // Set up PoB paths and load HeadlessWrapper
    bridge_set_string("POB_SCRIPTPATH", "/pob/src/");
    bridge_set_string("POB_RUNTIMEPATH", "/pob/");
    bridge_set_string("POB_USERPATH", "/pob/user/");

    // Load HeadlessWrapper which boots the PoB engine
    log("Loading PoB HeadlessWrapper...");
    const err = bridge_dofile("/pob/src/HeadlessWrapper.lua");
    if (err) throw new Error(`HeadlessWrapper failed: ${err}`);

    log("PoB engine ready.");
    initialized = true;
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Init error: ${msg}`);
    return false;
  }
}

self.onmessage = async (e: MessageEvent<CalcRequest & { _id?: string }>) => {
  const { _id, ...msg } = e.data;

  switch (msg.type) {
    case "init": {
      const success = await initEngine();
      respond(_id, { type: "init", success });
      break;
    }

    case "loadBuild": {
      if (!initialized) {
        respond(_id, { type: "loadBuild", success: false, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebLoadBuild", JSON.stringify({ xml: msg.xml }));
        const parsed = JSON.parse(result);
        respond(_id, { type: "loadBuild", success: !parsed.error, error: parsed.error });
      } catch (e) {
        respond(_id, { type: "loadBuild", success: false, error: String(e) });
      }
      break;
    }

    case "getStats": {
      if (!initialized) {
        respond(_id, { type: "stats", data: {}, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetStats", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "stats", data });
      } catch (e) {
        respond(_id, { type: "stats", data: {}, error: String(e) });
      }
      break;
    }

    case "getNodePower": {
      if (!initialized) {
        respond(_id, { type: "nodePower", data: {}, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetNodePower", JSON.stringify({ stat: msg.stat }));
        const data = JSON.parse(result);
        respond(_id, { type: "nodePower", data });
      } catch (e) {
        respond(_id, { type: "nodePower", data: {}, error: String(e) });
      }
      break;
    }

    case "exec": {
      if (!initialized) {
        respond(_id, { type: "exec", error: "Engine not initialized" });
        break;
      }
      const error = bridge_exec(msg.code);
      respond(_id, { type: "exec", result: error ?? "ok", error: error ?? undefined });
      break;
    }

    default:
      respond(_id, { type: "error", message: `Unknown command: ${(msg as any).type}` });
  }
};
