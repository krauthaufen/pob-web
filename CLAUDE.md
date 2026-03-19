# CLAUDE.md — PoB Web

## Build & Run

```bash
npm install                  # install all workspace deps
npm run dev                  # start Vite dev server (localhost:5173)
npm run build                # production build → packages/web/dist/
npm run build:wasm           # compile Lua → WASM (needs `source ~/emsdk/emsdk_env.sh`)
npm run bundle:lua           # bundle PoB Lua files → public/data/pob-lua.json
```

One-time data setup (requires PoB submodule + Emscripten):
```bash
source ~/emsdk/emsdk_env.sh
npm run build:wasm
npm run bundle:lua
node packages/pob-data/convert-sprites.mjs
```

Testing: `npx playwright test` from `packages/web/`.

## Deploy

```bash
cd packages/web && npx vite build
rsync -a --delete packages/web/dist/ tatooine:/home/schorsch/docker/pob/dist/
```
No container restart needed — nginx serves from a Docker volume.

## Architecture

Monorepo with npm workspaces:

- **`packages/lua-wasm/`** — Lua 5.2 compiled to WASM via Emscripten. `bridge.c` provides JS↔Lua FFI (`bridge_exec`, `bridge_call_json`, `bridge_init`). Built with `-sUSE_ZLIB=1` for inflate/deflate.
- **`packages/web/`** — React 19 + Vite 6 frontend. PixiJS 8 renders the passive tree (WebGL). Zustand for state.
- **`packages/pob-data/`** — Build-time scripts: bundle PoB Lua files, convert DDS sprites to PNG.
- **`vendor/PathOfBuilding-PoE2/`** — Git submodule, PoB engine source (unmodified).

### Worker Architecture

The Lua VM runs in a Web Worker (`calc-worker.ts`). The main thread communicates via `postMessage` through a promise-based client (`calc-client.ts`). Message types defined in `calc-api.ts`.

Boot sequence: load WASM → apply Lua shims (bit, jit, utf8) → populate MEMFS from pob-lua.json → run HeadlessWrapper → accept commands.

### Two-View SPA

- No build loaded → `MainPage.tsx` (OAuth login, character list, manual import)
- Build loaded → full build viewer (tree, stats, skills, items, config panels)

Controlled by `build` in the Zustand store — no router library.

## Key Conventions

- **Lua↔JS bridge**: All Lua functions prefixed `pobWeb*` (e.g. `pobWebLoadBuild`, `pobWebGetStats`). Called via `bridge_call_json(funcName, jsonArg)`, return JSON strings.
- **Path alias**: `@/` maps to `packages/web/src/` (configured in vite.config.ts and tsconfig).
- **Proxy routes** (dev: Vite proxy, prod: nginx):
  - `/poe-oauth/` → `https://www.pathofexile.com/oauth/` (must use `www.` — non-www 301s and drops POST body)
  - `/poe-api/` → `https://api.pathofexile.com/`
  - `/poe-ninja-api/` → `https://poe.ninja/`
  - `/api/` → haste-server (build sharing)
- **OAuth**: Direct redirect to `www.pathofexile.com` for authorize (no proxy — full page nav). Token exchange goes through proxy. PKCE verifier uses URL-safe chars only (`A-Za-z0-9-._~`).
- **PoE2 API paths**: Use path segments not query params — `/character/poe2` not `/character?realm=poe2`.

## Pitfalls

- **dkjson double-encode bug**: Calling Lua→JSON→decode→re-encode corrupts arrays to objects. Fetch stats separately after mutations instead of returning everything in one call.
- **CalcDefence.lua division by zero**: Crashes on empty builds during OnFrame. Caught and ignored — non-fatal.
- **`build.calcsTab.sectionList`** subSection data: Rows live in `.data[i]` not directly in the subSection table.
- **Gem support detection**: Use `gem.gemData.grantedEffect.support` (NOT `gem.grantedEffect.support`).
- **PoE2 stat parts**: Uses `grantedEffect.statSets` with `.label`, NOT `grantedEffect.parts` with `.name`.
- **HMR disabled**: Prevents iOS reload loops through reverse proxy.
- **Service worker**: `sw.js` in public/, cache-first for hashed assets, network-first for HTML.
