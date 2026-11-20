# syntax=docker/dockerfile:1

# --- Build stage: install all dependencies and create the Vite build ---------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage: only production dependencies + built frontend ------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY server.ts tsconfig.json ./
COPY examples ./examples
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses

# data/ and scores/ are normally bind-mounted by docker compose. Create them
# here so the image also works with plain `docker run`.
RUN mkdir -p data/slices data/soundfonts scores \
    && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
