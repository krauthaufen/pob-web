import { useState, useEffect, useCallback, useRef } from "react";
import { useBuildStore } from "@/store/build-store";
import type { CalcClient } from "@/worker/calc-client";
import type { ConfigData, ConfigOption, ConfigSection } from "@/worker/calc-api";

interface ConfigPanelProps {
  calcClient?: CalcClient | null;
  onConfigChange?: () => void;
}

export function ConfigPanel({ calcClient, onConfigChange }: ConfigPanelProps) {
  const { build, calcStatus, setCalcDisplay, setDisplayStats } = useBuildStore();
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [searchText, setSearchText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [updating, setUpdating] = useState(false);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Persist config values to localStorage
  const persistConfig = useCallback((data: ConfigData) => {
    try {
      const vals: Record<string, boolean | number | string> = {};
      for (const s of data.sections) {
        for (const o of s.options) {
          if (o.value != null && o.value !== false) vals[o.var] = o.value as any;
        }
      }
      localStorage.setItem("pob-config", JSON.stringify(vals));
    } catch {}
  }, []);

  // Restore saved config on build load
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!calcClient || !build) return;
    if (calcStatus !== "ready" && calcStatus !== "error") return;
    // On first load, restore saved config then fetch
    if (!restoredRef.current) {
      restoredRef.current = true;
      (async () => {
        try {
          const saved = localStorage.getItem("pob-config");
          if (saved) {
            const vals: Record<string, boolean | number | string> = JSON.parse(saved);
            for (const [k, v] of Object.entries(vals)) {
              await calcClient.setConfig(k, v);
            }
          }
        } catch {}
        const data = await calcClient.getConfigOptions();
        setConfigData(data);
      })();
    } else {
      calcClient.getConfigOptions().then(setConfigData).catch(console.error);
    }
  }, [calcClient, calcStatus, build]);

  const handleChange = useCallback(async (varName: string, value: boolean | number | string | null) => {
    if (!calcClient || updating) return;
    setUpdating(true);
    try {
      const result = await calcClient.setConfig(varName, value);
      if (result.success) {
        // Re-fetch config (visibility may change) + refresh stats
        const [newConfig, display, displayStats] = await Promise.all([
          calcClient.getConfigOptions(),
          calcClient.getCalcDisplay(),
          calcClient.getDisplayStats(),
        ]);
        setConfigData(newConfig);
        setCalcDisplay(display);
        setDisplayStats(displayStats);
        persistConfig(newConfig);
        onConfigChange?.();
      }
    } catch (e) {
      console.error("[Config] setConfig failed:", e);
    } finally {
      setUpdating(false);
    }
  }, [calcClient, updating, setCalcDisplay, setDisplayStats, onConfigChange]);

  const handleReset = useCallback(async () => {
    if (!calcClient || updating) return;
    setUpdating(true);
    try {
      const result = await calcClient.resetConfig();
      if (result.success) {
        const [newConfig, display, displayStats] = await Promise.all([
          calcClient.getConfigOptions(),
          calcClient.getCalcDisplay(),
          calcClient.getDisplayStats(),
        ]);
        setConfigData(newConfig);
        setCalcDisplay(display);
        setDisplayStats(displayStats);
        try { localStorage.removeItem("pob-config"); } catch {}
        onConfigChange?.();
      }
    } catch (e) {
      console.error("[Config] resetConfig failed:", e);
    } finally {
      setUpdating(false);
    }
  }, [calcClient, updating, setCalcDisplay, setDisplayStats, onConfigChange]);

  // Debounced handler for numeric inputs
  const handleNumericChange = useCallback((varName: string, raw: string) => {
    // Clear previous debounce for this var
    if (debounceRef.current[varName]) clearTimeout(debounceRef.current[varName]);

    // Update local state immediately for responsiveness
    setConfigData(prev => {
      if (!prev) return prev;
      return {
        sections: prev.sections.map(s => ({
          ...s,
          options: s.options.map(o =>
            o.var === varName ? { ...o, value: raw === "" ? null : raw } : o
          ),
        })),
      };
    });

    debounceRef.current[varName] = setTimeout(() => {
      const num = raw === "" ? null : Number(raw);
      if (raw !== "" && isNaN(num as number)) return;
      handleChange(varName, num);
    }, 500);
  }, [handleChange]);

  const toggleSection = useCallback((name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see configuration
      </div>
    );
  }

  if (calcStatus === "loading" || calcStatus === "calculating") {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        Calculating...
      </div>
    );
  }

  if (!configData || configData.sections.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        No configuration options available
      </div>
    );
  }

  const search = searchText.toLowerCase().trim();

  return (
    <div className="flex flex-col gap-0 p-0">
      {/* Search + Show All */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-poe-border bg-poe-panel px-3 py-2">
        <div className="relative flex-1">
          <input
            type="text"
            className="w-full rounded border border-poe-border bg-poe-bg px-2 py-1 text-xs text-poe-text placeholder-gray-600 focus:border-poe-accent focus:outline-none"
            placeholder="Search config..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button
              className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-gray-500 hover:text-gray-300"
              onClick={() => setSearchText("")}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1L7 7M7 1L1 7" />
              </svg>
            </button>
          )}
        </div>
        <label className="flex items-center gap-1 text-[10px] text-gray-500 whitespace-nowrap">
          <input
            type="checkbox"
            className="h-3 w-3 rounded border-gray-600 bg-poe-bg accent-poe-accent"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          All
        </label>
        <button
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-poe-border hover:text-gray-300"
          onClick={handleReset}
          disabled={updating}
          title="Reset all config to defaults"
        >
          Reset
        </button>
      </div>

      {/* Sections */}
      {configData.sections.map((section) => {
        const visibleOptions = filterOptions(section, search, showAll);
        if (visibleOptions.length === 0) return null;
        const isCollapsed = collapsed.has(section.name);

        return (
          <div key={section.name} className="border-b border-poe-border/50">
            <button
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200"
              onClick={() => toggleSection(section.name)}
            >
              <span>{section.name}</span>
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              >
                <path d="M3 1L7 5L3 9" />
              </svg>
            </button>
            {!isCollapsed && (
              <div className="px-3 pb-2">
                {visibleOptions.map((opt) => (
                  <ConfigRow
                    key={opt.var}
                    option={opt}
                    onChange={handleChange}
                    onNumericChange={handleNumericChange}
                    disabled={updating}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function filterOptions(section: ConfigSection, search: string, showAll: boolean): ConfigOption[] {
  return section.options.filter((opt) => {
    // Search filter
    if (search && !opt.label.toLowerCase().includes(search)) return false;
    // Visibility filter
    if (!opt.visible && !showAll) {
      // Show non-visible options that have a non-default value (user set something)
      if (opt.value === null || opt.value === undefined || opt.value === false) return false;
    }
    return true;
  });
}

interface ConfigRowProps {
  option: ConfigOption;
  onChange: (varName: string, value: boolean | number | string | null) => void;
  onNumericChange: (varName: string, raw: string) => void;
  disabled: boolean;
}

function ConfigRow({ option, onChange, onNumericChange, disabled }: ConfigRowProps) {
  const dimmed = !option.visible;

  if (option.type === "check") {
    return (
      <label
        className={`flex cursor-pointer items-center gap-2 py-0.5 text-xs ${dimmed ? "text-gray-600" : "text-poe-text"}`}
        title={option.tooltip}
      >
        <input
          type="checkbox"
          className="h-3 w-3 rounded border-gray-600 bg-poe-bg accent-poe-accent"
          checked={!!option.value}
          onChange={(e) => onChange(option.var, e.target.checked ? true : null)}
          disabled={disabled}
        />
        <span className="leading-tight">{option.label}</span>
      </label>
    );
  }

  if (option.type === "list" && option.list) {
    return (
      <div className={`flex items-center justify-between gap-2 py-0.5 text-xs ${dimmed ? "text-gray-600" : "text-poe-text"}`} title={option.tooltip}>
        <span className="shrink-0 leading-tight">{option.label}</span>
        <select
          className="min-w-0 max-w-[50%] rounded border border-poe-border bg-poe-bg px-1 py-0.5 text-xs text-poe-text focus:border-poe-accent focus:outline-none"
          value={option.value != null ? String(option.value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            // Try to preserve numeric types
            const num = Number(raw);
            onChange(option.var, isNaN(num) ? raw : num);
          }}
          disabled={disabled}
        >
          {option.list.map((item, i) => (
            <option key={i} value={String(item.val)}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (option.type === "text") {
    return (
      <div className={`py-0.5 text-xs ${dimmed ? "text-gray-600" : "text-poe-text"}`} title={option.tooltip}>
        <span className="mb-0.5 block leading-tight">{option.label}</span>
        <textarea
          className="w-full rounded border border-poe-border bg-poe-bg px-1 py-0.5 text-xs text-poe-text focus:border-poe-accent focus:outline-none"
          rows={3}
          value={option.value != null ? String(option.value) : ""}
          onChange={(e) => onChange(option.var, e.target.value || null)}
          disabled={disabled}
        />
      </div>
    );
  }

  // Numeric types: count, integer, countAllowZero, float
  return (
    <div className={`flex items-center justify-between gap-2 py-0.5 text-xs ${dimmed ? "text-gray-600" : "text-poe-text"}`} title={option.tooltip}>
      <span className="shrink-0 leading-tight">{option.label}</span>
      <input
        type="number"
        className="w-16 rounded border border-poe-border bg-poe-bg px-1 py-0.5 text-right text-xs text-poe-text focus:border-poe-accent focus:outline-none"
        value={option.value != null ? String(option.value) : ""}
        placeholder={option.placeholder != null ? String(option.placeholder) : undefined}
        onChange={(e) => onNumericChange(option.var, e.target.value)}
        step={option.type === "float" ? "0.1" : "1"}
        disabled={disabled}
      />
    </div>
  );
}
