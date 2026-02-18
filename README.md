# Pinpointer v6.0 — Docker + Puppeteer Edition

AI-powered website auditor that analyzes 10 aspects of any website using Google Gemini and Puppeteer visual analysis.

## Architecture

```
Internet → Traefik (SSL) → Nginx (caching/headers) → Node.js + Puppeteer + Chromium
```

## 10 Audit Skills

| # | Skill | Weight |
|---|---|---|
| 1 | SEO Analyzer | 15% |
| 2 | UX Auditor | 12% |
| 3 | UI Auditor | 10% |
| 4 | CRO Analyzer | 12% |
| 5 | Accessibility Auditor | 10% |
| 6 | Performance Analyzer | 12% |
| 7 | Content Quality | 10% |
| 8 | Security Auditor | 8% |
| 9 | Mobile Responsiveness | 6% |
| 10 | Competitive Benchmark | 5% |

## Quick Start (Local)

```bash
git clone https://github.com/moeadas/Pinpointer-Docker.git
cd Pinpointer-Docker
docker compose up -d --build
# Open http://localhost:8090
```

## Production Deployment (Hostinger VPS)

### Prerequisites
- Docker + Docker Compose on VPS
- Traefik running on `root_default` network (ports 80/443)
- DNS: `audit.pinpoint.online` → VPS IP `72.62.33.12`

### Deploy
```bash
ssh root@72.62.33.12
git clone https://github.com/moeadas/Pinpointer-Docker.git
cd Pinpointer-Docker
chmod +x deploy.sh
bash deploy.sh
```

The deploy script will:
1. Pull latest code
2. Backup existing deployment
3. Build Docker image (Node 20 + Chromium)
4. Start containers with Traefik integration
5. Run health checks
6. Auto-rollback on failure

### Compose Files
| File | Purpose |
|---|---|
| `docker-compose.yml` | Local development (port 8090) |
| `docker-compose.prod.yml` | Production with Traefik (audit.pinpoint.online) |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check (JSON) |
| `/api/validate-key` | POST | Validate Gemini API key |
| `/api/analyze` | POST | Start audit (`{url, gemini_key}`) |
| `/api/status?uuid=X` | GET | Poll audit progress |
| `/api/report?uuid=X` | GET | Get completed report |

## Management Commands

```bash
# Logs
docker logs -f pinpointer-app
docker logs -f pinpointer-nginx

# Status
docker compose -f docker-compose.prod.yml ps

# Restart
docker compose -f docker-compose.prod.yml restart

# Update
git pull && bash deploy.sh

# Stop
docker compose -f docker-compose.prod.yml down
```

## Technology Stack

- **Runtime**: Node.js 20 (slim)
- **Browser**: Chromium (via Puppeteer) for visual analysis
- **AI**: Google Gemini 2.5 Flash
- **Data**: Google PageSpeed Insights API
- **Proxy**: Nginx (caching, headers, gzip)
- **SSL**: Traefik + Let's Encrypt
- **Container**: Docker with resource limits
