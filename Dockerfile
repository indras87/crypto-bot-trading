FROM node:22-bookworm

WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build:prod

EXPOSE 3333

CMD ["sh", "-c", "[ -f var/config.json ] || echo '{\"webserver\":{\"ip\":\"0.0.0.0\",\"port\":3333}}' > var/config.json && node dist/index.js trade --port=3333"]
