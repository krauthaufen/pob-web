import { useState, useRef, useCallback } from "react";
import { useBuildStore } from "@/store/build-store";
import type { GemInfo, SocketGroupGems, AvailableGem } from "@/worker/calc-api";
import type { CalcClient } from "@/worker/calc-client";
import { resolveGemImages } from "@/utils/item-images";
import { isTouchDevice } from "@/utils/is-touch";

const GEM_COLORS: Record<string, string> = {
  str: "#c83030",
  dex: "#30a030",
  int: "#3060c8",
  normal: "#888888",
};

const GEM_BG: Record<string, string> = {
  str: "#2b1010",
  dex: "#102b10",
  int: "#10102b",
  normal: "#1a1a1a",
};

function GemDetailBody({ gem }: { gem: GemInfo }) {
  const color = GEM_COLORS[gem.color] ?? "#888";
  const bg = GEM_BG[gem.color] ?? "#1a1a1a";

  return (
    <>
      <div
        className="mb-0 rounded-t px-3 py-2 text-center"
        style={{ background: bg, borderTop: `2px solid ${color}` }}
      >
        <p className="text-sm font-semibold" style={{ color }}>
          {gem.name}
        </p>
        {gem.isSupport && (
          <p className="text-[10px] text-gray-500">Support</p>
        )}
      </div>
      <div
        className="rounded-b px-3 py-2 text-xs"
        style={{ background: "#121619", borderBottom: `1px solid ${color}40` }}
      >
        {gem.tagString && (
          <p className="mb-1 text-[10px] text-gray-500">{gem.tagString}</p>
        )}

        {gem.description && (
          <>
            <p className="mb-1.5 text-[11px] italic leading-relaxed text-gray-400">
              {gem.description}
            </p>
            <div className="my-1.5 border-b border-gray-700/60" />
          </>
        )}

        <div className="flex justify-between py-0.5">
          <span className="text-gray-500">Level</span>
          <span className="text-poe-text">{gem.level}</span>
        </div>

        {gem.quality > 0 && (
          <div className="flex justify-between py-0.5">
            <span className="text-gray-500">Quality</span>
            <span style={{ color: "#8888ff" }}>+{gem.quality}%</span>
          </div>
        )}

        {gem.castTime != null && gem.castTime > 0 && (
          <div className="flex justify-between py-0.5">
            <span className="text-gray-500">Cast Time</span>
            <span className="text-poe-text">{gem.castTime.toFixed(2)}s</span>
          </div>
        )}

        {gem.cooldown != null && gem.cooldown > 0 && (
          <div className="flex justify-between py-0.5">
            <span className="text-gray-500">Cooldown</span>
            <span className="text-poe-text">{gem.cooldown.toFixed(2)}s</span>
          </div>
        )}

        {(gem.reqLevel != null && gem.reqLevel > 0) || gem.reqStr || gem.reqDex || gem.reqInt ? (
          <>
            <div className="my-1.5 border-b border-gray-700/60" />
            <p className="text-[11px] text-gray-500">
              Requires
              {gem.reqLevel != null && gem.reqLevel > 0 && (
                <span> Level <span className="text-gray-300">{gem.reqLevel}</span></span>
              )}
              {gem.reqStr ? <>, <span className="text-gray-300">{gem.reqStr}</span> Str</> : null}
              {gem.reqDex ? <>, <span className="text-gray-300">{gem.reqDex}</span> Dex</> : null}
              {gem.reqInt ? <>, <span className="text-gray-300">{gem.reqInt}</span> Int</> : null}
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}

function GemDetail({ gem, onClose, onReplace, onRemove, replacing }: {
  gem: GemInfo;
  onClose: () => void;
  onReplace?: () => void;
  onRemove?: () => void;
  replacing?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-10 overflow-y-auto"
      style={{ background: "#0b0e11ee" }}
    >
      <div className="p-3">
        <button
          className="mb-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 2L4 6L8 10" />
          </svg>
          Back
        </button>
        <GemDetailBody gem={gem} />
        {gem.isSupport && onReplace && (
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded bg-poe-accent/80 py-2 text-xs font-semibold text-poe-bg transition active:bg-poe-accent disabled:opacity-50"
              onClick={onReplace}
              disabled={replacing}
            >
              Replace
            </button>
            {onRemove && (
              <button
                className="rounded bg-red-900/60 px-3 py-2 text-xs font-semibold text-red-200 transition active:bg-red-900/80 disabled:opacity-50"
                onClick={onRemove}
                disabled={replacing}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDps(value: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

function SupportPicker({ supports, currentName, gemImageUrls, dpsMap, dpsLoading, onSelect, onClose }: {
  supports: AvailableGem[];
  currentName: string;
  gemImageUrls: Record<string, string>;
  dpsMap: Record<string, number> | null;
  dpsLoading: boolean;
  onSelect: (gem: AvailableGem) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? supports.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : supports;

  // Sort by DPS delta when available
  const sorted = dpsMap
    ? [...filtered].sort((a, b) => (dpsMap[b.id] ?? -Infinity) - (dpsMap[a.id] ?? -Infinity))
    : filtered;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col"
      style={{ background: "#0b0e11" }}
    >
      <div className="flex items-center gap-2 border-b border-poe-border px-3 py-2">
        <button
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 2L4 6L8 10" />
          </svg>
        </button>
        <input
          className="flex-1 rounded border border-poe-border bg-poe-bg px-2 py-1 text-xs text-poe-text placeholder-gray-600 focus:border-poe-accent focus:outline-none"
          placeholder="Search supports..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        {dpsLoading && (
          <span className="text-[10px] text-gray-500 animate-pulse">calc...</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.map((gem) => {
          const color = GEM_COLORS[gem.color] ?? "#888";
          const isCurrent = gem.name === currentName;
          const dpsDelta = dpsMap?.[gem.id];
          return (
            <button
              key={gem.id}
              className={`flex w-full items-center gap-2 border-b border-poe-border/30 px-3 py-1.5 text-left transition hover:bg-white/5 ${isCurrent ? "bg-white/10" : ""}`}
              onClick={() => onSelect(gem)}
            >
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full"
                style={{ border: `2px solid ${color}`, background: "#121619" }}
              >
                {gemImageUrls[gem.name] ? (
                  <img src={gemImageUrls[gem.name]} alt="" className="h-full w-full rounded-full object-cover" loading="lazy" />
                ) : (
                  <svg width="7" height="7" viewBox="0 0 16 16" fill={color} opacity="0.6">
                    <path d="M8 1L14 8L8 15L2 8Z" />
                  </svg>
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color }}>
                {gem.name}
              </span>
              {dpsDelta != null ? (
                <span className={`shrink-0 font-mono text-[10px] ${dpsDelta > 0 ? "text-green-400" : dpsDelta < 0 ? "text-red-400" : "text-gray-500"}`}>
                  {dpsDelta > 0 ? "+" : ""}{formatDps(dpsDelta)}
                </span>
              ) : isCurrent ? (
                <span className="text-[9px] text-gray-500">current</span>
              ) : null}
            </button>
          );
        })}
        {sorted.length === 0 && (
          <p className="p-4 text-center text-xs text-gray-500">No matches</p>
        )}
      </div>
    </div>
  );
}

function GemRow({
  gem,
  imageUrl,
  isSupport,
  onHover,
  onHoverEnd,
  onClick,
  onToggle,
}: {
  gem: GemInfo;
  imageUrl?: string;
  isSupport: boolean;
  onHover: (rect: DOMRect) => void;
  onHoverEnd: () => void;
  onClick: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const color = GEM_COLORS[gem.color] ?? "#888";
  const ref = useRef<HTMLDivElement>(null);
  const dimmed = !gem.enabled;
  const iconSize = isSupport ? 24 : 28;

  return (
    <div
      ref={ref}
      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/5"
      style={{ paddingLeft: isSupport ? 20 : 4 }}
      onPointerEnter={() => { if (isTouchDevice()) return; if (ref.current) onHover(ref.current.getBoundingClientRect()); }}
      onPointerLeave={() => { if (isTouchDevice()) return; onHoverEnd(); }}
    >
      <button
        className="flex flex-1 items-center gap-2 min-w-0"
        style={{ opacity: dimmed ? 0.35 : 1 }}
        onClick={onClick}
      >
        <div
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={{
            width: iconSize,
            height: iconSize,
            border: `2px solid ${color}`,
            background: "#121619",
          }}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={gem.name}
              className="h-full w-full rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <svg width={iconSize * 0.45} height={iconSize * 0.45} viewBox="0 0 16 16" fill={color} opacity="0.6">
              <path d="M8 1L14 8L8 15L2 8Z" />
            </svg>
          )}
        </div>
        <span
          className="min-w-0 flex-1 truncate text-xs text-left"
          style={{ color: dimmed ? "#555" : color }}
        >
          {gem.name}
        </span>
        {!isSupport && (
          <span className="shrink-0 text-[10px] text-gray-600">
            {gem.level}
            {gem.quality > 0 && <span style={{ color: "#8888ff" }}> /{gem.quality}</span>}
          </span>
        )}
      </button>
      {onToggle && (
        <button
          className={`shrink-0 flex items-center justify-center w-8 h-7 rounded text-[10px] transition ${
            gem.enabled
              ? "text-green-500/70 hover:text-green-400 active:bg-green-900/30"
              : "text-red-500/70 hover:text-red-400 active:bg-red-900/30"
          }`}
          onClick={(e) => { e.stopPropagation(); onToggle(!gem.enabled); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={gem.enabled ? "Disable" : "Enable"}
        >
          {gem.enabled ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}

function SocketGroupRow({
  group,
  gemImageUrls,
  onGemHover,
  onGemHoverEnd,
  onGemClick,
  onGemToggle,
}: {
  group: SocketGroupGems;
  gemImageUrls: Record<string, string>;
  onGemHover: (gem: GemInfo, rect: DOMRect) => void;
  onGemHoverEnd: () => void;
  onGemClick: (gem: GemInfo, groupIndex: number, gemIndex: number) => void;
  onGemToggle?: (groupIndex: number, gemIndex: number, enabled: boolean) => void;
}) {
  const dimmed = !group.enabled;

  if (group.gems.length === 0) return null;

  return (
    <div
      className="border-b border-poe-border/50 px-2 py-1.5"
      style={{ opacity: dimmed ? 0.5 : 1 }}
    >
      {/* Group header */}
      <div className="mb-0.5 flex items-center gap-1.5 px-1">
        {group.slot && (
          <span className="text-[10px] font-medium text-gray-500">{group.slot}</span>
        )}
        {group.label && (
          <span className="text-[10px] text-gray-600 italic">{group.label}</span>
        )}
        {!group.enabled && (
          <span className="text-[9px] text-red-900">(disabled)</span>
        )}
      </div>

      {/* Gem list — vertical */}
      <div className="flex flex-col">
        {group.gems.map((gem, i) => (
          <GemRow
            key={i}
            gem={gem}
            imageUrl={gemImageUrls[gem.name]}
            isSupport={gem.isSupport}
            onHover={(rect) => onGemHover(gem, rect)}
            onHoverEnd={onGemHoverEnd}
            onClick={() => onGemClick(gem, group.index, i + 1)}
            onToggle={onGemToggle ? (enabled) => onGemToggle(group.index, i + 1, enabled) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

interface SelectedGemInfo {
  gem: GemInfo;
  groupIndex: number;
  gemIndex: number; // 1-based (Lua index)
}

export function GemsPanel({ calcClient }: { calcClient?: CalcClient | null }) {
  const { gemsData, build, gemImageUrls } = useBuildStore();
  const [hoveredGem, setHoveredGem] = useState<{ gem: GemInfo; rect: DOMRect } | null>(null);
  const [selected, setSelected] = useState<SelectedGemInfo | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [pickerSupports, setPickerSupports] = useState<AvailableGem[]>([]);
  const [dpsMap, setDpsMap] = useState<Record<string, number> | null>(null);
  const [dpsLoading, setDpsLoading] = useState(false);

  const handleToggle = useCallback(async (groupIndex: number, gemIndex: number, enabled: boolean) => {
    if (!calcClient) return;
    try {
      const result = await calcClient.toggleGem(groupIndex, gemIndex, enabled);
      const store = useBuildStore.getState();
      store.setGemsData(result.gems);
      store.setSkillsData(result.skills);
      store.setDisplayStats(result.displayStats);
    } catch (e) {
      console.error("[PoB] Toggle gem failed:", e);
    }
  }, [calcClient]);

  const handleReplace = useCallback(async (gem: AvailableGem) => {
    if (!calcClient || !selected) return;
    setReplacing(true);
    try {
      const result = await calcClient.replaceGem(selected.groupIndex, selected.gemIndex, gem.id);
      const store = useBuildStore.getState();
      store.setGemsData(result.gems);
      store.setGemImageUrls(resolveGemImages(result.gems));
      store.setSkillsData(result.skills);
      store.setDisplayStats(result.displayStats);
      setShowPicker(false);
      setSelected(null);
    } catch (e) {
      console.error("replaceGem failed:", e);
    } finally {
      setReplacing(false);
    }
  }, [calcClient, selected]);

  const handleRemove = useCallback(async () => {
    if (!calcClient || !selected) return;
    setReplacing(true);
    try {
      const result = await calcClient.replaceGem(selected.groupIndex, selected.gemIndex, null);
      const store = useBuildStore.getState();
      store.setGemsData(result.gems);
      store.setGemImageUrls(resolveGemImages(result.gems));
      store.setSkillsData(result.skills);
      store.setDisplayStats(result.displayStats);
      setSelected(null);
    } catch (e) {
      console.error("removeGem failed:", e);
    } finally {
      setReplacing(false);
    }
  }, [calcClient, selected]);

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see gems
      </div>
    );
  }

  if (!gemsData || gemsData.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        No gem data available
      </div>
    );
  }

  const totalGems = gemsData.reduce((sum, g) => sum + g.gems.length, 0);
  const enabledGroups = gemsData.filter((g) => g.enabled);

  return (
    <div className="relative flex h-full flex-col" style={{ background: "#0b0e11" }}>
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold" style={{ color: "#af6025" }}>
          {build.ascendancy || build.className}
        </h2>
        <p className="text-[10px] text-gray-500">
          {totalGems} gems in {enabledGroups.length} group{enabledGroups.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Socket groups */}
      <div className="flex-1 overflow-y-auto">
        {gemsData.map((group) => (
          <SocketGroupRow
            key={group.index}
            group={group}
            gemImageUrls={gemImageUrls}
            onGemHover={(gem, rect) => setHoveredGem({ gem, rect })}
            onGemHoverEnd={() => setHoveredGem(null)}
            onGemClick={(gem, groupIndex, gemIndex) => {
              setSelected({ gem, groupIndex, gemIndex });
              setShowPicker(false);
            }}
            onGemToggle={calcClient ? handleToggle : undefined}
          />
        ))}
      </div>

      {/* Hover tooltip */}
      {hoveredGem && !selected && (() => {
        const cellRect = hoveredGem.rect;
        const rightSpace = window.innerWidth - cellRect.right;
        const useRight = rightSpace < 280;
        const left = useRight ? Math.max(8, cellRect.left - 264) : cellRect.right + 8;
        const top = Math.max(8, Math.min(cellRect.top, window.innerHeight - 300));
        return (
          <div
            className="pointer-events-none fixed z-[9999] max-h-[80vh] w-[260px] overflow-y-auto rounded border border-poe-border shadow-2xl"
            style={{ left, top, background: "#0d1014f8" }}
          >
            <GemDetailBody gem={hoveredGem.gem} />
          </div>
        );
      })()}

      {/* Detail overlay (tap) */}
      {selected && !showPicker && (
        <GemDetail
          gem={selected.gem}
          onClose={() => setSelected(null)}
          onReplace={selected.gem.isSupport && calcClient ? () => {
            setShowPicker(true);
            setPickerSupports([]);
            setDpsMap(null);
            setDpsLoading(true);
            // Fetch compatible supports for this group, then calculate DPS
            calcClient.getAvailableSupports(selected.groupIndex).then((supports) => {
              setPickerSupports(supports);
              // Calculate DPS for each compatible support
              return calcClient.calcSupportDps(
                selected.groupIndex,
                selected.gemIndex,
                supports.map((s) => ({ id: s.id })),
              ).then((data) => {
                const map: Record<string, number> = {};
                for (const r of data.results) map[r.id] = r.dps;
                setDpsMap(map);
              });
            }).catch((e) => console.error("support picker failed:", e))
              .finally(() => setDpsLoading(false));
          } : undefined}
          onRemove={selected.gem.isSupport && calcClient ? handleRemove : undefined}
          replacing={replacing}
        />
      )}

      {/* Support picker overlay */}
      {showPicker && selected && (
        <SupportPicker
          supports={pickerSupports}
          currentName={selected.gem.name}
          gemImageUrls={gemImageUrls}
          dpsMap={dpsMap}
          dpsLoading={dpsLoading}
          onSelect={handleReplace}
          onClose={() => { setShowPicker(false); setDpsMap(null); }}
        />
      )}
    </div>
  );
}
