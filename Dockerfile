FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY assets ./assets
ENV NODE_ENV=production
CMD ["npm", "start"]
