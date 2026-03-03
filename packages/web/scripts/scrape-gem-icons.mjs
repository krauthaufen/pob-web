#!/usr/bin/env node
/**
 * Scrape gem icon URLs from poe2db.tw, download them, and write the mapping.
 * Run: node packages/web/scripts/scrape-gem-icons.mjs
 *
 * Downloads icons to public/images/gems/ and writes src/utils/gem-icon-map.json
 * mapping gem name → local filename.
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = resolve(__dirname, "../src/utils/gem-icon-map.json");
const OUT_DIR = resolve(__dirname, "../public/images/gems");

const PAGES = [
  "https://poe2db.tw/us/Skill_Gems",
  "https://poe2db.tw/us/Support_Gems",
];

const REFERER = "https://poe2db.tw/";

async function scrapePage(url) {
  const resp = await fetch(url);
  const html = await resp.text();
  const map = {};

  const imgNameRegex = /<img[^>]*src="(https:\/\/cdn\.poe2db\.tw\/image\/[^"]*?\.webp)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = imgNameRegex.exec(html)) !== null) {
    const url = m[1];
    const name = m[2].trim();
    if (url.includes("skillicons") && name.length > 1 && name.length < 60) {
      if (!map[name]) map[name] = url;
    }
  }

  const nameImgRegex = /<a[^>]*>([^<]+)<\/a>[\s\S]*?<img[^>]*src="(https:\/\/cdn\.poe2db\.tw\/image\/[^"]*?skillicons[^"]*?\.webp)"/gi;
  while ((m = nameImgRegex.exec(html)) !== null) {
    const name = m[1].trim();
    const url = m[2];
    if (name.length > 1 && name.length < 60 && !map[name]) {
      map[name] = url;
    }
  }

  return map;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

async function downloadImage(url, dest) {
  const resp = await fetch(url, { headers: { Referer: REFERER } });
  if (!resp.ok) return false;
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(dest, buf);
  return true;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const allMap = {};
  for (const url of PAGES) {
    process.stderr.write(`Scraping ${url}...\n`);
    const map = await scrapePage(url);
    process.stderr.write(`  Found ${Object.keys(map).length} gems\n`);
    Object.assign(allMap, map);
  }

  const sorted = Object.entries(allMap).sort(([a], [b]) => a.localeCompare(b));
  process.stderr.write(`\nDownloading ${sorted.length} icons...\n`);

  const result = {};
  let ok = 0, fail = 0;

  // Download in batches of 20
  for (let i = 0; i < sorted.length; i += 20) {
    const batch = sorted.slice(i, i + 20);
    await Promise.all(batch.map(async ([name, url]) => {
      const filename = sanitizeFilename(name) + ".webp";
      const dest = resolve(OUT_DIR, filename);
      if (existsSync(dest)) {
        result[name] = filename;
        ok++;
        return;
      }
      const success = await downloadImage(url, dest);
      if (success) {
        result[name] = filename;
        ok++;
      } else {
        fail++;
        process.stderr.write(`  FAIL: ${name}\n`);
      }
    }));
    process.stderr.write(`  ${i + batch.length}/${sorted.length}\r`);
  }

  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2) + "\n");
  process.stderr.write(`\nDone: ${ok} downloaded, ${fail} failed\n`);
  process.stderr.write(`Written to ${OUT_JSON}\n`);
}

main().catch(console.error);
