import { useState, useEffect, useCallback } from "react";
import { useBuildStore } from "@/store/build-store";
import type { CalcClient } from "@/worker/calc-client";
import type { MainSkillStats, SkillDpsEntry, CalcSection, CalcStatRow } from "@/worker/calc-api";

function formatNum(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value % 1 !== 0) return value.toFixed(1);
  return String(Math.round(value));
}

function formatValue(value: number, decimals: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (decimals > 0) return value.toFixed(decimals);
  return String(Math.round(value));
}

const DMG_COLORS: Record<string, string> = {
  Physical: "#c8c8c8",
  Fire: "#b97123",
  Cold: "#3f6db3",
  Lightning: "#adaa47",
  Chaos: "#d02090",
};

const DMG_BAR_COLORS: Record<string, string> = {
  Physical: "#9a9a9a",
  Fire: "#e07020",
  Cold: "#4488dd",
  Lightning: "#d4d040",
  Chaos: "#d040a0",
};

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

interface SkillsPanelProps {
  calcClient?: CalcClient | null;
}

export function SkillsPanel({ calcClient }: SkillsPanelProps) {
  const { skillsData, build, calcStatus, calcDisplay, setCalcDisplay, setDisplayStats, selectedSkillGroup, setSelectedSkillGroup } = useBuildStore();
  const [mainStats, setMainStats] = useState<MainSkillStats | null>(null);
  const [skillDps, setSkillDps] = useState<SkillDpsEntry[]>([]);
  const [fullDps, setFullDps] = useState(0);
  const [switching, setSwitching] = useState(false);

  // Initialize from skillsData when it arrives
  useEffect(() => {
    if (!skillsData) return;
    setMainStats(skillsData.mainSkillStats ?? null);
    setSkillDps(skillsData.skills);
    setFullDps(skillsData.fullDps);
  }, [skillsData]);

  const switchSkill = useCallback(async (index: number) => {
    if (!calcClient || switching) return;
    setSelectedSkillGroup(index);
    setSwitching(true);
    try {
      const result = await calcClient.switchMainSkill(index);
      setMainStats(result.stats);
      setSkillDps(result.skills);
      setFullDps(result.fullDps);
      // Update store's calcDisplay so all panels react
      if (result.display) {
        setCalcDisplay(result.display);
      }
      calcClient.getDisplayStats().then(setDisplayStats).catch(() => {});
    } catch (e) {
      console.error("[PoB] Switch skill failed:", e);
    } finally {
      setSwitching(false);
    }
  }, [calcClient, switching, setCalcDisplay, setDisplayStats, setSelectedSkillGroup]);

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see skills
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

  if (!skillsData || skillsData.groups.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        No skill data available
      </div>
    );
  }

  const groups = skillsData.groups.filter(g => g.enabled);
  const selected = groups.find(g => g.index === selectedSkillGroup);

  // Offence sections from CalcDisplay (group 1)
  const offenceSections = calcDisplay?.filter(s => s.group === 1) ?? [];

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Skill selector dropdown — show active skill names only */}
      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-gray-500">
          Main Skill
        </label>
        <select
          className="w-full rounded border border-poe-border bg-poe-bg px-2 py-1.5 text-xs text-poe-text focus:border-poe-accent focus:outline-none"
          value={selectedSkillGroup}
          onChange={(e) => switchSkill(Number(e.target.value))}
          disabled={switching}
        >
          {groups.map((g) => {
            // Show active skill names, not support gems or raw label
            const name = g.activeSkillNames.length > 0
              ? g.activeSkillNames.join(", ")
              : g.label || `Group ${g.index}`;
            const suffix = g.slot ? ` (${g.slot})` : "";
            return (
              <option key={g.index} value={g.index}>
                {name}{suffix}
              </option>
            );
          })}
        </select>
      </div>

      {/* DPS headline */}
      {mainStats && (mainStats.CombinedDPS > 0 || mainStats.TotalDPS > 0) && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">
            {switching ? "Recalculating..." : (selected?.activeSkillNames.join(", ") || "Selected Skill")}
          </span>
          <span className="font-medium text-yellow-300">
            {formatNum(mainStats.CombinedDPS || mainStats.TotalDPS)} DPS
          </span>
        </div>
      )}

      {/* Damage type breakdown */}
      {mainStats && mainStats.damageTypes && Object.keys(mainStats.damageTypes).length > 0 && (() => {
        const types = mainStats.damageTypes;
        const totalAvg = Object.values(types).reduce((s, t) => s + t.average, 0);
        const speed = mainStats.Speed || mainStats.CastSpeed || 1;
        const hitDps = mainStats.CombinedDPS || mainStats.TotalDPS || 0;
        // Order: Physical, Fire, Cold, Lightning, Chaos
        const order = ["Physical", "Fire", "Cold", "Lightning", "Chaos"] as const;
        const active = order.filter((dt) => types[dt] && types[dt]!.average > 0);
        if (active.length === 0) return null;
        return (
          <div>
            <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
              Damage Breakdown
            </h3>
            {/* Proportional bar */}
            <div className="mb-2 flex h-2.5 overflow-hidden rounded-sm">
              {active.map((dt) => {
                const pct = totalAvg > 0 ? (types[dt]!.average / totalAvg) * 100 : 0;
                return (
                  <div
                    key={dt}
                    style={{ width: `${pct}%`, background: DMG_BAR_COLORS[dt], minWidth: pct > 0 ? 2 : 0 }}
                  />
                );
              })}
            </div>
            {/* Per-type rows */}
            {active.map((dt) => {
              const t = types[dt]!;
              const pct = totalAvg > 0 ? (t.average / totalAvg) * 100 : 0;
              const dps = hitDps > 0 && totalAvg > 0 ? hitDps * (t.average / totalAvg) : t.average * speed;
              return (
                <div key={dt} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: DMG_BAR_COLORS[dt] }} />
                    <span style={{ color: DMG_COLORS[dt] }}>{dt}</span>
                    <span className="text-[10px] text-gray-600">({pct.toFixed(0)}%)</span>
                  </span>
                  <span className="text-gray-300">
                    <span className="text-gray-500">{formatNum(t.min)}-{formatNum(t.max)}</span>
                    <span className="ml-2">{formatNum(dps)} dps</span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Combined Full DPS */}
      {fullDps > 0 && (
        <div>
          <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
            Combined DPS
          </h3>
          <div className="flex justify-between py-0.5 text-xs">
            <span className="text-gray-400">Full DPS (all skills)</span>
            <span className="font-medium text-yellow-300">{formatNum(fullDps)}</span>
          </div>
        </div>
      )}

      {/* Per-skill DPS breakdown */}
      {skillDps.length > 0 && (
        <div>
          <h3 className="mb-1 border-b border-poe-border pb-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
            Skill DPS Breakdown
          </h3>
          {skillDps.map((skill, i) => (
            <div key={i} className="flex items-center justify-between py-0.5 text-xs">
              <span className="text-gray-300">
                {skill.name}
                {skill.trigger && (
                  <span className="ml-1 text-[10px] text-gray-500">({skill.trigger})</span>
                )}
                {skill.count > 1 && (
                  <span className="ml-1 text-[10px] text-gray-500">x{skill.count}</span>
                )}
              </span>
              <span className="text-poe-text">{formatNum(skill.dps)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Offence detail sections from CalcDisplay */}
      {offenceSections.map((section) => (
        <CalcSectionView key={section.id} section={section} />
      ))}
    </div>
  );
}
