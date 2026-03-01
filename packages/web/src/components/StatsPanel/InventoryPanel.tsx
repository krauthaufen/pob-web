import { useState, useEffect } from "react";
import { useBuildStore } from "@/store/build-store";
import type { EquippedItem } from "@/worker/calc-api";
import { resolveItemImages } from "@/utils/item-images";

// --- PoB rarity colors (from Data/Global.lua colorCodes) ---
// Rarity strings from PoB are UPPERCASE: "NORMAL", "MAGIC", "RARE", "UNIQUE", "RELIC"
const RARITY_COLOR: Record<string, string> = {
  UNIQUE: "#af6025",
  RELIC: "#60c060",
  RARE: "#ffff77",
  MAGIC: "#8888ff",
  NORMAL: "#c8c8c8",
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

// Weapon set 1
const WEAPON_SET_1: SlotDef[] = [
  { name: "Weapon 1", label: "Weapon", gridArea: "Weapon" },
  { name: "Weapon 2", label: "Offhand", gridArea: "Offhand" },
];

// Weapon set 2 (swap)
const WEAPON_SET_2: SlotDef[] = [
  { name: "Weapon 1 Swap", label: "Weapon", gridArea: "Weapon" },
  { name: "Weapon 2 Swap", label: "Offhand", gridArea: "Offhand" },
];

// Non-weapon equipment slots
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

// poe.ninja-style 7-column grid layout
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

// --- Item detail popover ---
function ItemDetail({ item, onClose }: { item: EquippedItem; onClose: () => void }) {
  const color = rarityColor(item.rarity);

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

        {/* Item header */}
        <div
          className="mb-2 rounded px-3 py-2"
          style={{ borderLeft: `3px solid ${color}`, background: "#121619" }}
        >
          <p className="text-sm font-semibold" style={{ color }}>
            {item.name || item.baseName}
          </p>
          {item.name && item.baseName && item.name !== item.baseName && (
            <p className="text-[11px] text-gray-400">{item.baseName}</p>
          )}
          <div className="mt-0.5 flex gap-2 text-[10px] text-gray-500">
            <span>{item.slot}</span>
            {item.quality > 0 && <span>Quality: {item.quality}%</span>}
            {item.levelReq > 0 && <span>Req: Lv{item.levelReq}</span>}
          </div>
        </div>

        {/* Mods */}
        <div className="rounded px-3 py-2 text-xs" style={{ background: "#121619" }}>
          {item.enchantMods.length > 0 && (
            <div className="mb-1.5">
              {item.enchantMods.map((mod, i) => (
                <p key={`e${i}`} className="leading-relaxed" style={{ color: "#b8daf1" }}>{mod}</p>
              ))}
            </div>
          )}

          {item.implicitMods.length > 0 && (
            <div className="mb-1.5">
              {item.implicitMods.map((mod, i) => (
                <p key={`i${i}`} className="leading-relaxed" style={{ color: "#8888ff" }}>{mod}</p>
              ))}
              <div className="my-1.5 border-b border-gray-700" />
            </div>
          )}

          {item.explicitMods.map((mod, i) => (
            <p key={`x${i}`} className="leading-relaxed" style={{ color: "#8888ff" }}>{mod}</p>
          ))}

          {item.craftedMods.length > 0 && (
            <div className="mt-1.5 border-t border-gray-700 pt-1.5">
              {item.craftedMods.map((mod, i) => (
                <p key={`c${i}`} className="leading-relaxed" style={{ color: "#b8daf1" }}>{mod}</p>
              ))}
            </div>
          )}

          {item.runeMods.length > 0 && (
            <div className="mt-1.5 border-t border-gray-700 pt-1.5">
              {item.runeMods.map((mod, i) => (
                <p key={`r${i}`} className="leading-relaxed" style={{ color: "#5cf0bb" }}>{mod}</p>
              ))}
            </div>
          )}

          {item.implicitMods.length === 0 && item.explicitMods.length === 0 &&
           item.craftedMods.length === 0 && item.enchantMods.length === 0 &&
           item.runeMods.length === 0 && (
            <p className="italic text-gray-600">No mods</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Slot cell ---
function SlotCell({
  slot,
  item,
  imageUrl,
  onClick,
}: {
  slot: SlotDef;
  item: EquippedItem | undefined;
  imageUrl: string | undefined;
  onClick: () => void;
}) {
  const border = item ? rarityColor(item.rarity) : "#2a3038";
  const hasItem = !!item;

  return (
    <button
      className="relative flex flex-col items-center justify-center rounded transition-colors hover:brightness-125"
      style={{
        gridArea: slot.gridArea,
        background: "#121619",
        border: `1px solid ${border}`,
        opacity: hasItem ? 1 : 0.4,
        minHeight: 0,
      }}
      onClick={hasItem ? onClick : undefined}
      title={item ? (item.name || item.baseName) : slot.label}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={item?.name || item?.baseName || slot.label}
          className="h-full w-full object-contain p-0.5"
          loading="lazy"
          style={{ imageRendering: "auto" }}
        />
      ) : (
        <span className="text-[9px] text-gray-600">{slot.label}</span>
      )}
    </button>
  );
}

// --- Main panel ---
export function InventoryPanel() {
  const { equippedItems, build } = useBuildStore();
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1);

  // Resolve images when items change
  useEffect(() => {
    if (!equippedItems || equippedItems.length === 0) return;
    let cancelled = false;
    resolveItemImages(equippedItems).then((urls) => {
      if (!cancelled) setImageUrls(urls);
    });
    return () => { cancelled = true; };
  }, [equippedItems]);

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

  // Build slot→item map
  const itemBySlot = new Map<string, EquippedItem>();
  for (const item of equippedItems) {
    itemBySlot.set(item.slot, item);
  }

  // Check if swap weapons exist
  const hasSwapWeapons = itemBySlot.has("Weapon 1 Swap") || itemBySlot.has("Weapon 2 Swap");
  const weaponSlots = weaponSet === 1 ? WEAPON_SET_1 : WEAPON_SET_2;
  const allSlots = [...weaponSlots, ...EQUIP_SLOTS];

  const selectedItem = selectedSlot ? itemBySlot.get(selectedSlot) : null;

  return (
    <div className="relative flex h-full flex-col" style={{ background: "#0b0e11" }}>
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

        {/* Weapon set toggle */}
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

      {/* poe.ninja-style 8-col equipment grid */}
      <div
        className="mx-auto w-full px-2 pb-3"
        style={{
          display: "grid",
          gridTemplateAreas: GRID_TEMPLATE,
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: "repeat(9, 40px)",
          gap: "3px",
          maxWidth: "310px",
        }}
      >
        {allSlots.map((slot) => (
          <SlotCell
            key={slot.gridArea + slot.name}
            slot={slot}
            item={itemBySlot.get(slot.name)}
            imageUrl={imageUrls[slot.name]}
            onClick={() => setSelectedSlot(slot.name)}
          />
        ))}
      </div>

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
