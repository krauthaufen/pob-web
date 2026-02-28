/**
 * Web Worker that runs the PoB Lua calculation engine via WASM.
 *
 * Boot sequence:
 * 1. Load Lua 5.2 WASM module (with zlib for Deflate/Inflate)
 * 2. Apply compatibility shims (bit, jit, lua-utf8)
 * 3. Fetch pob-lua.json bundle and populate Emscripten MEMFS
 * 4. Run our HeadlessWrapper which boots Launch → Main → Build
 * 5. Accept commands via postMessage
 */
import type { CalcRequest, CalcResponse } from "./calc-api";
import { ALL_SHIMS } from "./lua-shims";

let Module: any = null;
let bridge_exec!: (code: string) => string | null;
let bridge_call_json!: (func: string, arg: string) => string;
let bridge_init!: () => number;
let initialized = false;

function log(msg: string) {
  self.postMessage({ type: "log", message: msg } as CalcResponse);
}

function respond(id: string | undefined, response: CalcResponse) {
  self.postMessage({ ...response, _id: id });
}

/**
 * Create all directories along a path in Emscripten's MEMFS.
 */
function mkdirp(FS: any, path: string) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += "/" + part;
    try {
      FS.mkdir(current);
    } catch {
      // Already exists
    }
  }
}

/**
 * Write a file to Emscripten's MEMFS, creating parent dirs as needed.
 */
function writeFile(FS: any, path: string, content: string) {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) mkdirp(FS, dir);
  FS.writeFile(path, content);
}

/**
 * Fetch the PoB Lua bundle and populate MEMFS.
 */
async function loadPobFiles(FS: any): Promise<number> {
  log("Fetching PoB Lua bundle...");
  const resp = await fetch("/data/pob-lua.json");
  if (!resp.ok) throw new Error(`Failed to fetch pob-lua.json: ${resp.status}`);

  const bundle = await resp.json();
  const entries = Object.entries(bundle.files);
  log(`Writing ${entries.length} files to MEMFS...`);

  // All files go under /pob/
  // src/ files → /pob/src/
  // runtime/ files → /pob/runtime/
  for (const [path, content] of entries) {
    writeFile(FS, `/pob/${path}`, content as string);
  }

  // Create user directory for PoB data
  mkdirp(FS, "/pob/user");

  return entries.length;
}

/**
 * The HeadlessWrapper we inject into Lua.
 * This is based on the original but modified for our environment:
 * - Uses /pob/src/ as working directory
 * - Deflate/Inflate are provided by bridge.c (C zlib)
 * - GetTime is provided by bridge.c (emscripten_get_now)
 */
const HEADLESS_WRAPPER = `
-- PoB-Web HeadlessWrapper (adapted for Lua 5.2 WASM)

-- Callbacks
local callbackTable = {}
local mainObject
function runCallback(name, ...)
  if callbackTable[name] then
    return callbackTable[name](...)
  elseif mainObject and mainObject[name] then
    return mainObject[name](mainObject, ...)
  end
end
function SetCallback(name, func) callbackTable[name] = func end
function GetCallback(name) return callbackTable[name] end
function SetMainObject(obj) mainObject = obj end

-- Image Handles (no-op in headless)
local imageHandleClass = {}
imageHandleClass.__index = imageHandleClass
function NewImageHandle() return setmetatable({}, imageHandleClass) end
function imageHandleClass:Load(fileName, ...) self.valid = true end
function imageHandleClass:Unload() self.valid = false end
function imageHandleClass:IsValid() return self.valid end
function imageHandleClass:SetLoadingPriority(pri) end
function imageHandleClass:ImageSize() return 1, 1 end

-- Rendering stubs
function RenderInit(flag, ...) end
function GetScreenSize() return 1920, 1080 end
function GetScreenScale() return 1 end
function GetDPIScaleOverridePercent() return 1 end
function SetDPIScaleOverridePercent(scale) end
function SetClearColor(r, g, b, a) end
function SetDrawLayer(layer, subLayer) end
function SetViewport(x, y, width, height) end
function SetDrawColor(r, g, b, a) end
function GetDrawColor(r, g, b, a) end
function DrawImage(imgHandle, left, top, width, height, tcLeft, tcTop, tcRight, tcBottom) end
function DrawImageQuad(imageHandle, x1, y1, x2, y2, x3, y3, x4, y4, s1, t1, s2, t2, s3, t3, s4, t4) end
function DrawString(left, top, align, height, font, text) end
function DrawStringWidth(height, font, text) return 1 end
function DrawStringCursorIndex(height, font, text, cursorX, cursorY) return 0 end
function StripEscapes(text)
  return text:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","")
end
function GetAsyncCount() return 0 end

-- Search Handles
function NewFileSearch() end

-- General stubs
function SetWindowTitle(title) end
function GetCursorPos() return 0, 0 end
function SetCursorPos(x, y) end
function ShowCursor(doShow) end
function IsKeyDown(keyName) end
function Copy(text) end
function Paste() end
-- Deflate/Inflate are registered as C functions in bridge_init()
-- GetTime is registered as a C function in bridge_init()
function GetScriptPath() return "/pob/src" end
function GetRuntimePath() return "/pob" end
function GetUserPath() return "/pob/user" end
function MakeDir(path)
  -- best-effort mkdir via os
  pcall(function() os.execute("mkdir -p " .. path) end)
end
function RemoveDir(path) end
function SetWorkDir(path) end
function GetWorkDir() return "/pob/src" end
function LaunchSubScript(scriptText, funcList, subList, ...) end
function AbortSubScript(ssID) end
function IsSubScriptRunning(ssID) end
function LoadModule(fileName, ...)
  if not fileName:match("%.lua") then
    fileName = fileName .. ".lua"
  end
  local func, err = loadfile(fileName)
  if func then
    return func(...)
  else
    error("LoadModule() error loading '"..fileName.."': "..err)
  end
end
function PLoadModule(fileName, ...)
  if not fileName:match("%.lua") then
    fileName = fileName .. ".lua"
  end
  local func, err = loadfile(fileName)
  if func then
    return PCall(func, ...)
  else
    error("PLoadModule() error loading '"..fileName.."': "..err)
  end
end
function PCall(func, ...)
  local ret = { pcall(func, ...) }
  if ret[1] then
    table.remove(ret, 1)
    return nil, unpack(ret)
  else
    return ret[2]
  end
end
function ConPrintf(fmt, ...)
  print(string.format(fmt, ...))
end
function ConPrintTable(tbl, noRecurse) end
function ConExecute(cmd) end
function ConClear() end
function SpawnProcess(cmdName, args) end
function OpenURL(url) end
function SetProfiling(isEnabled) end
function Restart() end
function Exit() end
function TakeScreenshot() end

function GetCloudProvider(fullPath) return nil, nil, nil end

local l_require = require
function require(name)
  if name == "lcurl.safe" then return end
  return l_require(name)
end

dofile("Launch.lua")

-- Skip ModCache loading for faster boot
mainObject.continuousIntegrationMode = true

runCallback("OnInit")

-- OnFrame may error on empty builds (e.g. division by zero in CalcDefence).
-- We catch and continue since we just need the modules loaded.
local ok, frameErr = pcall(runCallback, "OnFrame")
if not ok then
  print("OnFrame error (non-fatal): " .. tostring(frameErr))
end

if mainObject.promptMsg then
  print("PoB startup warning: " .. tostring(mainObject.promptMsg))
  mainObject.promptMsg = nil  -- Clear so it doesn't block
end

build = mainObject.main.modes["BUILD"]

-- Helper functions exposed to JS bridge
function newBuild()
  mainObject.main:SetMode("BUILD", false, "pob-web build")
  runCallback("OnFrame")
end
function loadBuildFromXML(xmlText, name)
  mainObject.main:SetMode("BUILD", false, name or "", xmlText)
  runCallback("OnFrame")
end

-- JSON-callable functions for bridge_call_json
local dkjson = require("dkjson")
function pobWebLoadBuild(jsonArg)
  local args = dkjson.decode(jsonArg)
  if not args or not args.xml then
    return dkjson.encode({ error = "missing xml field" })
  end
  local ok, err = pcall(function()
    mainObject.main:SetMode("BUILD", false, args.name or "Imported Build", args.xml)
    runCallback("OnFrame")
  end)
  if ok then
    return dkjson.encode({ success = true })
  else
    return dkjson.encode({ error = tostring(err) })
  end
end

function pobWebGetStats(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ error = "no build loaded" })
  end
  local output = build.calcsTab.mainOutput
  if not output then
    return dkjson.encode({ error = "no calc output" })
  end
  local stats = {}
  -- Extract key stats
  for _, key in ipairs({
    "TotalDPS", "CombinedDPS", "TotalDot", "BleedDPS", "IgniteDPS", "PoisonDPS",
    "Life", "LifeRegen", "LifeLeechRate",
    "EnergyShield", "EnergyShieldRegen", "EnergyShieldLeechRate",
    "Mana", "ManaRegen", "ManaLeechRate",
    "Armour", "Evasion", "Ward",
    "PhysicalDamageReduction",
    "BlockChance", "SpellBlockChance",
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "Speed", "CastSpeed",
    "CritChance", "CritMultiplier",
  }) do
    if output[key] then
      stats[key] = output[key]
    end
  end
  return dkjson.encode(stats)
end
`;

async function initEngine(): Promise<boolean> {
  if (initialized) return true;

  try {
    log("Loading Lua WASM module...");

    const createModule = (await import("../../wasm/lua.mjs")).default;
    Module = await createModule({
      locateFile: (path: string) => {
        if (path.endsWith(".wasm")) return "/wasm/lua.wasm";
        return path;
      },
    });
    const FS = Module.FS;

    bridge_init = Module.cwrap("bridge_init", "number", []);
    bridge_exec = Module.cwrap("bridge_exec", "string", ["string"]);
    bridge_call_json = Module.cwrap("bridge_call_json", "string", ["string", "string"]);

    const result = bridge_init();
    if (result !== 0) throw new Error("bridge_init failed");
    log("Lua WASM initialized.");

    // Apply compatibility shims (bit, jit, lua-utf8)
    log("Applying Lua compatibility shims...");
    const shimErr = bridge_exec(ALL_SHIMS);
    if (shimErr) throw new Error(`Shim error: ${shimErr}`);

    // Load PoB files into MEMFS
    const fileCount = await loadPobFiles(FS);
    log(`Loaded ${fileCount} files into MEMFS.`);

    // Set Lua package.path to find runtime libraries
    const pathErr = bridge_exec(`
      package.path = "/pob/runtime/lua/?.lua;/pob/runtime/lua/?/init.lua;" .. package.path
    `);
    if (pathErr) throw new Error(`Package path error: ${pathErr}`);

    // Change working directory to /pob/src/ so LoadModule finds files
    FS.chdir("/pob/src");

    // Boot PoB via our HeadlessWrapper
    log("Booting PoB engine...");
    const bootErr = bridge_exec(HEADLESS_WRAPPER);
    if (bootErr) throw new Error(`PoB boot failed: ${bootErr}`);

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
