# PoB Web

A browser-based version of [Path of Building](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) for Path of Exile 2. The entire PoB calculation engine runs client-side — Lua compiled to WebAssembly — so there's no server doing the math, just your browser.

**Try it:** [pob.awx.at](https://pob.awx.at)

## What It Does

**Import builds** from PoB codes or poe.ninja character URLs. **Share them** as short links like `pob.awx.at/b/abc123`. Export your changes back to a PoB code when you're done.

**Full passive tree** you can actually interact with — allocate and deallocate nodes, see path costs, search by stat, and run a node power heatmap to find the best pickups for your build.

**All the stats** from PoB desktop: offence breakdown per skill, defence and EHP, resistances, all ~200 config options with live recalc. Switch between skills, tweak enemy settings, see what changes.

**Items, gems, and socket groups** are all displayed with their full details — mods, runes, supports, the works.

Works on phones too. Installs as a PWA.

## What's Missing

This is a viewer with tree editing, not a full build editor. You can't:

- Create or modify items
- Add, remove, or swap skill gems
- Manage multiple tree specs
- Undo tree changes (re-import to revert)
- Import directly from a GGG account (use poe.ninja URLs instead)
- Save multiple builds locally

## Project Structure

```
packages/
  lua-wasm/     Lua 5.2 → WASM via Emscripten
  web/          React + Vite frontend (PixiJS for the tree)
  pob-data/     Build scripts for sprites and Lua bundle
vendor/
  PathOfBuilding-PoE2/   PoB source (git submodule)
deploy/
  docker-compose.yml     nginx + haste-server for production
  nginx.conf
```

## Development

You'll need Node.js 20+ and the [Emscripten SDK](https://emscripten.org/) for WASM builds.

```bash
git clone --recurse-submodules https://github.com/krauthaufen/pob-web.git
cd pob-web
npm install
```

Build the data files (one-time, requires the PoB submodule):

```bash
npm run build:wasm          # compile Lua to WASM
npm run bundle:lua          # bundle PoB's Lua files
node packages/pob-data/convert-sprites.mjs  # convert tree sprites
```

Then start the dev server:

```bash
npm run dev
```

For build sharing during development, run a local haste-server:

```bash
docker run -d --name haste -p 7777:7777 rlister/hastebin
```

See [deploy/README.md](deploy/README.md) for production setup.

## License

[MIT](LICENSE)

## Acknowledgements

- [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) for the engine
- [Grinding Gear Games](https://www.grindinggear.com/) for Path of Exile 2
