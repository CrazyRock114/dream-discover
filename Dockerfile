FROM node:20-slim

# Force cache bust
ARG BUILD_DATE=unknown
LABEL build_date=$BUILD_DATE

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy entire project
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build server TypeScript
RUN cd server && pnpm run build

# Remove client node_modules to reduce image size
RUN rm -rf client/node_modules

# Expose port
EXPOSE 9091

WORKDIR /app/server

CMD ["node", "dist/index.js"]
