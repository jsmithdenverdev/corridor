# Corridor Worker Dockerfile
# Optimized for Fly.io scale-to-zero deployment

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# Build stage
FROM base AS build

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source files
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

# Build the worker
WORKDIR /app/apps/worker
RUN bun build src/index.ts --outdir dist --target bun

# Production stage - minimal image
FROM oven/bun:1-slim AS production
WORKDIR /app

# Copy only what we need
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production

# Run the worker
CMD ["bun", "run", "dist/index.js"]
