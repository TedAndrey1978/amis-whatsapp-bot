FROM node:20-alpine

WORKDIR /usr/src/app

# Instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el código del bot
COPY . .

ENV PORT=10000 \
    NODE_ENV=production

EXPOSE 10000

CMD ["node", "server.js"]
