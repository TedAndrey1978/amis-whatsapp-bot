# Dockerfile para Servidor 24/7 de WhatsApp y Antigravity en Render / Railway / Cloud
FROM node:20-bullseye-slim

# Instalar Chromium y dependencias nativas de Linux para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libasound2 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Establecer variable de entorno para Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /usr/src/app

# Copiar paquetes e instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar código fuente
COPY . .

# Exponer puerto HTTP
EXPOSE 5529 10000 8080 3000

# Iniciar servidor
CMD ["node", "server.js"]
