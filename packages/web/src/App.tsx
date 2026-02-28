import { useState, useEffect } from "react";
import { ImportPanel } from "@/components/ImportExport/ImportPanel";
import { StatsPanel } from "@/components/StatsPanel/StatsPanel";
import { PassiveTree } from "@/components/PassiveTree/PassiveTree";
import { useBuildStore } from "@/store/build-store";
import type { TreeData } from "@/components/PassiveTree/tree-types";

export function App() {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeSearch, setTreeSearch] = useState("");
  const [sidePanel, setSidePanel] = useState<"stats" | "import">("import");
  const [menuOpen, setMenuOpen] = useState(false);
  const build = useBuildStore((s) => s.build);
  const calcStatus = useBuildStore((s) => s.calcStatus);

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

  useEffect(() => {
    if (build) setSidePanel("stats");
  }, [build]);

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-poe-bg text-poe-text">
      {/* Fullscreen tree */}
      <main className="absolute inset-0">
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
            searchQuery={treeSearch || undefined}
          />
        )}
      </main>

      {/* Top bar overlay */}
      <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-11 items-center justify-between px-3">
        {/* Burger + title */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            className="flex h-9 w-9 items-center justify-center rounded bg-poe-panel/80 text-poe-text backdrop-blur-sm active:bg-poe-panel"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <rect y="3" width="20" height="2" rx="1" />
              <rect y="9" width="20" height="2" rx="1" />
              <rect y="15" width="20" height="2" rx="1" />
            </svg>
          </button>
          <span className="hidden text-sm font-bold text-poe-accent sm:inline">PoB Web</span>
        </div>

        {/* Search + status */}
        <div className="pointer-events-auto flex items-center gap-2">
          <input
            className="w-32 rounded border border-poe-border bg-poe-panel/80 px-2 py-1.5 text-xs text-poe-text placeholder-gray-600 backdrop-blur-sm focus:border-poe-accent focus:outline-none sm:w-48"
            placeholder="Search passives..."
            value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
          />
          {calcStatus && calcStatus !== "idle" && (
            <span className="rounded bg-poe-panel/80 px-2 py-1 text-xs text-gray-400 backdrop-blur-sm">
              {calcStatus === "calculating" ? "Calc..." :
               calcStatus === "ready" ? "Ready" :
               calcStatus === "loading" ? "Loading..." : ""}
            </span>
          )}
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

      {/* Slide-out drawer */}
      {menuOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setMenuOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />

          {/* Drawer */}
          <aside
            className="relative flex h-full w-80 max-w-[85vw] flex-col bg-poe-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex h-11 items-center justify-between border-b border-poe-border px-4">
              <span className="text-sm font-bold text-poe-accent">PoB Web</span>
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => setMenuOpen(false)}
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M4.5 4.5L13.5 13.5M13.5 4.5L4.5 13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            </div>

            {/* Tab switcher */}
            <div className="flex border-b border-poe-border">
              <button
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition ${
                  sidePanel === "import"
                    ? "border-b-2 border-poe-accent text-poe-accent"
                    : "text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => setSidePanel("import")}
              >
                Import
              </button>
              <button
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition ${
                  sidePanel === "stats"
                    ? "border-b-2 border-poe-accent text-poe-accent"
                    : "text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => setSidePanel("stats")}
              >
                Stats
              </button>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto">
              {sidePanel === "import" ? <ImportPanel /> : <StatsPanel />}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
