# Stage 1: Build
FROM node:20-slim AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only shared and gateway packages
COPY shared/package.json shared/
COPY gateway/package.json gateway/

# Copy postinstall script needed by pnpm install
COPY scripts/check-native-modules.mjs scripts/

# Install dependencies (workspace-aware, only for gateway + shared)
RUN pnpm install --filter @my-claudia/gateway --filter @my-claudia/shared --frozen-lockfile

# Copy source code
COPY shared/src shared/src
COPY shared/tsconfig.json shared/
COPY gateway/src gateway/src
COPY gateway/tsconfig.json gateway/

# Build shared first, then gateway
RUN pnpm --filter @my-claudia/shared run build && \
    pnpm --filter @my-claudia/gateway run build

# Stage 2: Production
FROM node:20-slim AS runtime

RUN npm install -g pnpm@9.15.0

WORKDIR /app

# Copy workspace root files for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY gateway/package.json gateway/

# Copy postinstall script needed by pnpm install
COPY scripts/check-native-modules.mjs scripts/

# Install production dependencies only
RUN pnpm install --filter @my-claudia/gateway --filter @my-claudia/shared --frozen-lockfile --prod

# Copy built output
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/gateway/dist gateway/dist

# Create data directories
RUN mkdir -p /data/gateway /data/files

# SQLite data and file storage will be persisted via volume
ENV GATEWAY_PORT=3200
ENV HOME=/data

EXPOSE 3200

WORKDIR /app/gateway

CMD ["node", "dist/index.js"]
