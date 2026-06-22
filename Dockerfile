# HR-Interview — multi-tenant Node.js server
# Designed for Fly.io with a persistent volume mounted at /app/data and /app/outputs.

FROM node:20-alpine

WORKDIR /app

# Install production deps only (skips devDependencies if any)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY server.js ./
COPY public ./public
COPY scripts ./scripts

# Volume mount points — Fly.io will mount persistent volume here
RUN mkdir -p /app/data /app/outputs
VOLUME ["/app/data", "/app/outputs"]

ENV NODE_ENV=production
ENV PORT=3000
ENV SECURE_COOKIES=true
ENV AUTO_OPEN_BROWSER=false

EXPOSE 3000

CMD ["node", "server.js"]
