# Stage 1: Base
# Node.js 20.19+ required by serverless-offline 13.10 (ERR_REQUIRE_ESM below it)
FROM node:20.19.5-alpine AS base
WORKDIR /app
RUN npm install -g serverless@3.40.0

# Stage 2: Dependencies
FROM base AS dependencies

# Install build dependencies for native modules (bigint, etc.)
RUN apk add --no-cache python3 make g++ gcc

COPY package.json package-lock.json ./
RUN npm install --only=production && \
    cp -R node_modules /prod_node_modules && \
    npm install

# Rebuild native modules to ensure they use compiled bindings
RUN npm rebuild

# Stage 3: Development
FROM base AS development
WORKDIR /app

# Install build dependencies for native modules (bigint, etc.)
RUN apk add --no-cache python3 make g++ gcc

COPY package.json package-lock.json ./
RUN npm install

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
