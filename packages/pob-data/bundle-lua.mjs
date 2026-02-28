/**
 * Bundle all PoB Lua source files into a single JSON file for the web worker.
 *
 * Output: packages/web/public/data/pob-lua.json
 * Format: { files: { "relative/path.lua": "content", ... } }
 *
 * The worker downloads this, iterates entries, and writes each into Emscripten's MEMFS.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pobRoot = join(__dirname, "../../vendor/PathOfBuilding-PoE2");
const outDir = join(__dirname, "../web/public/data");

mkdirSync(outDir, { recursive: true });

const files = {};
let totalSize = 0;
let fileCount = 0;

function addFile(fsPath, virtualPath) {
  try {
    const content = readFileSync(fsPath, "utf-8");
    files[virtualPath] = content;
    totalSize += content.length;
    fileCount++;
  } catch (e) {
    console.warn(`  skip: ${virtualPath} (${e.message})`);
  }
}

function addDirSync(fsDir, virtualPrefix, pattern = /\.lua$/, exclude = null) {
  let entries;
  try {
    entries = readdirSync(fsDir, { recursive: true });
  } catch (e) {
    console.warn(`  skip dir: ${fsDir} (${e.message})`);
    return;
  }
  for (const entry of entries) {
    const entryStr = String(entry);
    if (!pattern.test(entryStr)) continue;
    if (exclude && exclude.test(entryStr)) continue;
    const fsPath = join(fsDir, entryStr);
    try {
      if (!statSync(fsPath).isFile()) continue;
    } catch { continue; }
    const virtualPath = virtualPrefix + "/" + entryStr.replace(/\\/g, "/");
    addFile(fsPath, virtualPath);
  }
}

console.log("Bundling PoB Lua files...\n");

// 1. Core source files
console.log("  src/ top-level...");
for (const f of ["Launch.lua", "GameVersions.lua"]) {
  addFile(join(pobRoot, "src", f), `src/${f}`);
}

console.log("  src/Modules/...");
addDirSync(join(pobRoot, "src/Modules"), "src/Modules");

console.log("  src/Classes/...");
addDirSync(join(pobRoot, "src/Classes"), "src/Classes");

console.log("  src/Data/...");
addDirSync(join(pobRoot, "src/Data"), "src/Data");

// TreeData/ - only tree.lua files per version (skip 265MB of images)
console.log("  src/TreeData/ (tree.lua only)...");
for (const ver of ["0_1", "0_2", "0_3", "0_4"]) {
  addFile(join(pobRoot, `src/TreeData/${ver}/tree.lua`), `src/TreeData/${ver}/tree.lua`);
}
addFile(join(pobRoot, "src/TreeData/legion/tree-legion.lua"), "src/TreeData/legion/tree-legion.lua");

// 2. Runtime Lua libraries
console.log("  runtime/lua/...");
addDirSync(join(pobRoot, "runtime/lua"), "runtime/lua");

// 3. manifest.xml (needed by Launch.lua for version info)
console.log("  manifest.xml...");
addFile(join(pobRoot, "manifest.xml"), "src/manifest.xml");

// Write output
const json = JSON.stringify({ files });
const outPath = join(outDir, "pob-lua.json");
writeFileSync(outPath, json);

const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(1);
console.log(`\nDone: ${fileCount} files, ${(totalSize / 1024 / 1024).toFixed(1)}MB source`);
console.log(`Output: ${outPath} (${sizeMB}MB)`);
