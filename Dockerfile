# Dockerfile oficial para Puppeteer & WhatsApp Web 24/7 en Render
FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /usr/src/app

# Copiar e instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

ENV PORT=10000 \
    NODE_ENV=production

EXPOSE 10000 5529

CMD ["node", "server.js"]
