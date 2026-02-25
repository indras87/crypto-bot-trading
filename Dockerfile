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

CMD ["node", "dist/index.js", "trade"]
