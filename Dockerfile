# Stage 1: Base
# Node 24 = the nodejs24.x Lambda runtime (nodejs20.x was deprecated by AWS on
# 2026-04-30). serverless-offline 13.10 needs >= 20.19 for ERR_REQUIRE_ESM.
# Pinned by digest (OpenSSF Scorecard Pinned-Dependencies). Refresh with:
#   docker buildx imagetools inspect node:<tag> | grep Digest
FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base
WORKDIR /app

# Stage 2: Dependencies
FROM base AS dependencies

# Install build dependencies for native modules (bigint, etc.)
RUN apk add --no-cache python3 make g++ gcc

COPY package.json package-lock.json ./
# npm ci: install exactly what package-lock.json pins (no resolution at build time).
RUN npm ci --omit=dev && \
    cp -R node_modules /prod_node_modules && \
    npm ci

# Rebuild native modules to ensure they use compiled bindings
RUN npm rebuild

# Stage 3: Development
FROM base AS development
WORKDIR /app

# Install build dependencies for native modules (bigint, etc.)
RUN apk add --no-cache python3 make g++ gcc

COPY package.json package-lock.json ./
RUN npm ci

# Rebuild native modules to ensure they use compiled bindings
RUN npm rebuild

COPY . .
EXPOSE 3000
CMD ["npm", "run", "serverless:start:local"]

# Stage 4: Production (para futuro deployment)
FROM base AS production
WORKDIR /app
COPY --from=dependencies /prod_node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "serverless:start:local"]
