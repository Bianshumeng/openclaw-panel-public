FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY public ./public
COPY src ./src
COPY scripts ./scripts

RUN npm run build:runtime

FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.runtime/public ./public
COPY --from=builder /app/.runtime/src ./src

ENV NODE_ENV=production
ENV PANEL_CONFIG_PATH=/data/panel/panel.config.json

CMD ["node", "src/server.js"]
