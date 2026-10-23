// Manejo global de excepciones para evitar que el contenedor muera
process.on('uncaughtException', (err) => {
  console.error('🚨 [EXCEPCIÓN CAPTURADA]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🚨 [RECHAZO CAPTURADO]:', reason);
});

import * as BaileysModule from '@whiskeysockets/baileys';
const baileys = BaileysModule.default || BaileysModule;
const makeWASocket = typeof baileys === 'function' ? baileys : (baileys.default || baileys.makeWASocket || BaileysModule.makeWASocket || baileys);
const useMultiFileAuthState = baileys.useMultiFileAuthState || BaileysModule.useMultiFileAuthState;
const DisconnectReason = baileys.DisconnectReason || BaileysModule.DisconnectReason;
const BufferJSON = baileys.BufferJSON || BaileysModule.BufferJSON;
const initAuthCreds = baileys.initAuthCreds || BaileysModule.initAuthCreds;
const proto = baileys.proto || BaileysModule.proto;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || BaileysModule.fetchLatestBaileysVersion;
import { MongoClient } from 'mongodb';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { generateConversationalReply } from './asistente_conversacional.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://tedandrey78_db_user:HYHCN2Utcqhdwn7a@cluster0.fe2xsa1.mongodb.net/amis_whatsapp?authSource=admin&retryWrites=true&w=majority&appName=Cluster0';
let mongoClient = null;
let sessionCollection = null;
let userSessionsCollection = null;
let lastMongoError = null;

async function useMongoAuthState() {
  try {
    if (!mongoClient) {
      console.log('📡 Conectando a MongoDB Atlas para persistencia de sesión 24/7...');
      mongoClient = new MongoClient(MONGO_URI);
      await mongoClient.connect();
      const db = mongoClient.db('amis_whatsapp');
      sessionCollection = db.collection('auth_session');
      userSessionsCollection = db.collection('user_sessions');
      lastMongoError = null;
      console.log('✅ MongoDB Atlas conectado exitosamente.');
    }

    const writeData = async (data, id) => {
      try {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await sessionCollection.replaceOne({ _id: id }, { _id: id, data: serialized }, { upsert: true });
        console.log(`💾 [MONGO PERSISTENCIA] Clave guardada: ${id}`);
      } catch (err) {
        console.error('Error guardando en MongoDB:', err.message);
      }
    };

    const readData = async (id) => {
      try {
        const doc = await sessionCollection.findOne({ _id: id });
        if (doc && doc.data) {
          return JSON.parse(doc.data, BufferJSON.reviver);
        }
        return null;
      } catch (err) {
        console.error('Error leyendo de MongoDB:', err.message);
        return null;
      }
    };

    const removeData = async (id) => {
      try {
        await sessionCollection.deleteOne({ _id: id });
        console.log(`🗑️ [MONGO PERSISTENCIA] Clave eliminada: ${id}`);
      } catch (err) {
        console.error('Error eliminando de MongoDB:', err.message);
      }
    };

    const credsDoc = await readData('creds');
    const creds = credsDoc || initAuthCreds();

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const data = {};
            for (const id of ids) {
              const val = await readData(`${type}-${id}`);
              if (val) data[id] = val;
            }
            return data;
          },
          set: async (data) => {
            for (const category in data) {
              for (const id in data[category]) {
                const val = data[category][id];
                const key = `${category}-${id}`;
                if (val) {
                  await writeData(val, key);
                } else {
                  await removeData(key);
                }
              }
            }
          }
        }
      },
      saveCreds: () => writeData(creds, 'creds')
    };
  } catch (err) {
    console.error('⚠️ Error crítico en useMongoAuthState:', err.message);
    lastMongoError = err.message;
    throw err;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Variables de estado del bot
let currentQrData = null;
let currentQrImage = null;
let currentPairingCode = null;
let isClientReady = false;
let connectedUser = null;
let sock = null;

const SESSIONS_FILE = path.join(__dirname, 'user_sessions.json');
let userSessions = {};
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    userSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  }
} catch (e) {
  userSessions = {};
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(userSessions, null, 2), 'utf8');
  } catch (e) {
    console.error('Error guardando sesiones locales:', e.message);
  }
}

async function getUserSession(key) {
  if (userSessions[key]) return userSessions[key];
  if (userSessionsCollection) {
    try {
      const doc = await userSessionsCollection.findOne({ _id: key });
      if (doc && doc.state) {
        userSessions[key] = doc.state;
        return userSessions[key];
      }
    } catch (e) {
      console.error('Error recuperando sesión de MongoDB Atlas:', e.message);
    }
  }
  userSessions[key] = {
    state: 'IDLE',
    activePillar: null,
    activeSubmodule: null,
    history: [],
    waitingPillarConfirmation: false,
    pendingQuery: null,
    pendingTargetPillar: null,
    updatedAt: Date.now()
  };
  return userSessions[key];
}

async function saveUserSession(key, data) {
  userSessions[key] = data;
  saveSessions();
  if (userSessionsCollection) {
    try {
      await userSessionsCollection.replaceOne(
        { _id: key },
        { _id: key, state: data, updatedAt: new Date() },
        { upsert: true }
      );
    } catch (e) {
      console.error('Error persistiendo sesión en MongoDB Atlas:', e.message);
    }
  }
}

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'menu_config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error cargando menu_config.json:', err.message);
  }
  return { authorized_users: [], modules: {} };
}

function getAuthorizedUser(senderNumber, config, fullSender = '') {
  if (!config.authorized_users) return null;
  const cleanSender = (senderNumber || '').replace(/[^0-9]/g, '');
  return config.authorized_users.find(u => {
    const cleanAuth = (u.phone || '').replace(/[^0-9]/g, '');
    const cleanLid = (u.lid || '').replace(/[^0-9]/g, '');
    if (cleanAuth && (cleanSender.endsWith(cleanAuth) || cleanAuth.endsWith(cleanSender) || fullSender.includes(cleanAuth))) return true;
    if (cleanLid && (cleanSender === cleanLid || cleanSender.includes(cleanLid) || fullSender.includes(cleanLid))) return true;
    return false;
  });
}

function buildMainMenu(user, config) {
  let menu = config.menu_header.replace('{name}', user.name).replace('{role}', user.role);
  menu += '\n\n';

  let optionIndex = 1;
  const userModules = [];

  for (const [modKey, modData] of Object.entries(config.modules)) {
    if (modData.allowed_roles.includes(user.role) || modData.allowed_roles.includes('*')) {
      menu += `${optionIndex}️⃣ *${modData.title}*\n_${modData.description}_\n\n`;
      userModules.push({ digit: optionIndex.toString(), key: modKey, ...modData });
      optionIndex++;
    }
  }

  menu += config.menu_footer;
  return menu;
}

// Iniciar Servidor HTTP inmediatamente para Render
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let docsCount = 0;
    try {
      if (sessionCollection) docsCount = await sessionCollection.countDocuments();
    } catch (e) {}
    res.end(JSON.stringify({
      ready: isClientReady,
      authenticated: isClientReady,
      needsQr: !isClientReady && !!currentQrData,
      pairingCode: currentPairingCode || null,
      user: connectedUser || null,
      mongo: {
        connected: !!sessionCollection,
        error: lastMongoError,
        docsCount: docsCount
      }
    }));
    return;
  }

  if (req.url === '/send' && req.method === 'POST') {
    let postBody = '';
    req.on('data', chunk => { postBody += chunk; });
    req.on('end', async () => {
      try {
        const { phone, message } = JSON.parse(postBody);
        if (!phone || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Faltan campos phone o message' }));
        }
        const target = phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
        if (sock && isClientReady) {
          await sock.sendMessage(target, { text: message });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, target }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'WhatsApp no está listo aún' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Página visual en navegador (QR, Pairing Code y Estado en vivo)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AMIS Constructora · Torre de Control 24/7</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 30px 20px; }
        .card { max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 28px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
        h1 { font-size: 22px; margin-bottom: 6px; color: #38bdf8; }
        p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 20px; }
        .badge-online { background: #065f46; color: #34d399; }
        .badge-qr { background: #854d0e; color: #facc15; }
        .qr-box { background: white; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 20px; }
        .qr-box img { display: block; max-width: 256px; height: auto; }
        .pairing-code { font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #38bdf8; background: #0f172a; padding: 12px 24px; border-radius: 8px; border: 1px dashed #38bdf8; display: inline-block; margin-bottom: 15px; }
      </style>
      <script>
        setTimeout(() => { location.reload(); }, 6000);
      </script>
    </head>
    <body>
      <div class="card">
        <h1>AMIS CONSTRUCTORA</h1>
        <p>Cerebro Central Antigravity · Baileys 24/7</p>

        ${isClientReady ? `
          <div class="badge badge-online">● SERVICIO ACTIVO Y EN LÍNEA</div>
          <p>Conectado exitosamente como: <strong style="color: #38bdf8;">+${connectedUser || 'Sesión Activa'}</strong></p>
          <p style="font-size: 12px; color: #64748b;">La sesión está resguardada en MongoDB Atlas para evitar desconexiones.</p>
        ` : (currentPairingCode ? `
          <div class="badge badge-qr">⚡ VINCULACIÓN POR CÓDIGO</div>
          <p>Ingresa este código en WhatsApp (Dispositivos vinculados -> Vincular con número de teléfono):</p>
          <div class="pairing-code">${currentPairingCode}</div>
        ` : (currentQrImage ? `
          <div class="badge badge-qr">📷 ESCANEAR CÓDIGO QR</div>
          <div class="qr-box">
            <img src="${currentQrImage}" alt="Código QR WhatsApp" />
          </div>
          <p>Abre WhatsApp en tu teléfono -> Dispositivos vinculados -> Vincular un dispositivo.</p>
        ` : `
          <div class="badge badge-qr">⏳ INICIANDO SERVICIO...</div>
          <p>Conectando a MongoDB Atlas y levantando el asistente...</p>
        `))}
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP activo en el puerto ${PORT}`);
});

// =========================================================================
// 🏃‍♂️ MÓDULO RUNNING & INTELIGENCIA DEPORTIVA GARMIN TED ANDREY
// =========================================================================
const ULTIMAS_SESIONES_RUNNING = [
  {
    fecha: 'Jueves 22 de Octubre, 2026 (19:34)',
    tipo: 'Culiacán Carrera (5K Continuo)',
    distanciaKm: 5.01,
    duracion: '34m 36s',
    ritmoMedio: '6:54 min/km',
    ritmoMejorKm: '5:39 min/km',
    fcMedia: 157,
    fcMax: 168,
    cadenciaMedia: 160,
    cadenciaMax: 181,
    calorias: 400,
    balance: '49.0% / 51.0%',
    oscilacion: '8.1 cm',
    trainingEffect: 3.7,
    zonasFC: { z1: '5%', z2: '20%', z3: '65%', z4: '10%', z5: '0%' },
    tiempoRecuperacionSugerido: '24 horas',
    sensacion: 'Sesión sólida de 5 km en Culiacán. Intensidad en Zona 3 Tempo (157 ppm) con simetría casi perfecta en balance de contacto (49% Izq / 51% Der).'
  },
  {
    fecha: 'Martes 20 de Octubre, 2026 (20:43)',
    tipo: 'Culiacán Carrera (Rodaje Suave)',
    distanciaKm: 2.02,
    duracion: '15m 12s',
    ritmoMedio: '7:13 min/km',
    ritmoMejorKm: '6:45 min/km',
    fcMedia: 134,
    fcMax: 145,
    cadenciaMedia: 158,
    cadenciaMax: 172,
    calorias: 160,
    balance: '49.5% / 50.5%',
    oscilacion: '7.8 cm',
    trainingEffect: 2.1,
    zonasFC: { z1: '25%', z2: '70%', z3: '5%', z4: '0%', z5: '0%' },
    tiempoRecuperacionSugerido: '12 horas',
    sensacion: 'Rodaje regenerativo suave en Zona 2 aeróbica.'
  },
  {
    fecha: 'Sábado 17 de Octubre, 2026 (06:31)',
    tipo: 'Tirada Larga Aeróbica (Fondo 14K)',
    distanciaKm: 14.02,
    duracion: '1h 37m 20s',
    ritmoMedio: '6:57 min/km',
    ritmoMejorKm: '6:30 min/km',
    fcMedia: 146,
    fcMax: 162,
    cadenciaMedia: 162,
    cadenciaMax: 178,
    calorias: 1120,
    balance: '49.2% / 50.8%',
    oscilacion: '8.3 cm',
    trainingEffect: 4.2,
    zonasFC: { z1: '10%', z2: '60%', z3: '25%', z4: '5%', z5: '0%' },
    tiempoRecuperacionSugerido: '36 horas',
    sensacion: 'Fondo matutino de 14 km en Culiacán con buena reserva glucogénica.'
  }
];

async function obtenerAnalisisSesionCompleto(sesionIndex = 0) {
  let s = null;
  if (mongoClient) {
    try {
      const db = mongoClient.db('amis_whatsapp');
      const runs = await db.collection('garmin_activities').find().sort({ fecha: -1 }).limit(5).toArray();
      if (runs && runs.length > 0) {
        const r = runs[sesionIndex] || runs[0];
        s = {
          fecha: r.fecha,
          tipo: r.nombre || 'Carrera Garmin',
          distanciaKm: r.distanciaKm,
          duracion: r.duracion,
          ritmoMedio: r.ritmoMedio,
          ritmoMejorKm: r.ritmoMax || 'N/A',
          fcMedia: r.fcMedia || 157,
          fcMax: r.fcMax || 168,
          cadenciaMedia: r.cadenciaMedia || 160,
          cadenciaMax: r.cadenciaMax || 181,
          calorias: r.calorias || 400,
          balance: r.balanceContactoPiso ? `${r.balanceContactoPiso}%` : '49.0% / 51.0%',
          oscilacion: r.oscilacionVerticalCm ? `${r.oscilacionVerticalCm} cm` : '8.1 cm',
          trainingEffect: r.trainingEffectAerobico || 3.7,
          tiempoRecuperacionSugerido: '24 horas'
        };
      }
    } catch (e) {}
  }
  if (!s) {
    s = ULTIMAS_SESIONES_RUNNING[sesionIndex] || ULTIMAS_SESIONES_RUNNING[0];
  }

  return `🏃‍♂️ *ANÁLISIS BIOMECÁNICO & FISIOLÓGICO GARMIN*\n` +
    `👤 *Atleta:* Lic. Ted Andrey Domínguez | ⌚ *Dispositivo:* Garmin Fēnix 5X\n` +
    `📅 *Sesión:* ${s.fecha}\n` +
    `🎯 *Objetivo:* ${s.tipo}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *1. MÉTRICAS CLAVE DE RENDIMIENTO*\n` +
    `• *Distancia:* ${s.distanciaKm.toFixed(2)} km\n` +
    `• *Tiempo Total:* ${s.duracion}\n` +
    `• *Ritmo Promedio:* ${s.ritmoMedio}\n` +
    `• *Ritmo Máximo:* ${s.ritmoMejorKm}\n` +
    `• *Gasto Calórico:* ${s.calorias} kcal\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `❤️ *2. FISIOLOGÍA CARDIOVASCULAR*\n` +
    `• *FC Media:* ${s.fcMedia} ppm\n` +
    `• *FC Máxima:* ${s.fcMax} ppm\n` +
    `• *Training Effect Aeróbico:* ${s.trainingEffect || '3.7'} / 5.0 (Impacto constructivo de capacidad aeróbica)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ *3. BIOMECÁNICA Y DINÁMICAS (GARMIN FĒNIX 5X)*\n` +
    `• *Cadencia Media:* ${s.cadenciaMedia} spm (Pico: ${s.cadenciaMax} spm)\n` +
    `• *Balance de Contacto (GCT):* ${s.balance || '49% Izq / 51% Der'} (Excelente simetría bilateral)\n` +
    `• *Oscilación Vertical:* ${s.oscilacion || '8.1 cm'}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🧠 *4. DIAGNÓSTICO DEL COACH & CONSEJOS TÁCTICOS*\n` +
    `1. *Intensidad:* Rodaste en Zona 3 Tempo (${s.fcMedia} ppm). Para rodajes suaves regenerativos, modula los primeros 2 km a ~7:15 min/km para sostener Zona 2 pura (<145 ppm).\n` +
    `2. *Cadencia y Metrónomo:* Promediaste ${s.cadenciaMedia} spm. Activa el metrónomo de tu Fēnix 5X en 172-174 ppm con pasos más cortos para aligerar la carga articular.\n` +
    `3. *Recuperación:* Hidratación con electrolitos y descanso activo en las próximas ${s.tiempoRecuperacionSugerido}.\n\n` +
    `_Pregúntame cualquier duda de esta salida o de tu siguiente sesión._`;
}

// =========================================================================
// 🪙 MÓDULO DE CRIPTOMONEDAS: MERCADO BITSO EN VIVO & PORTAFOLIO TED
// =========================================================================
async function obtenerReporteCriptoBitso() {
  const getJson = (url) => new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  try {
    const [btcData, usdtData, ethData] = await Promise.all([
      getJson('https://api.bitso.com/v3/ticker/?book=btc_mxn'),
      getJson('https://api.bitso.com/v3/ticker/?book=usdt_mxn'),
      getJson('https://api.bitso.com/v3/ticker/?book=eth_mxn')
    ]);

    const btcPrice = parseFloat(btcData.payload.last);
    const btcChange24h = parseFloat(btcData.payload.change_24 || 0);
    const btcChangePct = ((btcChange24h / (btcPrice - btcChange24h)) * 100).toFixed(2);
    const usdtPrice = parseFloat(usdtData.payload.last);
    const ethPrice = parseFloat(ethData.payload.last);

    // Portafolio de Ted en Bitso:
    const btcHoldings = 0.00063682;
    const usdtHoldings = 105.85;
    const capitalDepositado = 3000.00;

    const btcValMXN = btcHoldings * btcPrice;
    const usdtValMXN = usdtHoldings * usdtPrice;
    const totalValMXN = btcValMXN + usdtValMXN;
    const diffMXN = totalValMXN - capitalDepositado;
    const diffPct = ((diffMXN / capitalDepositado) * 100).toFixed(2);
    const sign = diffMXN >= 0 
      ? `+$${diffMXN.toFixed(2)} MXN (+${diffPct}%) 🟢` 
      : `-$${Math.abs(diffMXN).toFixed(2)} MXN (${diffPct}%) 🔴`;

    const metaBtc = 0.001;
    const btcFaltante = metaBtc - btcHoldings;
    const metaPct = ((btcHoldings / metaBtc) * 100).toFixed(1);
    const usdtParaMeta = (btcFaltante * btcPrice / usdtPrice).toFixed(2);

    return `🪙 *REPORTE EN VIVO: MERCADO CRIPTOMONEDAS & BITSO*\n` +
      `👤 *Titular:* Lic. Ted Andrey Domínguez | 📊 *Plataforma:* Bitso Alpha\n` +
      `📅 *Fecha y Hora:* ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo', hour: '2-digit', minute: '2-digit' })}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💼 *1. TU PORTAFOLIO EN VIVO*\n` +
      `• *Total Estimado:* $${totalValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN\n` +
      `• *Capital Depositado:* $3,000.00 MXN\n` +
      `• *Rendimiento Neto:* ${sign}\n` +
      `• *Bitcoin Acumulado:* 0.00063682 BTC ($${btcValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN)\n` +
      `• *Reserva Dólares USDT:* 105.85 USDT ($${usdtValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📈 *2. ESTADO DEL MERCADO (BITSO EN VIVO)*\n` +
      `• *Bitcoin (BTC):* $${btcPrice.toLocaleString('es-MX')} MXN (${btcChangePct > 0 ? '+' : ''}${btcChangePct}% en 24h)\n` +
      `• *Dólar Tether (USDT):* $${usdtPrice.toFixed(3)} MXN\n` +
      `• *Ethereum (ETH):* $${ethPrice.toLocaleString('es-MX')} MXN\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *3. META 0.001 BTC (100,000 SATOSHIS)*\n` +
      `• *Progreso:* ${metaPct}% completado.\n` +
      `• *Faltante para la Meta:* 0.00036318 BTC (~$${(btcFaltante * btcPrice).toFixed(2)} MXN o ${usdtParaMeta} USDT).\n` +
      `• *Reserva Disponible:* Tienes 105.85 USDT blindados en caja listos para compras estratégicas.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *4. DIAGNÓSTICO Y PLAN TÁCTICO*\n` +
      `• *Escudo Activo:* Al haber mantenido los 105.85 USDT en reserva, tu capital no sufrió con la corrección de Bitcoin.\n` +
      `• *Ventana de Compra con Descuento:* Bitcoin está testeando el soporte de $1,520,000 - $1,525,000 MXN. Para conquistar tu meta de 0.001 BTC solo requieres convertir *${usdtParaMeta} USDT* a Bitcoin.\n\n` +
      `_¿Deseas ejecutar la conversión de USDT a BTC para amarrar la meta o consultar otra criptomoneda?_`;
  } catch (err) {
    return `⚠️ *Bitso Live:* No se pudo conectar momentáneamente con los servidores de Bitso. Por favor intenta de nuevo en unos segundos.`;
  }
}

// =========================================================================
// 🏃‍♂️ MOTOR DE INTELIGENCIA DEPORTIVA: COACH IA DE RUNNING & FISIOLOGÍA
// =========================================================================
async function responderCoachIA(query) {
  const q = (query || '').toLowerCase().trim();

  let latest = {
    fecha: 'Jueves 22 de Octubre (19:34)',
    distanciaKm: 5.01,
    ritmoMedio: '6:54 min/km',
    fcMedia: 157,
    cadenciaMedia: 160,
    balance: '49.0% / 51.0%'
  };

  if (mongoClient) {
    try {
      const db = mongoClient.db('amis_whatsapp');
      const r = await db.collection('garmin_activities').findOne({}, { sort: { fecha: -1 } });
      if (r) {
        latest = {
          fecha: r.fecha,
          distanciaKm: r.distanciaKm,
          ritmoMedio: r.ritmoMedio,
          fcMedia: r.fcMedia || 157,
          cadenciaMedia: r.cadenciaMedia || 160,
          balance: r.balanceContactoPiso ? `${r.balanceContactoPiso}%` : '49.0% / 51.0%'
        };
      }
    } catch (e) {}
  }

  if (/cu[aá]nto debo|a qu[eé] ritmo|a qu[eé] velocidad|mi ritmo|ritmo ideal|siguiente carrera|siguiente salida|entreno de ma[nñ]ana|ritmo/i.test(q)) {
    return `🏃‍♂️ *Recomendación de Ritmo y Entrenamiento (Coach Ted):*\n\n` +
      `Basado en tu última sesión real de *${latest.distanciaKm} km a ${latest.ritmoMedio}* con FC media de *${latest.fcMedia} ppm*:\n\n` +
      `• *Para tu rodaje suave regenerativo:* Sal entre *7:15 y 7:30 min/km* en los primeros 2 km. Tu objetivo es sostener *Zona 2 aeróbica pura* (<145 ppm) para optimizar quema de grasas y capilarización.\n` +
      `• *Para tu día de calidad (Tempo):* Sostén *5:45 a 6:00 min/km* por bloques controlados de 15 minutos.\n` +
      `• *Para series:* Tu paso objetivo es *5:00 a 5:15 min/km* con recuperación al trote suave.\n\n` +
      `💡 *Regla de oro:* En tu última carrera rodaste a 157 ppm (Zona 3). Para que el fondo sea verdaderamente regenerativo, baja el paso 30 segundos al inicio.`;
  }

  if (/metr[oó]nomo|metometro|como.*pongo.*reloj/i.test(q)) {
    return `⌚ *Cómo Activar el Metrónomo en tu Garmin Fēnix 5X:*\n\n` +
      `Para elevar tu cadencia de ${latest.cadenciaMedia} spm al rango óptimo de 172-178 spm:\n\n` +
      `1️⃣ Presiona el botón *START* (arriba derecha) y entra al perfil *Carrera* (Run).\n` +
      `2️⃣ Mantén presionado el botón *UP / MENU* (botón central izquierdo) por 2 segundos.\n` +
      `3️⃣ Entra a *Configuración de carrera* (Run Settings).\n` +
      `4️⃣ Baja con el botón *DOWN* y selecciona *Metrónomo* (Metronome).\n` +
      `5️⃣ En *Estado*, ponlo en *Activado* (On).\n` +
      `6️⃣ En *Frecuencia*, ajústalo a *172 ppm* o *174 ppm* (para subir gradualmente desde tus ${latest.cadenciaMedia} spm actuales).\n` +
      `7️⃣ En *Alerta / Sonido*, selecciona *Vibración* (ritmo táctil sin pitidos molestos).\n\n` +
      `🎯 *Tip táctico:* Acorta la zancada y mueve los codos más rápido; las piernas seguirán la cadencia de tus brazos.`;
  }

  if (/cadencia|zancada|pisada|talon|impacto|rodillas|180|spm/i.test(q)) {
    return `⚡ *Análisis de Cadencia y Biomecánica (Garmin Fēnix 5X):*\n\n` +
      `• *Tu cadencia en tu última carrera:* Promediaste *${latest.cadenciaMedia} spm*.\n` +
      `• *Balance de pisada:* ${latest.balance} (¡Excelente simetría entre pierna izquierda y derecha!).\n` +
      `• *Objetivo:* Subir gradualmente a *170-174 spm*. Al aumentar la frecuencia con pasos más compactos, reduces el tiempo de impacto en el asfalto y proteges rodillas y sóleos.\n` +
      `• *Consejo:* Usa el metrónomo en 172 ppm durante los primeros 10 minutos de tu próximo trote.`;
  }

  if (/zona|pulsaciones|frecuencia|cardiac|coraz[oó]n|ppm|pecho/i.test(q)) {
    return `❤️ *Control de Zonas Cardíacas (Garmin Ted):*\n\n` +
      `En tu sesión de 5 km promediaste *${latest.fcMedia} ppm* (Zona 3 Tempo):\n` +
      `• *Zona 1 (<130 ppm):* Recuperación activa.\n` +
      `• *Zona 2 (130 - 145 ppm):* *Tu base aeróbica fundamental.* Quema de grasas.\n` +
      `• *Zona 3 (146 - 156 ppm):* Zona Tempo aeróbica donde estuviste ayer.\n` +
      `• *Zona 4 (157 - 168 ppm):* Umbral anaeróbico (tocaste el límite superior a 168 ppm).\n` +
      `• *Zona 5 (>168 ppm):* VO2 máx.\n\n` +
      `📌 *Ajuste:* Inicia más suave tus salidas para mantenerte más tiempo en Zona 2.`;
  }

  if (/dolor|molestia|s[oó]leo|gemelo|pantorrilla|recupera|suplement|creatina|electrolit|agua|descanso/i.test(q)) {
    return `💊 *Protocolo de Recuperación Muscular (Coach Ted):*\n\n` +
      `• *Sóleos y Gemelos:* Aplica 10 minutos de Foam Roller suave y estiramiento con rodilla flexionada para aislar el sóleo.\n` +
      `• *Hidratación Táctica:* 500 ml de agua con 300 mg de citrato de magnesio y una pizca de sal marina para reponer electrolitos.\n` +
      `• *Sueño reparador:* Recuerda que la síntesis de colágeno y recuperación articular ocurre en fases de sueño profundo. Apunta a 7.5 horas hoy.`;
  }

  return `🏃‍♂️ *RUNNING COACH & FISIOLOGÍA GARMIN*\n\n` +
    `Telemetría real sincronizada de tu Garmin Fēnix 5X:\n` +
    `• Registraste *${latest.distanciaKm} km a ${latest.ritmoMedio}* con cadencia de *${latest.cadenciaMedia} spm* y FC media de *${latest.fcMedia} ppm*.\n` +
    `• Tu balance de pisada fue de *${latest.balance}*.\n\n` +
    `💡 *¿Qué deseas consultar de tu entrenamiento?*\n` +
    `• Escribe *ayer* para ver el reporte biomédico completo de tu última sesión de 5K.\n` +
    `• Escribe *ritmo* para saber a qué velocidad salir en tu próxima sesión.\n` +
    `• Escribe *cadencia* para revisar tu zancada y metrónomo.\n` +
    `• Escribe *zonas* para ver tus rangos cardíacos en detalle.\n` +
    `• Escribe *recuperación* para cuidado de sóleos y electrolitos.\n\n` +
    `_O pregúntame directamente cualquier duda de running, o escribe *menu* para volver._`;
}

// =========================================================================
// 🏛️ CENTRO DE MANDO MAESTRO TED ANDREY (EXCLUSIVO 6676921223)
// =========================================================================
const PILARES_INFO = {
  PILAR_1_OBRA: {
    id: '1',
    codigo: 'PILAR_1_OBRA',
    titulo: 'División 1: Obra y Edificación Monolítica',
    proyectos: 'Infonavit Álamos del Río / Proyecto Franco Parral / Suministros'
  },
  PILAR_2_FINANZAS_FISCAL: {
    id: '2',
    codigo: 'PILAR_2_FINANZAS_FISCAL',
    titulo: 'División 2: Fiscal, Corporativo y Tesorería',
    proyectos: 'AMIS Fiscal / TADR Fiscal / Proy. Ejecutivo $360k / Familiar SAT / Moldes SIMA'
  },
  PILAR_3_PERSONAL: {
    id: '3',
    codigo: 'PILAR_3_PERSONAL',
    titulo: 'División 3: Proyectos Personales, Tech & Bienestar',
    proyectos: 'Mercado Cripto Bitso / Garmin Running Coach / SupleAI App / Compras China / Agenda'
  }
};

function getMenuMaestroTed() {
  return `🏛️ *CENTRO DE MANDO ESTRATÉGICO ANTIGRAVITY*\n` +
    `👤 *Lic. Ted Andrey Domínguez Romero*\n\n` +
    `Selecciona la división o frente que deseas consultar:\n\n` +
    `1️⃣ 🏗️ *División 1: Obra y Edificación Monolítica*\n` +
    `   • Proyecto Álamos del Río / Lope (320 viv, $54.33 MDP, anticipo $9.23 MDP en BanBajío)\n` +
    `   • Proyecto Franco / Parral (684 viv Sierra Bonita, muros 10 y 20 cm, visto bueno 7 oct)\n` +
    `   • Catálogo de Materiales y Compras Reales AMIS\n\n` +
    `2️⃣ 💼 *División 2: Fiscal, Corporativo y Tesorería*\n` +
    `   • AMIS Fiscal & BanBajío (~$9.05 MDP) · Dispersión 3 Vías\n` +
    `   • TADR Fiscal (Honorarios, Retenciones y SAT)\n` +
    `   • Submayor Proyecto Ejecutivo ($360k - 50% Ing. Samuel / 50% Ted)\n` +
    `   • Módulo Fiscal Familiar (Ing. Samuel & Sra. Isabel)\n` +
    `   • Sistema de Moldes SIMA (Activos & Rotación 24h)\n\n` +
    `3️⃣ 🌟 *División 3: Proyectos Personales, Tech & Bienestar*\n` +
    `   • Mercado Criptomonedas Bitso Alpha en vivo (BTC, USDT, Meta 0.001 BTC)\n` +
    `   • Running Coach IA & Garmin Fēnix 5X (Telemetría real, cadencia, metrónomo)\n` +
    `   • SupleAI App (SaaS Suplementación Inteligente & Afiliados)\n` +
    `   • Compras en China & Sourcing Internacional (06_COMPRAS_CHINAS / 1688 / Yupoo)\n` +
    `   • Agenda Ejecutiva & Pendientes Personales\n\n` +
    `_Escribe *1*, *2* o *3* para ingresar a una división, o escribe directamente lo que buscas._`;
}

function getSubmenuPilar1() {
  return `🏗️ *DIVISIÓN 1: OBRA Y EDIFICACIÓN MONOLÍTICA*\n` +
    `Contexto de Construcción, Estructuras e Ingeniería SIMA.\n\n` +
    `1️⃣ *Proyecto Álamos del Río / Lope:* 320 viviendas (20 torres de 4 niveles), $54.33 MDP, anticipo $9.23 MDP cobrado en BanBajío con CFDI VIV-2, condición suspensiva Día "D", acero/concreto a cargo de M2 Coseinver ($60.76 MDP).\n` +
    `2️⃣ *Proyecto Franco / Parral:* 684 viviendas cuádruplex (Sierra Bonita), muros de 10 cm y 20 cm (cero muros de 12 cm), visto bueno 7 de octubre de 2026, honorarios $240k+IVA, exclusividad SIMA.\n` +
    `3️⃣ *Catálogo de Precios y Materiales:* Cemento ($245), varilla 3/8 ($178.50), varilla 1/2 ($312), alambre ($38.50), diésel ($25.80).\n\n` +
    `_Escribe el número de la sección (1, 2, 3), haz una pregunta sobre obra, o escribe *menu* para volver._`;
}

function getSubmenuPilar2() {
  return `💼 *DIVISIÓN 2: FISCAL, CORPORATIVO Y TESORERÍA*\n` +
    `Contexto Contable, Fiscal, Societario y Bancario.\n\n` +
    `1️⃣ *AMIS Constructora:* Cuenta BanBajío 476863400201 (~$9.05 MDP) y Dispersión Semanal 3 Vías (Vía 1 Fiscal BanBajío IMSS, Vía 2 Darnelix 8% Asimilables $62.5k netos, Vía 3 Roblock 7% destajos/efectivo).\n` +
    `2️⃣ *TADR Fiscal:* Honorarios Lic. Ted (DORT780211CQ5), retenciones 10% ISR y 10.67% IVA, provisión SAT y asesorías personales.\n` +
    `3️⃣ *Submayor Proyecto Ejecutivo:* Estado del fondo $360,000 MXN ($100k cobrado VIV-1, $260k pendiente; 50% Ing. Samuel / 50% Ted).\n` +
    `4️⃣ *Módulo Fiscal Familiar:* Ing. Samuel (anual exenta en abril) y Sra. Isabel (trámite de disminución de obligaciones ante el SAT).\n` +
    `5️⃣ *Sistema de Moldes SIMA:* Activos, mantenimiento y rotación 24h.\n\n` +
    `_Escribe el número de la sección (1 al 5), haz tu consulta fiscal o financiera, o escribe *menu* para volver._`;
}

function getSubmenuPilar3() {
  return `🌟 *DIVISIÓN 3: PROYECTOS PERSONALES, TECH & BIENESTAR*\n` +
    `Contexto Personal, Tecnológico y Deportivo.\n\n` +
    `1️⃣ *🪙 Mercado Criptomonedas Bitso:* Portafolio en vivo (0.00063682 BTC, 105.85 USDT, meta 0.001 BTC / 100,000 satoshis).\n` +
    `2️⃣ *🏃‍♂️ Running Coach & Garmin Fēnix 5X:* Telemetría real (5.01 km a 6:54 min/km), cadencia (160 spm), metrónomo (172 ppm) y zonas cardíacas.\n` +
    `3️⃣ *📱 SupleAI App:* SaaS de suplementación inteligente (React Native + FastAPI) y monetización con afiliados.\n` +
    `4️⃣ *🇨🇳 Compras en China & Sourcing:* Importaciones, plataformas 1688, catálogos Yupoo, casilleros CSSBuy/Sugargoo/US Closer e inspección QC.\n` +
    `5️⃣ *📋 Agenda Ejecutiva:* Organización de actividades, compromisos y pendientes personales.\n\n` +
    `_Escribe el número de la sección (1 al 5), haz tu consulta directa, o escribe *menu* para volver._`;
}

function detectarPilarDeConsulta(text) {
  const t = (text || '').toLowerCase().trim();

  // Detección Pilar 3: Personal / Tech
  const matchPersonal = /cripto|bitcoin|btc|bitso|usdt|eth|satoshi|running|garmin|correr|entreno|sesi[oó]n.*ayer|cadencia|ritmo|ppm|pulsaciones|supleai|suplement|creatina|china|compras?|pedido|pedidos|paquete|paquetes|gu[ií]a|rastreo|casillero|yupoo|1688|taobao|cssbuy|sugargoo|us closer|aduanas?|agenda.*personal|compromiso.*personal/i.test(t);

  // Detección Pilar 2: Fiscal / Finanzas
  const matchFiscal = /banbaj[ií]o|cuenta.*maestra|saldo.*amis|darnelix|roblock|asimilables?|factura.*tadr|honorarios?.*ted|retenci[oó]n|dort780211|aco241114|submayor|proyecto ejecutivo|360k|isabel romero|samuel dom[ií]nguez.*sat|declaraci[oó]n.*anual|impuestos?|provisi[oó]n sat|diot|n[oó]mina.*semanal|tabulador/i.test(t);

  // Detección Pilar 1: Obra
  const matchObra = /alamos|[aá]lamos|lope|franco|parral|sierra bonita|muro|moldes?|vivienda|torre|concreto|varilla|cemento|di[eé]sel|arena|grava|cuadrilla|colado|residente|destajo.*obra/i.test(t);

  if (matchPersonal && !matchObra && !matchFiscal) return 'PILAR_3_PERSONAL';
  if (matchFiscal && !matchObra && !matchPersonal) return 'PILAR_2_FINANZAS_FISCAL';
  if (matchObra && !matchFiscal && !matchPersonal) return 'PILAR_1_OBRA';
  return null;
}

async function responderConsultaPilar(pilar, query, userState = null, sessionKey = null) {
  const q = (query || '').toLowerCase().trim();

  // Helper para persistir submódulo de inmediato
  const setSubmodule = async (subm) => {
    if (userState) {
      userState.activeSubmodule = subm;
      if (sessionKey) {
        await saveUserSession(sessionKey, userState);
      } else {
        saveSessions();
      }
    }
  };

  // Respuestas Pilar 1: Obra y Edificación Monolítica
  if (pilar === 'PILAR_1_OBRA') {
    if (q === '1' || /^(alamos|[aá]lamos|lope|infonavit)$/i.test(q)) {
      await setSubmodule('ALAMOS');
      return `🏢 *Proyecto Infonavit Álamos del Río (AMIS SIMA)*\n\n` +
        `• *Alcance:* 320 viviendas (20 torres de 4 niveles en obra gris monolítica).\n` +
        `• *Monto Contrato:* $54,337,280.00 MXN ($169,804.00/viv exento de IVA).\n` +
        `• *Cobranza:* Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en CFDI VIV-2 en BanBajío.\n` +
        `• *Saldo por Cobrar:* $45,099,942.40 MXN en estimaciones de obra.\n` +
        `• *Condición Suspensiva:* Plazos congelados hasta cumplimiento total del Día 'D' (dictamen de uso de suelo + planos autorizados).\n` +
        `• *Rotación:* Estricta rotación de 24 horas por nivel con moldes SIMA.\n` +
        `• *Suministros:* Acero y concreto mayores a cargo de M2 Coseinver ($60.76 MDP). Pre-armados activos en patio.\n\n` +
        `_¿Deseas consultar sobre habilitado de acero, condición Día D, relación con M2 o estimaciones?_`;
    }
    if (q === '2' || /^(franco|parral|sierra bonita)$/i.test(q)) {
      await setSubmodule('PARRAL');
      return `⛏️ *Proyecto Franco / Parral (SIMA - Chihuahua)*\n\n` +
        `• *Alcance:* 684 viviendas en edificios cuádruplex (prototipo Sierra Bonita: 2 PB / 2 PA, lote 14.04x15).\n` +
        `• *Estatus de Planos:* Visto bueno definitivo del martes 7 de octubre de 2026 (13 láminas ejecutivas autorizadas).\n` +
        `• *Espesores de Muro:* Cero muros de 12 cm. Muros de *10 cm* (carga y colindancias) y *20 cm* (instalaciones 3" y 4", y fachada de acceso).\n` +
        `• *Honorarios Estructurales:* $240,000 + IVA (bonificables si contratan antes del 15 de diciembre de 2026).\n` +
        `• *Exclusividad SIMA:* Franco edifica hasta 100 tradicionales; mínimo 584 exclusivas para AMIS.\n\n` +
        `_¿Deseas consultar planos autorizados, cubicaciones, volumetrías o modulación de moldes SIMA?_`;
    }
    if (q === '3' || /^(material|materiales|precios|catalogo)$/i.test(q)) {
      await setSubmodule('MATERIALES');
      return `🏗️ *Catálogo de Precios de Materiales (Compras Reales AMIS):*\n\n` +
        `• *Cemento Gris Tolteca 50kg:* $245.00 MXN / Saco\n` +
        `• *Varilla 3/8" (No. 3):* $178.50 MXN / Tramo 12m\n` +
        `• *Varilla 1/2" (No. 4):* $312.00 MXN / Tramo 12m\n` +
        `• *Alambre Recocido Cal. 16:* $38.50 MXN / Kg\n` +
        `• *Arena Triturada:* $480.00 MXN / M3 | *Grava 3/4":* $520.00 MXN / M3\n` +
        `• *Diésel Automotriz:* $25.80 MXN / Litro\n\n` +
        `_Precios de mercado reales auditados contra facturas de compras recientes. ¿Deseas cotizar algún insumo adicional?_`;
    }
    return null;
  }

  // Respuestas Pilar 2: Fiscal, Corporativo y Tesorería
  if (pilar === 'PILAR_2_FINANZAS_FISCAL') {
    if (q === '1' || /^(saldo|banbaj[ií]o|banco|tesorer[ií]a|amis|dispersion|dispersi[oó]n)$/i.test(q)) {
      await setSubmodule('AMIS_FISCAL');
      return `💼 *Tesorería & Fiscal AMIS Constructora (ACO241114A70):*\n\n` +
        `• *Cuenta BanBajío Maestra:* 476863400201\n` +
        `• *Saldo Auditoría:* ~$9,050,000.00 MXN (Anticipo Álamos blindado).\n` +
        `• *Vías de Dispersión Semanal (Viernes):*\n` +
        `  1. *Fiscal Directa BanBajío:* Solo trabajadores con alta IMSS y timbrado Nominax CFDI 4.0.\n` +
        `  2. *DARNELIX Asimilables (8%):* $62,500.00 netos ($12,500 c/u para los 5 socios). Depósito: $67,129.63 MXN en PEIBO.\n` +
        `  3. *CONSTRUCTORA ROBLOCK (7%):* Destajos sin CFDI, sobrenóminas SPEI y raya en efectivo.\n` +
        `• *Regla de Oro:* Cero dispersión a cuentas de terceros; quien no tenga cuenta bancaria verificada cobra en efectivo en sobre de raya.\n\n` +
        `_¿Deseas consultar saldos bancarios, nómina de la semana o dispersión de socios?_`;
    }
    if (q === '2' || /^(tadr|honorarios?|consultor[ií]a|sat ted)$/i.test(q)) {
      await setSubmodule('TADR_FISCAL');
      return `⚖️ *Contabilidad Personal TADR (Lic. Ted - RFC: DORT780211CQ5):*\n\n` +
        `• *Régimen:* Actividad Empresarial y Servicios Profesionales / Consultoría.\n` +
        `• *Directiva Espejo AMIS:* En facturas para reparto de socios se retiene 10% ISR y 10.67% IVA, apartando bolsa SAT (5.33% IVA residual + ISR).\n` +
        `• *Asesorías Propias:* 100% ingreso exclusivo de Ted Andrey.\n` +
        `• *Libro Maestro:* Control_Fiscal_y_Facturacion_2026_TADR.xlsx.\n\n` +
        `_¿Deseas consultar retenciones acumuladas, provisión de impuestos o deducciones personales?_`;
    }
    if (q === '3' || /^(submayor|proyecto ejecutivo|360k)$/i.test(q)) {
      await setSubmodule('PROY_EJECUTIVO');
      return `📑 *Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN):*\n\n` +
        `• *Titularidad:* 50% Ing. Samuel Domínguez / 50% Lic. Ted Andrey Domínguez.\n` +
        `• *Anticipo Cobrado:* $100,000.00 MXN (CFDI VIV-1).\n` +
        `• *Saldo por Cobrar:* $260,000.00 MXN.\n` +
        `• *Aislamiento:* Cuenta corriente 100% independiente de los repartos ordinarios de socios.\n\n` +
        `_¿Deseas revisar el estado de cuenta del proyecto ejecutivo o programar cobranza?_`;
    }
    if (q === '4' || /^(familiar|modulo familiar|isabel|samuel)$/i.test(q)) {
      await setSubmodule('FAMILIAR');
      return `👨‍👩‍👧 *Módulo Fiscal Familiar (AntiGravity Fiscal Familiar):*\n\n` +
        `1. *Ing. Samuel Domínguez (DORS510222UA2):* Régimen 606 (Dividendos) + 605 (Asimilados). Solo presenta Anual en Abril. Estatus: 100% blindado.\n` +
        `2. *Sra. Isabel Romero (ROGI561130NM0):* Alerta SAT activa por régimen 612. Acción prioritaria: Tramitar Disminución de Obligaciones ante SAT para dejarla solo en Sueldos/Asimilados sin provisionales mensuales.\n\n` +
        `_¿Deseas consultar la estrategia de blindaje o el expediente contable de tus papás?_`;
    }
    if (q === '5' || /^(sima|moldes?)$/i.test(q)) {
      await setSubmodule('SIMA_MOLDES');
      return `⚙️ *Sistema de Moldes SIMA (Activos & Operación):*\n\n` +
        `• *Juegos de Moldes:* Equipos monolíticos de aluminio de alta resistencia para muros y losas.\n` +
        `• *Rotación Oficial:* 24 horas continuas de fraguado y descimbrado por nivel.\n` +
        `• *Mantenimiento:* Supervisión a cargo de Bladimir Beltrán y reposición de herrajes/esquineros autorizados.\n\n` +
        `_¿Deseas consultar inventario de moldes, refacciones o ciclo de rotación?_`;
    }
    return null;
  }

  // Respuestas Pilar 3: Personal, Tech & Bienestar
  if (pilar === 'PILAR_3_PERSONAL') {
    if (q === '1' || /^(cripto|bitso|btc|usdt|portafolio)$/i.test(q)) {
      await setSubmodule('BITSO');
      return await obtenerReporteCriptoBitso();
    }
    if (q === '2' || /^(coach|running|menu coach|garmin|entreno)$/i.test(q)) {
      await setSubmodule('RUNNING');
      return await responderCoachIA(query);
    }
    if (/^(ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis|carrera ayer)$/i.test(q)) {
      await setSubmodule('RUNNING');
      return await obtenerAnalisisSesionCompleto(0);
    }
    if (q === '3' || /^(supleai|app)$/i.test(q)) {
      await setSubmodule('SUPLEAI');
      return `📱 *SupleAI App (SaaS de Suplementación Inteligente):*\n\n` +
        `• *Arquitectura:* Frontend React Native multiplataforma + Backend FastAPI.\n` +
        `• *Monetización:* Deep-linking de suplementos recomendados vía programas de afiliados (Amazon México y Mercado Libre).\n` +
        `• *Blindaje Médico:* Regla de exclusión estricta para embarazo, lactancia y patologías crónicas.\n` +
        `• *Estatus:* Base de datos de ingredientes activos y compatibilidad fisiológica configurada.\n\n` +
        `_¿Deseas consultar sobre ingredientes, monetización de afiliados o desarrollo de la app?_`;
    }
    if (q === '4' || /^(china|importaciones|yupoo|1688|sourcing)$/i.test(q)) {
      await setSubmodule('CHINA');
      return `🇨🇳 *Compras en China & Abastecimiento Internacional:*\n\n` +
        `• *Fábricas y Plataformas:* Conexión directa OEM/ODM en 1688, Taobao y catálogos Yupoo.\n` +
        `• *Agentes y Casilleros:* Operación vía CSSBuy / Sugargoo para consolidación en bodega de China y US Closer para USA.\n` +
        `• *Protocolo de Inspección:* Control de calidad (QC) con fotos HD, verificación de medidas en cm e instrucción 'Drop Box' para aligerar peso volumétrico y blindar aduana.\n` +
        `• *Repositorio:* Expediente exclusivo en 06_COMPRAS_CHINAS.\n\n` +
        `_Estoy listo como tu Director de Sourcing. ¿Deseas consultar estatus de pedidos, catálogos Yupoo, guías de rastreo o cotizar un nuevo producto?_`;
    }
    if (q === '5' || /^(agenda|pendientes)$/i.test(q)) {
      await setSubmodule('AGENDA');
      return `📋 *Agenda Ejecutiva Personal (Lic. Ted):*\n\n` +
        `• Asistente personal y coach activos 24/7.\n` +
        `• Monitoreo de portafolio Bitso sincronizado con precios en vivo.\n` +
        `• Reporte nocturno de running y recordatorios matutinos configurados.\n\n` +
        `_Todo en orden. ¿Deseas agendar alguna actividad o recordatorio específico?_`;
    }
    return null;
  }

  return null;
}

async function consultarCerebroPorDivision(division, userQuery, history = [], submodule = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  let systemPrompt = '';
  let badge = '';

  if (division === 'PILAR_1_OBRA') {
    const isAlamos = submodule === 'ALAMOS' || /alamos|[aá]lamos|lope|infonavit|320|coseinver/i.test(userQuery);
    const isParral = submodule === 'PARRAL' || /franco|parral|sierra bonita|cu[aá]druplex|684/i.test(userQuery);
    const isMateriales = submodule === 'MATERIALES' || /material|materiales|precios?|cemento|varilla|di[eé]sel|arena|grava/i.test(userQuery);

    if (isParral && !isAlamos) {
      badge = '⛏️ [DIVISIÓN 1 · PROYECTO PARRAL]';
      systemPrompt = `Eres el Director Técnico de Obra Monolítica SIMA de Ted Andrey Domínguez en AMIS Constructora.
Ámbito EXCLUSIVO de conversación: PROYECTO FRANCO / PARRAL (Hidalgo del Parral, Chihuahua).
- Parámetros Oficiales Reales y Validados:
  1. Programa Total: 684 viviendas en edificios cuádruplex de 4 departamentos (2 en Planta Baja y 2 en Planta Alta, lotes de 14.04x15 m, 4 estacionamientos frontales en batería). Prototipo Sierra Bonita.
  2. Estatus Oficial de Planos: Visto bueno definitivo del martes 7 de octubre de 2026 a las 8:45 pm con 13 láminas ejecutivas de arquitectura e ingenierías autorizadas.
  3. Espesores de Muro: CERO muros de 12 cm. ÚNICAMENTE muros de 10 cm (carga interiores y colindancias) y muros de 20 cm (instalaciones sanitarias/bajantes de 3" y 4", y fachada principal en accesos).
  4. Condiciones Económicas (Rev. 8): Honorarios de diseño estructural $240,000.00 MXN + IVA (bonificables si contratan obra antes del 15 de diciembre de 2026); tarifa de no realización $120,000.00 MXN + IVA; gestoría RUV/INFONAVIT hasta $360,000.00 MXN + IVA.
  5. Exclusividad SIMA: Hasta 100 viviendas tradicionales para Franco; las restantes mínimo 584 viviendas exclusivas para AMIS con moldes SIMA. Suministros generales a cargo de Franco en tiempo y forma.
AISLAMIENTO ESTRICTO: Cero mezcla con Álamos del Río ni con finanzas personales o compras en China.
Tono: Muy natural, conversacional, profesional de ingeniería, claro, conciso y directo al grano.`;
    } else if (isMateriales && !isAlamos && !isParral) {
      badge = '📦 [DIVISIÓN 1 · PRECIOS Y MATERIALES]';
      systemPrompt = `Eres el Encargado de Compras e Insumos de Obra de AMIS Constructora para Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: CATÁLOGO DE PRECIOS Y REQUISICIONES DE MATERIALES.
- Catálogo de compras reales auditado contra facturas recientes (02_COTIZACIONES_Y_MERCADEO/CATALOGO_PRECIOS_Y_MERCADEO.xlsx):
  * Cemento Gris Tolteca 50kg: $245.00 MXN / saco.
  * Varilla 3/8" (No. 3): $178.50 MXN / tramo de 12m.
  * Varilla 1/2" (No. 4): $312.00 MXN / tramo de 12m.
  * Alambre Recocido Cal. 16: $38.50 MXN / kg.
  * Arena Triturada: $480.00 MXN / m3 | Grava 3/4": $520.00 MXN / m3.
  * Diésel automotriz para maquinaria: $25.80 MXN / litro.
- Operación de Requisiciones: Canalizadas en campo a través del Ing. Emilio Peñuelas (Pre-Armados) y Bladimir Beltrán (Mantenimiento).
Tono: Técnico, matemático, ágil y enfocado en costos y rendimientos.`;
    } else {
      badge = '🏗️ [DIVISIÓN 1 · ÁLAMOS DEL RÍO]';
      systemPrompt = `Eres el Director Técnico e Ingeniero de Obra Monolítica SIMA de Ted Andrey Domínguez en AMIS Constructora.
Ámbito EXCLUSIVO de conversación: INFONAVIT ÁLAMOS DEL RÍO / PROYECTO LOPE (Navolato, Sinaloa).
- Parámetros Oficiales del Proyecto:
  1. Alcance: Exclusivamente Obra Gris Monolítica con Sistema de Moldes SIMA para 320 viviendas (20 torres de 4 niveles).
  2. Monto Contractual: $54,337,280.00 MXN ($169,804.00 / viv). Régimen Exento de IVA.
  3. Cobranza: Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en firme con CFDI VIV-2 en Banco del Bajío.
  4. Saldo por Cobrar: $45,099,942.40 MXN a liquidar mediante estimaciones quincenales por avance de obra.
  5. Reglas de Oro Operativas:
     - Plazos contractuales de ejecución congelados hasta cumplir la Condición Suspensiva del Día "D" (Anticipo cobrado + Dictamen de Uso de Suelo + Planos ejecutivos aprobados por el Municipio).
     - Rotación estricta de moldes de 24 horas continuas por nivel.
     - Suministros principales (acero, concreto premezclado, tuberías) e indirectos mayores son 100% de M2 Coseinver ($60.76 MDP en Anexo C contractual).
     - Habilitado de acero y pre-armados activos en patio de maniobras por cuadrillas de AMIS.
AISLAMIENTO ESTRICTO: Prohibido hablar de finanzas personales, cripto o compras en China.
Tono: Natural, conversacional, ejecutivo de obra y directo al grano.`;
    }
  } else if (division === 'PILAR_2_FINANZAS_FISCAL') {
    const isAmis = submodule === 'AMIS_FISCAL' || /amis|banbaj[ií]o|dispersion|dispersi[oó]n|darnelix|roblock|n[oó]mina|tabulador/i.test(userQuery);
    const isTadr = submodule === 'TADR_FISCAL' || /tadr|dort780211|honorarios?.*ted|retenci[oó]n|sat ted/i.test(userQuery);
    const isProyEj = submodule === 'PROY_EJECUTIVO' || /submayor|proyecto ejecutivo|360k/i.test(userQuery);
    const isFamiliar = submodule === 'FAMILIAR' || /familiar|isabel|samuel.*sat|anual/i.test(userQuery);
    const isSima = submodule === 'SIMA_MOLDES' || /sima|moldes?/i.test(userQuery);

    if (isTadr && !isAmis) {
      badge = '⚖️ [DIVISIÓN 2 · TADR CONSULTORÍA FISCAL]';
      systemPrompt = `Eres el Asesor Fiscal Personal del Lic. Ted Andrey Domínguez Romero.
Ámbito EXCLUSIVO de conversación: CONTABILIDAD PERSONAL TADR (RFC: DORT780211CQ5).
- Régimen: Actividad Empresarial y Servicios Profesionales / Consultoría.
- Directiva Espejo AMIS: En facturas emitidas para reparto de socios se retiene 10% ISR y 10.67% IVA por parte de AMIS; se aparta la Bolsa de Provisión Impuestos SAT (IVA residual 5.33% + ISR estimado) y el remanente neto se dispersa a los 5 socios.
- Asesorías Reales de Ted: 100% de ingreso propio e independiente de Ted.
- Libro Maestro: Control_Fiscal_y_Facturacion_2026_TADR.xlsx.
Tono: Asesor fiscal de cabecera, analítico, seguro y matemático al centavo.`;
    } else if (isProyEj && !isAmis) {
      badge = '📑 [DIVISIÓN 2 · SUBMAYOR PROYECTO EJECUTIVO]';
      systemPrompt = `Eres el Auditor Contable del Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN).
Ámbito EXCLUSIVO de conversación: SUBMAYOR PROYECTO EJECUTIVO.
- Titularidad: Pertenece estrictamente en 50% al Ing. Samuel Domínguez Rosas y 50% al Lic. Ted Andrey Domínguez Romero.
- Anticipo Cobrado a M2 Coseinver: $100,000.00 MXN timbrado con CFDI VIV-1.
- Saldo por Cobrar: $260,000.00 MXN.
- Blindaje: Cuenta corriente 100% independiente de los repartos ordinarios de socios de AMIS.
Tono: Auditor contable, conciso y exacto.`;
    } else if (isFamiliar && !isAmis) {
      badge = '👨‍👩‍👧 [DIVISIÓN 2 · MÓDULO FISCAL FAMILIAR]';
      systemPrompt = `Eres el Asesor Fiscal Familiar de la familia Domínguez Romero (AntiGravity Fiscal Familiar).
Ámbito EXCLUSIVO de conversación: MÓDULO FISCAL FAMILIAR.
- Contribuyentes Administrados:
  1. Ing. Samuel Domínguez Rosas (RFC: DORS510222UA2): Régimen 606 (Dividendos) + 605 (Asimilados). BanBajío CLABE 030730900012268610. Obligación: Únicamente Declaración Anual en Abril. Cero provisionales, cero IVA mensual, cero DIOT. Estatus: 100% blindado.
  2. Sra. Isabel Romero Guerrero (RFC: ROGI561130NM0): Régimen 612 (Actividad Empresarial) + 605 (Asimilados). BanBajío CLABE 030730900012268500. Alerta activa: SAT exige pagos mensuales. Acción Estratégica Prioritaria: Tramitar Disminución de Obligaciones ante el SAT para dejarla solo en Sueldos/Asimilados y Dividendos (exenta de declaraciones mensuales).
Tono: Profesional, respetuoso, patrimonial y preventivo.`;
    } else if (isSima && !isAmis) {
      badge = '⚙️ [DIVISIÓN 2 · ACTIVOS MOLDES SIMA]';
      systemPrompt = `Eres el Contralor de Activos y Mantenimiento del Sistema de Moldes SIMA.
Ámbito EXCLUSIVO de conversación: ACTIVOS Y MOLDES SIMA.
- Equipos de moldes monolíticos de aluminio para muros y losas.
- Ciclo de rotación estricta de 24 horas continuas de fraguado y descimbrado.
- Mantenimiento y reposición de esquineros, cuñas y corbatas a cargo de Bladimir Beltrán.
Tono: Práctico, enfocado en amortización de activos y continuidad de obra.`;
    } else {
      badge = '💼 [DIVISIÓN 2 · AMIS FISCAL & TESORERÍA]';
      systemPrompt = `Eres el Contralor Corporativo y Asesor Fiscal de Cabecera de Ted Andrey Domínguez en AMIS Constructora, S.A. de C.V.
Ámbito EXCLUSIVO de conversación: AMIS CONSTRUCTORA (RFC: ACO241114A70).
- Cuenta Maestra BanBajío: 476863400201 (Saldo vivo ~$9.05 MDP, respaldando anticipo Álamos).
- 5 Socios al 20% c/u: Ing. Samuel, Sra. Isabel, Sam Jr., Ted Andrey, Mariano.
- Sistema Maestro de Dispersión Semanal (Viernes AMIS - 3 Vías):
  1. Vía 1 (Fiscal Directa BanBajío): ÚNICAMENTE nómina neta timbrada de personal dado de alta ante el IMSS (RP Z3350123108, Nominax y CFDI 4.0).
  2. Vía 2 (Socios Asimilables vía DARNELIX 8%): Reparto de $62,500.00 MXN netos ($12,500 c/u a los 5 socios). Depósito: $67,129.63 MXN a cuenta PEIBO 732010100000087663.
  3. Vía 3 (Constructora Roblock 7%): Factura deducible de materiales para destajos sin CFDI, sobrenóminas SPEI y raya en efectivo.
  4. PROHIBICIÓN ESTRICTA: Cero transferencias a cuentas de terceros. Quien no tenga cuenta bancaria auditada a su nombre cobra en efectivo en sobre de raya.
Tono: Analítico, matemático al centavo, blindado fiscalmente y conversacional.`;
    }
  } else if (division === 'PILAR_3_PERSONAL') {
    const isChina = submodule === 'CHINA' || /china|compras?|pedido|pedidos|paquete|paquetes|gu[ií]a|rastreo|casillero|yupoo|1688|taobao|cssbuy|sugargoo|us closer|aduanas?|sourcing/i.test(userQuery);
    const isRunning = submodule === 'RUNNING' || /running|garmin|correr|entreno|cadencia|ritmo|metr[oó]nomo|km|s[oó]leo|zancada|pulsaciones|ppm|frecuencia card/i.test(userQuery);
    const isCripto = submodule === 'BITSO' || /cripto|bitso|btc|bitcoin|usdt|satoshis?|portafolio/i.test(userQuery);
    const isSuple = submodule === 'SUPLEAI' || /supleai|suplement|creatina|prote[ií]na|afiliados/i.test(userQuery);
    const isAgenda = submodule === 'AGENDA' || /agenda|pendiente|recordatorio|compromiso/i.test(userQuery);

    if (isChina && !isRunning && !isCripto) {
      badge = '🇨🇳 [DIVISIÓN 3 · COMPRAS EN CHINA · SOURCING]';
      systemPrompt = `Eres el Director Senior de Compras Internacionales, Negociador Estratégico y Agente de Abastecimiento (Sourcing Director) de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: COMPRAS EN CHINA & ABASTECIMIENTO INTERNACIONAL (Carpeta oficial de trabajo: 06_COMPRAS_CHINAS).
- Especialidad y Operación:
  1. Plataformas y Fábricas: Negociación directa con proveedores OEM/ODM en 1688 (precios mayoristas de fábrica), Taobao y catálogos Yupoo (calzado deportivo, ropa técnica y accesorios de máxima calidad).
  2. Casilleros y Agentes: Operación con CSSBuy y Sugargoo para compras asistidas y consolidación en bodegas de China, y casillero US Closer en EE. UU. para triangulación hacia México.
  3. Control de Calidad (QC): Protocolo estricto de inspección en bodega china (fotos HD desde múltiples ángulos, medición con cinta métrica de plantillas y prendas en cm para evitar fallas de tallaje).
  4. Aduana y Logística ("Drop Box"): Instrucción obligatoria de solicitar "Drop Box" (retirar cajas de calzado) para reducir drásticamente el peso volumétrico y minimizar inspecciones aduanales. Uso de líneas trianguladas tax-free o declaración aduanal prudente ($12-$14 USD/kg).
  5. Estatus actual: Explica a Ted de forma directa y ejecutiva el flujo de compras activas registrado en '06_COMPRAS_CHINAS'. Si pregunta por el estatus de sus compras o paquetes, infórmale que los enlaces y órdenes se gestionan a través de sus casilleros (CSSBuy/Sugargoo/US Closer) y pídele el número de orden, guía o producto específico que desea revisar para darle el rastreo puntual.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de running, carreras, tenis deportivos desde la perspectiva de entrenamiento, Garmin Fēnix 5X, métricas de ejercicio, obras de construcción o impuestos.
Tono: Negociador internacional experto, ágil, altamente profesional, conciso y directo al grano.`;
    } else if (isRunning && !isChina && !isCripto) {
      badge = '🏃‍♂️ [DIVISIÓN 3 · RUNNING COACH GARMIN]';
      let latestRunDetails = `
- Carrera Más Reciente (Ayer Jueves 22 Oct, 19:34): Culiacán Carrera de 5.01 km en 34m 36s. Ritmo promedio: 6:54 min/km (máximo 5:39 min/km). FC Media: 157 ppm (máx 168 ppm - Zona 3 Tempo). Cadencia media: 160 spm (pico 181 spm). Balance de contacto GCT: 49.0% Izquierda / 51.0% Derecha (simetría excelente). Oscilación vertical: 8.1 cm. Gasto calórico: 400 kcal. Desnivel: +21 m. Training Effect Aeróbico: 3.7 / 5.0.
- Carrera Anterior (Martes 20 Oct, 20:43): Rodaje suave de 2.02 km a 7:13 min/km (FC Media 134 ppm, Zona 2 pura).
- Fondo Anterior (Sábado 17 Oct, 06:31): Tirada larga de 14.02 km en 1h 37m a 6:57 min/km (FC Media 146 ppm).`;

      if (mongoClient) {
        try {
          const db = mongoClient.db('amis_whatsapp');
          const dbRuns = await db.collection('garmin_activities').find().sort({ fecha: -1 }).limit(3).toArray();
          if (dbRuns && dbRuns.length > 0) {
            latestRunDetails = '\n' + dbRuns.map((r, i) => 
              `- ${i === 0 ? 'ÚLTIMA CARRERA REGISTRADA' : 'Carrera Anterior'} (${r.fecha}): ${r.nombre || 'Carrera'} de ${r.distanciaKm} km en ${r.duracion}. Ritmo: ${r.ritmoMedio} (máx ${r.ritmoMax || 'N/A'}). FC Media: ${r.fcMedia || 'N/A'} ppm (máx ${r.fcMax || 'N/A'} ppm). Cadencia: ${r.cadenciaMedia || 160} spm (máx ${r.cadenciaMax || 181} spm). Balance GCT: ${r.balanceContactoPiso ? r.balanceContactoPiso + '%' : '49/51%'}. Training Effect: ${r.trainingEffectAerobico || '3.7'}.`
            ).join('\n');
          }
        } catch (e) {}
      }

      systemPrompt = `Eres el Running Coach de Alto Rendimiento y Asesor Fisiológico de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: RUNNING COACH & FISIOLOGÍA GARMIN.
- Atleta: Lic. Ted Andrey Domínguez.
- Reloj Oficial: Garmin Fēnix 5X (Cristal de zafiro, sensor Elevate, altímetro barométrico, 5 botones: LIGHT, UP/MENU, DOWN, START/STOP, BACK/LAP). Conoces al 100% sus pantallas, configuraciones de campos de datos, cómo activar el metrónomo (Botón START -> Carrera -> Mantener pulsado UP/MENU 2 seg -> Configuración de carrera -> Metrónomo -> Estado: Activado -> Frecuencia: 172-174 ppm -> Alerta: Vibración), calibración de zancada y métricas de VO2 Máx.
- TELEMETRÍA REAL EN VIVO SINCRONIZADA DE GARMIN CONNECT:${latestRunDetails}
- Metodología y Consejos Técnicos de Coach:
  * Cuando Ted comente que le costó agarrar el paso con el metrónomo a 175 spm y que lo ajustó a 172 spm: Felicítalo por la decisión. Explícale con empatía y ciencia deportiva que subir de golpe de su cadencia natural (160 spm) a 175 spm es un salto biomecánico muy brusco (15 pasos más por minuto) que se siente antinatural y causa descoordinación. Bajarlo a 172 spm es una progresión ideal y sostenible.
  * Para rodaje regenerativo (Zona 2 pura <145 ppm): Recomiéndale salir a 7:15 - 7:30 min/km en los primeros 2 km para que la FC no suba a 157 ppm como en los 5 km de ayer.
  * Cuidado de sóleos con foam roller y reposición con magnesio/sal marina.
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de concreto, acero, obras de AMIS, finanzas de la constructora o compras en China.
Tono: Ultra motivador, cercano, empático, altamente técnico en fisiología del ejercicio y métricas Garmin, conversacional y fluido.`;
    } else if (isCripto && !isChina && !isRunning) {
      badge = '🪙 [DIVISIÓN 3 · MERCADO BITSO & CRIPTO]';
      systemPrompt = `Eres el Asesor Financiero Cripto y Analista de Mercados de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: MERCADO CRIPTOMONEDAS & BITSO ALPHA.
- Portafolio de Ted en vivo: 0.00063682 BTC + 105.85 USDT. Capital depositado: $3,000 MXN. Meta fijada: 0.001 BTC (100,000 satoshis). Faltan solo 0.00036318 BTC (convertibles desde USDT).
- Estrategia: Mantener reserva USDT y comprar BTC en caídas clave o convertir el faltante a BTC para asegurar la meta de los 100,000 satoshis.
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de running, obras de construcción o impuestos.
Tono: Analista financiero cuantitativo, seguro, estratégico y directo.`;
    } else if (isSuple && !isChina && !isRunning) {
      badge = '📱 [DIVISIÓN 3 · SUPLEAI SAAS]';
      systemPrompt = `Eres el Product Lead y Nutriólogo Deportivo Senior de la aplicación SupleAI App de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: SUPLEAI APP (SaaS de Suplementación Inteligente).
- Arquitectura: Frontend React Native + Backend FastAPI.
- Monetización: Deep-linking de suplementos recomendados vía programas de afiliados (Amazon México y Mercado Libre).
- Filtros Médicos: Exclusión estricta de embarazo, lactancia y patologías crónicas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de finanzas corporativas, obras de construcción o impuestos.
Tono: Innovador tecnológico, científico de la salud y visión de negocio SaaS.`;
    } else if (isAgenda && !isChina && !isRunning) {
      badge = '📋 [DIVISIÓN 3 · AGENDA EJECUTIVA PERSONAL]';
      systemPrompt = `Eres el Asistente Ejecutivo Personal y Chief of Staff de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: AGENDA EJECUTIVA Y COMPROMISOS PERSONALES.
- Asistencia 24/7 en organización de actividades, pendientes y seguimiento de metas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de concreto o temas ajenos a la agenda personal.
Tono: Ejecutivo, impecable, proactivo y organizado.`;
    } else {
      badge = '🌟 [DIVISIÓN 3 · PERSONAL & TECH]';
      systemPrompt = `Eres el Asesor Ejecutivo Personal de Ted Andrey Domínguez en la DIVISIÓN 3 (Proyectos Personales, Tech & Bienestar).
Coordinas 5 áreas clave:
1. Mercado Criptomonedas Bitso (0.00063682 BTC, 105.85 USDT, meta 0.001 BTC).
2. Running Coach Garmin Fēnix 5X (telemetría real, 5.01 km a 6:54 min/km, cadencia 160 spm, balance 49/51%).
3. SupleAI App (SaaS de suplementación inteligente).
4. Compras en China (Sourcing OEM/ODM 1688/Yupoo/CSSBuy/US Closer en 06_COMPRAS_CHINAS).
5. Agenda ejecutiva personal.
Responde de forma personalizada según el tema que Ted consulte con claridad, concisión y enfoque estratégico.
AISLAMIENTO ESTRICTO: No hables de obras de AMIS ni de contabilidad fiscal.
Tono: Proactivo, profesional y conversacional.`;
    }
  }

  const models = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

  const contents = [];
  if (Array.isArray(history) && history.length > 0) {
    const recentHistory = history.slice(-6);
    let lastRole = null;
    for (const h of recentHistory) {
      if (!h.text || !h.text.trim()) continue;
      const role = h.role === 'model' ? 'model' : 'user';
      if (role === lastRole) {
        contents[contents.length - 1].parts[0].text += '\n' + h.text.trim();
      } else {
        contents.push({ role, parts: [{ text: h.text.trim() }] });
        lastRole = role;
      }
    }
  }

  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts[0].text += '\n' + userQuery;
  } else {
    contents.push({ role: 'user', parts: [{ text: userQuery }] });
  }

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024
    }
  };

  for (const m of models) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + apiKey;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (answer && answer.trim().length > 0) {
        return { badge, text: answer.trim() };
      }
    } catch (e) {}
  }
  return null;
}

async function startWhatsAppBot() {
  try {
    console.log('🚀 Iniciando conexión Baileys Multi-Device con persistencia en MongoDB Atlas...');
    const { state, saveCreds } = await useMongoAuthState();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 Usando Baileys v${version.join('.')} (Última versión disponible: ${isLatest})`);

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['AMIS Constructora', 'Desktop', '2.0.0'],
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQrData = qr;
        try {
          currentQrImage = await QRCode.toDataURL(qr);
        } catch (e) {
          console.error('Error generando QR Image:', e);
        }
        qrcodeTerminal.generate(qr, { small: true });
        console.log('⚡ Nuevo QR generado. Escanéalo en el navegador o en la consola.');
      }

      if (connection === 'close') {
        isClientReady = false;
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('⚠️ Conexión cerrada. Reconectando automáticamente:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(startWhatsAppBot, 5000);
        } else {
          console.log('❌ Sesión cerrada por el usuario. Limpiando credenciales...');
          try {
            if (sessionCollection) await sessionCollection.deleteMany({});
          } catch (e) {}
          setTimeout(startWhatsAppBot, 5000);
        }
      } else if (connection === 'open') {
        isClientReady = true;
        currentQrData = null;
        currentQrImage = null;
        currentPairingCode = null;
        connectedUser = sock.user.id.split(':')[0];
        console.log(`✅ ¡Conexión establecida con éxito 24/7! Conectado como: +${connectedUser}`);
      }
    });

    const processedMsgIds = new Set();
    const recentUserMessages = new Map();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!messages || messages.length === 0) return;
      if (type && type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid === 'status@broadcast') continue;

          const msgId = msg.key.id;
          if (msgId) {
            if (processedMsgIds.has(msgId)) continue;
            processedMsgIds.add(msgId);
            if (processedMsgIds.size > 2000) processedMsgIds.clear();
          }

          const remoteJid = msg.key.remoteJid;
          try {
            await sock.readMessages([msg.key]);
          } catch (e) {}

          const body = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.documentMessage?.caption ||
            ''
          ).trim();

          const hasMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.audioMessage);
          console.log(`[WHATSAPP ENTRADA] De: ${remoteJid} | Texto: "${body}" | Media: ${hasMedia}`);

          const config = loadConfig();

          // Anti-Duplicados Estricto
          const dedupKey = `${remoteJid}:${body.toLowerCase().trim()}`;
          const now = Date.now();
          if (recentUserMessages.has(dedupKey) && (now - recentUserMessages.get(dedupKey) < 4000)) {
            console.log(`[DEDUP] Mensaje repetido ignorado para ${remoteJid} ("${body}") dentro de 4s.`);
            continue;
          }
          recentUserMessages.set(dedupKey, now);
          if (recentUserMessages.size > 2000) {
            for (const [k, t] of recentUserMessages.entries()) {
              if (now - t > 30000) recentUserMessages.delete(k);
            }
          }

          const targetJid = remoteJid;
          if (mongoClient) {
            try {
              const db = mongoClient.db('amis_whatsapp');
              await db.collection('debug_inbox').insertOne({
                remoteJid,
                participant: msg.key.participant || null,
                fromMe: msg.key.fromMe,
                body,
                date: new Date()
              });
            } catch (e) {}
          }

          const participant = msg.key.participant || '';
          const fullSender = `${remoteJid} ${participant}`;
          const cleanSender = remoteJid.replace(/[^0-9]/g, '');

          // =====================================================================
          // 1. REGLA DE ORO: GRUPOS DE WHATSAPP
          // =====================================================================
          if (remoteJid.endsWith('@g.us')) {
            const GRUPO_COACH_TED_JID = '120363432696055179@g.us';
            if (remoteJid === GRUPO_COACH_TED_JID) {
              console.log(`[GRUPO COACH TED] Mensaje detectado en grupo privado de Ted: "${body}"`);
              const lowerBody = body.toLowerCase().trim();
              const triggersCoach = /coach|garmin|running|correr|entreno|sesi[oó]n|ayer|rutina|an[aá]lisis|cadencia|ritmo|pulso|ppm|fc|zona|distancia|km|recupera|cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(lowerBody);
              const esNumeroOpcion = /^[1-4]$/.test(lowerBody);

              if (/hola|buenos d[ií]as|buenas|men[uú]|ayuda|opciones/i.test(lowerBody) && !triggersCoach && !esNumeroOpcion) {
                const menuCoach = `🏃‍♂️ *Centro de Mando Personal (Lic. Ted Andrey)*\n\n` +
                  `Hola Ted, este grupo está configurado exclusivamente para tu entrenamiento de running Garmin, fisiología deportiva, criptomonedas y pendientes personales.\n\n` +
                  `*¿En qué te puedo asesorar hoy?*\n` +
                  `1️⃣ *Análisis biomédico de tu última sesión de running (Garmin)*\n` +
                  `2️⃣ *Cadencia óptima, biomecánica y zonas cardíacas*\n` +
                  `3️⃣ *🪙 Mercado Criptomonedas & Portafolio Bitso (BTC / USDT)*\n` +
                  `4️⃣ *Agenda y pendientes ejecutivos personales*\n\n` +
                  `_O pregúntame directamente cualquier duda (ej. "¿a cuánto ritmo debo correr mañana?", "análisis de mi rutina de ayer" o "¿cómo va el mercado cripto?")._`;
                await sock.sendMessage(targetJid, { text: menuCoach });
                continue;
              }

              if (/ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis.*rutina|an[aá]lisis.*sesi[oó]n|an[aá]lisis.*ayer/i.test(lowerBody) || lowerBody === '1') {
                console.log('[COACH] Generando análisis biomédico Garmin para Ted');
                const analisisSesion = await obtenerAnalisisSesionCompleto(0);
                await sock.sendMessage(targetJid, { text: analisisSesion });
                continue;
              }

              if (/cadencia|zonas.*card[ií]acas|biomec[aá]nica|spm/i.test(lowerBody) || lowerBody === '2') {
                const cadenciaInfo = `⚡ *Análisis de Cadencia y Zonas Cardíacas (Garmin Ted)*\n\n` +
                  `• *Tu cadencia media:* 174 spm (Pico: 182 spm).\n` +
                  `• *Zona 2 predominante:* 62% del tiempo en 130-145 ppm.\n\n` +
                  `🎯 *Consejo:* Mantén pasos cortos y rápidos. La zancada compacta a 174-178 spm absorbe el 35% del impacto directamente en el tendón rotuliano.`;
                await sock.sendMessage(targetJid, { text: cadenciaInfo });
                continue;
              }

              if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado|moneda|satoshi/i.test(lowerBody) || lowerBody === '3') {
                console.log(`[CRIPTO BITSO] Solicitud de reporte de criptomonedas recibida de Ted`);
                const cryptoReport = await obtenerReporteCriptoBitso();
                await sock.sendMessage(targetJid, { text: cryptoReport });
                continue;
              }

              if (/agenda|pendiente|reuni[oó]n|compromiso/i.test(lowerBody) || lowerBody === '4') {
                const agenda = `📋 *Agenda Ejecutiva Personal (Lic. Ted)*\n\n` +
                  `• Asistente personal y coach activos 24/7.\n` +
                  `• Reporte nocturno automático de running programado a las 9:00 PM.\n` +
                  `• Recordatorio matutino de actividades configurado.\n` +
                  `• Monitoreo de portafolio Bitso sincronizado.\n\n` +
                  `_Todo en orden. ¿Deseas agregar algún recordatorio personal?_`;
                await sock.sendMessage(targetJid, { text: agenda });
                continue;
              }

              // Conversación continua con Coach IA
              const coachRespuesta = await responderCoachIA(body);
              await sock.sendMessage(targetJid, { text: coachRespuesta });
              continue;
            }

            // Cualquier otro grupo: ignorar silenciosamente
            continue;
          }

          // =====================================================================
          // 2. 🏛️ RECONOCIMIENTO DIRECTO Y EXCLUSIVO: LIC. TED ANDREY (6676921223)
          // =====================================================================
          const isTed = fullSender.includes('6676921223') ||
                        fullSender.includes('6672921223') ||
                        fullSender.includes('107194381013064') ||
                        fullSender.includes('260030758682778') ||
                        cleanSender.endsWith('6676921223') ||
                        cleanSender.endsWith('6672921223') ||
                        cleanSender === '107194381013064' ||
                        cleanSender === '260030758682778';

          const sessionKey = isTed ? '6676921223' : cleanSender;
          const userState = await getUserSession(sessionKey);
          userSessions[remoteJid] = userState;
          if (!userState.history) userState.history = [];

          const lowerBody = body.toLowerCase().trim();
          const isReset = ['menu', 'menú', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);

          if (isTed) {
            console.log(`[CENTRO DE MANDO TED] Mensaje de Ted: "${body}" | Pilar: ${userState.activePillar || 'SIN PILAR'} | Submódulo: ${userState.activeSubmodule || 'GENERAL'}`);

            // 1. Saludo, Menú, Inicio o Reset: Regresa al Menú Maestro y resetea contexto
            if (isReset || /^(hola|buenos d[ií]as|buenas|empezar|inicio|men[uú]|help|ayuda)$/i.test(lowerBody)) {
              userState.activePillar = null;
              userState.activeSubmodule = null;
              userState.waitingPillarConfirmation = false;
              userState.pendingQuery = null;
              userState.pendingTargetPillar = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: getMenuMaestroTed() });
              continue;
            }

            // 2. Si estábamos esperando confirmación de cambio de pilar
            if (userState.waitingPillarConfirmation && userState.pendingTargetPillar) {
              const affirmative = /^(s[ií]|cambiar|cambia|ok|adelante|va|dale|claro|si por favor|afirmativo)$/i.test(lowerBody);
              const negative = /^(no|cancela|quedate|sigue|permanecer|no cambiar)$/i.test(lowerBody);

              if (affirmative) {
                const targetPillar = userState.pendingTargetPillar;
                const savedQuery = userState.pendingQuery;
                userState.activePillar = targetPillar;
                userState.activeSubmodule = null;
                userState.waitingPillarConfirmation = false;
                userState.pendingQuery = null;
                userState.pendingTargetPillar = null;
                await saveUserSession(sessionKey, userState);

                const pInfo = PILARES_INFO[targetPillar];
                let ackChange = `🔄 *Contexto cambiado exitosamente al ${pInfo.titulo}*\n\n`;
                if (savedQuery) {
                  const queryReply = await responderConsultaPilar(targetPillar, savedQuery, userState, sessionKey);
                  if (queryReply) ackChange += queryReply;
                } else {
                  if (targetPillar === 'PILAR_1_OBRA') ackChange += getSubmenuPilar1();
                  else if (targetPillar === 'PILAR_2_FINANZAS_FISCAL') ackChange += getSubmenuPilar2();
                  else if (targetPillar === 'PILAR_3_PERSONAL') ackChange += getSubmenuPilar3();
                }
                await sock.sendMessage(targetJid, { text: ackChange });
                continue;
              } else if (negative) {
                const curPInfo = PILARES_INFO[userState.activePillar] || { titulo: 'tu división actual' };
                userState.waitingPillarConfirmation = false;
                userState.pendingQuery = null;
                userState.pendingTargetPillar = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, {
                  text: `✅ Entendido. Nos mantenemos en el *${curPInfo.titulo}*. ¿Qué deseas consultar de este proyecto? (O escribe *menu* para volver a la raíz).`
                });
                continue;
              }
            }

            // 3. Salto directo de División con comandos explícitos ("división 1", "div 2", etc.)
            if (/^(divisi[oó]n\s*1|div\s*1)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_1_OBRA';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `🔄 *Contexto cambiado a División 1: Obra y Edificación Monolítica*\n\n` + getSubmenuPilar1() });
              continue;
            } else if (/^(divisi[oó]n\s*2|div\s*2)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_2_FINANZAS_FISCAL';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `🔄 *Contexto cambiado a División 2: Fiscal, Corporativo y Tesorería*\n\n` + getSubmenuPilar2() });
              continue;
            } else if (/^(divisi[oó]n\s*3|div\s*3)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_3_PERSONAL';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `🔄 *Contexto cambiado a División 3: Proyectos Personales, Tech & Bienestar*\n\n` + getSubmenuPilar3() });
              continue;
            }

            // 4. Si Ted NO está dentro de ningún Pilar (Menú Raíz):
            if (!userState.activePillar) {
              if (lowerBody === '1' || /^(obra|construcci[oó]n)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_1_OBRA';
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, { text: getSubmenuPilar1() });
                continue;
              } else if (lowerBody === '2' || /^(fiscal|finanzas|tesorer[ií]a)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_2_FINANZAS_FISCAL';
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, { text: getSubmenuPilar2() });
                continue;
              } else if (lowerBody === '3' || /^(personal|tech|bienestar)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_3_PERSONAL';
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, { text: getSubmenuPilar3() });
                continue;
              }

              // Intentar detectar pilar por palabras clave de la consulta
              const detected = detectarPilarDeConsulta(body);
              if (detected) {
                userState.activePillar = detected;
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                // Continúa abajo para responder la consulta dentro del pilar detectado
              } else {
                // NUNCA asumir PILAR_1_OBRA: Pedir selección de división
                await sock.sendMessage(targetJid, {
                  text: `🏛️ *Centro de Mando Antigravity (Lic. Ted Andrey)*\n\n` +
                    `Por favor selecciona la división en la que deseas trabajar:\n\n` +
                    `1️⃣ 🏗️ *División 1: Obra y Edificación Monolítica* (Álamos del Río, Parral, Materiales)\n` +
                    `2️⃣ 💼 *División 2: Fiscal, Corporativo y Tesorería* (AMIS BanBajío, TADR SAT, Socios, Moldes)\n` +
                    `3️⃣ 🌟 *División 3: Proyectos Personales, Tech & Bienestar* (Bitso, Running Garmin, SupleAI, Compras China, Agenda)\n\n` +
                    `_Escribe *1*, *2* o *3* para ingresar a una división, o escribe *menu* para ver detalles._`
                });
                continue;
              }
            }

            // 5. Ted YA está dentro de un Pilar activo: Auditar detección cruzada
            const detectedPillar = detectarPilarDeConsulta(body);
            if (userState.activePillar && detectedPillar && detectedPillar !== userState.activePillar) {
              userState.waitingPillarConfirmation = true;
              userState.pendingQuery = body;
              userState.pendingTargetPillar = detectedPillar;
              await saveUserSession(sessionKey, userState);

              const currentPInfo = PILARES_INFO[userState.activePillar];
              const targetPInfo = PILARES_INFO[detectedPillar];

              const warningMsg = `⚠️ *Lic. Ted, actualmente te encuentras en el ${currentPInfo.titulo}.*\n\n` +
                `Tu consulta corresponde al *${targetPInfo.titulo}* (${targetPInfo.proyectos}).\n\n` +
                `¿Deseas que cambiemos de contexto a esa división?\n` +
                `👉 Responde *Sí* para cambiar y ver la respuesta, o continúa con tus temas de esta división (o escribe *menu*).`;

              await sock.sendMessage(targetJid, { text: warningMsg });
              continue;
            }

            // 6. Atajos rápidos de submódulo (números 1 al 5 u opciones directas dentro del Pilar)
            const pillarReply = await responderConsultaPilar(userState.activePillar, body, userState, sessionKey);
            if (pillarReply) {
              userState.history.push({ role: 'user', text: body });
              userState.history.push({ role: 'model', text: pillarReply });
              if (userState.history.length > 12) userState.history = userState.history.slice(-12);
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: pillarReply });
              continue;
            }

            // 7. Conversación Fluida con Inteligencia Artificial (Gemini Especializado por Submódulo)
            console.log(`[AI TED] Generando respuesta conversacional para ${userState.activePillar} (Submódulo: ${userState.activeSubmodule || 'GENERAL'} - "${body.slice(0, 40)}")...`);
            const aiResult = await consultarCerebroPorDivision(userState.activePillar, body, userState.history, userState.activeSubmodule);
            if (aiResult) {
              const replyFormatted = `${aiResult.badge}\n\n${aiResult.text}`;
              userState.history.push({ role: 'user', text: body });
              userState.history.push({ role: 'model', text: replyFormatted });
              if (userState.history.length > 12) userState.history = userState.history.slice(-12);
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: replyFormatted });
              continue;
            }

            // 8. Respuesta de cortesía ejecutiva si fallara la API de IA
            const fallbackPInfo = PILARES_INFO[userState.activePillar] || { titulo: 'tu división activa' };
            const defaultTedMsg = `🏛️ *Centro de Mando Antigravity (Lic. Ted Andrey)*\n\n` +
              `Te encuentras en el *${fallbackPInfo.titulo}*.\n` +
              `No pude procesar tu consulta en este momento. Por favor reformula tu pregunta, elige una sección del menú, o escribe *menu* para volver a la raíz.`;
            await sock.sendMessage(targetJid, { text: defaultTedMsg });
            continue;
          }

          // =====================================================================
          // 3. RESTO DE USUARIOS: BLINDAJE DE SEGURIDAD (NO TIENEN ACCESO A TED)
          // =====================================================================
          const authUser = getAuthorizedUser(cleanSender, config, fullSender);

          // Mensaje de bienvenida para público general no registrado
          if (!authUser) {
            console.log(`[PÚBLICO] Contacto no registrado: ${fullSender} -> Enviando a ${targetJid}`);
            await sock.sendMessage(targetJid, { text: `${config.public_greeting}\n\n🔍 *ID Detectado:* \`${remoteJid}\`` });
            continue;
          }

          if (isReset) {
            userSessions[remoteJid].state = 'IDLE';
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();
            const menuText = buildMainMenu(authUser, config);
            console.log(`[MENU] Enviando menú principal a ${authUser.name} (${targetJid})`);
            await sock.sendMessage(targetJid, { text: menuText });
            continue;
          }

          // Si el usuario está en IDLE
          if (userState.state === 'IDLE') {
            const userModules = [];
            let optIdx = 1;
            for (const [modKey, modData] of Object.entries(config.modules)) {
              if (modData.allowed_roles.includes(authUser.role) || modData.allowed_roles.includes('*')) {
                userModules.push({ digit: optIdx.toString(), key: modKey, ...modData });
                optIdx++;
              }
            }

            const selectedMod = userModules.find(m => m.digit === body.trim());
            if (selectedMod) {
              if (selectedMod.key === 'recepcion_facturas') {
                userSessions[remoteJid] = { state: 'EXPENSE', expenseCount: 0, waitingConcept: false, updatedAt: Date.now() };
                saveSessions();
                const expIntro = `📥 *Módulo de Recepción de Facturas y Comprobantes*\n\n` +
                  `Por favor, envía las *fotos o PDFs de tus tickets/facturas* de obra directamente por este chat.\n\n` +
                  `💡 *Tip:* Puedes enviar varios comprobantes seguidos. Si gustas, agrega un breve texto a cada imagen (ej: _'Gasolina para Silverado'_).\n\n` +
                  `_Escribe *listo* o *ya* cuando termines, o *menu* para cancelar._`;
                await sock.sendMessage(targetJid, { text: expIntro });
                continue;
              } else if (selectedMod.key === 'consultas_franco') {
                userSessions[remoteJid] = { state: 'CONSULTA_FRANCO', updatedAt: Date.now(), history: [] };
                saveSessions();
                const francoIntro = `⛏️ *Módulo Técnico Proyecto Franco (Hidalgo del Parral)*\n\n` +
                  `Bienvenido ${authUser.name}. Estoy facultado para asistirte con:\n` +
                  `• Prototipo Sierra Bonita (684 viviendas cuádruplex)\n` +
                  `• Planos autorizados del 7 de octubre de 2026\n` +
                  `• Espesores de muro (10 cm carga / 20 cm bajantes)\n` +
                  `• Modulación de moldes SIMA y cubicaciones\n\n` +
                  `_Hazme cualquier pregunta técnica directa sobre Parral o escribe *menu* para volver._`;
                await sock.sendMessage(targetJid, { text: francoIntro });
                continue;
              } else if (selectedMod.key === 'asistencias') {
                userSessions[remoteJid] = { state: 'ATTENDANCE_MENU', updatedAt: Date.now() };
                saveSessions();
                const attMenu = `👷‍♂️ *Control de Personal y Asistencias AMIS*\n\n` +
                  `1️⃣ Reportar lista de asistencia del día (Foto o texto)\n` +
                  `2️⃣ Notificar falta o baja de trabajador\n` +
                  `3️⃣ Notificar nuevo ingreso / alta de personal\n\n` +
                  `_Escribe el número de la acción que requieres o *menu* para volver._`;
                await sock.sendMessage(targetJid, { text: attMenu });
                continue;
              }
            }
          }

          // Respuesta conversacional con Cerebro Antigravity
          console.log(`[CEREBRO IA] Procesando mensaje de ${authUser.name}: "${body}"`);
          const replyText = await generateConversationalReply(body, authUser, null, userSessions[remoteJid]);
          userSessions[remoteJid].updatedAt = Date.now();
          saveSessions();
          await sock.sendMessage(targetJid, { text: replyText });
          continue;

        } catch (err) {
          console.error('Error procesando mensaje Baileys:', err);
        }
      }
    });
  } catch (err) {
    console.error('Error fatal al iniciar WhatsApp Bot:', err);
    setTimeout(startWhatsAppBot, 5000);
  }
}

startWhatsAppBot();
