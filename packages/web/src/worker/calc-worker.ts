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
    let text = content as string;

    // Patch dkjson.lua: PoB added sortedkeys() using table.sort as a global,
    // but dkjson sets `local _ENV = nil` which blocks globals in Lua 5.2.
    // Fix: capture table.sort as a local before _ENV is set to nil.
    if (path === "runtime/lua/dkjson.lua") {
      text = text.replace(
        "local concat = table.concat",
        "local concat = table.concat\nlocal sort = table.sort",
      );
      text = text.replace(/table\.sort\(/g, "sort(");
    }

    // Patch CalcDefence.lua: FrostShield division by zero when mitigation is 0.
    // Produces NaN which crashes s_format("%d"). Guard with a zero check.
    if (path === "src/Modules/CalcDefence.lua") {
      text = text.replace(
        'local lifeProtected = output["FrostShieldLife"] / (output["FrostShieldDamageMitigation"] / 100) * (1 - output["FrostShieldDamageMitigation"] / 100)',
        'local lifeProtected = (output["FrostShieldDamageMitigation"] or 0) > 0 and (output["FrostShieldLife"] / (output["FrostShieldDamageMitigation"] / 100) * (1 - output["FrostShieldDamageMitigation"] / 100)) or 0',
      );
    }

    writeFile(FS, `/pob/${path}`, text);
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

-- Helper: collect all allocated node hashes from the spec + granted passives
local function getAllocatedNodeList()
  local nodes = {}
  local seen = {}
  -- Primary source: spec.allocNodes (tree-allocated nodes)
  if build and build.spec and build.spec.allocNodes then
    for hash, _ in pairs(build.spec.allocNodes) do
      if type(hash) == "number" then
        nodes[#nodes + 1] = hash
        seen[hash] = true
      end
    end
  end
  -- Secondary: mainEnv.allocNodes includes granted passives (anoints etc.)
  if build and build.calcsTab and build.calcsTab.mainEnv and build.calcsTab.mainEnv.allocNodes then
    for nodeId, _ in pairs(build.calcsTab.mainEnv.allocNodes) do
      if type(nodeId) == "number" and not seen[nodeId] then
        nodes[#nodes + 1] = nodeId
        seen[nodeId] = true
      end
    end
  end
  return nodes
end

function pobWebLoadBuild(jsonArg)
  local args = dkjson.decode(jsonArg)
  if not args or not args.xml then
    return dkjson.encode({ error = "missing xml field" })
  end
  -- SetMode must succeed
  local setOk, setErr = pcall(function()
    mainObject.main:SetMode("BUILD", false, args.name or "Imported Build", args.xml)
  end)
  if not setOk then
    return dkjson.encode({ error = "SetMode: " .. tostring(setErr) })
  end
  -- OnFrame triggers calcs but may error (e.g. CalcDefence division by zero).
  -- This is non-fatal; partial stats may still be available.
  local frameOk, frameErr = pcall(runCallback, "OnFrame")
  if not frameOk then
    print("OnFrame after build load (non-fatal): " .. tostring(frameErr))
  end
  if mainObject.promptMsg then
    print("PoB warning: " .. tostring(mainObject.promptMsg))
    mainObject.promptMsg = nil
  end
  -- Update build reference
  build = mainObject.main.modes["BUILD"]

  -- Install varControls stub for headless mode (ConfigOptions apply functions use it)
  pcall(installVarControlsStub)

  -- If OnFrame failed, try to explicitly run BuildOutput so we have calc data
  if not frameOk and build and build.calcsTab then
    local calcOk, calcErr = pcall(function()
      build.calcsTab:BuildOutput()
    end)
    if not calcOk then
      print("BuildOutput fallback (non-fatal): " .. tostring(calcErr))
    end
  end

  -- Run an extra OnFrame if calcsTab.mainOutput is still nil
  if build and build.calcsTab and not build.calcsTab.mainOutput then
    local retryOk, retryErr = pcall(runCallback, "OnFrame")
    if not retryOk then
      print("OnFrame retry (non-fatal): " .. tostring(retryErr))
    end
  end

  local allocList = getAllocatedNodeList()
  return dkjson.encode({ success = true, allocatedNodes = allocList })
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
  stats._allocatedNodes = getAllocatedNodeList()
  return dkjson.encode(stats)
end

function pobWebGetSkillsData(jsonArg)
  if not build then
    return dkjson.encode({ error = "no build loaded" })
  end

  -- Auto-select highest DPS skill group
  local skillsTab = build.skillsTab
  if skillsTab and skillsTab.socketGroupList then
    local bestIndex = build.mainSocketGroup or 1
    local bestDps = 0

    for i, group in ipairs(skillsTab.socketGroupList) do
      if group.enabled ~= false then
        build.mainSocketGroup = i
        build.modFlag = true
        build.buildFlag = true
        pcall(runCallback, "OnFrame")
        local o = build.calcsTab and build.calcsTab.mainOutput
        local dps = o and (o.CombinedDPS or o.TotalDPS or 0) or 0
        if dps > bestDps then
          bestDps = dps
          bestIndex = i
        end
      end
    end

    -- Switch to best group for final output
    build.mainSocketGroup = bestIndex
    build.modFlag = true
    build.buildFlag = true
    pcall(runCallback, "OnFrame")
  end

  local output = build.calcsTab and build.calcsTab.mainOutput
  local result = {
    mainSocketGroup = build.mainSocketGroup or 1,
    fullDps = output and (output.FullDPS or output.CombinedDPS) or 0,
    skills = {},   -- per-skill DPS from SkillDPS
    groups = {},   -- socket group metadata
  }

  -- Per-skill DPS from calcFullDPS (already computed at build load)
  if output and output.SkillDPS then
    for _, skill in ipairs(output.SkillDPS) do
      table.insert(result.skills, {
        name = skill.name or "Unknown",
        dps = skill.dps or 0,
        count = skill.count or 1,
        trigger = skill.trigger or nil,
        skillPart = skill.skillPart or nil,
      })
    end
  end

  -- Main skill detailed stats
  if output then
    result.mainSkillStats = {
      TotalDPS = output.TotalDPS or 0,
      CombinedDPS = output.CombinedDPS or 0,
      TotalDot = output.TotalDot or 0,
      BleedDPS = output.BleedDPS or 0,
      IgniteDPS = output.IgniteDPS or 0,
      PoisonDPS = output.PoisonDPS or 0,
      Speed = output.Speed or 0,
      CastSpeed = output.CastSpeed or 0,
      CritChance = output.CritChance or 0,
      CritMultiplier = output.CritMultiplier or 0,
      AverageDamage = output.AverageDamage or 0,
      ManaCost = output.ManaCost or 0,
    }
  end

  -- Socket group metadata for dropdown
  if skillsTab and skillsTab.socketGroupList then
    for i, group in ipairs(skillsTab.socketGroupList) do
      -- Get the active skill name(s) for this group
      local activeNames = {}
      for _, gem in ipairs(group.gemList or {}) do
        if gem.enabled ~= false then
          -- Check support via gemData.grantedEffect.support (PoB's canonical check)
          local grantedEffect = gem.gemData and gem.gemData.grantedEffect or gem.grantedEffect
          local isSupport = grantedEffect and grantedEffect.support
          if not isSupport then
            table.insert(activeNames, gem.nameSpec or (gem.gemData and gem.gemData.name) or gem.name or "")
          end
        end
      end
      table.insert(result.groups, {
        index = i,
        label = group.label or "",
        enabled = group.enabled ~= false,
        slot = group.slot or "",
        activeSkillNames = activeNames,
        includeInFullDPS = group.includeInFullDPS or false,
      })
    end
  end

  return dkjson.encode(result)
end

function pobWebSwitchMainSkill(jsonArg)
  if not build then
    return dkjson.encode({ error = "no build loaded" })
  end
  local args = dkjson.decode(jsonArg)
  if not args or not args.index then
    return dkjson.encode({ error = "missing index" })
  end

  -- Switch main socket group (matching PoB's dropdown handler)
  build.mainSocketGroup = args.index
  build.modFlag = true
  build.buildFlag = true

  -- Run OnFrame to trigger full recalc (not just BuildOutput)
  local ok, err = pcall(runCallback, "OnFrame")
  if not ok then
    print("OnFrame after skill switch (non-fatal): " .. tostring(err))
  end

  -- Return updated main skill stats
  local output = build.calcsTab and build.calcsTab.mainOutput
  if not output then
    return dkjson.encode({ error = "no calc output after switch" })
  end

  local stats = {
    TotalDPS = output.TotalDPS or 0,
    CombinedDPS = output.CombinedDPS or 0,
    TotalDot = output.TotalDot or 0,
    BleedDPS = output.BleedDPS or 0,
    IgniteDPS = output.IgniteDPS or 0,
    PoisonDPS = output.PoisonDPS or 0,
    Speed = output.Speed or 0,
    CastSpeed = output.CastSpeed or 0,
    CritChance = output.CritChance or 0,
    CritMultiplier = output.CritMultiplier or 0,
    AverageDamage = output.AverageDamage or 0,
    ManaCost = output.ManaCost or 0,
  }

  -- Also update SkillDPS
  local skillDps = {}
  if output.SkillDPS then
    for _, skill in ipairs(output.SkillDPS) do
      table.insert(skillDps, {
        name = skill.name or "Unknown",
        dps = skill.dps or 0,
        count = skill.count or 1,
      })
    end
  end

  -- Also compute CalcDisplay for all panels to react
  local displayData = dkjson.decode(pobWebGetCalcDisplay("{}"))

  return dkjson.encode({
    stats = stats,
    fullDps = output.FullDPS or output.CombinedDPS or 0,
    skills = skillDps,
    display = displayData and displayData.sections or {},
  })
end

function pobWebGetDefenceStats(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ error = "no build loaded" })
  end
  local output = build.calcsTab.mainOutput
  if not output then
    return dkjson.encode({ error = "no calc output" })
  end

  local stats = {}
  for _, key in ipairs({
    -- Pool
    "Life", "LifeUnreserved", "LifeLeechRate", "LifeLeechGainRate",
    "EnergyShield", "EnergyShieldLeechRate",
    "Mana", "ManaUnreserved", "ManaLeechRate",
    "Ward",
    -- Regen (correct keys from CalcDefence.lua)
    "LifeRegenRecovery", "NetLifeRegen",
    "EnergyShieldRegenRecovery", "NetEnergyShieldRegen",
    "ManaRegenRecovery", "NetManaRegen",
    -- Mitigation
    "Armour", "Evasion", "PhysicalDamageReduction", "PhysicalResist",
    "EvadeChance", "MeleeEvadeChance",
    "BlockChance", "SpellBlockChance",
    "EffectiveBlockChance", "EffectiveSpellBlockChance",
    "AttackDodgeChance", "SpellDodgeChance",
    -- Resistances
    "FireResist", "ColdResist", "LightningResist", "ChaosResist",
    "FireResistTotal", "ColdResistTotal", "LightningResistTotal", "ChaosResistTotal",
    "FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap", "ChaosResistOverCap",
    -- EHP / max hit
    "TotalEHP", "TotalNumberOfHits",
    "SecondMinimalMaximumHitTaken",
    "PhysicalMaximumHitTaken", "FireMaximumHitTaken",
    "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
    -- Misc
    "MovementSpeedMod", "EffectiveMovementSpeedMod",
    -- ES recharge
    "EnergyShieldRecharge",
  }) do
    if output[key] then
      stats[key] = output[key]
    end
  end

  -- Debug: dump all numeric output keys so we can see what's available
  local debugKeys = {}
  for k, v in pairs(output) do
    if type(v) == "number" and v ~= 0 then
      debugKeys[#debugKeys + 1] = k
    end
  end
  table.sort(debugKeys)
  stats._availableKeys = debugKeys

  return dkjson.encode(stats)
end

-- data module reference (for powerStatList)
local _dataRef = nil
function getDataRef()
  if _dataRef then return _dataRef end
  -- data is a global set by Launch.lua / Data.lua
  if data then
    _dataRef = data
    return data
  end
  return nil
end

-- Allocate a node using PoB's PassiveSpec:AllocNode
function pobWebAllocNode(jsonArg)
  if not build or not build.spec then
    return dkjson.encode({ error = "no build loaded" })
  end
  local args = dkjson.decode(jsonArg)
  if not args or not args.nodeId then
    return dkjson.encode({ error = "missing nodeId" })
  end

  local node = build.spec.nodes[args.nodeId]
  if not node then
    return dkjson.encode({ error = "node not found: " .. tostring(args.nodeId) })
  end

  if node.alloc then
    return dkjson.encode({ success = true, allocatedNodes = getAllocatedNodeList() })
  end

  -- PoB handles pathing, path allocation, and dependencies
  local allocOk, allocErr = pcall(function() build.spec:AllocNode(node) end)
  if not allocOk then
    return dkjson.encode({ error = "AllocNode failed: " .. tostring(allocErr) })
  end

  -- Trigger recalculation
  build.buildFlag = true
  local ok, err = pcall(runCallback, "OnFrame")
  if not ok then
    print("OnFrame after alloc (non-fatal): " .. tostring(err))
  end

  local displayData = dkjson.decode(pobWebGetCalcDisplay("{}"))
  return dkjson.encode({ success = true, allocatedNodes = getAllocatedNodeList(), display = displayData and displayData.sections or {} })
end

-- Export current build as XML string using PoB's SaveDB
function pobWebExportBuild(jsonArg)
  if not build then
    return dkjson.encode({ error = "no build loaded" })
  end
  local ok, xml = pcall(function() return build:SaveDB("code") end)
  if not ok then
    return dkjson.encode({ error = "SaveDB failed: " .. tostring(xml) })
  end
  return dkjson.encode({ xml = xml })
end

-- Deallocate a node using PoB's PassiveSpec:DeallocNode
function pobWebDeallocNode(jsonArg)
  if not build or not build.spec then
    return dkjson.encode({ error = "no build loaded" })
  end
  local args = dkjson.decode(jsonArg)
  if not args or not args.nodeId then
    return dkjson.encode({ error = "missing nodeId" })
  end

  local node = build.spec.nodes[args.nodeId]
  if not node then
    return dkjson.encode({ error = "node not found: " .. tostring(args.nodeId) })
  end

  if not node.alloc then
    return dkjson.encode({ success = true, allocatedNodes = getAllocatedNodeList() })
  end

  -- PoB handles orphan removal via node.depends
  local deallocOk, deallocErr = pcall(function() build.spec:DeallocNode(node) end)
  if not deallocOk then
    return dkjson.encode({ error = "DeallocNode failed: " .. tostring(deallocErr) })
  end

  -- Trigger recalculation
  build.buildFlag = true
  local ok, err = pcall(runCallback, "OnFrame")
  if not ok then
    print("OnFrame after dealloc (non-fatal): " .. tostring(err))
  end

  local displayData = dkjson.decode(pobWebGetCalcDisplay("{}"))
  return dkjson.encode({ success = true, allocatedNodes = getAllocatedNodeList(), display = displayData and displayData.sections or {} })
end

-- Calculate stat impact of adding/removing a node using PoB's own CalcsTab methods.
-- For unallocated nodes: includes the full path (node.path) needed to reach the node.
-- For allocated nodes: includes all dependents (node.depends) that would be orphaned.
-- Uses data.powerStatList for stat selection and CalcsTab:CalculatePowerStat for deltas.
function pobWebCalcNodeImpact(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ error = "no build loaded" })
  end
  local args = dkjson.decode(jsonArg)
  if not args or not args.nodeId then
    return dkjson.encode({ error = "missing nodeId" })
  end

  local node = build.spec.nodes[args.nodeId]
  if not node then
    return dkjson.encode({ error = "node not found: " .. tostring(args.nodeId) })
  end

  -- Use PoB's cached calculator from CalcsTab (populated by BuildOutput)
  -- If BuildOutput crashed before setting miscCalculator (e.g. CalcDefence NaN), init it now
  if not build.calcsTab.miscCalculator then
    local initOk, res = pcall(function()
      build.calcsTab.miscCalculator = { build.calcsTab.calcs.getMiscCalculator(build) }
    end)
    if not initOk then
      return dkjson.encode({ error = "getMiscCalculator init failed: " .. tostring(res) })
    end
  end
  local miscOk, calcFunc, calcBase = pcall(build.calcsTab.GetMiscCalculator, build.calcsTab)
  if not miscOk then
    return dkjson.encode({ error = "GetMiscCalculator failed: " .. tostring(calcFunc) })
  end

  local pathCount = 1
  local pathNodes = {}
  local calcOk, output

  local singleNode = args.singleNode

  if not node.alloc then
    -- UNALLOCATED: include node.path (all nodes from allocated tree to this node)
    local addNodes = {}
    if not singleNode and node.path and #node.path > 0 then
      for _, n in ipairs(node.path) do
        addNodes[n] = true
        pathNodes[#pathNodes + 1] = n.id or 0
      end
      pathCount = #node.path
    else
      addNodes[node] = true
      pathNodes[1] = args.nodeId
    end
    calcOk, output = pcall(calcFunc, { addNodes = addNodes }, true)
  else
    -- ALLOCATED: include node.depends (all nodes that would become orphaned)
    local removeNodes = {}
    if not singleNode and node.depends and #node.depends > 0 then
      for _, n in ipairs(node.depends) do
        removeNodes[n] = true
        pathNodes[#pathNodes + 1] = n.id or 0
      end
      pathCount = #node.depends
    else
      removeNodes[node] = true
      pathNodes[1] = args.nodeId
    end
    calcOk, output = pcall(calcFunc, { removeNodes = removeNodes }, true)
  end

  if not calcOk then
    return dkjson.encode({ error = "calc failed: " .. tostring(output) })
  end

  -- Use PoB's data.powerStatList and CalcsTab:CalculatePowerStat for each stat
  local d = getDataRef()
  local deltas = {}

  if d and d.powerStatList then
    for _, entry in ipairs(d.powerStatList) do
      if entry.stat and not entry.ignoreForNodes then
        local ok, delta = pcall(build.calcsTab.CalculatePowerStat, build.calcsTab, entry, output, calcBase)
        if ok and type(delta) == "number" and math.abs(delta) > 0.01 then
          deltas[entry.stat] = { value = delta, label = entry.label }
        end
      end
    end
  end

  return dkjson.encode({ deltas = deltas, pathCount = pathCount, pathNodes = pathNodes })
end

-- Calculate combined offence/defence power for all unallocated nodes (heatmap).
-- Uses PoB's CalculateCombinedOffDefStat for each node, cached by modKey.
-- Returns { nodes = { [hash] = { off, def } }, max = { off, def } }
function pobWebGetNodePower(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ error = "no build loaded" })
  end

  -- Ensure miscCalculator exists
  if not build.calcsTab.miscCalculator then
    local initOk, res = pcall(function()
      build.calcsTab.miscCalculator = { build.calcsTab.calcs.getMiscCalculator(build) }
    end)
    if not initOk then
      return dkjson.encode({ error = "getMiscCalculator init failed: " .. tostring(res) })
    end
  end
  local miscOk, calcFunc, calcBase = pcall(build.calcsTab.GetMiscCalculator, build.calcsTab)
  if not miscOk then
    return dkjson.encode({ error = "GetMiscCalculator failed: " .. tostring(calcFunc) })
  end

  local cache = {}
  local result = {}
  local maxOff = 0
  local maxDef = 0

  -- Count eligible nodes first
  local eligible = {}
  for nodeId, node in pairs(build.spec.nodes) do
    if not node.alloc and node.modKey and node.modKey ~= "" then
      if node.type ~= "ClassStart" and node.type ~= "AscendClassStart" and not node.isOnlyImage then
        eligible[#eligible + 1] = { id = nodeId, node = node }
      end
    end
  end

  local total = #eligible

  for i, entry in ipairs(eligible) do
    local nodeId = entry.id
    local node = entry.node
    local output = cache[node.modKey]
    if not output then
      local ok, res = pcall(calcFunc, { addNodes = { [node] = true } }, true)
      if ok then
        cache[node.modKey] = res
        output = res
      end
    end
    if output then
      local ok, off, def = pcall(build.calcsTab.CalculateCombinedOffDefStat, build.calcsTab, output, calcBase)
      if ok and type(off) == "number" and type(def) == "number" then
        local h = node.id or nodeId
        result[tostring(h)] = { off = off, def = def }
        if off > maxOff then maxOff = off end
        if def > maxDef then maxDef = def end
      end
    end
  end

  -- Build top nodes list sorted by (off + def) / pathDist
  -- Group normal passives by modKey (identical mods), skip ascendancy nodes
  local groups = {}  -- modKey -> { best entry, count }
  for hashStr, power in pairs(result) do
    local node = build.spec.nodes[tonumber(hashStr)]
    if node and power.off + power.def > 0 and not node.ascendancyName then
      local dist = node.pathDist or 1000
      local score = (math.max(power.off, 0) + math.max(power.def, 0)) / math.max(dist, 1)
      local isSmall = node.type ~= "Notable" and node.type ~= "Keystone" and node.type ~= "JewelSocket"
      local groupKey = isSmall and (node.modKey or hashStr) or hashStr

      local existing = groups[groupKey]
      if not existing then
        groups[groupKey] = {
          hash = tonumber(hashStr),
          name = node.dn or "?",
          type = node.type or "Normal",
          off = power.off,
          def = power.def,
          pathDist = dist,
          score = score,
          count = 1,
        }
      else
        existing.count = existing.count + 1
        -- Keep the one with best score (shortest path)
        if score > existing.score then
          existing.hash = tonumber(hashStr)
          existing.name = node.dn or "?"
          existing.pathDist = dist
          existing.score = score
          existing.off = power.off
          existing.def = power.def
        end
      end
    end
  end

  local ranked = {}
  for _, entry in pairs(groups) do
    ranked[#ranked + 1] = entry
  end
  table.sort(ranked, function(a, b) return a.score > b.score end)

  local topNodes = {}
  for i = 1, math.min(30, #ranked) do
    local r = ranked[i]
    topNodes[i] = { hash = r.hash, name = r.name, type = r.type, off = r.off, def = r.def, pathDist = r.pathDist, count = r.count }
  end

  return dkjson.encode({ nodes = result, max = { off = maxOff, def = maxDef }, topNodes = topNodes })
end

-- Get PoB sidebar display stats (mirrors BuildDisplayStats.lua)
-- Returns groups of { label, value, color? } separated by spacers
function pobWebGetDisplayStats(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ groups = {} })
  end
  local o = build.calcsTab.mainOutput
  if not o then
    return dkjson.encode({ groups = {} })
  end

  local function fmt_d(v) return string.format("%d", v) end
  local function fmt_1f(v) return string.format("%.1f", v) end
  local function fmt_2f(v) return string.format("%.2f", v) end
  local function fmt_3f(v) return string.format("%.3f", v) end
  local function fmt_0f(v) return string.format("%.0f", v) end
  local function fmt_pct_d(v) return string.format("%d%%", v) end
  local function fmt_pct_1f(v) return string.format("%.1f%%", v) end
  local function fmt_pct_2f(v) return string.format("%.2f%%", v) end
  local function fmt_pct_0f(v) return string.format("%.0f%%", v) end
  local function fmt_mod_1f(v) return string.format("%+.1f%%", (v - 1) * 100) end
  local function fmt_2fs(v) return string.format("%.2fs", v) end
  local function fmt_3fs(v) return string.format("%.3fs", v) end
  local function fmt_1fm(v) return string.format("%.1fm", v) end
  local function fmt_dpct(v) return string.format("%d%%", v * 100) end

  -- Color codes (hex)
  local LIFE = "#c51e1e"
  local MANA = "#4040ff"
  local ES = "#7070d0"
  local SPIRIT = "#60a060"
  local FIRE = "#b97123"
  local COLD = "#3f6db3"
  local LIGHT = "#adaa47"
  local CHAOS = "#d02090"
  local EVASION = "#33aa33"
  local STRENGTH = "#c83030"
  local DEXTERITY = "#30b060"
  local INTELLIGENCE = "#3070d0"
  local CURRENCY = "#e8d291"
  local RAGE = "#be5728"
  local RARE = "#ff7"

  -- Helper: add stat to current group if value is truthy
  local groups = {}
  local cur = {}
  local function sep()
    if #cur > 0 then groups[#groups + 1] = cur; cur = {} end
  end
  local function add(label, val, color)
    if val and val ~= "" then
      cur[#cur + 1] = { label = label, value = val, color = color }
    end
  end
  local function v(key) return o[key] or 0 end

  -- === Group 1: Offence ===
  if v("ActiveMinionLimit") > 0 then add("Active Minion Limit", fmt_d(v("ActiveMinionLimit"))) end
  if v("AverageHit") > 0 then add("Average Hit", fmt_1f(v("AverageHit"))) end
  if v("AverageDamage") > 0 then add("Average Damage", fmt_1f(v("AverageDamage"))) end
  if v("AverageBurstDamage") > 0 and v("AverageBurstHits") > 1 then add("Average Burst Damage", fmt_1f(v("AverageBurstDamage"))) end
  if v("Speed") > 0 and (v("TriggerTime") or 0) == 0 and not o.ChannelTime then
    if o.mainSkill and o.mainSkill.skillFlags and o.mainSkill.skillFlags.spell then
      add("Cast Rate", fmt_2f(v("Speed")))
    else
      add("Attack Rate", fmt_2f(v("Speed")))
    end
  end
  if (v("TriggerTime") or 0) ~= 0 and v("Speed") > 0 then add("Effective Trigger Rate", fmt_2f(v("Speed"))) end
  if v("WarcryCastTime") > 0 then add("Cast Time", fmt_2fs(v("WarcryCastTime"))) end
  if o.ChannelTime and not o.TriggerTime then add("Channel Time", fmt_2fs(v("ChannelTime"))) end
  if v("HitSpeed") > 0 and not o.TriggerTime then add("Hit Rate", fmt_2f(v("HitSpeed"))) end
  if v("ChannelTimeToTrigger") > 0 then add("Channel Time", fmt_2fs(v("ChannelTimeToTrigger"))) end
  if v("TrapThrowingTime") > 0 then add("Trap Throwing Time", fmt_2fs(v("TrapThrowingTime"))) end
  if v("TrapCooldown") > 0 then add("Trap Cooldown", fmt_3fs(v("TrapCooldown"))) end
  if v("MineLayingTime") > 0 then add("Mine Throwing Time", fmt_2fs(v("MineLayingTime"))) end
  if v("TrapThrowCount") > 0 then add("Avg. Traps per Throw", fmt_2f(v("TrapThrowCount"))) end
  if v("MineThrowCount") > 0 then add("Avg. Mines per Throw", fmt_2f(v("MineThrowCount"))) end
  if v("TotemPlacementTime") > 0 and not o.TriggerTime then add("Totem Placement Time", fmt_2fs(v("TotemPlacementTime"))) end
  if v("FiringRate") > 0 then add("Firing Rate", fmt_2f(v("FiringRate"))) end
  if v("ReloadTime") > 0 then add("Reload Time", fmt_2fs(v("ReloadTime"))) end
  if v("PreEffectiveCritChance") > 0 then add("Crit Chance", fmt_pct_2f(v("PreEffectiveCritChance"))) end
  if v("CritChance") > 0 and v("CritChance") ~= v("PreEffectiveCritChance") then add("Effective Crit Chance", fmt_pct_2f(v("CritChance"))) end
  if v("CritMultiplier") > 0 and v("CritChance") > 0 then add("Crit Multiplier", fmt_d(v("CritMultiplier") * 100) .. "%") end
  if v("HitChance") > 0 then add("Hit Chance", fmt_pct_0f(v("HitChance"))) end
  if v("TotalDPS") > 0 then add("Hit DPS", fmt_1f(v("TotalDPS"))) end
  if v("TotalDot") > 0 then add("DoT DPS", fmt_1f(v("TotalDot"))) end
  if v("WithDotDPS") > 0 and v("WithDotDPS") ~= v("TotalDPS") and v("PoisonDPS") == 0 and v("IgniteDPS") == 0 and v("BleedDPS") == 0 then
    add("Total DPS inc. DoT", fmt_1f(v("WithDotDPS")))
  end
  if v("BleedDPS") > 0 then add("Bleed DPS", fmt_1f(v("BleedDPS"))) end
  if v("IgniteDPS") > 0 then add("Ignite DPS", fmt_1f(v("IgniteDPS"))) end
  if v("BurningGroundDPS") > 0 then add("Burning Ground DPS", fmt_1f(v("BurningGroundDPS"))) end
  if v("PoisonDPS") > 0 then add("Poison DPS", fmt_1f(v("PoisonDPS"))) end
  if v("CausticGroundDPS") > 0 then add("Caustic Ground DPS", fmt_1f(v("CausticGroundDPS"))) end
  if v("DecayDPS") > 0 then add("Decay DPS", fmt_1f(v("DecayDPS"))) end
  if v("TotalDotDPS") > 0 and v("TotalDotDPS") ~= v("TotalDot") and v("TotalDotDPS") ~= v("IgniteDPS") and v("TotalDotDPS") ~= v("BleedDPS") and v("TotalDotDPS") ~= v("PoisonDPS") then
    add("Total DoT DPS", fmt_1f(v("TotalDotDPS")))
  end
  if v("ImpaleDPS") > 0 then add("Impale DPS", fmt_1f(v("ImpaleDPS"))) end
  if v("CullingDPS") > 0 then add("Culling DPS", fmt_1f(v("CullingDPS"))) end
  if v("CombinedDPS") > 0 and v("CombinedDPS") ~= (v("TotalDPS") + v("TotalDot")) then
    add("Combined DPS", fmt_1f(v("CombinedDPS")))
  end
  if v("ExplodeChance") > 0 then add("Total Explode Chance", fmt_pct_0f(v("ExplodeChance"))) end
  if v("Cooldown") > 0 then add("Skill Cooldown", fmt_3fs(v("Cooldown"))) end
  if v("SealCooldown") > 0 then add("Seal Gain Frequency", fmt_2fs(v("SealCooldown"))) end
  if v("SealMax") > 0 then add("Max Number of Seals", fmt_d(v("SealMax"))) end
  if v("AreaOfEffectRadiusMetres") > 0 then add("AoE Radius", fmt_1fm(v("AreaOfEffectRadiusMetres"))) end
  if v("ManaCost") > 0 and o.ManaHasCost then add("Mana Cost", fmt_d(v("ManaCost")), MANA) end
  if v("ManaPerSecondCost") > 0 and o.ManaPerSecondHasCost then add("Mana Cost per second", fmt_2f(v("ManaPerSecondCost")), MANA) end
  if v("LifeCost") > 0 and o.LifeHasCost then add("Life Cost", fmt_d(v("LifeCost")), LIFE) end
  if v("LifePerSecondCost") > 0 and o.LifePerSecondHasCost then add("Life Cost per second", fmt_2f(v("LifePerSecondCost")), LIFE) end
  if v("ESCost") > 0 and o.ESHasCost then add("Energy Shield Cost", fmt_d(v("ESCost")), ES) end
  sep()

  -- === Group 2: Attributes ===
  if v("Str") > 0 then add("Strength", fmt_d(v("Str")), STRENGTH) end
  if v("Dex") > 0 then add("Dexterity", fmt_d(v("Dex")), DEXTERITY) end
  if v("Int") > 0 then add("Intelligence", fmt_d(v("Int")), INTELLIGENCE) end
  sep()

  -- === Group 3: Devotion/Tribute ===
  if v("Devotion") > 0 then add("Devotion", fmt_d(v("Devotion")), RARE) end
  if v("Tribute") > 0 then add("Tribute", fmt_d(v("Tribute")), RARE) end
  sep()

  -- === Group 4: EHP ===
  if v("TotalEHP") > 0 then add("Effective Hit Pool", fmt_0f(v("TotalEHP"))) end
  if v("PhysicalMaximumHitTaken") > 0 then add("Phys Max Hit", fmt_0f(v("PhysicalMaximumHitTaken"))) end
  if v("LightningMaximumHitTaken") > 0 then
    if v("LightningMaximumHitTaken") == v("ColdMaximumHitTaken") and v("LightningMaximumHitTaken") == v("FireMaximumHitTaken") then
      add("Elemental Max Hit", fmt_0f(v("LightningMaximumHitTaken")), LIGHT)
    else
      add("Fire Max Hit", fmt_0f(v("FireMaximumHitTaken")), FIRE)
      add("Cold Max Hit", fmt_0f(v("ColdMaximumHitTaken")), COLD)
      add("Lightning Max Hit", fmt_0f(v("LightningMaximumHitTaken")), LIGHT)
    end
  end
  if v("ChaosMaximumHitTaken") > 0 then add("Chaos Max Hit", fmt_0f(v("ChaosMaximumHitTaken")), CHAOS) end
  sep()

  -- === Group 5: Life ===
  if v("Life") > 0 then add("Total Life", fmt_d(v("Life")), LIFE) end
  if v("LifeUnreserved") > 0 and v("LifeUnreserved") < v("Life") then add("Unreserved Life", fmt_d(v("LifeUnreserved")), LIFE) end
  if v("LifeUnreservedPercent") > 0 and v("LifeUnreservedPercent") < 100 then add("Unreserved Life", fmt_pct_d(v("LifeUnreservedPercent")), LIFE) end
  if v("LifeRegenRecovery") ~= 0 then
    local lbl = v("LifeRecovery") > 0 and "Life Recovery" or "Life Regen"
    add(lbl, fmt_1f(v("LifeRegenRecovery")), LIFE)
  end
  if v("LifeLeechGainRate") > 0 then add("Life Leech/On Hit Rate", fmt_1f(v("LifeLeechGainRate")), LIFE) end
  if v("LifeLeechGainPerHit") > 0 then add("Life Leech/Gain per Hit", fmt_1f(v("LifeLeechGainPerHit")), LIFE) end
  sep()

  -- === Group 6: Mana ===
  if v("Mana") > 0 then add("Total Mana", fmt_d(v("Mana")), MANA) end
  if v("ManaUnreserved") > 0 and v("ManaUnreserved") < v("Mana") then add("Unreserved Mana", fmt_d(v("ManaUnreserved")), MANA) end
  if v("ManaUnreservedPercent") > 0 and v("ManaUnreservedPercent") < 100 then add("Unreserved Mana", fmt_pct_d(v("ManaUnreservedPercent")), MANA) end
  if v("ManaRegenRecovery") ~= 0 then
    local lbl = v("ManaRecovery") > 0 and "Mana Recovery" or "Mana Regen"
    add(lbl, fmt_1f(v("ManaRegenRecovery")), MANA)
  end
  if v("ManaLeechGainRate") > 0 then add("Mana Leech/On Hit Rate", fmt_1f(v("ManaLeechGainRate")), MANA) end
  sep()

  -- === Group 7: Spirit ===
  if v("Spirit") > 0 then add("Total Spirit", fmt_d(v("Spirit")), SPIRIT) end
  if v("SpiritUnreserved") > 0 and v("SpiritUnreserved") < v("Spirit") then add("Unreserved Spirit", fmt_d(v("SpiritUnreserved")), SPIRIT) end
  sep()

  -- === Group 8: Energy Shield ===
  if v("EnergyShield") > 0 then add("Energy Shield", fmt_d(v("EnergyShield")), ES) end
  if v("EnergyShieldRegenRecovery") ~= 0 then
    local lbl = v("EnergyShieldRecovery") > 0 and "ES Recovery" or "ES Regen"
    add(lbl, fmt_1f(v("EnergyShieldRegenRecovery")), ES)
  end
  if v("EnergyShieldLeechGainRate") > 0 then add("ES Leech/On Hit Rate", fmt_1f(v("EnergyShieldLeechGainRate")), ES) end
  sep()

  -- === Group 9: Rage ===
  if v("Rage") > 0 then add("Rage", fmt_d(v("Rage")), RAGE) end
  if v("RageRegenRecovery") > 0 then add("Rage Regen", fmt_1f(v("RageRegenRecovery")), RAGE) end
  sep()

  -- === Group 10: Net Recovery ===
  if v("TotalBuildDegen") > 0 then add("Total Degen", fmt_1f(v("TotalBuildDegen"))) end
  if v("TotalNetRegen") ~= 0 then add("Total Net Recovery", string.format("%+.1f", v("TotalNetRegen"))) end
  if v("NetLifeRegen") ~= 0 then add("Net Life Recovery", string.format("%+.1f", v("NetLifeRegen")), LIFE) end
  if v("NetManaRegen") ~= 0 then add("Net Mana Recovery", string.format("%+.1f", v("NetManaRegen")), MANA) end
  if v("NetEnergyShieldRegen") ~= 0 then add("Net ES Recovery", string.format("%+.1f", v("NetEnergyShieldRegen")), ES) end
  sep()

  -- === Group 11: Evasion ===
  if v("Evasion") > 0 then add("Evasion Rating", fmt_d(v("Evasion")), EVASION) end
  if v("EvadeChance") > 0 then add("Evade Chance", fmt_pct_d(v("EvadeChance")), EVASION) end
  if v("MeleeEvadeChance") > 0 then add("Melee Evade Chance", fmt_pct_d(v("MeleeEvadeChance")), EVASION) end
  if v("ProjectileEvadeChance") > 0 then add("Projectile Evade Chance", fmt_pct_d(v("ProjectileEvadeChance")), EVASION) end
  if v("SpellEvadeChance") > 0 then add("Spell Evade Chance", fmt_pct_d(v("SpellEvadeChance")), EVASION) end
  if v("SpellProjectileEvadeChance") > 0 then add("Spell Proj. Evade Chance", fmt_pct_d(v("SpellProjectileEvadeChance")), EVASION) end
  if v("DeflectionRating") > 0 then add("Deflection Rating", fmt_d(v("DeflectionRating")), EVASION) end
  if v("DeflectChance") > 0 then add("Deflect Chance", fmt_pct_d(v("DeflectChance")), EVASION) end
  sep()

  -- === Group 12: Armour ===
  if v("Armour") > 0 then add("Armour", fmt_d(v("Armour"))) end
  add("Phys. Damage Reduction", fmt_pct_d(v("PhysicalDamageReduction")))
  sep()

  -- === Group 13: Block/Dodge/Suppression ===
  if v("EffectiveBlockChance") > 0 then add("Block Chance", fmt_pct_d(v("EffectiveBlockChance"))) end
  if v("EffectiveSpellBlockChance") > 0 then add("Spell Block Chance", fmt_pct_d(v("EffectiveSpellBlockChance"))) end
  if v("AttackDodgeChance") > 0 then add("Attack Dodge Chance", fmt_pct_d(v("AttackDodgeChance"))) end
  if v("SpellDodgeChance") > 0 then add("Spell Dodge Chance", fmt_pct_d(v("SpellDodgeChance"))) end
  if v("EffectiveSpellSuppressionChance") > 0 then add("Spell Suppression Chance", fmt_pct_d(v("EffectiveSpellSuppressionChance"))) end
  sep()

  -- === Group 14: Resistances (always show) ===
  local function resistStr(val, overcap)
    if overcap and overcap > 0 then
      return string.format("%d%% (+%d%%)", val, overcap)
    end
    return string.format("%d%%", val)
  end
  add("Fire Resistance", resistStr(v("FireResist"), v("FireResistOverCap")), FIRE)
  add("Cold Resistance", resistStr(v("ColdResist"), v("ColdResistOverCap")), COLD)
  add("Lightning Resistance", resistStr(v("LightningResist"), v("LightningResistOverCap")), LIGHT)
  if not o.ChaosInoculation then
    add("Chaos Resistance", resistStr(v("ChaosResist"), v("ChaosResistOverCap")), CHAOS)
  else
    add("Chaos Resistance", "Immune", CHAOS)
  end
  sep()

  -- === Group 15: Movement Speed (always show) ===
  if v("EffectiveMovementSpeedMod") ~= 0 then
    add("Movement Speed Modifier", fmt_mod_1f(v("EffectiveMovementSpeedMod")))
  end
  sep()

  -- === Group 16: Full DPS ===
  if v("FullDPS") > 0 then add("Full DPS", fmt_1f(v("FullDPS")), CURRENCY) end

  -- Close final group
  sep()

  return dkjson.encode({ groups = groups })
end

-- Get structured calc display using PoB's CalcSections and CheckFlag visibility
function pobWebGetCalcDisplay(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ sections = {} })
  end
  -- Ensure calcsEnv is populated (getSkillsData's OnFrame loop may leave it nil)
  local skipCheckFlag = false
  if not build.calcsTab.calcsEnv then
    -- Try BuildOutput (runs MAIN then CALCS mode)
    pcall(function() build.calcsTab:BuildOutput() end)
    if not build.calcsTab.calcsEnv then
      -- CALCS mode crashed (e.g. CalcDefence.lua NaN) — skip section filtering
      skipCheckFlag = true
    end
  end
  local output = build.calcsTab.mainOutput
  if not output then
    return dkjson.encode({ sections = {} })
  end
  if not build.calcsTab.sectionList then
    return dkjson.encode({ sections = {} })
  end

  local sections = {}

  for _, section in ipairs(build.calcsTab.sectionList) do
    local sVisible = true
    if not skipCheckFlag then
      local sOk, sv = pcall(build.calcsTab.CheckFlag, build.calcsTab, section)
      sVisible = sOk and sv
    end
    if sVisible then
      local sData = { id = section.id, group = section.group, subsections = {} }

      -- subSection[i] = { label = "...", data = { flag = "...", [1]=row, [2]=row, ... } }
      for _, sub in ipairs(section.subSection) do
        local subData = { label = sub.label or "", stats = {} }
        local dataBlock = sub.data
        if not dataBlock then goto continue_sub end

        if not skipCheckFlag then
          local subOk, subVisible = pcall(build.calcsTab.CheckFlag, build.calcsTab, dataBlock)
          if not (subOk and subVisible) then goto continue_sub end
        end

        for _, rowData in ipairs(dataBlock) do
          local rVisible = true
          if not skipCheckFlag then
            local rOk, rv = pcall(build.calcsTab.CheckFlag, build.calcsTab, rowData)
            rVisible = rOk and rv
          end
          if rVisible and rowData.label then
            -- Strip PoB color codes (^7, ^xRRGGBB)
            local cleanLabel = rowData.label:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","")
            local row = { label = cleanLabel, values = {} }
            for _, colData in ipairs(rowData) do
              if type(colData) == "table" and colData.format then
                for decimals, key in colData.format:gmatch("{(%d+):output:([^}]+)}") do
                  local val = output[key]
                  if val and type(val) == "number" then
                    -- Filter out baseline/default values
                    local isDefault = false
                    if val == 0 then isDefault = true
                    elseif key:match("Effect$") and math.abs(val - 100) < 0.01 then isDefault = true
                    elseif (key:match("Mult$") or key:match("More$")) and math.abs(val - 1) < 0.01 then isDefault = true
                    end
                    if not isDefault then
                      row.values[#row.values + 1] = {
                        key = key, value = val, decimals = tonumber(decimals)
                      }
                    end
                  end
                end
              end
            end
            if #row.values > 0 then
              subData.stats[#subData.stats + 1] = row
            end
          end
        end

        if #subData.stats > 0 then
          sData.subsections[#sData.subsections + 1] = subData
        end
        ::continue_sub::
      end

      if #sData.subsections > 0 then
        sections[#sections + 1] = sData
      end
    end
  end
  return dkjson.encode({ sections = sections })
end

-- Get weapon set node data (nodes with allocMode 1 or 2)
function pobWebGetWeaponSetNodes(jsonArg)
  local result = {}
  if build and build.spec and build.spec.allocNodes then
    for hash, node in pairs(build.spec.allocNodes) do
      if type(hash) == "number" and node.allocMode and node.allocMode ~= 0 then
        result[tostring(hash)] = node.allocMode
      end
    end
  end
  return dkjson.encode(result)
end

-- Get equipped items data from PoB's ItemsTab
function pobWebGetItemsData(jsonArg)
  if not build or not build.itemsTab then
    return dkjson.encode({ items = {} })
  end

  local result = {}
  local slots = build.itemsTab.slots
  if not slots then
    return dkjson.encode({ items = {} })
  end

  -- Check if build has CanUseBondedModifiers (Shaman ascendancy notable)
  local hasBonded = false
  if build.calcsTab and build.calcsTab.mainEnv and build.calcsTab.mainEnv.modDB then
    local cond = build.calcsTab.mainEnv.modDB.conditions
    if cond and cond["CanUseBondedModifiers"] then
      hasBonded = true
    end
  end

  local catalystTypes = {
    "Life Modifiers", "Mana Modifiers", "Defense Modifiers", "Physical",
    "Fire Modifiers", "Cold Modifiers", "Lightning Modifiers", "Chaos Modifiers",
    "Attack Modifiers", "Caster Modifiers", "Speed Modifiers", "Attribute Modifiers"
  }

  local function cleanLine(line)
    return line:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","")
  end

  local function collectMods(modLines, skipBonded)
    if not modLines then return {} end
    local mods = {}
    for _, mod in ipairs(modLines) do
      if mod.line and mod.line ~= "" then
        if skipBonded and mod.bonded then
          -- skip bonded mods when build doesn't have the condition
        else
          local m = { line = cleanLine(mod.line) }
          if mod.crafted then m.crafted = true end
          if mod.fractured then m.fractured = true end
          if mod.desecrated then m.desecrated = true end
          if mod.mutated then m.mutated = true end
          if mod.bonded then m.bonded = true end
          mods[#mods + 1] = m
        end
      end
    end
    return mods
  end

  for slotName, slot in pairs(slots) do
    if slot.selItemId and slot.selItemId > 0 then
      local item = build.itemsTab.items[slot.selItemId]
      if item then
        local base = item.base
        local itemData = {
          slot = slotName,
          name = item.title or item.name or "",
          baseName = item.baseName or (base and base.name) or "",
          itemType = (base and base.weapon and build.data.weaponTypeInfo[base.type] and build.data.weaponTypeInfo[base.type].label) or (base and base.type) or "",
          rarity = item.rarity or "NORMAL",
          quality = item.quality or 0,
          levelReq = item.levelReq or 0,
          corrupted = item.corrupted or false,
          doubleCorrupted = item.doubleCorrupted or false,
          mirrored = item.mirrored or false,
          fractured = item.fractured or false,
          influences = {},
          implicitMods = collectMods(item.implicitModLines),
          enchantMods = collectMods(item.enchantModLines),
          runeMods = collectMods(item.runeModLines, not hasBonded),
          explicitMods = collectMods(item.explicitModLines),
        }

        -- Catalyst quality (jewelry)
        if item.catalyst and item.catalyst > 0 and item.catalystQuality and item.catalystQuality > 0 then
          itemData.catalystType = catalystTypes[item.catalyst]
          itemData.catalystQuality = item.catalystQuality
        end

        -- Influences
        if item.desecrated then itemData.influences[#itemData.influences + 1] = "Desecrated" end
        if item.mutated then itemData.influences[#itemData.influences + 1] = "Mutated" end

        -- Weapon stats
        if base and base.weapon and item.weaponData then
          local wd = item.weaponData[slot.slotNum or 1]
          if wd then
            itemData.weapon = {
              physMin = wd.PhysicalMin, physMax = wd.PhysicalMax, physDps = wd.PhysicalDPS,
              fireMin = wd.FireMin, fireMax = wd.FireMax, fireDps = wd.FireDPS,
              coldMin = wd.ColdMin, coldMax = wd.ColdMax, coldDps = wd.ColdDPS,
              lightningMin = wd.LightningMin, lightningMax = wd.LightningMax, lightningDps = wd.LightningDPS,
              chaosMin = wd.ChaosMin, chaosMax = wd.ChaosMax, chaosDps = wd.ChaosDPS,
              elemDps = wd.ElementalDPS,
              totalDps = wd.TotalDPS,
              aps = wd.AttackRate,
              critChance = wd.CritChance,
              range = wd.range,
            }
          end
        end

        -- Armour stats
        if base and base.armour and item.armourData then
          local ad = item.armourData
          itemData.armour = {}
          if ad.Armour and ad.Armour > 0 then itemData.armour.armour = ad.Armour end
          if ad.Evasion and ad.Evasion > 0 then itemData.armour.evasion = ad.Evasion end
          if ad.EnergyShield and ad.EnergyShield > 0 then itemData.armour.energyShield = ad.EnergyShield end
          if ad.Ward and ad.Ward > 0 then itemData.armour.ward = ad.Ward end
          if ad.BlockChance and ad.BlockChance > 0 then itemData.armour.blockChance = ad.BlockChance end
        end

        -- Flask stats
        if base and base.flask and item.flaskData then
          local fd = item.flaskData
          itemData.flask = {
            lifeTotal = fd.lifeTotal,
            lifeGradual = fd.lifeGradual,
            lifeInstant = fd.lifeInstant,
            manaTotal = fd.manaTotal,
            manaGradual = fd.manaGradual,
            manaInstant = fd.manaInstant,
            duration = fd.duration,
            chargesUsed = fd.chargesUsed,
            chargesMax = fd.chargesMax,
          }
          -- Flask buff mods
          if item.buffModLines then
            itemData.buffMods = collectMods(item.buffModLines)
          end
        end

        -- Charm stats
        if base and base.charm and item.charmData then
          local cd = item.charmData
          itemData.charm = {
            duration = cd.duration,
            chargesUsed = cd.chargesUsed,
            chargesMax = cd.chargesMax,
          }
          if item.buffModLines then
            itemData.buffMods = collectMods(item.buffModLines)
          end
        end

        -- Spirit cost
        if item.spiritValue and item.spiritValue > 0 then
          itemData.spirit = item.spiritValue
        end

        -- Sockets and runes
        if item.itemSocketCount and item.itemSocketCount > 0 then
          itemData.sockets = item.itemSocketCount
          -- Collect socketed rune/augment names
          if item.runes then
            local names = {}
            for i = 1, item.itemSocketCount do
              local name = item.runes[i]
              if name and name ~= "None" then
                names[#names + 1] = name
              end
            end
            if #names > 0 then
              itemData.runeNames = names
            end
          end
        end

        -- Requirements
        if item.requirements then
          local r = item.requirements
          if (r.str and r.str > 0) or (r.dex and r.dex > 0) or (r.int and r.int > 0) then
            itemData.requirements = {
              str = r.str or 0,
              dex = r.dex or 0,
              int = r.int or 0,
            }
          end
        end

        result[#result + 1] = itemData
      end
    end
  end

  return dkjson.encode({ items = result })
end

-- Get jewel socket data from PoB's PassiveSpec and ItemsTab
function pobWebGetJewelData(jsonArg)
  local result = {}
  if not (build and build.spec and build.spec.jewels and build.itemsTab) then
    return dkjson.encode(result)
  end
  for nodeId, itemId in pairs(build.spec.jewels) do
    if itemId and type(itemId) == "number" and itemId > 0 then
      local item = build.itemsTab.items[itemId]
      if item then
        local implicitMods = {}
        local explicitMods = {}
        local enchantMods = {}
        local runeMods = {}
        if item.implicitModLines then
          for _, ml in ipairs(item.implicitModLines) do
            if ml.line then implicitMods[#implicitMods + 1] = ml.line:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","") end
          end
        end
        if item.explicitModLines then
          for _, ml in ipairs(item.explicitModLines) do
            if ml.line then explicitMods[#explicitMods + 1] = ml.line:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","") end
          end
        end
        if item.enchantModLines then
          for _, ml in ipairs(item.enchantModLines) do
            if ml.line then enchantMods[#enchantMods + 1] = ml.line:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","") end
          end
        end
        if item.runeModLines then
          for _, ml in ipairs(item.runeModLines) do
            if ml.line then runeMods[#runeMods + 1] = ml.line:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","") end
          end
        end
        -- Get jewel radius info
        local radiusData = nil
        local mult = 1.2
        if data and data.gameConstants and data.gameConstants["PassiveTreeJewelDistanceMultiplier"] then
          mult = data.gameConstants["PassiveTreeJewelDistanceMultiplier"]
        end
        if item.jewelRadiusIndex and data and data.jewelRadius then
          local rd = data.jewelRadius[item.jewelRadiusIndex]
          if rd then
            radiusData = {
              inner = rd.inner * mult,
              outer = rd.outer * mult,
            }
          end
        end

        -- From Nothing: radius centered on keystones, not the socket
        local radiusCenters = nil
        if item.jewelData and item.jewelData.fromNothingKeystones and build.spec and build.spec.tree then
          local centers = {}
          for keyName, _ in pairs(item.jewelData.fromNothingKeystones) do
            local keyNode = build.spec.tree.keystoneMap and build.spec.tree.keystoneMap[keyName]
            if keyNode and keyNode.x and keyNode.y then
              centers[#centers + 1] = { x = keyNode.x, y = keyNode.y, name = keyName }
            end
          end
          if #centers > 0 then
            radiusCenters = centers
          end
        end

        result[tostring(nodeId)] = {
          name = item.title or item.name or "Unknown Jewel",
          baseName = item.baseName or "",
          rarity = item.rarity or "NORMAL",
          implicitMods = implicitMods,
          explicitMods = explicitMods,
          enchantMods = enchantMods,
          runeMods = runeMods,
          radius = radiusData,
          radiusCenters = radiusCenters,
        }
      end
    end
  end
  return dkjson.encode(result)
end

-- Install varControls stub so ConfigOptions apply functions don't crash in headless mode.
-- Called after build load — enemyIsBoss's apply accesses varControls[x]:SetPlaceholder().
local function installVarControlsStub()
  if not build or not build.configTab then return end
  if not build.configTab.varControls then build.configTab.varControls = {} end
  setmetatable(build.configTab.varControls, {
    __index = function(t, k)
      local stub = { placeholder = 0, enabled = true, selIndex = 1, list = {} }
      function stub:SetPlaceholder(val) self.placeholder = val end
      function stub:SelByValue(val) end
      function stub:SetText(text) end
      t[k] = stub
      return stub
    end
  })
end

-- Evaluate visibility of a config option against mainEnv state
local function evalConfigVisibility(varData, mainEnv, input)
  local function checkAny(ifOpt, checkFn)
    if type(ifOpt) == "table" then
      for _, opt in ipairs(ifOpt) do
        if checkFn(opt) then return true end
      end
      return false
    end
    return checkFn(ifOpt)
  end

  if varData.ifCond then
    if not checkAny(varData.ifCond, function(c)
      return mainEnv.conditionsUsed and mainEnv.conditionsUsed[c]
    end) then return false end
  end
  if varData.ifMinionCond then
    if not checkAny(varData.ifMinionCond, function(c)
      return mainEnv.minionConditionsUsed and mainEnv.minionConditionsUsed[c]
    end) then return false end
  end
  if varData.ifEnemyCond then
    if not checkAny(varData.ifEnemyCond, function(c)
      return mainEnv.enemyConditionsUsed and mainEnv.enemyConditionsUsed[c]
    end) then return false end
  end
  if varData.ifOption then
    if not checkAny(varData.ifOption, function(o)
      return input[o]
    end) then return false end
  end
  if varData.ifMult then
    if not checkAny(varData.ifMult, function(m)
      return mainEnv.multipliersUsed and mainEnv.multipliersUsed[m]
    end) then return false end
  end
  if varData.ifEnemyMult then
    if not checkAny(varData.ifEnemyMult, function(m)
      return mainEnv.enemyMultipliersUsed and mainEnv.enemyMultipliersUsed[m]
    end) then return false end
  end
  if varData.ifStat then
    if not checkAny(varData.ifStat, function(s)
      return (mainEnv.perStatsUsed and mainEnv.perStatsUsed[s])
    end) then return false end
  end
  if varData.ifEnemyStat then
    if not checkAny(varData.ifEnemyStat, function(s)
      return mainEnv.enemyPerStatsUsed and mainEnv.enemyPerStatsUsed[s]
    end) then return false end
  end
  if varData.ifMod then
    if not checkAny(varData.ifMod, function(m)
      return mainEnv.modsUsed and mainEnv.modsUsed[m]
    end) then return false end
  end
  if varData.ifSkill then
    if not checkAny(varData.ifSkill, function(s)
      return mainEnv.skillsUsed and mainEnv.skillsUsed[s]
    end) then return false end
  end
  if varData.ifSkillType then
    if not checkAny(varData.ifSkillType, function(st)
      if mainEnv.player then
        for _, skill in ipairs(mainEnv.player.activeSkillList or {}) do
          if skill.skillTypes and skill.skillTypes[st] then return true end
        end
      end
      return false
    end) then return false end
  end
  if varData.ifSkillFlag then
    if not checkAny(varData.ifSkillFlag, function(sf)
      if mainEnv.player then
        for _, skill in ipairs(mainEnv.player.activeSkillList or {}) do
          local flags = skill.activeEffect and skill.activeEffect.grantedEffect and skill.activeEffect.grantedEffect.statSet and skill.activeEffect.grantedEffect.statSet.skillFlags
          if flags and flags[sf] then return true end
          if skill.skillFlags and skill.skillFlags[sf] then return true end
        end
      end
      return false
    end) then return false end
  end
  if varData.ifSkillData then
    if not checkAny(varData.ifSkillData, function(sd)
      if mainEnv.player then
        for _, skill in ipairs(mainEnv.player.activeSkillList or {}) do
          if skill.skillData and skill.skillData[sd] then return true end
        end
      end
      return false
    end) then return false end
  end
  if varData.ifTagType then
    if not checkAny(varData.ifTagType, function(tt)
      return mainEnv.tagTypesUsed and mainEnv.tagTypesUsed[tt]
    end) then return false end
  end
  if varData.ifNode then
    if not checkAny(varData.ifNode, function(nodeId)
      if build.spec.allocNodes[nodeId] then return true end
      local node = build.spec.nodes[nodeId]
      if node and node.type == "Keystone" then
        return mainEnv.keystonesAdded and mainEnv.keystonesAdded[node.dn]
      end
      return false
    end) then return false end
  end
  if varData.ifFlag then
    if not checkAny(varData.ifFlag, function(f)
      if mainEnv.player and mainEnv.player.mainSkill then
        local skill = mainEnv.player.mainSkill
        if skill.skillFlags and skill.skillFlags[f] then return true end
        if skill.skillModList and skill.skillModList.Flag then
          local ok, result = pcall(skill.skillModList.Flag, skill.skillModList, nil, f)
          if ok and result then return true end
        end
      end
      return false
    end) then return false end
  end

  return true
end

-- Get all config options with current values and visibility
function pobWebGetConfigOptions(jsonArg)
  if not build or not build.configTab then
    return dkjson.encode({ error = "no build loaded" })
  end

  local varList = LoadModule("Modules/ConfigOptions")
  local mainEnv = build.calcsTab and build.calcsTab.mainEnv
  local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
  local input = configSet and configSet.input or {}
  local placeholder = configSet and configSet.placeholder or {}

  local sections = {}
  local currentSection = nil

  for _, varData in ipairs(varList) do
    if varData.section then
      currentSection = { name = varData.section, options = {} }
      sections[#sections + 1] = currentSection
    elseif currentSection and varData.var then
      local visible = true
      if mainEnv then
        local ok, vis = pcall(evalConfigVisibility, varData, mainEnv, input)
        visible = ok and vis
      end

      local opt = {
        var = varData.var,
        type = varData.type,
        label = StripEscapes(varData.label or ""),
        visible = visible,
        value = input[varData.var],
        hideIfInvalid = varData.hideIfInvalid or false,
      }

      -- Placeholder: prefer configSet placeholder, fall back to varData defaults
      local ph = placeholder[varData.var]
      if ph == nil then ph = varData.defaultPlaceholderState end
      if ph ~= nil then opt.placeholder = ph end

      -- List options
      if varData.type == "list" and varData.list then
        opt.list = {}
        for _, item in ipairs(varData.list) do
          opt.list[#opt.list + 1] = {
            val = item.val,
            label = StripEscapes(item.label or ""),
          }
        end
        -- Default selection if no value set
        if not input[varData.var] and varData.defaultIndex and varData.list[varData.defaultIndex] then
          opt.value = varData.list[varData.defaultIndex].val
        end
      end

      -- Tooltip (string or function)
      if type(varData.tooltip) == "string" then
        opt.tooltip = StripEscapes(varData.tooltip)
      elseif type(varData.tooltip) == "function" then
        local ok, tip = pcall(varData.tooltip, build.configTab.modList or {}, build)
        if ok and tip then opt.tooltip = StripEscapes(tostring(tip)) end
      end

      currentSection.options[#currentSection.options + 1] = opt
    end
  end

  return dkjson.encode({ sections = sections })
end

-- Set a config value and trigger recalculation
function pobWebSetConfig(jsonArg)
  if not build or not build.configTab then
    return dkjson.encode({ error = "no build loaded" })
  end
  local args = dkjson.decode(jsonArg)
  if not args or not args.var then
    return dkjson.encode({ error = "missing var" })
  end

  local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
  if not configSet then
    return dkjson.encode({ error = "no active config set" })
  end

  -- Set value (null/nil clears to default)
  if args.value == nil or args.value == dkjson.null then
    configSet.input[args.var] = nil
  else
    configSet.input[args.var] = args.value
  end

  -- Rebuild mods from config
  installVarControlsStub()
  local modOk, modErr = pcall(function()
    build.configTab:BuildModList()
  end)
  if not modOk then
    print("BuildModList after config change (non-fatal): " .. tostring(modErr))
  end

  -- Trigger full recalc
  build.buildFlag = true
  local ok, err = pcall(runCallback, "OnFrame")
  if not ok then
    print("OnFrame after config change (non-fatal): " .. tostring(err))
  end

  return dkjson.encode({ success = true })
end

-- Reset all config values to defaults
function pobWebResetConfig(jsonArg)
  if not build or not build.configTab then
    return dkjson.encode({ error = "no build loaded" })
  end

  local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
  if not configSet then
    return dkjson.encode({ error = "no active config set" })
  end

  -- Clear all input values
  for k in pairs(configSet.input) do
    configSet.input[k] = nil
  end

  -- Rebuild mods
  installVarControlsStub()
  pcall(function() build.configTab:BuildModList() end)
  build.buildFlag = true
  pcall(runCallback, "OnFrame")

  return dkjson.encode({ success = true })
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
        try {
          const parsed = JSON.parse(result);
          respond(_id, { type: "loadBuild", success: !parsed.error, error: parsed.error, allocatedNodes: parsed.allocatedNodes });
        } catch {
          // bridge_call_json returned a Lua error string instead of JSON
          respond(_id, { type: "loadBuild", success: false, error: result });
        }
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

    case "getSkills": {
      const emptySkills = { mainSocketGroup: 1, fullDps: 0, skills: [], groups: [] };
      if (!initialized) {
        respond(_id, { type: "skills", data: emptySkills, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetSkillsData", "{}");
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "skills", data: emptySkills, error: data.error });
        } else {
          respond(_id, { type: "skills", data });
        }
      } catch (e) {
        respond(_id, { type: "skills", data: emptySkills, error: String(e) });
      }
      break;
    }

    case "switchMainSkill": {
      if (!initialized) {
        respond(_id, { type: "switchMainSkill", data: { stats: {} as any, fullDps: 0, skills: [] }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebSwitchMainSkill", JSON.stringify({ index: msg.index }));
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "switchMainSkill", data: { stats: {} as any, fullDps: 0, skills: [] }, error: data.error });
        } else {
          respond(_id, { type: "switchMainSkill", data });
        }
      } catch (e) {
        respond(_id, { type: "switchMainSkill", data: { stats: {} as any, fullDps: 0, skills: [] }, error: String(e) });
      }
      break;
    }

    case "getDefence": {
      if (!initialized) {
        respond(_id, { type: "defence", data: {}, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetDefenceStats", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "defence", data });
      } catch (e) {
        respond(_id, { type: "defence", data: {}, error: String(e) });
      }
      break;
    }

    case "getDisplayStats": {
      if (!initialized) {
        respond(_id, { type: "displayStats", data: [], error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetDisplayStats", "{}");
        const parsed = JSON.parse(result);
        respond(_id, { type: "displayStats", data: parsed.groups || [] });
      } catch (e) {
        console.error("[PoB] getDisplayStats error:", e);
        respond(_id, { type: "displayStats", data: [], error: String(e) });
      }
      break;
    }

    case "getCalcDisplay": {
      if (!initialized) {
        respond(_id, { type: "calcDisplay", data: [], error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetCalcDisplay", "{}");
        const parsed = JSON.parse(result);
        respond(_id, { type: "calcDisplay", data: parsed.sections || [] });
      } catch (e) {
        console.error("[PoB] getCalcDisplay error:", e);
        respond(_id, { type: "calcDisplay", data: [], error: String(e) });
      }
      break;
    }

    case "getItems": {
      if (!initialized) {
        respond(_id, { type: "items", data: { items: [] }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetItemsData", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "items", data });
      } catch (e) {
        respond(_id, { type: "items", data: { items: [] }, error: String(e) });
      }
      break;
    }

    case "getWeaponSetNodes": {
      if (!initialized) {
        respond(_id, { type: "weaponSetNodes", data: {}, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetWeaponSetNodes", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "weaponSetNodes", data });
      } catch (e) {
        respond(_id, { type: "weaponSetNodes", data: {}, error: String(e) });
      }
      break;
    }

    case "getJewels": {
      if (!initialized) {
        respond(_id, { type: "jewels", data: {}, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetJewelData", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "jewels", data });
      } catch (e) {
        respond(_id, { type: "jewels", data: {}, error: String(e) });
      }
      break;
    }

    case "allocNode": {
      const emptyAlloc = { success: false, allocatedNodes: [] as number[] };
      if (!initialized) {
        respond(_id, { type: "allocNode", data: emptyAlloc, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebAllocNode", JSON.stringify({ nodeId: msg.nodeId }));
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "allocNode", data: emptyAlloc, error: data.error });
        } else {
          respond(_id, { type: "allocNode", data });
        }
      } catch (e) {
        respond(_id, { type: "allocNode", data: emptyAlloc, error: String(e) });
      }
      break;
    }

    case "deallocNode": {
      const emptyDealloc = { success: false, allocatedNodes: [] as number[] };
      if (!initialized) {
        respond(_id, { type: "deallocNode", data: emptyDealloc, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebDeallocNode", JSON.stringify({ nodeId: msg.nodeId }));
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "deallocNode", data: emptyDealloc, error: data.error });
        } else {
          respond(_id, { type: "deallocNode", data });
        }
      } catch (e) {
        respond(_id, { type: "deallocNode", data: emptyDealloc, error: String(e) });
      }
      break;
    }

    case "calcNodeImpact": {
      const emptyImpact = { deltas: {}, pathCount: 1, pathNodes: [] as number[] };
      if (!initialized) {
        respond(_id, { type: "nodeImpact", data: emptyImpact, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebCalcNodeImpact", JSON.stringify({
          nodeId: msg.nodeId,
          singleNode: (msg as any).singleNode || false,
        }));
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "nodeImpact", data: emptyImpact, error: data.error });
        } else {
          respond(_id, { type: "nodeImpact", data });
        }
      } catch (e) {
        respond(_id, { type: "nodeImpact", data: emptyImpact, error: String(e) });
      }
      break;
    }

    case "getNodePower": {
      const emptyPower = { nodes: {}, max: { off: 0, def: 0 }, topNodes: [] };
      if (!initialized) {
        respond(_id, { type: "nodePower", data: emptyPower, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetNodePower", "{}");
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "nodePower", data: emptyPower, error: data.error });
        } else {
          respond(_id, { type: "nodePower", data });
        }
      } catch (e) {
        respond(_id, { type: "nodePower", data: emptyPower, error: String(e) });
      }
      break;
    }

    case "getConfigOptions": {
      if (!initialized) {
        respond(_id, { type: "configOptions", data: { sections: [] }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebGetConfigOptions", "{}");
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "configOptions", data: { sections: [] }, error: data.error });
        } else {
          respond(_id, { type: "configOptions", data });
        }
      } catch (e) {
        respond(_id, { type: "configOptions", data: { sections: [] }, error: String(e) });
      }
      break;
    }

    case "setConfig": {
      if (!initialized) {
        respond(_id, { type: "setConfig", data: { success: false }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebSetConfig", JSON.stringify({
          var: (msg as any).var,
          value: (msg as any).value,
        }));
        const data = JSON.parse(result);
        respond(_id, { type: "setConfig", data });
      } catch (e) {
        respond(_id, { type: "setConfig", data: { success: false }, error: String(e) });
      }
      break;
    }

    case "resetConfig": {
      if (!initialized) {
        respond(_id, { type: "resetConfig", data: { success: false }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebResetConfig", "{}");
        const data = JSON.parse(result);
        respond(_id, { type: "resetConfig", data });
      } catch (e) {
        respond(_id, { type: "resetConfig", data: { success: false }, error: String(e) });
      }
      break;
    }

    case "exportBuild": {
      if (!initialized) {
        respond(_id, { type: "exportBuild", data: { code: "" }, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebExportBuild", "{}");
        const data = JSON.parse(result);
        if (data.error) {
          respond(_id, { type: "exportBuild", data: { code: "" }, error: data.error });
        } else {
          respond(_id, { type: "exportBuild", data: { code: data.xml } });
        }
      } catch (e) {
        respond(_id, { type: "exportBuild", data: { code: "" }, error: String(e) });
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
