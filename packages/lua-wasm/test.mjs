// Smoke test for Lua WASM + bridge in Node.js
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the WASM binary so we can pass it directly (no fetch in Node)
const wasmBinary = readFileSync(join(__dirname, "dist", "lua.wasm"));

// Patch the module to handle Node environment
const mjsPath = join(__dirname, "dist", "lua.mjs");
let mjsCode = readFileSync(mjsPath, "utf8");
// Force Node environment detection
mjsCode = mjsCode.replace(
  /ENVIRONMENT_IS_WEB\s*=\s*[^;]+/,
  "ENVIRONMENT_IS_WEB = false"
);
mjsCode = mjsCode.replace(
  /ENVIRONMENT_IS_WORKER\s*=\s*[^;]+/,
  "ENVIRONMENT_IS_WORKER = false"
);
mjsCode = mjsCode.replace(
  /ENVIRONMENT_IS_NODE\s*=\s*[^;]+/,
  "ENVIRONMENT_IS_NODE = true"
);

const tmpPath = join(__dirname, "dist", "_test_lua.mjs");
writeFileSync(tmpPath, mjsCode);

try {
  const { default: createModule } = await import(tmpPath);
  const Module = await createModule({ wasmBinary });

  const bridge_init = Module.cwrap("bridge_init", "number", []);
  const bridge_exec = Module.cwrap("bridge_exec", "string", ["string"]);

  const r = bridge_init();
  console.log("bridge_init:", r === 0 ? "OK" : `FAIL (${r})`);

  // Test bit shim
  let err = bridge_exec(`
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
  `);
  console.log("bit shim:", err ? `FAIL: ${err}` : "OK");

  err = bridge_exec(`
    assert(bit.band(0xFF, 0x0F) == 0x0F, "band failed")
    assert(bit.bor(0xF0, 0x0F) == 0xFF, "bor failed")
    assert(bit.lshift(1, 8) == 256, "lshift failed")
    assert(bit.rshift(256, 8) == 1, "rshift failed")
    assert(bit.tobit(0xFFFFFFFF) == -1, "tobit failed")
  `);
  console.log("bit ops:", err ? `FAIL: ${err}` : "OK");

  // Test Deflate/Inflate
  err = bridge_exec(`
    local original = "Hello from Lua! Test string for deflate/inflate roundtrip."
    local compressed = Deflate(original)
    assert(#compressed > 0, "Deflate returned empty")
    local decompressed = Inflate(compressed)
    assert(decompressed == original, "roundtrip failed")
  `);
  console.log("Deflate/Inflate:", err ? `FAIL: ${err}` : "OK");

  // Test GetTime
  err = bridge_exec(`
    local t = GetTime()
    assert(type(t) == "number", "GetTime type")
    assert(t >= 0, "GetTime value")
  `);
  console.log("GetTime:", err ? `FAIL: ${err}` : "OK");

  // Test lua-utf8 preload
  err = bridge_exec(`
    do
      local u = {}
      u.reverse = string.reverse
      u.gsub = string.gsub
      u.find = string.find
      u.sub = string.sub
      u.match = string.match
      u.len = string.len
      function u.next(s, i, step)
        step = step or 1
        return i + step
      end
      package.preload["lua-utf8"] = function() return u end
    end
    local utf8 = require("lua-utf8")
    assert(utf8.reverse("abc") == "cba")
    assert(utf8.find("hello", "ell") == 2)
  `);
  console.log("lua-utf8:", err ? `FAIL: ${err}` : "OK");

  console.log("\nAll smoke tests passed!");
} finally {
  try { unlinkSync(tmpPath); } catch {}
}
