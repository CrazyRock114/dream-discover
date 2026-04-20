FROM node:20-slim

# Force cache bust - increment this value to invalidate Docker build cache
ARG CACHE_BUST=6

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy entire project (patches directory is needed by pnpm-lock.yaml)
COPY . .

# Install all dependencies (frozen lockfile requires patches/)
RUN pnpm install --frozen-lockfile

# Build server TypeScript
RUN cd server && pnpm run build

# Remove client node_modules to reduce image size
RUN rm -rf client/node_modules

WORKDIR /app/server

CMD ["node", "dist/index.js"]
