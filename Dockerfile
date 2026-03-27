# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile
# Multi-stage build:
#   Stage 1 (deps)    — install production dependencies only
#   Stage 2 (builder) — build the Next.js frontend
#   Stage 3 (runner)  — lean final image with both backend + frontend
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Backend dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Frontend build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 3: Final runtime image ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 appuser

# Copy backend
COPY --from=deps  /app/node_modules ./node_modules
COPY server.js ./
COPY src/ ./src/

# Copy built frontend
COPY --from=builder /app/frontend/.next       ./frontend/.next
COPY --from=builder /app/frontend/public      ./frontend/public
COPY --from=builder /app/frontend/package.json ./frontend/package.json

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "server.js"]
