FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy entire project (simpler than selective COPY for monorepo)
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build server TypeScript
RUN cd server && pnpm run build

# Remove client dependencies to reduce image size
RUN rm -rf client/node_modules

# Expose port (Railway will override with PORT env var)
EXPOSE 9091

WORKDIR /app/server

CMD ["node", "dist/index.js"]
