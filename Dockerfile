FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PANEL_CONFIG_PATH=/data/panel/panel.config.json

EXPOSE 18080

CMD ["node", "src/server.js"]
