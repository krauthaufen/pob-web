// Downloads and extracts PUC-Rio Lua 5.2.4 source
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");
const luaDir = join(pkgDir, "lua-5.2.4");

if (existsSync(luaDir)) {
  console.log("Lua 5.2.4 source already exists, skipping download.");
  process.exit(0);
}

const url = "https://www.lua.org/ftp/lua-5.2.4.tar.gz";
console.log(`Downloading ${url}...`);
execSync(`curl -sL "${url}" | tar xz`, { cwd: pkgDir, stdio: "inherit" });
console.log("Lua 5.2.4 source downloaded and extracted.");
