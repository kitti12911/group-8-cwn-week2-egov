# Node 20 + better-sqlite3 (native) · TZ Asia/Bangkok
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

FROM node:20-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Bangkok PORT=3000 DB_PATH=/data/egov.db
WORKDIR /app
# Thai TTF so PDF documents/exports render Thai labels (server/documents.js + dashboard.js look in /usr/share/fonts/truetype/tlwg)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-tlwg-garuda-ttf fonts-tlwg-loma-ttf && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY views ./views
COPY public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/index.js"]
