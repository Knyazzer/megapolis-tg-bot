FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY scripts ./scripts
COPY src ./src

RUN npm run check

USER node

EXPOSE 3000

CMD ["npm", "start"]
