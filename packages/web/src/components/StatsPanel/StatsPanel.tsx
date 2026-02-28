import { useBuildStore } from "@/store/build-store";

function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  const formatted = typeof value === "number"
    ? value >= 1000000
      ? `${(value / 1000000).toFixed(2)}M`
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : value % 1 !== 0
          ? value.toFixed(1)
          : String(value)
    : value;

  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={color ?? "text-poe-text"}>{formatted}</span>
    </div>
  );
}

function ResistRow({ label, value, color }: { label: string; value: number; color: string }) {
  const capped = value >= 75;
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className={color}>{label}</span>
      <span className={capped ? "text-green-400" : "text-red-400"}>
        {value}%
      </span>
    </div>
  );
}

export function StatsPanel() {
  const { stats, calcStatus, build } = useBuildStore();

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

  // Show parsed build info even without calc engine
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Build info header */}
      <div>
        <h2 className="text-sm font-semibold text-poe-accent">
          {build.ascendancy || build.className}
        </h2>
        <p className="text-xs text-gray-400">
          Level {build.level} — {build.nodes.length} passives
        </p>
      </div>

      {/* Offence */}
      {stats && (
        <>
          <div>
            <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
              Offence
            </h3>
            <StatRow label="Total DPS" value={stats.totalDps} color="text-yellow-300" />
            <StatRow label="Hit DPS" value={stats.hitDps} />
            <StatRow label="DoT DPS" value={stats.dotDps} />
            <StatRow label="Crit Chance" value={`${stats.critChance.toFixed(1)}%`} />
            <StatRow label="Crit Multi" value={`${stats.critMulti.toFixed(0)}%`} />
            <StatRow label="Attack Speed" value={`${stats.attackSpeed.toFixed(2)}/s`} />
          </div>

          {/* Defence */}
          <div>
            <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
              Defence
            </h3>
            <StatRow label="Life" value={stats.life} color="text-poe-life" />
            <StatRow label="Energy Shield" value={stats.energyShield} color="text-poe-es" />
            <StatRow label="Mana" value={stats.mana} color="text-poe-mana" />
            <StatRow label="Armour" value={stats.armour} />
            <StatRow label="Evasion" value={stats.evasion} />
          </div>

          {/* Resistances */}
          <div>
            <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
              Resistances
            </h3>
            <ResistRow label="Fire" value={stats.fireRes} color="text-poe-fire" />
            <ResistRow label="Cold" value={stats.coldRes} color="text-poe-cold" />
            <ResistRow label="Lightning" value={stats.lightningRes} color="text-poe-lightning" />
            <ResistRow label="Chaos" value={stats.chaosRes} color="text-poe-chaos" />
          </div>
        </>
      )}

      {/* Skills summary (always shown from parsed data) */}
      <div>
        <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
          Skills ({build.skills.length} groups)
        </h3>
        {build.skills.filter(s => s.enabled).map((group, i) => (
          <div key={i} className="py-1">
            <p className="text-xs text-poe-text">
              {group.gems.filter(g => g.enabled).map(g => g.nameSpec).join(" + ") || "(empty)"}
            </p>
          </div>
        ))}
      </div>

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
