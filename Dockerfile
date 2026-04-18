FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy server package.json first for layer caching
COPY server/package.json ./server/

# Install dependencies (server only)
RUN pnpm install --frozen-lockfile --filter=server...

# Copy server source code
COPY server/ ./server/

# Build server TypeScript
RUN cd server && pnpm run build

# Expose port (Railway will override with PORT env var)
EXPOSE 9091

WORKDIR /app/server

CMD ["node", "dist/index.js"]
