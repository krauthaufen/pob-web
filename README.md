# PoB Web

A browser-based [Path of Building](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) for Path of Exile 2. The full PoB calculation engine runs client-side — Lua compiled to WebAssembly — no server math, just your browser.

**Try it:** [pob.awx.at](https://pob.awx.at)

## Features

- **Import builds** from PoB codes, poe.ninja character URLs, or directly from your PoE2 account via OAuth
- **Share builds** as short links (`pob.awx.at/b/abc123`), export changes back to PoB codes
- **Interactive passive tree** — allocate/deallocate nodes, path cost display, stat search, node power heatmap
- **Full stats** — offence per skill, defence/EHP, resistances, ~200 config options with live recalc
- **Items & gems** — equipped items with mods/runes, socket groups with supports, custom item paste, slot browser
- **PoE2 account import** — OAuth login, character list, one-click import of tree/items/skills
- **Mobile-friendly** — touch support, responsive layout, installable as PWA

## Architecture

```
Browser (Main Thread)                          Web Worker
┌──────────────────────────┐    postMessage    ┌──────────────────────┐
│ React + PixiJS           │ ◄──────────────► │ Lua 5.2 (WASM)       │
│                          │                   │ + PoB engine          │
│ MainPage (OAuth/import)  │                   │ + HeadlessWrapper     │
│ PassiveTree (WebGL)      │                   │ + dkjson              │
│ Stats/Skills/Items/Gems  │                   │                      │
│ ConfigPanel              │                   │ Deflate/Inflate       │
│ Zustand stores           │                   │ (Emscripten zlib)     │
└──────────────────────────┘                   └──────────────────────┘
```

The Lua VM runs PoB's calculation engine unmodified in a Web Worker. The main thread sends commands (load build, allocate node, get stats) via `postMessage` and renders the results with React and PixiJS.

## Project Structure

```
packages/
  lua-wasm/          Lua 5.2 → WASM via Emscripten (bridge.c for JS↔Lua FFI)
  web/               React 19 + Vite frontend
    src/
      components/
        MainPage.tsx           Landing page, OAuth login, character import
        ImportExport/          Build code import/export, sharing
        PassiveTree/           PixiJS tree renderer, node interaction, sprites
        StatsPanel/            Stats, skills, gems, items, defence, config panels
      store/
        build-store.ts         Build state, calc results, UI state (Zustand)
        auth-store.ts          OAuth token, account, character list
      worker/
        calc-worker.ts         Lua WASM boot, PoB engine, message handlers
        calc-client.ts         Promise-based worker client
        calc-api.ts            Message type definitions
        build-decoder.ts       PoB code encode/decode, poe.ninja fetching
        lua-shims.ts           LuaJIT → Lua 5.2 compatibility (bit, jit, utf8)
      utils/
        poe-auth.ts            OAuth 2.0 PKCE flow (GGG API)
        poe-api.ts             PoE2 character API client
        item-images.ts         Wiki image resolution with caching
        refresh-all.ts         Post-mutation stat refresh orchestration
        is-touch.ts            Touch device detection for hover suppression
    public/
      data/pob-lua.json        Bundled PoB Lua files (~34MB, ~3.8MB gzipped)
      data/tree.json           PoE2 passive tree data
      data/sprites/            BC7-decoded sprite atlases (PNG)
      wasm/                    Lua WASM binary + JS glue (symlink)
  pob-data/            Build-time asset processing
    bundle-lua.mjs       Bundle PoB Lua files into JSON
    convert-sprites.mjs  Convert DDS sprite sheets to PNG atlases
    bc7-decode.mjs       BC7 texture block decoder
vendor/
  PathOfBuilding-PoE2/   PoB source (git submodule, unmodified)
deploy/
  docker-compose.yml     nginx + haste-server for production
  nginx.conf             SPA routing, API proxies, build sharing
```

## Development

Requires Node.js 20+ and the [Emscripten SDK](https://emscripten.org/) for WASM builds.

```bash
git clone --recurse-submodules https://github.com/krauthaufen/pob-web.git
cd pob-web
npm install
```

Build the data files (one-time, requires PoB submodule):

```bash
source ~/emsdk/emsdk_env.sh   # activate Emscripten
npm run build:wasm             # compile Lua to WASM
npm run bundle:lua             # bundle PoB Lua files
node packages/pob-data/convert-sprites.mjs  # convert tree sprites
```

Start the dev server:

```bash
npm run dev
```

The Vite dev server proxies `/poe-oauth`, `/poe-api`, `/poe-ninja-api`, and `/api` to their respective backends. For build sharing during development, run a local haste-server:

```bash
docker run -d --name haste -p 7777:7777 rlister/hastebin
```

## Deployment

Production runs on Docker with nginx serving the SPA and proxying to haste-server for build sharing.

```bash
cd packages/web && npx vite build
rsync -a --delete packages/web/dist/ server:/path/to/pob/dist/
```

The nginx config handles:
- SPA routing (all paths → `index.html`)
- Immutable caching for hashed assets
- Build sharing via haste-server (`/api/documents` POST, `/api/raw/:key` GET)
- CORS proxy for poe.ninja API (`/poe-ninja-api/`)
- OAuth proxy for GGG API (`/poe-oauth/`, `/poe-api/`)

See [deploy/README.md](deploy/README.md) for full setup.

## OAuth (PoE2 Account Import)

GGG-approved OAuth application:
- **Client ID:** `pobweb` (public client, PKCE)
- **Scopes:** `account:profile`, `account:characters`
- **Redirect URI:** `https://pob.awx.at/`
- **Flow:** Authorization Code + PKCE (no client secret)

The authorize redirect goes directly to `www.pathofexile.com`. Token exchange and API calls go through the nginx proxy to avoid CORS. Character list uses `/character/poe2` for PoE2-only results.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| UI | React 19 + TypeScript |
| Bundler | Vite 6 |
| Tree renderer | PixiJS 8 (WebGL) |
| Calc engine | Lua 5.2 → WASM (Emscripten) |
| State | Zustand |
| Styling | Tailwind CSS 3.4 |
| Build import | pako (inflate) + DOMParser |
| Testing | Playwright |
| Offline | Service Worker + PWA |

## License

[MIT](LICENSE)

## Acknowledgements

- [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) for the engine
- [Grinding Gear Games](https://www.grindinggear.com/) for Path of Exile 2
