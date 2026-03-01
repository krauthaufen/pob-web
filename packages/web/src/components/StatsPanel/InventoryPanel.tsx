import { useBuildStore } from "@/store/build-store";
import type { EquippedItem } from "@/worker/calc-api";

const RARITY_COLORS: Record<string, string> = {
  Unique: "border-poe-accent text-poe-accent",
  Rare: "border-yellow-400 text-yellow-400",
  Magic: "border-blue-400 text-blue-400",
  Normal: "border-gray-500 text-gray-300",
};

const RARITY_BG: Record<string, string> = {
  Unique: "bg-poe-accent/10",
  Rare: "bg-yellow-400/10",
  Magic: "bg-blue-400/10",
  Normal: "bg-gray-500/10",
};

// Slot display order
const SLOT_ORDER = [
  "Weapon 1", "Weapon 1 Swap",
  "Weapon 2", "Weapon 2 Swap",
  "Helmet", "Body Armour", "Gloves", "Boots",
  "Amulet", "Ring 1", "Ring 2", "Belt",
  "Flask 1", "Flask 2", "Flask 3", "Flask 4", "Flask 5",
];

function ItemCard({ item }: { item: EquippedItem }) {
  const colors = RARITY_COLORS[item.rarity] ?? RARITY_COLORS.Normal;
  const bg = RARITY_BG[item.rarity] ?? RARITY_BG.Normal;

  return (
    <div className={`rounded border ${colors} ${bg} mb-2`}>
      {/* Header */}
      <div className="border-b border-inherit px-3 py-1.5">
        <p className="text-xs font-semibold">{item.name || item.baseName}</p>
        {item.name && item.baseName && item.name !== item.baseName && (
          <p className="text-[10px] text-gray-400">{item.baseName}</p>
        )}
        <div className="flex gap-2 text-[10px] text-gray-500">
          <span>{item.slot}</span>
          {item.quality > 0 && <span>Quality: {item.quality}%</span>}
        </div>
      </div>

      {/* Mods */}
      <div className="px-3 py-1.5 text-xs">
        {/* Enchant mods */}
        {item.enchantMods.length > 0 && (
          <div className="mb-1">
            {item.enchantMods.map((mod, i) => (
              <p key={`e${i}`} className="text-cyan-300">{mod}</p>
            ))}
          </div>
        )}

        {/* Implicit mods */}
        {item.implicitMods.length > 0 && (
          <div className="mb-1">
            {item.implicitMods.map((mod, i) => (
              <p key={`i${i}`} className="text-blue-300">{mod}</p>
            ))}
            <div className="my-1 border-b border-gray-700" />
          </div>
        )}

        {/* Explicit mods */}
        {item.explicitMods.map((mod, i) => (
          <p key={`x${i}`} className="text-gray-200">{mod}</p>
        ))}

        {/* Crafted mods */}
        {item.craftedMods.map((mod, i) => (
          <p key={`c${i}`} className="text-cyan-400">{mod}</p>
        ))}

        {/* Rune mods */}
        {item.runeMods.length > 0 && (
          <div className="mt-1 border-t border-gray-700 pt-1">
            {item.runeMods.map((mod, i) => (
              <p key={`r${i}`} className="text-green-300">{mod}</p>
            ))}
          </div>
        )}

        {/* Empty item */}
        {item.implicitMods.length === 0 && item.explicitMods.length === 0 &&
         item.craftedMods.length === 0 && item.enchantMods.length === 0 &&
         item.runeMods.length === 0 && (
          <p className="text-gray-600 italic">No mods</p>
        )}
      </div>
    </div>
  );
}

export function InventoryPanel() {
  const { equippedItems, build } = useBuildStore();

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

  // Sort by slot order
  const sorted = [...equippedItems].sort((a, b) => {
    const ai = SLOT_ORDER.indexOf(a.slot);
    const bi = SLOT_ORDER.indexOf(b.slot);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="flex flex-col gap-1 p-4">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-poe-accent">
          {build.ascendancy || build.className}
        </h2>
        <p className="text-xs text-gray-400">
          {sorted.length} items equipped
        </p>
      </div>
      {sorted.map((item, i) => (
        <ItemCard key={`${item.slot}-${i}`} item={item} />
      ))}
    </div>
  );
}
