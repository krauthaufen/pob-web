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

  return dkjson.encode({ success = true })
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

function pobWebGetSkillsData(jsonArg)
  if not build then
    return dkjson.encode({ error = "no build loaded" })
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
  local skillsTab = build.skillsTab
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

-- Helper: collect all allocated node hashes from the spec
local function getAllocatedNodeList()
  local nodes = {}
  if build and build.spec and build.spec.allocNodes then
    for hash, _ in pairs(build.spec.allocNodes) do
      if type(hash) == "number" then
        nodes[#nodes + 1] = hash
      end
    end
  end
  return nodes
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
  local miscOk, calcFunc, calcBase = pcall(build.calcsTab.GetMiscCalculator, build.calcsTab)
  if not miscOk then
    return dkjson.encode({ error = "GetMiscCalculator failed: " .. tostring(calcFunc) })
  end

  local pathCount = 1
  local calcOk, output

  if not node.alloc then
    -- UNALLOCATED: include node.path (all nodes from allocated tree to this node)
    local addNodes = {}
    if node.path and #node.path > 0 then
      for _, n in ipairs(node.path) do addNodes[n] = true end
      pathCount = #node.path
    else
      addNodes[node] = true
    end
    calcOk, output = pcall(calcFunc, { addNodes = addNodes }, true)
  else
    -- ALLOCATED: include node.depends (all nodes that would become orphaned)
    local removeNodes = {}
    if node.depends and #node.depends > 0 then
      for _, n in ipairs(node.depends) do removeNodes[n] = true end
      pathCount = #node.depends
    else
      removeNodes[node] = true
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

  return dkjson.encode({ deltas = deltas, pathCount = pathCount })
end

-- Get structured calc display using PoB's CalcSections and CheckFlag visibility
function pobWebGetCalcDisplay(jsonArg)
  if not build or not build.calcsTab then
    return dkjson.encode({ sections = {} })
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
    local sOk, sVisible = pcall(build.calcsTab.CheckFlag, build.calcsTab, section)
    if sOk and sVisible then
      local sData = { id = section.id, group = section.group, subsections = {} }

      -- subSection[i] = { label = "...", data = { flag = "...", [1]=row, [2]=row, ... } }
      for _, sub in ipairs(section.subSection) do
        local subData = { label = sub.label or "", stats = {} }
        local dataBlock = sub.data
        if not dataBlock then goto continue_sub end

        local subOk, subVisible = pcall(build.calcsTab.CheckFlag, build.calcsTab, dataBlock)
        if not (subOk and subVisible) then goto continue_sub end

        for _, rowData in ipairs(dataBlock) do
          local rOk, rVisible = pcall(build.calcsTab.CheckFlag, build.calcsTab, rowData)
          if rOk and rVisible and rowData.label then
            -- Strip PoB color codes (^7, ^xRRGGBB)
            local cleanLabel = rowData.label:gsub("%^%d",""):gsub("%^x%x%x%x%x%x%x","")
            local row = { label = cleanLabel, values = {} }
            for _, colData in ipairs(rowData) do
              if type(colData) == "table" and colData.format then
                for decimals, key in colData.format:gmatch("{(%d+):output:([^}]+)}") do
                  local val = output[key]
                  if val and type(val) == "number" and val ~= 0 then
                    row.values[#row.values + 1] = {
                      key = key, value = val, decimals = tonumber(decimals)
                    }
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

-- Get jewel socket data from PoB's PassiveSpec and ItemsTab
function pobWebGetJewelData(jsonArg)
  local result = {}
  if build and build.spec and build.spec.jewels and build.itemsTab then
    for nodeId, itemId in pairs(build.spec.jewels) do
      if itemId and type(itemId) == "number" and itemId > 0 then
        local item = build.itemsTab.items[itemId]
        if item then
          result[tostring(nodeId)] = {
            name = item.title or item.name or "Unknown Jewel",
            rarity = item.rarity or "Normal",
          }
        end
      end
    end
  end
  return dkjson.encode(result)
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
        respond(_id, { type: "calcDisplay", data: [], error: String(e) });
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
      const emptyImpact = { deltas: {}, pathCount: 1 };
      if (!initialized) {
        respond(_id, { type: "nodeImpact", data: emptyImpact, error: "Engine not initialized" });
        break;
      }
      try {
        const result = bridge_call_json("pobWebCalcNodeImpact", JSON.stringify({
          nodeId: msg.nodeId,
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
