import { useBuildStore } from "@/store/build-store";
import type { CalcSection, CalcStatRow } from "@/worker/calc-api";

function formatValue(value: number, decimals: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (decimals > 0) return value.toFixed(decimals);
  return String(Math.round(value));
}

function CalcRow({ row }: { row: CalcStatRow }) {
  const primary = row.values[0];
  if (!primary) return null;
  return (
    <div className="flex justify-between py-0.5 text-xs">
      <span className="text-gray-400">{row.label}</span>
      <span className="text-poe-text">
        {formatValue(primary.value, primary.decimals)}
        {row.values.length > 1 && row.values.slice(1).map((v, i) => (
          <span key={i} className="ml-1 text-gray-500">
            ({formatValue(v.value, v.decimals)})
          </span>
        ))}
      </span>
    </div>
  );
}

function CalcSectionView({ section }: { section: CalcSection }) {
  return (
    <>
      {section.subsections.map((sub, i) => (
        <div key={i}>
          <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
            {sub.label}
          </h3>
          {sub.stats.map((row, j) => (
            <CalcRow key={j} row={row} />
          ))}
        </div>
      ))}
    </>
  );
}

export function DefencePanel() {
  const { calcDisplay, build, calcStatus } = useBuildStore();

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see defences
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

  // Group 3 = Defence, Group 2 = Pools
  const defenceSections = calcDisplay?.filter(s => s.group === 3) ?? [];
  const poolSections = calcDisplay?.filter(s => s.group === 2) ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Build info */}
      <div>
        <h2 className="text-sm font-semibold text-poe-accent">
          {build.ascendancy || build.className}
        </h2>
        <p className="text-xs text-gray-400">
          Level {build.level}
        </p>
      </div>

      {/* Defence sections from CalcDisplay */}
      {defenceSections.map((section) => (
        <CalcSectionView key={section.id} section={section} />
      ))}

      {/* Pool sections from CalcDisplay */}
      {poolSections.map((section) => (
        <CalcSectionView key={section.id} section={section} />
      ))}
    </div>
  );
}
