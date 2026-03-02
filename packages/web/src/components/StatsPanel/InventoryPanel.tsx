import { useState, useRef } from "react";
import { useBuildStore } from "@/store/build-store";
import type { EquippedItem, ModLine, JewelInfo } from "@/worker/calc-api";

// --- PoB rarity colors (from Data/Global.lua colorCodes) ---
const RARITY_COLOR: Record<string, string> = {
  UNIQUE: "#af6025",
  RELIC: "#60c060",
  RARE: "#ffff77",
  MAGIC: "#8888ff",
  NORMAL: "#c8c8c8",
};
const RARITY_BG: Record<string, string> = {
  UNIQUE: "#2b1a0e",
  RELIC: "#0e2b10",
  RARE: "#2b2b0e",
  MAGIC: "#121230",
  NORMAL: "#1a1a1a",
};

// Mod type colors matching in-game
const MOD_COLORS = {
  magic: "#8888ff",      // normal explicit
  crafted: "#b8daf1",    // benchcraft
  enchant: "#b8daf1",    // enchantments
  fractured: "#a29162",  // fractured (gold-ish)
  corrupted: "#d20000",  // corruption implicit
  rune: "#5cf0bb",       // rune mods
  bonded: "#5cf0bb",     // bonded rune mods (same as rune)
  implicit: "#8888ff",   // regular implicit
  unsupported: "#f05050",
};

function rarityColor(rarity: string): string {
  return RARITY_COLOR[rarity] ?? "#c8c8c8";
}

// --- Grid slot definitions ---
type SlotDef = {
  name: string;
  label: string;
  gridArea: string;
};

const WEAPON_SET_1: SlotDef[] = [
  { name: "Weapon 1", label: "Weapon", gridArea: "Weapon" },
  { name: "Weapon 2", label: "Offhand", gridArea: "Offhand" },
];
const WEAPON_SET_2: SlotDef[] = [
  { name: "Weapon 1 Swap", label: "Weapon", gridArea: "Weapon" },
  { name: "Weapon 2 Swap", label: "Offhand", gridArea: "Offhand" },
];
const EQUIP_SLOTS: SlotDef[] = [
  { name: "Helmet", label: "Helm", gridArea: "Helm" },
  { name: "Body Armour", label: "Body", gridArea: "Body" },
  { name: "Amulet", label: "Amulet", gridArea: "Amulet" },
  { name: "Gloves", label: "Gloves", gridArea: "Gloves" },
  { name: "Belt", label: "Belt", gridArea: "Belt" },
  { name: "Boots", label: "Boots", gridArea: "Boots" },
  { name: "Ring 1", label: "Ring", gridArea: "Ring1" },
  { name: "Ring 2", label: "Ring", gridArea: "Ring2" },
  { name: "Flask 1", label: "Flask", gridArea: "Flask1" },
  { name: "Charm 1", label: "Charm", gridArea: "Charm1" },
  { name: "Charm 2", label: "Charm", gridArea: "Charm2" },
  { name: "Charm 3", label: "Charm", gridArea: "Charm3" },
  { name: "Flask 2", label: "Flask", gridArea: "Flask2" },
];

const GRID_TEMPLATE = `
  "Weapon Weapon Helm   Helm   .      Offhand Offhand"
  "Weapon Weapon Helm   Helm   .      Offhand Offhand"
  "Weapon Weapon Body   Body   Amulet Offhand Offhand"
  "Weapon Weapon Body   Body   .      Offhand Offhand"
  ".      Ring1  Body   Body   Ring2  .       ."
  "Gloves Gloves Belt   Belt   Boots  Boots   ."
  "Gloves Gloves .      .      Boots  Boots   ."
  "Flask1 .      Charm1 Charm2 Charm3 .       Flask2"
  "Flask1 .      .      .      .      .       Flask2"
`;

// --- Separator line ---
function Sep() {
  return <div className="my-1.5 border-b border-gray-700/60" />;
}

// --- Stat line (grey label, coloured value) ---
function StatLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <p className="text-[11px]">
      <span className="text-gray-500">{label}: </span>
      <span style={{ color: color || "#8888ff" }}>{value}</span>
    </p>
  );
}

// --- Mod line renderer ---
function ModLineView({ mod, isImplicit, isCorrupted, isRune }: { mod: ModLine; isImplicit?: boolean; isCorrupted?: boolean; isRune?: boolean }) {
  let color = MOD_COLORS.magic;
  if (mod.bonded) color = MOD_COLORS.bonded;
  else if (mod.crafted) color = MOD_COLORS.crafted;
  else if (mod.fractured) color = MOD_COLORS.fractured;
  else if (mod.desecrated) color = MOD_COLORS.corrupted;
  else if (mod.mutated) color = MOD_COLORS.corrupted;
  else if (isImplicit && isCorrupted) color = MOD_COLORS.corrupted;
  else if (isImplicit) color = MOD_COLORS.implicit;
  else if (isRune) color = MOD_COLORS.rune;

  return (
    <p className="text-[11px] leading-relaxed" style={{ color }}>
      {mod.line}
      {mod.fractured && <span className="ml-1 text-[9px] text-gray-600">(fractured)</span>}
      {mod.bonded && <span className="ml-1 text-[9px] text-gray-600">(bonded)</span>}
    </p>
  );
}

// --- Reusable item detail body (shared between click panel and hover tooltip) ---
export function ItemDetailBody({ item }: { item: EquippedItem }) {
  const color = rarityColor(item.rarity);
  const bg = RARITY_BG[item.rarity] ?? "#1a1a1a";
  const w = item.weapon;
  const a = item.armour;

  return (
    <>
      {/* Item header — rarity-coloured box */}
      <div
        className="mb-0 rounded-t px-3 py-2 text-center"
        style={{ background: bg, borderTop: `2px solid ${color}` }}
      >
        {item.name && (
          <p className="text-sm font-semibold" style={{ color }}>{item.name}</p>
        )}
        {item.baseName && (!item.name || item.name !== item.baseName) && (
          <p className="text-sm" style={{ color }}>{item.baseName}</p>
        )}
        {(!item.name && !item.baseName) && (
          <p className="text-sm" style={{ color }}>{item.slot}</p>
        )}
      </div>

      {/* Stats body */}
      <div className="rounded-b px-3 py-2 text-xs" style={{ background: "#121619", borderBottom: `1px solid ${color}40` }}>
        {/* Item type */}
        <p className="text-[11px] text-gray-500">{item.itemType}</p>

        {/* Quality — catalyst quality for jewelry, normal quality otherwise */}
        {item.catalystType && item.catalystQuality != null && item.catalystQuality > 0 ? (
          <StatLine label={`Quality (${item.catalystType})`} value={`+${item.catalystQuality}% (augmented)`} />
        ) : item.quality > 0 ? (
          <StatLine label="Quality" value={`+${item.quality}%`} />
        ) : null}

        {/* Spirit */}
        {item.spirit && item.spirit > 0 && (
          <StatLine label="Spirit" value={String(item.spirit)} />
        )}

        {/* Weapon stats */}
        {w && (
          <>
            {(w.physMin != null && w.physMax != null) && (
              <StatLine label="Physical Damage" value={`${Math.round(w.physMin)}-${Math.round(w.physMax)}`} />
            )}
            {(w.fireMin != null || w.coldMin != null || w.lightningMin != null) && (
              <p className="text-[11px]">
                <span className="text-gray-500">Elemental Damage: </span>
                {w.fireMin != null && <span style={{ color: "#b97123" }}>{Math.round(w.fireMin)}-{Math.round(w.fireMax!)}</span>}
                {w.fireMin != null && (w.coldMin != null || w.lightningMin != null) && <span className="text-gray-600">, </span>}
                {w.coldMin != null && <span style={{ color: "#3f6db3" }}>{Math.round(w.coldMin)}-{Math.round(w.coldMax!)}</span>}
                {w.coldMin != null && w.lightningMin != null && <span className="text-gray-600">, </span>}
                {w.lightningMin != null && <span style={{ color: "#adaa47" }}>{Math.round(w.lightningMin)}-{Math.round(w.lightningMax!)}</span>}
              </p>
            )}
            {(w.chaosMin != null) && (
              <StatLine label="Chaos Damage" value={`${Math.round(w.chaosMin)}-${Math.round(w.chaosMax!)}`} color="#d02090" />
            )}
            {w.critChance != null && (
              <StatLine label="Critical Hit Chance" value={`${w.critChance.toFixed(2)}%`} />
            )}
            {w.aps != null && (
              <StatLine label="Attacks per Second" value={w.aps.toFixed(2)} />
            )}
            {w.range != null && w.range < 120 && (
              <StatLine label="Weapon Range" value={`${(w.range / 10).toFixed(1)} metres`} />
            )}
            <Sep />
            {w.physDps != null && <StatLine label="Physical DPS" value={w.physDps.toFixed(1)} />}
            {w.elemDps != null && <StatLine label="Elemental DPS" value={w.elemDps.toFixed(1)} />}
            {w.chaosDps != null && <StatLine label="Chaos DPS" value={w.chaosDps.toFixed(1)} color="#d02090" />}
            {w.totalDps != null && (w.physDps != null ? 1 : 0) + (w.elemDps != null ? 1 : 0) + (w.chaosDps != null ? 1 : 0) > 1 && (
              <StatLine label="Total DPS" value={w.totalDps.toFixed(1)} />
            )}
          </>
        )}

        {/* Armour stats */}
        {a && (
          <>
            {a.blockChance != null && <StatLine label="Chance to Block" value={`${a.blockChance}%`} />}
            {a.armour != null && <StatLine label="Armour" value={String(a.armour)} />}
            {a.evasion != null && <StatLine label="Evasion Rating" value={String(a.evasion)} />}
            {a.energyShield != null && <StatLine label="Energy Shield" value={String(a.energyShield)} />}
            {a.ward != null && <StatLine label="Ward" value={String(a.ward)} />}
          </>
        )}

        {/* Flask stats */}
        {item.flask && (
          <>
            {item.flask.lifeGradual != null && item.flask.lifeGradual !== 0 && (
              <p className="text-[11px] text-gray-400">
                Recovers <span style={{ color: "#8888ff" }}>{item.flask.lifeGradual}</span> Life over <span style={{ color: "#8888ff" }}>{item.flask.duration?.toFixed(1)}0</span> Seconds
              </p>
            )}
            {item.flask.lifeInstant != null && item.flask.lifeInstant !== 0 && (
              <p className="text-[11px] text-gray-400">
                Recovers <span style={{ color: "#8888ff" }}>{item.flask.lifeInstant}</span> Life instantly
              </p>
            )}
            {item.flask.manaGradual != null && item.flask.manaGradual !== 0 && (
              <p className="text-[11px] text-gray-400">
                Recovers <span style={{ color: "#8888ff" }}>{item.flask.manaGradual}</span> Mana over <span style={{ color: "#8888ff" }}>{item.flask.duration?.toFixed(1)}0</span> Seconds
              </p>
            )}
            {item.flask.chargesUsed != null && (
              <p className="text-[11px] text-gray-400">
                Consumes <span style={{ color: "#8888ff" }}>{item.flask.chargesUsed}</span> of <span style={{ color: "#8888ff" }}>{item.flask.chargesMax}</span> Charges on use
              </p>
            )}
          </>
        )}

        {/* Charm stats */}
        {item.charm && (
          <>
            {item.charm.duration != null && (
              <p className="text-[11px] text-gray-400">
                Lasts <span style={{ color: "#8888ff" }}>{item.charm.duration.toFixed(2)}</span> Seconds
              </p>
            )}
            {item.charm.chargesUsed != null && (
              <p className="text-[11px] text-gray-400">
                Consumes <span style={{ color: "#8888ff" }}>{item.charm.chargesUsed}</span> of <span style={{ color: "#8888ff" }}>{item.charm.chargesMax}</span> Charges on use
              </p>
            )}
          </>
        )}

        {/* Buff mods (flask/charm effects) */}
        {item.buffMods && item.buffMods.length > 0 && (
          <>
            <Sep />
            {item.buffMods.map((mod, i) => (
              <p key={`b${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.magic }}>{mod.line}</p>
            ))}
          </>
        )}


        {/* Requirements */}
        {(item.levelReq > 0 || item.requirements) && (
          <>
            <Sep />
            <p className="text-[11px] text-gray-500">
              Requires
              {item.levelReq > 0 && <span> Level <span className="text-gray-300">{item.levelReq}</span></span>}
              {item.requirements?.str ? <>, <span className="text-gray-300">{item.requirements.str}</span> Str</> : null}
              {item.requirements?.dex ? <>, <span className="text-gray-300">{item.requirements.dex}</span> Dex</> : null}
              {item.requirements?.int ? <>, <span className="text-gray-300">{item.requirements.int}</span> Int</> : null}
            </p>
          </>
        )}

        {/* Enchant mods */}
        {item.enchantMods.length > 0 && (
          <>
            <Sep />
            {item.enchantMods.map((mod, i) => (
              <p key={`e${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.enchant }}>{mod.line}</p>
            ))}
          </>
        )}

        {/* Rune mods */}
        {item.runeMods.length > 0 && (
          <>
            <Sep />
            {item.runeMods.map((mod, i) => (
              <ModLineView key={`r${i}`} mod={mod} isRune />
            ))}
          </>
        )}

        {/* Implicit mods — above separator, styled differently from explicits */}
        {item.implicitMods.length > 0 && (
          <>
            <Sep />
            {item.implicitMods.map((mod, i) => (
              <ModLineView key={`i${i}`} mod={mod} isImplicit isCorrupted={item.corrupted} />
            ))}
          </>
        )}

        {/* Explicit mods (includes crafted with flag) */}
        {item.explicitMods.length > 0 && (
          <>
            <Sep />
            {item.explicitMods.map((mod, i) => (
              <ModLineView key={`x${i}`} mod={mod} />
            ))}
          </>
        )}

        {/* Corrupted / Mirrored label */}
        {(item.corrupted || item.doubleCorrupted || item.mirrored) && (
          <>
            <Sep />
            {item.mirrored && (
              <p className="text-[11px] font-semibold" style={{ color: MOD_COLORS.corrupted }}>Mirrored</p>
            )}
            {item.doubleCorrupted ? (
              <p className="text-[11px] font-semibold" style={{ color: MOD_COLORS.corrupted }}>Twice Corrupted</p>
            ) : item.corrupted ? (
              <p className="text-[11px] font-semibold" style={{ color: MOD_COLORS.corrupted }}>Corrupted</p>
            ) : null}
          </>
        )}

        {/* Influences */}
        {item.influences.length > 0 && (
          <p className="mt-1 text-[10px] text-gray-500">{item.influences.join(", ")}</p>
        )}

        {/* No mods at all */}
        {item.implicitMods.length === 0 && item.explicitMods.length === 0 &&
         item.enchantMods.length === 0 && item.runeMods.length === 0 &&
         !item.buffMods?.length && !item.weapon && !item.armour && !item.flask && !item.charm && (
          <p className="mt-1 italic text-gray-600">No mods</p>
        )}
      </div>
    </>
  );
}

// --- Jewel detail body (same rarity colors/layout as item detail) ---
export function JewelDetailBody({ jewel }: { jewel: JewelInfo }) {
  const color = rarityColor(jewel.rarity.toUpperCase());
  const bg = RARITY_BG[jewel.rarity.toUpperCase()] ?? "#1a1a1a";

  return (
    <>
      {/* Header — rarity-coloured box, same as item detail */}
      <div
        className="mb-0 rounded-t px-3 py-2 text-center"
        style={{ background: bg, borderTop: `2px solid ${color}` }}
      >
        <p className="text-sm font-semibold" style={{ color }}>{jewel.name}</p>
        {jewel.baseName && jewel.baseName !== jewel.name && (
          <p className="text-sm" style={{ color }}>{jewel.baseName}</p>
        )}
      </div>

      {/* Mods body */}
      <div className="rounded-b px-3 py-2 text-xs" style={{ background: "#121619", borderBottom: `1px solid ${color}40` }}>
        {/* Enchant mods */}
        {jewel.enchantMods.length > 0 && (
          <>
            {jewel.enchantMods.map((mod, i) => (
              <p key={`e${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.enchant }}>{mod}</p>
            ))}
            <Sep />
          </>
        )}

        {/* Rune mods */}
        {jewel.runeMods.length > 0 && (
          <>
            {jewel.runeMods.map((mod, i) => (
              <p key={`r${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.rune }}>{mod}</p>
            ))}
            <Sep />
          </>
        )}

        {/* Implicit mods */}
        {jewel.implicitMods.length > 0 && (
          <>
            {jewel.implicitMods.map((mod, i) => (
              <p key={`i${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.implicit }}>{mod}</p>
            ))}
          </>
        )}

        {/* Separator between implicit and explicit */}
        {jewel.implicitMods.length > 0 && jewel.explicitMods.length > 0 && <Sep />}

        {/* Explicit mods */}
        {jewel.explicitMods.length > 0 && (
          <>
            {jewel.explicitMods.map((mod, i) => (
              <p key={`x${i}`} className="text-[11px] leading-relaxed" style={{ color: MOD_COLORS.magic }}>{mod}</p>
            ))}
          </>
        )}

        {/* No mods */}
        {jewel.implicitMods.length === 0 && jewel.explicitMods.length === 0 &&
         jewel.enchantMods.length === 0 && jewel.runeMods.length === 0 && (
          <p className="italic text-gray-600">No mods</p>
        )}
      </div>
    </>
  );
}

// --- Item detail click-through panel (mobile/touch) ---
function ItemDetail({ item, onClose }: { item: EquippedItem; onClose: () => void }) {
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
        <ItemDetailBody item={item} />
      </div>
    </div>
  );
}

// PoE2 socket overlay — shown as squares at the bottom of the item cell
function SocketOverlay({ sockets, runeNames, runeImageUrls }: { sockets: number; runeNames?: string[]; runeImageUrls?: Record<string, string> }) {
  const count = sockets;
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center gap-0.5 p-[2px]">
      {Array.from({ length: count }, (_, i) => {
        const name = runeNames?.[i];
        const filled = !!name;
        const imgUrl = name ? runeImageUrls?.[name] : undefined;
        return (
          <div
            key={i}
            className="flex items-center justify-center overflow-hidden rounded-sm"
            style={{
              width: 20,
              height: 20,
              border: `1px solid ${filled ? "#5cf0bb88" : "#333"}`,
              background: filled ? "#0a1a12cc" : "#0a0a0acc",
            }}
            title={name || "Empty socket"}
          >
            {imgUrl ? (
              <img src={imgUrl} alt={name!} className="h-[18px] w-[18px] object-contain" />
            ) : filled ? (
              <span className="text-[7px] font-bold leading-none" style={{ color: "#5cf0bb" }}>
                {name!.split(" ")[0]}
              </span>
            ) : (
              <div className="h-2.5 w-2.5 rounded-sm border border-gray-700 bg-gray-900" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Slot cell ---
function SlotCell({
  slot,
  item,
  imageUrl,
  runeImageUrls,
  onClick,
  onHover,
  onHoverEnd,
}: {
  slot: SlotDef;
  item: EquippedItem | undefined;
  imageUrl: string | undefined;
  runeImageUrls: Record<string, string>;
  onClick: () => void;
  onHover: (rect: DOMRect) => void;
  onHoverEnd: () => void;
}) {
  const border = item ? rarityColor(item.rarity) : "#2a3038";
  const hasItem = !!item;
  const loading = hasItem && !imageUrl;
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      className="relative flex flex-col items-center justify-center rounded transition-colors hover:brightness-125"
      style={{
        gridArea: slot.gridArea,
        background: "#121619",
        border: `1px solid ${border}`,
        opacity: hasItem ? 1 : 0.4,
      }}
      onClick={hasItem ? onClick : undefined}
      onMouseEnter={() => { if (hasItem && ref.current) onHover(ref.current.getBoundingClientRect()); }}
      onMouseLeave={onHoverEnd}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={item?.name || item?.baseName || slot.label}
          className="h-full w-full object-contain p-0.5"
          loading="lazy"
          style={{ imageRendering: "auto" }}
        />
      ) : loading ? (
        <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#333" strokeWidth="2" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="#666" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <span className="text-[9px] text-gray-600">{slot.label}</span>
      )}
      {/* Socket overlay */}
      {item?.sockets != null && item.sockets > 0 && (
        <SocketOverlay sockets={item.sockets} runeNames={item.runeNames} runeImageUrls={runeImageUrls} />
      )}
    </button>
  );
}

// --- Jewel cell for the jewel row ---
function JewelCell({
  jewel,
  imageUrl,
  onClick,
  onHover,
  onHoverEnd,
}: {
  jewel: JewelInfo;
  imageUrl?: string;
  onClick: () => void;
  onHover: (rect: DOMRect) => void;
  onHoverEnd: () => void;
}) {
  const color = rarityColor(jewel.rarity.toUpperCase());
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      className="flex flex-col items-center gap-0.5 rounded px-1 py-1 transition hover:bg-gray-800"
      onClick={onClick}
      onMouseEnter={() => { if (ref.current) onHover(ref.current.getBoundingClientRect()); }}
      onMouseLeave={onHoverEnd}
      title={`${jewel.name} — Click to locate on tree`}
    >
      <div
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded"
        style={{ border: `1px solid ${color}`, background: "#121619" }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={jewel.name} className="h-7 w-7 object-contain" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={color} opacity="0.7">
            <path d="M8 1L14 8L8 15L2 8Z" />
          </svg>
        )}
      </div>
      <span className="max-w-[56px] truncate text-[8px] leading-tight" style={{ color }}>
        {jewel.name}
      </span>
    </button>
  );
}

// --- Main panel ---
export function InventoryPanel() {
  const { equippedItems, build, itemImageUrls: imageUrls, runeImageUrls, jewelImageUrls, jewelData, focusNode } = useBuildStore();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1);
  const [hoveredItem, setHoveredItem] = useState<{ item: EquippedItem; rect: DOMRect } | null>(null);
  const [hoveredJewel, setHoveredJewel] = useState<{ jewel: JewelInfo; rect: DOMRect } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  if (!build) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Import a build to see items
      </div>
    );
  }

  if (!equippedItems || equippedItems.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        No equipped items
      </div>
    );
  }

  const itemBySlot = new Map<string, EquippedItem>();
  for (const item of equippedItems) {
    itemBySlot.set(item.slot, item);
  }

  const hasSwapWeapons = itemBySlot.has("Weapon 1 Swap") || itemBySlot.has("Weapon 2 Swap");
  const weaponSlots = weaponSet === 1 ? WEAPON_SET_1 : WEAPON_SET_2;
  const allSlots = [...weaponSlots, ...EQUIP_SLOTS];

  const selectedItem = selectedSlot ? itemBySlot.get(selectedSlot) : null;

  // Collect jewels from jewelData
  const jewels = jewelData ? Object.entries(jewelData).filter(([, j]) => j.name) : [];

  return (
    <div ref={panelRef} className="relative flex h-full flex-col" style={{ background: "#0b0e11" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#af6025" }}>
            {build.ascendancy || build.className}
          </h2>
          <p className="text-[10px] text-gray-500">
            {equippedItems.length} items equipped
          </p>
        </div>

        {hasSwapWeapons && (
          <div className="flex gap-1">
            <button
              className="rounded border px-2 py-0.5 text-[10px] font-bold"
              style={{
                borderColor: weaponSet === 1 ? "#8888ff" : "#2a3038",
                color: weaponSet === 1 ? "#8888ff" : "#555",
                background: weaponSet === 1 ? "#8888ff15" : "transparent",
              }}
              onClick={() => setWeaponSet(1)}
            >
              I
            </button>
            <button
              className="rounded border px-2 py-0.5 text-[10px] font-bold"
              style={{
                borderColor: weaponSet === 2 ? "#8888ff" : "#2a3038",
                color: weaponSet === 2 ? "#8888ff" : "#555",
                background: weaponSet === 2 ? "#8888ff15" : "transparent",
              }}
              onClick={() => setWeaponSet(2)}
            >
              II
            </button>
          </div>
        )}
      </div>

      {/* Equipment grid */}
      <div
        className="mx-auto w-full px-2 pb-2"
        style={{
          display: "grid",
          gridTemplateAreas: GRID_TEMPLATE,
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "repeat(9, 40px)",
          gap: "3px",
          maxWidth: "310px",
        }}
      >
        {allSlots.map((slot) => {
          const item = itemBySlot.get(slot.name);
          return (
            <SlotCell
              key={slot.gridArea + slot.name}
              slot={slot}
              item={item}
              imageUrl={imageUrls[slot.name]}
              runeImageUrls={runeImageUrls}
              onClick={() => setSelectedSlot(slot.name)}
              onHover={(rect) => { if (item) setHoveredItem({ item, rect }); }}
              onHoverEnd={() => setHoveredItem(null)}
            />
          );
        })}
      </div>

      {/* Jewel row */}
      {jewels.length > 0 && (
        <div className="border-t border-gray-800 px-2 py-1.5">
          <p className="mb-1 text-[9px] uppercase tracking-wider text-gray-600">Jewels</p>
          <div className="flex flex-wrap gap-1">
            {jewels.map(([hash, jewel]) => (
              <JewelCell
                key={hash}
                jewel={jewel}
                imageUrl={jewelImageUrls[jewel.name]}
                onClick={() => focusNode(Number(hash))}
                onHover={(rect) => setHoveredJewel({ jewel, rect })}
                onHoverEnd={() => setHoveredJewel(null)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hover tooltip (mouse only, fixed position to escape sidebar clipping) */}
      {hoveredItem && !selectedItem && (() => {
        const cellRect = hoveredItem.rect;
        const rightSpace = window.innerWidth - cellRect.right;
        const useRight = rightSpace < 280;
        const left = useRight ? Math.max(8, cellRect.left - 264) : cellRect.right + 8;
        const top = Math.max(8, Math.min(cellRect.top, window.innerHeight - 300));
        return (
          <div
            className="pointer-events-none fixed z-[9999] max-h-[80vh] w-[260px] overflow-y-auto rounded border border-poe-border shadow-2xl"
            style={{ left, top, background: "#0d1014f8" }}
          >
            <ItemDetailBody item={hoveredItem.item} />
          </div>
        );
      })()}

      {/* Jewel hover tooltip */}
      {hoveredJewel && !selectedItem && (() => {
        const cellRect = hoveredJewel.rect;
        const rightSpace = window.innerWidth - cellRect.right;
        const useRight = rightSpace < 280;
        const left = useRight ? Math.max(8, cellRect.left - 264) : cellRect.right + 8;
        const top = Math.max(8, Math.min(cellRect.top, window.innerHeight - 300));
        return (
          <div
            className="pointer-events-none fixed z-[9999] max-h-[80vh] w-[260px] overflow-y-auto rounded border border-poe-border shadow-2xl"
            style={{ left, top, background: "#0d1014f8" }}
          >
            <JewelDetailBody jewel={hoveredJewel.jewel} />
          </div>
        );
      })()}

      {/* Detail overlay */}
      {selectedItem && (
        <ItemDetail
          item={selectedItem}
          onClose={() => setSelectedSlot(null)}
        />
      )}
    </div>
  );
}
