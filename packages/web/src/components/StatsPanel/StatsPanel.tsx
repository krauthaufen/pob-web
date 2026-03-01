import { useBuildStore } from "@/store/build-store";
import type { DisplayStat, DisplayStatGroup } from "@/worker/calc-api";

function StatRow({ stat }: { stat: DisplayStat }) {
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className="text-gray-400">{stat.label}</span>
      <span style={stat.color ? { color: stat.color } : undefined} className={stat.color ? "font-medium" : "text-poe-text"}>
        {stat.value}
      </span>
    </div>
  );
}

function StatGroup({ group }: { group: DisplayStatGroup }) {
  if (group.length === 0) return null;
  return (
    <div className="border-b border-poe-border pb-2">
      {group.map((stat, i) => (
        <StatRow key={i} stat={stat} />
      ))}
    </div>
  );
}

export function StatsPanel() {
  const { displayStats, build, calcStatus } = useBuildStore();

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see stats
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

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Build info header */}
      <div className="pb-2 border-b border-poe-border">
        <h2 className="text-sm font-semibold text-poe-accent">
          {build.ascendancy || build.className}
        </h2>
        <p className="text-xs text-gray-400">
          Level {build.level} — {build.nodes.length} passives
        </p>
      </div>

      {/* Display stat groups from PoB sidebar */}
      {displayStats?.map((group, i) => (
        <StatGroup key={i} group={group} />
      ))}

      {/* Items summary */}
      <div>
        <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
          Items ({build.items.filter(i => i.slot).length} equipped)
        </h3>
        {build.items.filter(i => i.slot).map((item, i) => (
          <div key={i} className="flex justify-between py-0.5 text-xs">
            <span className="text-gray-500">{item.slot}</span>
            <span className={
              item.rarity === "Unique" ? "text-poe-accent" :
              item.rarity === "Rare" ? "text-yellow-400" :
              item.rarity === "Magic" ? "text-blue-400" :
              "text-poe-text"
            }>
              {item.name || item.base}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
