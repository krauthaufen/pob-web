# Deployment

PoB Web is a static SPA served by nginx, with a haste-server backend for build sharing.

## Architecture

```
Internet → Traefik (TLS) → nginx ─┬→ static files (SPA)
                                   ├→ /api/documents  → haste-server (POST, restricted)
                                   ├→ /api/raw/:key   → haste-server (GET, public)
                                   └→ /poe-ninja-api/ → poe.ninja (CORS proxy)
```

- **nginx** serves the built SPA and proxies API requests
- **haste-server** (`rlister/hastebin`) stores shared build codes with file-based storage
- **Traefik** (external) handles TLS termination and routing

## Prerequisites

- Docker and Docker Compose on the server
- A Traefik reverse proxy with an external `web` network and `https-redirect` middleware
- SSH access to the deploy target (default: `tatooine`)
- Node.js for building the frontend

## Server Setup

1. Create the deploy directory on the server:

```bash
ssh tatooine "mkdir -p /home/schorsch/docker/pob/dist"
```

2. Copy the deploy configs:

```bash
rsync -az deploy/docker-compose.yml deploy/nginx.conf tatooine:/home/schorsch/docker/pob/
```

3. Start the containers:

```bash
ssh tatooine "cd /home/schorsch/docker/pob && docker compose up -d"
```

This starts two containers:
- `pob` — nginx serving the SPA + proxying API requests
- `pob-haste` — haste-server on an internal-only network (no external access)

## Deploying

Run the deploy script from the repo root:

```bash
./deploy.sh
```

This will:
1. Build the Vite SPA (`packages/web`)
2. Rsync the built files to the server
3. Sync `docker-compose.yml` and `nginx.conf`
4. Restart containers

Override the target host:

```bash
DEPLOY_HOST=myserver ./deploy.sh
```

## Customization

### Domains

Update these places when changing domains:

- `deploy/docker-compose.yml` — Traefik router rules (`Host(...)`)
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
ssh tatooine "docker run --rm -v pob_haste-data:/data -v /tmp:/backup alpine tar czf /backup/haste-backup.tar.gz -C /data ."
scp tatooine:/tmp/haste-backup.tar.gz .
```
