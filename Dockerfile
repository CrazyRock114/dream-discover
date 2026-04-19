FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy patches directory (required by pnpm --frozen-lockfile)
COPY patches/ ./patches/

# Copy all workspace package.json files (pnpm needs them for workspace resolution)
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies (server only, but pnpm needs all workspace package.json for resolution)
RUN pnpm install --frozen-lockfile --filter=server...

# Copy server source code
COPY server/ ./server/

# Build server TypeScript
RUN cd server && pnpm run build

# Expose port (Railway will override with PORT env var)
EXPOSE 9091

WORKDIR /app/server

CMD ["node", "dist/index.js"]
