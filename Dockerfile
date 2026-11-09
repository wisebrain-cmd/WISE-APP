FROM node:20-bookworm-slim

WORKDIR /app

# sqlite3 may need to compile its native addon when a prebuilt binary is unavailable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["npm", "start"]
