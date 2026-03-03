/**
 * After any PoB mutation (equip item, alloc node, change config, toggle gem, etc.),
 * refresh all derived data in the store. Any change can ripple everywhere.
 */
import type { CalcClient } from "@/worker/calc-client";
import { useBuildStore } from "@/store/build-store";
import { encodeBuildCode } from "@/worker/build-decoder";
import { resolveItemImages } from "@/utils/item-images";
import { resolveGemImages } from "@/utils/item-images";

export async function refreshAll(calcClient: CalcClient) {
  const [displayStats, skills, calcDisplay, items, gems] = await Promise.all([
    calcClient.getDisplayStats(),
    calcClient.getSkills(),
    calcClient.getCalcDisplay(),
    calcClient.getItems(),
    calcClient.getGems(),
  ]);

  const store = useBuildStore.getState();
  store.setDisplayStats(displayStats);
  store.setSkillsData(skills);
  store.setCalcDisplay(calcDisplay);
  store.setEquippedItems(items);
  store.setGemsData(gems);
  store.setGemImageUrls(resolveGemImages(gems));

  // Resolve item images in background
  resolveItemImages(items).then((urls) => {
    useBuildStore.getState().setItemImageUrls(urls);
  });

  // Persist build code
  calcClient.exportBuild().then((xml) => {
    if (xml) useBuildStore.getState().setImportCode(encodeBuildCode(xml));
  }).catch(() => {});
}
