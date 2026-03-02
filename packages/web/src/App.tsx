import { useState, useEffect, useRef, useCallback } from "react";
import { ImportPanel, EXAMPLE_CODE } from "@/components/ImportExport/ImportPanel";
import { StatsPanel } from "@/components/StatsPanel/StatsPanel";
import { SkillsPanel } from "@/components/StatsPanel/SkillsPanel";
import { DefencePanel } from "@/components/StatsPanel/DefencePanel";
import { InventoryPanel } from "@/components/StatsPanel/InventoryPanel";
import { ConfigPanel } from "@/components/StatsPanel/ConfigPanel";
import { PassiveTree } from "@/components/PassiveTree/PassiveTree";
import { useBuildStore } from "@/store/build-store";
import type { DefenceStats } from "@/store/build-store";
import type { TreeData } from "@/components/PassiveTree/tree-types";
import { CalcClient } from "@/worker/calc-client";
import { decodeBuildCode, parseBuildXml, parsePoeNinjaUrl, fetchPoeNinjaBuild } from "@/worker/build-decoder";
import { resolveItemImages, resolveRuneImages, resolveJewelImages } from "@/utils/item-images";
import type { NodePowerData } from "@/worker/calc-api";

// Persist/restore lightweight UI state across iOS background kills
const SESSION_KEY = "pob-ui-state";
type UiState = {
  sidePanel?: string;
  menuOpen?: boolean;
  pinned?: boolean;
  treeSearch?: string;
};

function saveUiState(patch: Partial<UiState>) {
  try {
    const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {}
}

function loadUiState(): UiState {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}"); } catch { return {}; }
}

const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;

export function App() {
  const saved = loadUiState();
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeSearch, setTreeSearch] = useState(saved.treeSearch || "");
  const [sidePanel, setSidePanelRaw] = useState<"import" | "stats" | "skills" | "defence" | "items" | "config">((saved.sidePanel as any) || "import");
  const [menuOpen, setMenuOpenRaw] = useState(saved.menuOpen ?? isDesktop);
  const [pinned, setPinnedRaw] = useState(saved.pinned ?? isDesktop);

  const setSidePanel = useCallback((p: typeof sidePanel) => { setSidePanelRaw(p); saveUiState({ sidePanel: p }); }, []);
  const setMenuOpen = useCallback((v: boolean) => { setMenuOpenRaw(v); saveUiState({ menuOpen: v }); }, []);
  const setPinned = useCallback((v: boolean) => { setPinnedRaw(v); saveUiState({ pinned: v }); }, []);
  const build = useBuildStore((s) => s.build);
  const calcStatus = useBuildStore((s) => s.calcStatus);
  const setCalcStatus = useBuildStore((s) => s.setCalcStatus);
  const setStats = useBuildStore((s) => s.setStats);
  const setSkillsData = useBuildStore((s) => s.setSkillsData);
  const setDefenceStats = useBuildStore((s) => s.setDefenceStats);
  const setCalcDisplay = useBuildStore((s) => s.setCalcDisplay);
  const setDisplayStats = useBuildStore((s) => s.setDisplayStats);
  const setJewelData = useBuildStore((s) => s.setJewelData);
  const setWeaponSetNodes = useBuildStore((s) => s.setWeaponSetNodes);
  const setEquippedItems = useBuildStore((s) => s.setEquippedItems);
  const [engineStatus, setEngineStatus] = useState<string>("idle");
  const [engineLogs, setEngineLogs] = useState<string[]>([]);
  const [heatmapData, setHeatmapDataRaw] = useState<NodePowerData | null>(null);
  const heatmapFingerprintRef = useRef<string>("");
  const getHeatmapFingerprint = useCallback(() => {
    const code = useBuildStore.getState().originalImportCode;
    const nodes = useBuildStore.getState().allocatedNodes;
    return code + ":" + nodes.size;
  }, []);
  const setHeatmapData = useCallback((data: NodePowerData | null) => {
    setHeatmapDataRaw(data);
    try {
      if (data) {
        const fp = getHeatmapFingerprint();
        heatmapFingerprintRef.current = fp;
        localStorage.setItem("pob-node-power", JSON.stringify({ fp, data }));
      } else {
        heatmapFingerprintRef.current = "";
        localStorage.removeItem("pob-node-power");
      }
    } catch {}
  }, [getHeatmapFingerprint]);
  // Restore cached power data only if fingerprint matches current build state
  const restoreCachedHeatmap = useCallback(() => {
    try {
      const cached = localStorage.getItem("pob-node-power");
      if (!cached) return;
      const { fp, data } = JSON.parse(cached);
      if (fp === getHeatmapFingerprint()) {
        heatmapFingerprintRef.current = fp;
        setHeatmapDataRaw(data);
      } else {
        localStorage.removeItem("pob-node-power");
      }
    } catch {}
  }, [getHeatmapFingerprint]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const allocatedNodes = useBuildStore((s) => s.allocatedNodes);
  const calcClientRef = useRef<CalcClient | null>(null);
  const pendingBuildRef = useRef<string | null>(null);

  const initEngine = useCallback(async () => {
    if (calcClientRef.current) return;
    setEngineStatus("loading");
    const client = new CalcClient((msg) => {
      console.log("[PoB]", msg);
      setEngineLogs((prev) => [...prev.slice(-20), msg]);
    });
    calcClientRef.current = client;
    const ok = await client.init();
    setEngineStatus(ok ? "ready" : "error");

    // If a build was imported while engine was loading, send it now
    if (ok && pendingBuildRef.current) {
      const xml = pendingBuildRef.current;
      pendingBuildRef.current = null;
      await loadBuildInEngine(client, xml);
    }
  }, []);

  const loadBuildInEngine = useCallback(async (client: CalcClient, xml: string) => {
    setHeatmapDataRaw(null); // Clear display without wiping cache (restoreCachedHeatmap checks later)
    setCalcStatus("loading");
    const { success, error } = await client.loadBuild(xml);
    if (!success) {
      console.error("[PoB] Build load failed:", error);
      setCalcStatus("error", error || "Failed to load build in engine");
      return;
    }
    // Restore saved config before first calculation
    try {
      const savedConfig = localStorage.getItem("pob-config");
      if (savedConfig) {
        const vals: Record<string, boolean | number | string> = JSON.parse(savedConfig);
        for (const [k, v] of Object.entries(vals)) {
          await client.setConfig(k, v);
        }
      }
    } catch {}

    setCalcStatus("calculating");

    // Fetch stats, skills, defence, calcDisplay, jewels, weapon set nodes, and items independently
    const [statsResult, skillsResult, defenceResult, displayResult, displayStatsResult, jewelsResult, wsResult, itemsResult] = await Promise.allSettled([
      client.getStats(),
      client.getSkills(),
      client.getDefence(),
      client.getCalcDisplay(),
      client.getDisplayStats(),
      client.getJewels(),
      client.getWeaponSetNodes(),
      client.getItems(),
    ]);

    const stats = statsResult.status === "fulfilled" ? statsResult.value : {} as any;
    const skills = skillsResult.status === "fulfilled" ? skillsResult.value : null;
    const defence = defenceResult.status === "fulfilled" ? defenceResult.value : {};

    // Update allocated nodes from engine (includes anointed/granted passives)
    if (stats._allocatedNodes) {
      useBuildStore.getState().setAllocatedNodes(stats._allocatedNodes);
    }

    if (statsResult.status === "rejected") console.error("[PoB] getStats failed:", statsResult.reason);
    if (skillsResult.status === "rejected") console.error("[PoB] getSkills failed:", skillsResult.reason);
    if (defenceResult.status === "rejected") console.error("[PoB] getDefence failed:", defenceResult.reason);

    if (displayResult.status === "fulfilled") setCalcDisplay(displayResult.value);
    else console.error("[PoB] getCalcDisplay failed:", displayResult.reason);

    if (displayStatsResult.status === "fulfilled") setDisplayStats(displayStatsResult.value);
    else console.error("[PoB] getDisplayStats failed:", displayStatsResult.reason);

    if (jewelsResult.status === "fulfilled") {
      setJewelData(jewelsResult.value);
      resolveJewelImages(jewelsResult.value).then((urls) => {
        useBuildStore.getState().setJewelImageUrls(urls);
      }).catch(() => {});
    } else console.error("[PoB] getJewels failed:", jewelsResult.reason);

    if (wsResult.status === "fulfilled") {
      // Convert string keys to numbers
      const wsData: Record<number, number> = {};
      for (const [k, v] of Object.entries(wsResult.value)) wsData[Number(k)] = v as number;
      setWeaponSetNodes(wsData);
    } else console.error("[PoB] getWeaponSetNodes failed:", wsResult.reason);

    if (itemsResult.status === "fulfilled") {
      setEquippedItems(itemsResult.value);
      // Preload item and rune images so they're ready when the Items tab opens
      resolveItemImages(itemsResult.value).then((urls) => {
        useBuildStore.getState().setItemImageUrls(urls);
      }).catch(() => {});
      resolveRuneImages(itemsResult.value).then((urls) => {
        useBuildStore.getState().setRuneImageUrls(urls);
      }).catch(() => {});
    } else console.error("[PoB] getItems failed:", itemsResult.reason);

    setStats({
      totalDps: stats.TotalDPS || stats.CombinedDPS || 0,
      hitDps: stats.TotalDPS || 0,
      dotDps: stats.TotalDot || 0,
      critChance: stats.CritChance || 0,
      critMulti: stats.CritMultiplier || 0,
      attackSpeed: stats.Speed || 0,
      castSpeed: stats.CastSpeed || 0,
      hitDamage: 0,
      life: stats.Life || 0,
      energyShield: stats.EnergyShield || 0,
      mana: stats.Mana || 0,
      armour: stats.Armour || 0,
      evasion: stats.Evasion || 0,
      blockChance: stats.BlockChance || 0,
      fireRes: stats.FireResist || 0,
      coldRes: stats.ColdResist || 0,
      lightningRes: stats.LightningResist || 0,
      chaosRes: stats.ChaosResist || 0,
      movementSpeed: 0,
    });

    if (skills) setSkillsData(skills);

    // Log available defence keys for debugging
    if (defence._availableKeys) {
      console.log("[PoB] Defence output keys:", defence._availableKeys);
    }

    const d: DefenceStats = {
      life: defence.Life || 0,
      lifeUnreserved: defence.LifeUnreserved || 0,
      lifeRegen: defence.NetLifeRegen || defence.LifeRegenRecovery || 0,
      energyShield: defence.EnergyShield || 0,
      esRegen: defence.NetEnergyShieldRegen || defence.EnergyShieldRegenRecovery || 0,
      mana: defence.Mana || 0,
      manaUnreserved: defence.ManaUnreserved || 0,
      manaRegen: defence.NetManaRegen || defence.ManaRegenRecovery || 0,
      ward: defence.Ward || 0,
      armour: defence.Armour || 0,
      evasion: defence.Evasion || 0,
      physReduction: defence.PhysicalDamageReduction || defence.PhysicalResist || 0,
      blockChance: defence.BlockChance || 0,
      spellBlockChance: defence.SpellBlockChance || 0,
      fireRes: defence.FireResist || 0,
      coldRes: defence.ColdResist || 0,
      lightningRes: defence.LightningResist || 0,
      chaosRes: defence.ChaosResist || 0,
      fireOverCap: defence.FireResistOverCap || 0,
      coldOverCap: defence.ColdResistOverCap || 0,
      lightningOverCap: defence.LightningResistOverCap || 0,
      chaosOverCap: defence.ChaosResistOverCap || 0,
      totalEhp: defence.TotalEHP || 0,
      physMaxHit: defence.PhysicalMaximumHitTaken || 0,
      fireMaxHit: defence.FireMaximumHitTaken || 0,
      coldMaxHit: defence.ColdMaximumHitTaken || 0,
      lightningMaxHit: defence.LightningMaximumHitTaken || 0,
      chaosMaxHit: defence.ChaosMaximumHitTaken || 0,
      movementSpeed: defence.MovementSpeedMod || 0,
    };
    setDefenceStats(d);

    // Restore cached heatmap if fingerprint still matches
    restoreCachedHeatmap();
  }, [setCalcStatus, setStats, setSkillsData, setDefenceStats, setCalcDisplay, setDisplayStats, setJewelData, setWeaponSetNodes, setEquippedItems, restoreCachedHeatmap]);

  // Auto-init engine on mount
  useEffect(() => {
    initEngine();
  }, [initEngine]);

  // When a build is imported, send it to the engine
  useEffect(() => {
    if (!build) return;
    const client = calcClientRef.current;
    if (client && engineStatus === "ready") {
      loadBuildInEngine(client, build.rawXml);
    } else {
      // Engine not ready yet, queue the build
      pendingBuildRef.current = build.rawXml;
    }
  }, [build, engineStatus, loadBuildInEngine]);

  useEffect(() => {
    fetch("/data/tree.json")
      .then((r) => r.json())
      .then((data) => {
        setTreeData(data);
        setTreeLoading(false);
      })
      .catch((e) => {
        console.error("Failed to load tree.json:", e);
        setTreeLoading(false);
      });
  }, []);

  // Auto-import: restore last build from localStorage, or fall back to example
  useEffect(() => {
    if (build) return; // already have a build
    (async () => {
      try {
        let code: string;
        try { code = localStorage.getItem("pob-import-code") || EXAMPLE_CODE; } catch { code = EXAMPLE_CODE; }
        const ninjaUrl = parsePoeNinjaUrl(code);
        if (ninjaUrl) {
          code = await fetchPoeNinjaBuild(ninjaUrl.account, ninjaUrl.character);
        }
        const xml = decodeBuildCode(code);
        const parsed = parseBuildXml(xml);
        useBuildStore.getState().setBuild(parsed);
        useBuildStore.getState().setImportCode(code);
        useBuildStore.getState().setOriginalImportCode(code);
      } catch (e) {
        console.error("Auto-import failed:", e);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (build) setSidePanelRaw((prev) => prev === "import" ? "stats" : prev);
  }, [build]);

  // Clear heatmap when tree changes (node alloc/dealloc invalidates power data)
  useEffect(() => {
    // Only clear if the fingerprint no longer matches (i.e. actual tree change, not initial load)
    if (heatmapFingerprintRef.current && getHeatmapFingerprint() !== heatmapFingerprintRef.current) {
      setHeatmapData(null);
    }
  }, [allocatedNodes, setHeatmapData, getHeatmapFingerprint]);

  return (
    <div className="relative flex h-[100dvh] w-screen overflow-hidden bg-poe-bg text-poe-text">
      {/* Pinned sidebar (rendered inline, before main) */}
      {menuOpen && pinned && (
        <aside className="flex h-full w-80 shrink-0 flex-col border-r border-poe-border bg-poe-panel">
          <div className="flex h-11 items-center justify-between border-b border-poe-border px-4">
            <span className="text-sm font-bold text-poe-accent">PoB Web</span>
            <div className="flex items-center gap-1">
              <button
                className={`rounded p-1 text-gray-400 transition hover:text-white ${pinned ? "bg-poe-accent/20 text-poe-accent" : ""}`}
                onClick={() => setPinned(!pinned)}
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
                title={pinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M7 1v8M4 6l3 3 3-3M3 12h8" />
                </svg>
              </button>
              <button
                className="rounded p-1 text-gray-400 hover:text-white"
                onClick={() => setMenuOpen(false)}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 3L11 11M11 3L3 11" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex border-b border-poe-border">
            {(["import", "stats", "skills", "defence", "items", "config"] as const).map((tab) => (
              <button
                key={tab}
                className={`flex-1 px-2 py-2.5 text-xs font-medium transition ${
                  sidePanel === tab
                    ? "border-b-2 border-poe-accent text-poe-accent"
                    : "text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => setSidePanel(tab)}
              >
                {tab === "import" ? "Import" :
                 tab === "stats" ? "Stats" :
                 tab === "skills" ? "Skills" :
                 tab === "defence" ? "Defence" :
                 tab === "items" ? "Items" : "Config"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {sidePanel === "import" ? <ImportPanel /> :
             sidePanel === "stats" ? <StatsPanel /> :
             sidePanel === "skills" ? <SkillsPanel calcClient={calcClientRef.current} /> :
             sidePanel === "defence" ? <DefencePanel /> :
             sidePanel === "items" ? <InventoryPanel /> :
             <ConfigPanel calcClient={calcClientRef.current} onConfigChange={() => setHeatmapData(null)} />}
          </div>
        </aside>
      )}

      {/* Main area (tree + overlays) */}
      <main className="relative flex-1">
        {treeLoading ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            Loading passive tree...
          </div>
        ) : !treeData ? (
          <div className="flex h-full items-center justify-center text-gray-500">
            <div className="text-center">
              <p>Failed to load tree data.</p>
              <p className="mt-1 text-xs">
                Ensure <code>public/data/tree.json</code> exists.
              </p>
            </div>
          </div>
        ) : (
          <PassiveTree
            treeData={treeData}
            heatmapData={heatmapData}
            searchQuery={treeSearch || undefined}
            calcClient={calcClientRef.current}
          />
        )}

        {/* Top bar overlay */}
        <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-11 items-center justify-between px-3">
          {/* Burger + title + engine status */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              className="flex h-9 w-9 items-center justify-center rounded bg-poe-panel/80 text-poe-text backdrop-blur-sm active:bg-poe-panel"
              onClick={() => { if (menuOpen && pinned) { setMenuOpen(false); } else { setMenuOpen(true); } }}
              aria-label="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <rect y="3" width="20" height="2" rx="1" />
                <rect y="9" width="20" height="2" rx="1" />
                <rect y="15" width="20" height="2" rx="1" />
              </svg>
            </button>
            {!(menuOpen && pinned) && <span className="hidden text-sm font-bold text-poe-accent sm:inline">PoB Web</span>}
            {engineStatus === "loading" && (
              <span className="text-xs text-yellow-400">Booting...</span>
            )}
            {engineStatus === "ready" && (
              <span className="text-xs text-green-400">Ready</span>
            )}
            {engineStatus === "error" && (
              <span className="text-xs text-red-400">Engine Error</span>
            )}
          </div>

          {/* Search + calc status */}
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="relative">
              <input
                className="w-32 rounded border border-poe-border bg-poe-panel/80 px-2 py-1.5 pr-6 text-xs text-poe-text placeholder-gray-600 backdrop-blur-sm focus:border-poe-accent focus:outline-none sm:w-48"
                placeholder="Search passives..."
                value={treeSearch}
                onChange={(e) => { setTreeSearch(e.target.value); saveUiState({ treeSearch: e.target.value }); }}
              />
              {treeSearch && (
                <button
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:text-gray-300"
                  onClick={() => { setTreeSearch(""); saveUiState({ treeSearch: "" }); }}
                  aria-label="Clear search"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2L8 8M8 2L2 8" />
                  </svg>
                </button>
              )}
            </div>
            {calcStatus && calcStatus !== "idle" && (
              <span className="rounded bg-poe-panel/80 px-2 py-1 text-xs text-gray-400 backdrop-blur-sm">
                {calcStatus === "calculating" ? "Calc..." :
                 calcStatus === "ready" ? "Ready" :
                 calcStatus === "loading" ? "Loading..." :
                 calcStatus === "error" ? "Calc Error" : ""}
              </span>
            )}
            {build && calcStatus === "ready" && (
              <button
                className={`flex h-7 items-center gap-1 rounded px-2 text-xs backdrop-blur-sm transition ${
                  heatmapData ? "bg-poe-accent/20 text-poe-accent" : "bg-poe-panel/60 text-gray-500 hover:text-gray-300"
                } ${heatmapLoading ? "animate-pulse" : ""}`}
                onClick={async () => {
                  if (heatmapData) {
                    setHeatmapData(null);
                    return;
                  }
                  const client = calcClientRef.current;
                  if (!client) return;
                  setHeatmapLoading(true);
                  try {
                    const data = await client.getNodePower();
                    setHeatmapData(data);
                  } catch (e) {
                    console.error("[PoB] getNodePower failed:", e);
                  } finally {
                    setHeatmapLoading(false);
                  }
                }}
                title={heatmapData ? "Hide node power heatmap" : "Show node power heatmap (offence=red, defence=blue)"}
                disabled={heatmapLoading}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="6" cy="6" r="4.5" />
                  <path d="M6 3v3l2 1" />
                </svg>
                {heatmapLoading ? "..." : "Power"}
              </button>
            )}
            <button
              className="flex h-7 w-7 items-center justify-center rounded bg-poe-panel/60 text-gray-600 backdrop-blur-sm transition hover:text-gray-300"
              onClick={() => {
                try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem("pob-viewport"); } catch {}
                setTreeSearch("");
                setSidePanel("import");
                setMenuOpen(isDesktop);
                setPinned(isDesktop);
                useBuildStore.getState().resetViewport();
              }}
              title="Reset view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1v4h4M13 13v-4h-4" />
                <path d="M1.5 5A6 6 0 0112.5 4M12.5 9A6 6 0 011.5 10" />
              </svg>
            </button>
          </div>
        </header>

        {/* Node count overlay */}
        {build && (
          <div className="absolute bottom-3 left-3 z-30 rounded bg-poe-panel/80 px-3 py-1.5 text-xs backdrop-blur-sm">
            <span className="text-gray-400">Allocated: </span>
            <span className="font-medium text-poe-accent">
              {useBuildStore.getState().allocatedNodes.size}
            </span>
            <span className="text-gray-500"> / {build.nodes.length}</span>
          </div>
        )}

        {/* Engine boot log */}
        {engineLogs.length > 0 && engineStatus === "loading" && (
          <div className="absolute bottom-3 right-3 z-30 max-h-48 w-80 overflow-y-auto rounded bg-poe-panel/90 p-2 text-xs font-mono text-gray-400 backdrop-blur-sm">
            {engineLogs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </main>

      {/* Slide-out drawer (non-pinned mode) */}
      {menuOpen && !pinned && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-poe-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-11 items-center justify-between border-b border-poe-border px-4">
              <span className="text-sm font-bold text-poe-accent">PoB Web</span>
              <div className="flex items-center gap-1">
                <button
                  className="rounded p-1 text-gray-400 transition hover:text-white"
                  onClick={() => { setPinned(true); }}
                  aria-label="Pin sidebar"
                  title="Pin sidebar"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M7 1v8M4 6l3 3 3-3M3 12h8" />
                  </svg>
                </button>
                <button
                  className="rounded p-1 text-gray-400 hover:text-white"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 3L11 11M11 3L3 11" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex border-b border-poe-border">
              {(["import", "stats", "skills", "defence", "items", "config"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`flex-1 px-2 py-2.5 text-xs font-medium transition ${
                    sidePanel === tab
                      ? "border-b-2 border-poe-accent text-poe-accent"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  onClick={() => setSidePanel(tab)}
                >
                  {tab === "import" ? "Import" :
                   tab === "stats" ? "Stats" :
                   tab === "skills" ? "Skills" :
                   tab === "defence" ? "Defence" :
                   tab === "items" ? "Items" : "Config"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {sidePanel === "import" ? <ImportPanel /> :
               sidePanel === "stats" ? <StatsPanel /> :
               sidePanel === "skills" ? <SkillsPanel calcClient={calcClientRef.current} /> :
               sidePanel === "defence" ? <DefencePanel /> :
               sidePanel === "items" ? <InventoryPanel /> :
               <ConfigPanel calcClient={calcClientRef.current} onConfigChange={() => setHeatmapData(null)} />}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
