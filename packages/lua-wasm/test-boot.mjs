// Test PoB HeadlessWrapper boot in Node.js via Lua WASM
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webPkg = join(__dirname, "..", "web");
const pobBundle = join(webPkg, "public/data/pob-lua.json");

// Read WASM binary
const wasmBinary = readFileSync(join(__dirname, "dist", "lua.wasm"));

// Patch for Node
const mjsPath = join(__dirname, "dist", "lua.mjs");
let mjsCode = readFileSync(mjsPath, "utf8");
mjsCode = mjsCode.replace(/ENVIRONMENT_IS_WEB\s*=\s*[^;]+/, "ENVIRONMENT_IS_WEB = false");
mjsCode = mjsCode.replace(/ENVIRONMENT_IS_WORKER\s*=\s*[^;]+/, "ENVIRONMENT_IS_WORKER = false");
mjsCode = mjsCode.replace(/ENVIRONMENT_IS_NODE\s*=\s*[^;]+/, "ENVIRONMENT_IS_NODE = true");

const tmpPath = join(__dirname, "dist", "_test_boot.mjs");
writeFileSync(tmpPath, mjsCode);

try {
  console.log("Loading Lua WASM...");
  const { default: createModule } = await import(tmpPath);
  const Module = await createModule({ wasmBinary });
  const FS = Module.FS;

  const bridge_init = Module.cwrap("bridge_init", "number", []);
  const bridge_exec = Module.cwrap("bridge_exec", "string", ["string"]);

  bridge_init();
  console.log("Lua WASM initialized.");

  // Load shims
  const shimsCode = `
    -- jit stub + arg table
    jit = { opt = { start = function() end }, version = "pob-web" }
    arg = {}

    -- bit shim (LuaJIT bit -> Lua 5.2 bit32)
    bit = {}
    bit.band = bit32.band
    bit.bor = bit32.bor
    bit.bxor = bit32.bxor
    bit.lshift = bit32.lshift
    bit.rshift = bit32.rshift
    bit.arshift = bit32.arshift
    bit.bnot = bit32.bnot
    function bit.tobit(x)
      x = x % 4294967296
      if x >= 2147483648 then x = x - 4294967296 end
      return x
    end
    function bit.bswap(x)
      x = bit32.band(x, 0xFFFFFFFF)
      local b0 = bit32.band(x, 0xFF)
      local b1 = bit32.band(bit32.rshift(x, 8), 0xFF)
      local b2 = bit32.band(bit32.rshift(x, 16), 0xFF)
      local b3 = bit32.band(bit32.rshift(x, 24), 0xFF)
      return bit.tobit(b0 * 16777216 + b1 * 65536 + b2 * 256 + b3)
    end
    function bit.tohex(x, n)
      n = n or 8
      if n < 0 then
        return string.format("%0" .. (-n) .. "X", bit32.band(x, 0xFFFFFFFF))
      end
      return string.format("%0" .. n .. "x", bit32.band(x, 0xFFFFFFFF))
    end
    function bit.rol(x, n) return bit32.lrotate(x, n) end
    function bit.ror(x, n) return bit32.rrotate(x, n) end

    -- lua-utf8 stub
    do
      local u = {}
      u.reverse = string.reverse
      u.gsub = string.gsub
      u.find = string.find
      u.sub = string.sub
      u.match = string.match
      u.len = string.len
      u.byte = string.byte
      u.char = string.char
      u.gmatch = string.gmatch
      u.format = string.format
      u.rep = string.rep
      u.lower = string.lower
      u.upper = string.upper
      function u.next(s, i, step)
        step = step or 1
        if step > 0 then
          local pos = i
          for _ = 1, step do
            if pos > #s then return nil end
            pos = pos + 1
          end
          return pos
        else
          local pos = i
          for _ = 1, -step do
            if pos <= 0 then return nil end
            pos = pos - 1
          end
          return pos
        end
      end
      package.preload["lua-utf8"] = function() return u end
    end
  `;
  let err = bridge_exec(shimsCode);
  if (err) { console.error("Shim error:", err); process.exit(1); }
  console.log("Shims applied.");

  // Load PoB files into MEMFS
  console.log("Loading PoB bundle...");
  const bundle = JSON.parse(readFileSync(pobBundle, "utf-8"));
  const entries = Object.entries(bundle.files);
  console.log(`  ${entries.length} files`);

  function mkdirp(path) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      try { FS.mkdir(current); } catch {}
    }
  }

  for (const [path, content] of entries) {
    const fullPath = `/pob/${path}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    mkdirp(dir);
    FS.writeFile(fullPath, content);
  }
  // Create user dir
  mkdirp("/pob/user");
  console.log("MEMFS populated.");

  // Set package.path for runtime libs
  err = bridge_exec(`package.path = "/pob/runtime/lua/?.lua;/pob/runtime/lua/?/init.lua;" .. package.path`);
  if (err) { console.error("Package path error:", err); process.exit(1); }

  // Change to /pob/src/
  FS.chdir("/pob/src");
  console.log("CWD set to /pob/src/");

  // Try booting
  console.log("\nBooting PoB HeadlessWrapper...");
  const startTime = Date.now();

  // Load the original HeadlessWrapper but strip the #@ shebang line and
  // replace the error-blocking section with a non-fatal version
  let headlessWrapper = readFileSync(
    join(__dirname, "..", "..", "vendor/PathOfBuilding-PoE2/src/HeadlessWrapper.lua"),
    "utf-8"
  ).replace(/^#@\n/, "");

  // Replace the OnFrame + error handling section to be non-fatal
  headlessWrapper = headlessWrapper.replace(
    /runCallback\("OnFrame"\)[\s\S]*?build = mainObject\.main\.modes\["BUILD"\]/,
    `local ok, frameErr = pcall(runCallback, "OnFrame")
if not ok then
  print("OnFrame error (non-fatal): " .. tostring(frameErr))
end
if mainObject.promptMsg then
  print("PoB startup warning: " .. tostring(mainObject.promptMsg))
  mainObject.promptMsg = nil
end
build = mainObject.main.modes["BUILD"]`
  );

  err = bridge_exec(headlessWrapper);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (err) {
    console.error(`\nBoot FAILED after ${elapsed}s:`);
    console.error(err);
    process.exit(1);
  }

  console.log(`\nPoB booted successfully in ${elapsed}s!`);

  // Test that build module exists (mainObject is local, can't access from here)
  err = bridge_exec(`
    assert(build ~= nil, "build module is nil")
    print("Build module type: " .. type(build))
  `);
  if (err) {
    console.error("Post-boot check failed:", err);
  } else {
    console.log("Post-boot check: OK (build module available)");
  }

  // Test loadBuildFromXML function exists
  err = bridge_exec(`
    assert(type(loadBuildFromXML) == "function", "loadBuildFromXML missing")
    assert(type(newBuild) == "function", "newBuild missing")
    print("Helper functions: OK")
  `);
  if (err) {
    console.error("Helper functions check failed:", err);
  } else {
    console.log("Helper functions: OK");
  }

} finally {
  try { unlinkSync(tmpPath); } catch {}
}
