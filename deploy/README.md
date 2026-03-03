# Deployment

PoB Web is a static SPA served by nginx, with a haste-server backend for build sharing.

## Architecture

```
Internet → nginx (port 80) ─┬→ static files (SPA)
                             ├→ /api/documents  → haste-server (POST, restricted)
                             ├→ /api/raw/:key   → haste-server (GET, public)
                             └→ /poe-ninja-api/ → poe.ninja (CORS proxy)
```

- **nginx** serves the built SPA and proxies API requests
- **haste-server** (`rlister/hastebin`) stores shared build codes with file-based storage

## Prerequisites

- Docker and Docker Compose on the server
- Node.js for building the frontend

## Server Setup

1. Create the deploy directory on the server:

```bash
mkdir -p /path/to/pob/dist
```

2. Copy the deploy configs:

```bash
cp deploy/docker-compose.yml deploy/nginx.conf /path/to/pob/
```

3. Edit `docker-compose.yml`:
   - Update the Traefik labels or remove them and expose port 80 directly:
     ```yaml
     ports:
       - "80:80"
     ```
   - If not using Traefik, remove the `web` external network and put `pob` on `internal` only (or your own network)

4. Edit `nginx.conf`:
   - Update the Origin check domains in the `/api/documents` location to match your domain

5. Start the containers:

```bash
cd /path/to/pob && docker compose up -d
```

This starts two containers:
- `pob` — nginx serving the SPA + proxying API requests
- `pob-haste` — haste-server on an internal-only network (no external access)

## Building & Deploying

Build the frontend:

```bash
cd packages/web && npx vite build
```

Copy the output to the server:

```bash
rsync -az --delete packages/web/dist/ server:/path/to/pob/dist/
rsync -az deploy/docker-compose.yml deploy/nginx.conf server:/path/to/pob/
ssh server "cd /path/to/pob && docker compose up -d"
```

Or use the included deploy script (configure `DEPLOY_HOST` and paths as needed):

```bash
DEPLOY_HOST=myserver ./deploy.sh
```

## Customization

### Domains

Update these places when changing domains:

- `deploy/nginx.conf` — Origin check in `/api/documents` location
- `packages/web/vite.config.ts` — `allowedHosts` for dev server

### Build Sharing Security

The haste-server is only accessible through nginx on an internal Docker network. nginx enforces:

- **Origin check**: POST to `/api/documents` requires `Origin` header matching configured domains
- **Rate limiting**: 5 requests/minute per IP with burst of 3
- **Method restrictions**: POST-only on `/api/documents`, GET-only on `/api/raw/`

Shared builds are immutable and cached for 1 year.

## Local Development

Start haste-server locally for build sharing:

```bash
docker run -d --name haste -p 7777:7777 rlister/hastebin
```

The Vite dev server proxies `/api` to `localhost:7777` automatically.

## Data

Build pastes are stored in the `haste-data` Docker volume. Back up with:

```bash
docker run --rm -v pob_haste-data:/data -v /tmp:/backup alpine tar czf /backup/haste-backup.tar.gz -C /data .
```
