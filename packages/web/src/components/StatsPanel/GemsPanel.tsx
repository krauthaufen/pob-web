import { useState, useRef } from "react";
import { useBuildStore } from "@/store/build-store";
import type { GemInfo, SocketGroupGems } from "@/worker/calc-api";

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

function GemDetail({ gem, onClose }: { gem: GemInfo; onClose: () => void }) {
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
}: {
  gem: GemInfo;
  imageUrl?: string;
  isSupport: boolean;
  onHover: (rect: DOMRect) => void;
  onHoverEnd: () => void;
  onClick: () => void;
}) {
  const color = GEM_COLORS[gem.color] ?? "#888";
  const ref = useRef<HTMLButtonElement>(null);
  const dimmed = !gem.enabled;
  const iconSize = isSupport ? 24 : 28;

  return (
    <button
      ref={ref}
      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/5"
      style={{ opacity: dimmed ? 0.35 : 1, paddingLeft: isSupport ? 20 : 4 }}
      onClick={onClick}
      onMouseEnter={() => { if (ref.current) onHover(ref.current.getBoundingClientRect()); }}
      onMouseLeave={onHoverEnd}
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
        className="min-w-0 flex-1 truncate text-xs"
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
  );
}

function SocketGroupRow({
  group,
  gemImageUrls,
  onGemHover,
  onGemHoverEnd,
  onGemClick,
}: {
  group: SocketGroupGems;
  gemImageUrls: Record<string, string>;
  onGemHover: (gem: GemInfo, rect: DOMRect) => void;
  onGemHoverEnd: () => void;
  onGemClick: (gem: GemInfo) => void;
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
            onClick={() => onGemClick(gem)}
          />
        ))}
      </div>
    </div>
  );
}

export function GemsPanel() {
  const { gemsData, build, gemImageUrls } = useBuildStore();
  const [hoveredGem, setHoveredGem] = useState<{ gem: GemInfo; rect: DOMRect } | null>(null);
  const [selectedGem, setSelectedGem] = useState<GemInfo | null>(null);

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
            onGemClick={(gem) => setSelectedGem(gem)}
          />
        ))}
      </div>

      {/* Hover tooltip */}
      {hoveredGem && !selectedGem && (() => {
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
      {selectedGem && (
        <GemDetail
          gem={selectedGem}
          onClose={() => setSelectedGem(null)}
        />
      )}
    </div>
  );
}
