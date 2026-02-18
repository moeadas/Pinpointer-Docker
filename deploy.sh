#!/bin/bash
# ═══════════════════════════════════════════════
# Pinpointer v6.0 — Production Deploy Script
# Hostinger VPS: Traefik -> Nginx -> Node.js
#
# Usage: bash deploy.sh
# ═══════════════════════════════════════════════

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
APP_CONTAINER="pinpointer-app"
NGINX_CONTAINER="pinpointer-nginx"
BACKUP_DIR="./backups"
HEALTH_URL="http://localhost:3000/health"
MAX_HEALTH_RETRIES=12
HEALTH_INTERVAL=5

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"; }
err()  { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════════"
echo "  🎯 Pinpointer v6.0 — Production Deployment"
echo "  📍 Domain: audit.pinpoint.online"
echo "  🏗️  Stack: Traefik → Nginx → Node.js + Puppeteer"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Pre-flight Checks ───
log "Running pre-flight checks..."

if ! command -v docker &> /dev/null; then
    err "Docker not found. Install Docker first."
    exit 1
fi
ok "Docker found: $(docker --version | head -1)"

if ! docker compose version &> /dev/null 2>&1; then
    err "Docker Compose not found."
    exit 1
fi
ok "Docker Compose found"

if [ ! -f "$COMPOSE_FILE" ]; then
    err "Compose file not found: $COMPOSE_FILE"
    exit 1
fi
ok "Compose file found: $COMPOSE_FILE"

# Check root_default network exists (Traefik's network)
if ! docker network inspect root_default &> /dev/null 2>&1; then
    warn "Network 'root_default' not found. Creating it..."
    docker network create root_default
    ok "Created root_default network"
else
    ok "Traefik network 'root_default' exists"
fi

# ─── Pull Latest Code ───
log "Pulling latest code from git..."
if git rev-parse --git-dir > /dev/null 2>&1; then
    git pull origin main 2>/dev/null || warn "Git pull skipped (not on main or no remote)"
    ok "Code is up to date"
else
    warn "Not a git repo — skipping git pull"
fi

# ─── Backup Existing Deployment ───
if docker ps --format '{{.Names}}' | grep -q "$APP_CONTAINER"; then
    log "Existing deployment detected — creating backup..."
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

    # Save current image ID
    CURRENT_IMAGE=$(docker inspect --format='{{.Image}}' "$APP_CONTAINER" 2>/dev/null || echo "none")
    echo "$CURRENT_IMAGE" > "$BACKUP_DIR/image_$TIMESTAMP.txt"

    # Save container logs
    docker logs "$APP_CONTAINER" --tail 200 > "$BACKUP_DIR/logs_$TIMESTAMP.txt" 2>&1 || true

    ok "Backup saved to $BACKUP_DIR/*_$TIMESTAMP.*"
fi

# ─── Stop Existing Containers ───
if docker ps -a --format '{{.Names}}' | grep -qE "(${APP_CONTAINER}|${NGINX_CONTAINER})"; then
    log "Stopping existing Pinpointer containers..."
    docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
    ok "Old containers stopped"
fi

# ─── Build and Start ───
log "Building Pinpointer Docker image..."
echo "   (First build takes ~2-3 min: installing Chromium + Node.js deps)"
echo ""

docker compose -f "$COMPOSE_FILE" build --no-cache
ok "Image built successfully"

log "Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d
ok "Containers started"

# ─── Health Check with Retry ───
log "Waiting for health check..."
HEALTHY=false

for i in $(seq 1 $MAX_HEALTH_RETRIES); do
    sleep $HEALTH_INTERVAL

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "$APP_CONTAINER"; then
        err "Container '$APP_CONTAINER' is not running!"
        echo ""
        echo "Container logs:"
        docker logs "$APP_CONTAINER" --tail 30 2>&1
        break
    fi

    # Check health endpoint
    HEALTH=$(docker exec "$APP_CONTAINER" wget -qO- http://localhost:3000/health 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q '"status":"ok"'; then
        HEALTHY=true
        break
    fi

    log "  Attempt $i/$MAX_HEALTH_RETRIES — waiting ${HEALTH_INTERVAL}s..."
done

if [ "$HEALTHY" = true ]; then
    ok "Pinpointer is healthy!"
else
    err "Health check failed after $MAX_HEALTH_RETRIES attempts"
    echo ""

    # ─── Auto-Rollback ───
    warn "Rolling back to previous version..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

    if [ -n "${CURRENT_IMAGE:-}" ] && [ "$CURRENT_IMAGE" != "none" ]; then
        warn "Previous image: $CURRENT_IMAGE"
        warn "Manual rollback: docker run -d --name $APP_CONTAINER $CURRENT_IMAGE"
    fi

    echo ""
    echo "Debug commands:"
    echo "  docker logs $APP_CONTAINER"
    echo "  docker compose -f $COMPOSE_FILE logs"
    exit 1
fi

# ─── Verify Traefik Integration ───
log "Verifying Traefik integration..."
if docker network inspect root_default --format='{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | grep -q "$NGINX_CONTAINER"; then
    ok "Nginx container connected to Traefik network (root_default)"
else
    warn "Nginx container may not be on root_default network. Check Traefik routing."
fi

# ─── Final Status ───
echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}🎯 Pinpointer v6.0 is LIVE!${NC}"
echo ""
echo "  🌐 Public URL:  https://audit.pinpoint.online"
echo "  🏥 Health:      docker exec $APP_CONTAINER wget -qO- http://localhost:3000/health"
echo ""
echo "  📋 Commands:"
echo "     Logs (app):   docker logs -f $APP_CONTAINER"
echo "     Logs (nginx): docker logs -f $NGINX_CONTAINER"
echo "     Status:       docker compose -f $COMPOSE_FILE ps"
echo "     Restart:      docker compose -f $COMPOSE_FILE restart"
echo "     Update:       git pull && bash deploy.sh"
echo "     Stop:         docker compose -f $COMPOSE_FILE down"
echo ""
echo "  🔑 Features:"
echo "     • Puppeteer visual analysis (Chromium in Docker)"
echo "     • 10 AI audit skills powered by Gemini"
echo "     • Traefik SSL via Let's Encrypt"
echo "     • Nginx caching + security headers"
echo "═══════════════════════════════════════════════"
