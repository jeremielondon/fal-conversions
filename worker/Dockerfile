# FAL Tracking Worker — Stripe webhook → Google Ads Enhanced Conversions
# Lean Node service. No build step (plain ESM JS).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install deps first (layer cache). No lockfile committed → use install, not ci.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Persistent attribution store (ref→gclid). Created + owned by `node` so the
# named volume mounted at /data inherits writable ownership on first creation.
RUN mkdir -p /data && chown node:node /data

# Run unprivileged (node:alpine ships a `node` user)
USER node

EXPOSE 3020
CMD ["node", "src/server.js"]
