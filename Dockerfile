FROM node:20-slim

WORKDIR /usr/src/app

# Instalar git necesario para dependencias de Baileys
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Instalar dependencias
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el código del bot
COPY . .

ENV PORT=10000 \
    NODE_ENV=production

EXPOSE 10000

CMD ["node", "server.js"]
