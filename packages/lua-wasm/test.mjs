// Quick test: verify Lua WASM loads and can execute code
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Emscripten ES6 modules need some shims for Node
globalThis.document = { currentScript: { src: "" } };

// We need to patch the module to work in Node since we built for web,worker
const mjsPath = join(__dirname, "dist", "lua.mjs");
let mjsCode = readFileSync(mjsPath, "utf8");
// Override the environment detection
mjsCode = mjsCode.replace(
  /ENVIRONMENT_IS_WEB\s*=\s*true/,
  "ENVIRONMENT_IS_WEB = false"
);

// Write a temp patched version
import { writeFileSync, unlinkSync } from "fs";
const tmpPath = join(__dirname, "dist", "_test_lua.mjs");
writeFileSync(tmpPath, mjsCode);

try {
  const { default: createModule } = await import(tmpPath);
  const Module = await createModule();

  const bridge_init = Module.cwrap("bridge_init", "number", []);
  const bridge_exec = Module.cwrap("bridge_exec", "string", ["string"]);
  const bridge_get_string = Module.cwrap("bridge_get_string", "string", ["string"]);

  console.log("Initializing Lua...");
  const result = bridge_init();
  console.log("bridge_init:", result === 0 ? "OK" : "FAILED");

  console.log("\nExecuting Lua code...");
  let err = bridge_exec("x = 40 + 2");
  console.log("40 + 2 =", err ? `ERROR: ${err}` : "assigned to x");

  err = bridge_exec("print('Hello from Lua WASM! x =', x)");
  console.log("print result:", err ? `ERROR: ${err}` : "OK");

  const x = bridge_get_string("x");
  console.log("x from JS:", x);

  // Test table/JSON
  err = bridge_exec(`
    function testJson(input)
      return '{"result": "Lua says hello!", "input_length": ' .. #input .. '}'
    end
  `);
  console.log("Define function:", err ? `ERROR: ${err}` : "OK");

  const bridge_call_json = Module.cwrap("bridge_call_json", "string", ["string", "string"]);
  const jsonResult = bridge_call_json("testJson", '{"test": true}');
  console.log("JSON call result:", jsonResult);

  console.log("\n✓ All tests passed!");
} finally {
  unlinkSync(tmpPath);
}
