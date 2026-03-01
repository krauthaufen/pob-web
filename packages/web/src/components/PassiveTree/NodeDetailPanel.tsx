import type { ProcessedNode } from "./tree-types";
import type { NodeImpact, JewelInfo } from "@/worker/calc-api";

function formatNum(value: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value % 1 !== 0) return value.toFixed(1);
  return String(Math.round(value));
}

/** Stats that represent percentages (show % suffix) */
const PCT_STATS = new Set([
  "CritChance", "CritMultiplier", "BlockChance", "SpellBlockChance",
  "SpellSuppressionChance", "BleedChance", "FreezeChance", "IgniteChance", "ShockChance",
  "MeleeAvoidChance", "SpellAvoidChance", "ProjectileAvoidChance",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist",
]);

function ImpactRow({ label, value, stat }: {
  label: string;
  value: number;
  stat: string;
}) {
  const positive = value > 0;
  const suffix = PCT_STATS.has(stat) ? "%" : "";
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={positive ? "text-green-400" : "text-red-400"}>
        {positive ? "+" : ""}{formatNum(value)}{suffix}
      </span>
    </div>
  );
}

interface Props {
  node: ProcessedNode;
  isAllocated: boolean;
  impact: NodeImpact | null;
  impactFull: NodeImpact | null;
  impactLoading: boolean;
  singleMode: boolean;
  onToggleMode: () => void;
  allocating: boolean;
  jewelInfo: JewelInfo | null;
  onAllocate: () => void;
  onDeallocate: () => void;
  onClose: () => void;
}

export function NodeDetailPanel({
  node, isAllocated, impact, impactFull, impactLoading, singleMode, onToggleMode,
  allocating, jewelInfo, onAllocate, onDeallocate, onClose,
}: Props) {
  const typeColor =
    node.type === "keystone" ? "text-poe-accent" :
    node.type === "notable" ? "text-yellow-300" :
    node.type === "jewel" ? "text-teal-400" :
    "text-poe-text";

  const typeLabel =
    node.type === "keystone" ? "Keystone" :
    node.type === "notable" ? "Notable" :
    node.type === "jewel" ? "Jewel Socket" :
    node.type === "mastery" ? "Mastery" :
    "Passive";

  // Build sorted impact rows from PoB's deltas (labels come from PoB's data.powerStatList)
  const impactRows = impact
    ? Object.entries(impact.deltas)
        .filter(([, d]) => Math.abs(d.value) > 0.01)
        .sort((a, b) => Math.abs(b[1].value) - Math.abs(a[1].value))
    : [];

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-xl border-t border-poe-border bg-poe-panel/95 shadow-2xl backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-2 pb-1">
        <div className="h-1 w-10 rounded-full bg-gray-600" />
      </div>

      <div className="px-4 pb-4">
        {/* Header */}
        <div className="mb-2 flex items-start justify-between">
          <div>
            <p className={`text-sm font-semibold ${typeColor}`}>
              {node.name}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              {typeLabel}
              {isAllocated && " — Allocated"}
            </p>
            {jewelInfo && (
              <p className={`text-xs ${
                jewelInfo.rarity === "Unique" ? "text-poe-accent" :
                jewelInfo.rarity === "Rare" ? "text-yellow-400" :
                jewelInfo.rarity === "Magic" ? "text-blue-400" :
                "text-gray-300"
              }`}>
                {jewelInfo.name}
                {jewelInfo.baseName && jewelInfo.baseName !== jewelInfo.name && (
                  <span className="ml-1 text-gray-500">{jewelInfo.baseName}</span>
                )}
              </p>
            )}
          </div>
          <button
            className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 active:bg-gray-700"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3L11 11M11 3L3 11" />
            </svg>
          </button>
        </div>

        {/* Jewel mods */}
        {jewelInfo && (jewelInfo.implicitMods.length > 0 || jewelInfo.explicitMods.length > 0 || jewelInfo.enchantMods.length > 0 || jewelInfo.runeMods.length > 0) && (
          <div className="mb-3 rounded bg-poe-bg/50 px-3 py-2">
            {jewelInfo.enchantMods.map((mod, i) => (
              <p key={`e${i}`} className="text-xs leading-relaxed text-cyan-300">{mod}</p>
            ))}
            {jewelInfo.implicitMods.map((mod, i) => (
              <p key={`i${i}`} className="text-xs leading-relaxed text-blue-300">{mod}</p>
            ))}
            {(jewelInfo.implicitMods.length > 0 && jewelInfo.explicitMods.length > 0) && (
              <div className="my-1 border-b border-gray-700" />
            )}
            {jewelInfo.explicitMods.map((mod, i) => (
              <p key={`x${i}`} className="text-xs leading-relaxed text-gray-200">{mod}</p>
            ))}
            {jewelInfo.runeMods.length > 0 && (
              <div className="mt-1 border-t border-gray-700 pt-1">
                {jewelInfo.runeMods.map((mod, i) => (
                  <p key={`r${i}`} className="text-xs leading-relaxed text-green-300">{mod}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {node.stats.length > 0 && (
          <div className="mb-3 rounded bg-poe-bg/50 px-3 py-2">
            {node.stats.map((stat, i) => (
              <p key={i} className="text-xs leading-relaxed text-gray-300">{stat}</p>
            ))}
          </div>
        )}

        {/* Impact */}
        {impactLoading ? (
          <div className="mb-3 text-xs text-gray-500">Calculating impact...</div>
        ) : impactRows.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                {isAllocated
                  ? `Removing${impact!.pathCount > 1 ? ` (${impact!.pathCount} nodes)` : ""}`
                  : `Allocating${impact!.pathCount > 1 ? ` (${impact!.pathCount} nodes)` : ""}`}
              </p>
              {impactFull && impactFull.pathCount > 1 && (
                <button
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                  onClick={onToggleMode}
                >
                  {singleMode ? "Show path" : "This node only"}
                </button>
              )}
            </div>
            {impactRows.map(([stat, delta]) => (
              <ImpactRow key={stat} label={delta.label} value={delta.value} stat={stat} />
            ))}
          </div>
        ) : null}

        {/* Action button */}
        {node.type !== "classStart" && node.type !== "mastery" && (
          <button
            className={`w-full rounded py-2.5 text-xs font-semibold transition active:scale-[0.98] ${
              isAllocated
                ? "bg-red-900/60 text-red-200 active:bg-red-900/80"
                : "bg-poe-accent/80 text-poe-bg active:bg-poe-accent"
            } ${allocating ? "opacity-50" : ""}`}
            onClick={isAllocated ? onDeallocate : onAllocate}
            disabled={allocating}
          >
            {allocating
              ? "Working..."
              : isAllocated ? "Deallocate" : "Allocate"}
          </button>
        )}
      </div>
    </div>
  );
}
