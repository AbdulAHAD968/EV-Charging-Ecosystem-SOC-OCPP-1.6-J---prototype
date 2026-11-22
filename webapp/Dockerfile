# EV-SOC Live: single-container image (Node/Express/ws backend + static React client).
# Build and run from the repo root with this file's directory as the Docker context, e.g.:
#   docker build -t ev-soc-live -f webapp/Dockerfile webapp
#   docker run -p 4000:4000 ev-soc-live
# Coolify: point it at this Dockerfile with build context "webapp/", and set the exposed
# port to 4000 (NOT 8000, which Coolify itself uses).

# ---- Stage 1: build the client (Vite) -------------------------------------
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: install server production dependencies -----------------------
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: final runtime image ------------------------------------------
FROM node:20-alpine
ENV NODE_ENV=production
# Default port; Coolify (or any host) can override this with an env var.
# Do not use 8000, it is reserved by Coolify itself on the host.
ENV PORT=4000
WORKDIR /app

COPY server/package.json ./server/package.json
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/src ./server/src
COPY --from=client-build /app/client/dist ./client/dist

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

WORKDIR /app/server
CMD ["node", "src/index.js"]
