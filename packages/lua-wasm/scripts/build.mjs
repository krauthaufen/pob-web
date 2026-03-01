// Builds Lua 5.2.4 + bridge.c to WASM via Emscripten
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");
const luaSrc = join(pkgDir, "lua-5.2.4", "src");
const bridgeSrc = join(pkgDir, "src", "bridge.c");
const distDir = join(pkgDir, "dist");

if (!existsSync(luaSrc)) {
  console.error("Lua source not found. Run: npm run download-lua");
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });

// All Lua .c files except lua.c (standalone interpreter) and luac.c (compiler)
const luaCFiles = [
  "lapi.c", "lcode.c", "lctype.c", "ldebug.c", "ldo.c", "ldump.c",
  "lfunc.c", "lgc.c", "llex.c", "lmem.c", "lobject.c", "lopcodes.c",
  "lparser.c", "lstate.c", "lstring.c", "ltable.c", "ltm.c",
  "lundump.c", "lvm.c", "lzio.c",
  "lauxlib.c", "lbaselib.c", "lbitlib.c", "lcorolib.c", "ldblib.c",
  "liolib.c", "lmathlib.c", "loadlib.c", "loslib.c", "lstrlib.c",
  "ltablib.c", "linit.c",
].map(f => join(luaSrc, f));

const allSources = [...luaCFiles, bridgeSrc].join(" ");

const exportedFunctions = [
  "_bridge_init",
  "_bridge_destroy",
  "_bridge_exec",
  "_bridge_dofile",
  "_bridge_set_string",
  "_bridge_set_number",
  "_bridge_get_string",
  "_bridge_get_number",
  "_bridge_call_json",
  "_bridge_stack_top",
  "_bridge_stack_clear",
  "_malloc",
  "_free",
].join(",");

const cmd = [
  "emcc",
  `-I${luaSrc}`,
  "-DLUA_COMPAT_ALL",
  "-O2",
  allSources,
  "-o", join(distDir, "lua.mjs"),
  `-sEXPORTED_FUNCTIONS=${exportedFunctions}`,
  `-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8,FS`,
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sFORCE_FILESYSTEM=1",
  "-sENVIRONMENT=web,worker",
  "-sINITIAL_MEMORY=33554432",
  "-sSTACK_SIZE=1048576",
  "-sUSE_ZLIB=1",
  "--no-entry",
].join(" ");

console.log("Building Lua WASM...");
console.log(cmd);
execSync(cmd, { cwd: pkgDir, stdio: "inherit" });
console.log(`\nBuild complete: ${distDir}/lua.mjs + lua.wasm`);
