# ═══════════════════════════════════════════════
# Pinpointer v6.0 — Docker + Puppeteer Edition
# Node 20 + Chromium for visual website analysis
# ═══════════════════════════════════════════════

FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium (don't download bundled)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_ENABLED=true
ENV NODE_ENV=production
ENV PORT=3000

# Create app directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy app source
COPY server.js ./
COPY public/ ./public/
COPY skills/ ./skills/

# Create screenshots directory
RUN mkdir -p screenshots && chown -R node:node /app

# Run as non-root user
USER node

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
