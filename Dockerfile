# Stage 1: Base
# Node.js 20.19+ required by serverless-offline 13.10 (ERR_REQUIRE_ESM below it)
# Pinned by digest (OpenSSF Scorecard Pinned-Dependencies). Refresh with:
#   docker buildx imagetools inspect node:<tag> | grep Digest
FROM node:20.19.5-alpine@sha256:6178e78b972f79c335df281f4b7674a2d85071aae2af020ffa39f0a770265435 AS base
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
