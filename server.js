// Manejo global de excepciones para evitar que el contenedor muera
process.on('uncaughtException', (err) => {
  console.error('ðŸš¨ [EXCEPCIÃ“N CAPTURADA]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('ðŸš¨ [RECHAZO CAPTURADO]:', reason);
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
      console.log('ðŸ“¡ Conectando a MongoDB Atlas para persistencia de sesiÃ³n 24/7...');
      mongoClient = new MongoClient(MONGO_URI);
      await mongoClient.connect();
      const db = mongoClient.db('amis_whatsapp');
      sessionCollection = db.collection('auth_session');
      userSessionsCollection = db.collection('user_sessions');
      lastMongoError = null;
      console.log('âœ… MongoDB Atlas conectado exitosamente.');
    }

    const writeData = async (data, id) => {
      try {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await sessionCollection.replaceOne({ _id: id }, { _id: id, data: serialized }, { upsert: true });
        console.log(`ðŸ’¾ [MONGO PERSISTENCIA] Clave guardada: ${id}`);
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
        console.log(`ðŸ—‘ï¸ [MONGO PERSISTENCIA] Clave eliminada: ${id}`);
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
    console.error('âš ï¸ Error crÃ­tico en useMongoAuthState:', err.message);
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
      console.error('Error recuperando sesiÃ³n de MongoDB Atlas:', e.message);
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
      console.error('Error persistiendo sesiÃ³n en MongoDB Atlas:', e.message);
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
      menu += `${optionIndex}ï¸âƒ£ *${modData.title}*\n_${modData.description}_\n\n`;
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
          return res.end(JSON.stringify({ error: 'WhatsApp no estÃ¡ listo aÃºn' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // PÃ¡gina visual en navegador (QR, Pairing Code y Estado en vivo)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AMIS Constructora Â· Torre de Control 24/7</title>
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
        <p>Cerebro Central Antigravity Â· Baileys 24/7</p>

        ${isClientReady ? `
          <div class="badge badge-online">â— SERVICIO ACTIVO Y EN LÃNEA</div>
          <p>Conectado exitosamente como: <strong style="color: #38bdf8;">+${connectedUser || 'SesiÃ³n Activa'}</strong></p>
          <p style="font-size: 12px; color: #64748b;">La sesiÃ³n estÃ¡ resguardada en MongoDB Atlas para evitar desconexiones.</p>
        ` : (currentPairingCode ? `
          <div class="badge badge-qr">âš¡ VINCULACIÃ“N POR CÃ“DIGO</div>
          <p>Ingresa este cÃ³digo en WhatsApp (Dispositivos vinculados -> Vincular con nÃºmero de telÃ©fono):</p>
          <div class="pairing-code">${currentPairingCode}</div>
        ` : (currentQrImage ? `
          <div class="badge badge-qr">ðŸ“· ESCANEAR CÃ“DIGO QR</div>
          <div class="qr-box">
            <img src="${currentQrImage}" alt="CÃ³digo QR WhatsApp" />
          </div>
          <p>Abre WhatsApp en tu telÃ©fono -> Dispositivos vinculados -> Vincular un dispositivo.</p>
        ` : `
          <div class="badge badge-qr">â³ INICIANDO SERVICIO...</div>
          <p>Conectando a MongoDB Atlas y levantando el asistente...</p>
        `))}
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ðŸŒ Servidor HTTP activo en el puerto ${PORT}`);
});

// =========================================================================
// ðŸƒâ€â™‚ï¸ MÃ“DULO RUNNING & INTELIGENCIA DEPORTIVA GARMIN TED ANDREY
// =========================================================================
const ULTIMAS_SESIONES_RUNNING = [
  {
    fecha: 'Jueves 22 de Octubre, 2026 (19:34)',
    tipo: 'CuliacÃ¡n Carrera (5K Continuo)',
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
    sensacion: 'SesiÃ³n sÃ³lida de 5 km en CuliacÃ¡n. Intensidad en Zona 3 Tempo (157 ppm) con simetrÃ­a casi perfecta en balance de contacto (49% Izq / 51% Der).'
  },
  {
    fecha: 'Martes 20 de Octubre, 2026 (20:43)',
    tipo: 'CuliacÃ¡n Carrera (Rodaje Suave)',
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
    sensacion: 'Rodaje regenerativo suave en Zona 2 aerÃ³bica.'
  },
  {
    fecha: 'SÃ¡bado 17 de Octubre, 2026 (06:31)',
    tipo: 'Tirada Larga AerÃ³bica (Fondo 14K)',
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
    sensacion: 'Fondo matutino de 14 km en CuliacÃ¡n con buena reserva glucogÃ©nica.'
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

        let fechaLabel = r.fecha;
        try {
          const runDate = new Date(r.fecha.replace(' ', 'T'));
          const today = new Date();
          const diasSemana = ['Domingo', 'Lunes', 'Martes', 'MiÃ©rcoles', 'Jueves', 'Viernes', 'SÃ¡bado'];
          const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
          const diaNombre = diasSemana[runDate.getDay()];
          const mesNombre = meses[runDate.getMonth()];
          const horaStr = r.fecha.includes(' ') ? r.fecha.split(' ')[1].slice(0, 5) : '';

          if (runDate.toDateString() === today.toDateString()) {
            fechaLabel = `Hoy ${diaNombre} ${runDate.getDate()} de ${mesNombre}, ${runDate.getFullYear()} (${horaStr} AM)`;
          } else {
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            if (runDate.toDateString() === yesterday.toDateString()) {
              fechaLabel = `Ayer ${diaNombre} ${runDate.getDate()} de ${mesNombre}, ${runDate.getFullYear()} (${horaStr})`;
            } else {
              fechaLabel = `${diaNombre} ${runDate.getDate()} de ${mesNombre}, ${runDate.getFullYear()} (${horaStr})`;
            }
          }
        } catch(e) {}

        const balLeft = r.balanceContactoPiso ? parseFloat(r.balanceContactoPiso) : 49.9;
        const balRight = (100 - balLeft).toFixed(1);
        const osc = r.oscilacionVerticalCm ? (r.oscilacionVerticalCm < 2 ? (r.oscilacionVerticalCm * 10).toFixed(1) : parseFloat(r.oscilacionVerticalCm).toFixed(1)) : '8.2';
        const te = r.trainingEffectAerobico ? parseFloat(r.trainingEffectAerobico.toFixed(1)) : 4.2;

        let recup = '24 horas';
        if (te >= 4.0 || r.distanciaKm >= 8) recup = '36 a 48 horas';
        else if (te >= 3.0) recup = '24 a 36 horas';

        s = {
          fecha: fechaLabel,
          tipo: r.nombre || 'CuliacÃ¡n Carrera',
          distanciaKm: r.distanciaKm,
          duracion: r.duracion,
          ritmoMedio: r.ritmoMedio,
          ritmoMejorKm: r.ritmoMax || 'N/A',
          fcMedia: r.fcMedia || 160,
          fcMax: r.fcMax || 170,
          cadenciaMedia: r.cadenciaMedia || 150,
          cadenciaMax: r.cadenciaMax || 177,
          calorias: r.calorias || 708,
          balance: `${balLeft}% Izq / ${balRight}% Der`,
          oscilacion: `${osc} cm`,
          trainingEffect: te,
          tiempoRecuperacionSugerido: recup,
          desnivel: r.desnivelPositivoM || 28
        };
      }
    } catch (e) {}
  }
  if (!s) {
    s = ULTIMAS_SESIONES_RUNNING[sesionIndex] || ULTIMAS_SESIONES_RUNNING[0];
  }

  return `ðŸƒâ€â™‚ï¸ *ANÃLISIS BIOMECÃNICO & FISIOLÃ“GICO GARMIN*\n` +
    `ðŸ‘¤ *Atleta:* Lic. Ted Andrey DomÃ­nguez | âŒš *Dispositivo:* Garmin FÄ“nix 5X\n` +
    `ðŸ“… *SesiÃ³n:* ${s.fecha}\n` +
    `ðŸŽ¯ *Objetivo:* ${s.tipo}\n\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
    `ðŸ“Š *1. MÃ‰TRICAS CLAVE DE RENDIMIENTO*\n` +
    `â€¢ *Distancia:* ${s.distanciaKm.toFixed(2)} km\n` +
    `â€¢ *Tiempo Total:* ${s.duracion}\n` +
    `â€¢ *Ritmo Promedio:* ${s.ritmoMedio}\n` +
    `â€¢ *Ritmo MÃ¡ximo:* ${s.ritmoMejorKm}\n` +
    `â€¢ *Gasto CalÃ³rico:* ${s.calorias} kcal\n` +
    `â€¢ *Desnivel Positivo:* +${s.desnivel || 28} m\n\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
    `â¤ï¸ *2. FISIOLOGÃA CARDIOVASCULAR*\n` +
    `â€¢ *FC Media:* ${s.fcMedia} ppm\n` +
    `â€¢ *FC MÃ¡xima:* ${s.fcMax} ppm\n` +
    `â€¢ *Training Effect AerÃ³bico:* ${s.trainingEffect} / 5.0 (${s.trainingEffect >= 4.0 ? 'Impacto altamente constructivo / Sobrecarga Ã³ptima' : 'Mantenimiento aerÃ³bico'})\n\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
    `âš¡ *3. BIOMECÃNICA Y DINÃMICAS (GARMIN FÄ’NIX 5X)*\n` +
    `â€¢ *Cadencia Media:* ${s.cadenciaMedia} spm (Pico: ${s.cadenciaMax} spm)\n` +
    `â€¢ *Balance de Contacto (GCT):* ${s.balance} (SimetrÃ­a casi perfecta al 50/50)\n` +
    `â€¢ *OscilaciÃ³n Vertical:* ${s.oscilacion}\n\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
    `ðŸ§  *4. DIAGNÃ“STICO DEL COACH & CONSEJOS TÃCTICOS*\n` +
    `1. *Carga y AsimilaciÃ³n:* Rodaste ${s.distanciaKm.toFixed(2)} km a ${s.ritmoMedio} con FC Media de ${s.fcMedia} ppm (Zona 3 Tempo / Umbral). Tu Training Effect fue de ${s.trainingEffect}, lo que significa una ganancia cardiovascular tremenda.\n` +
    `2. *SimetrÃ­a Impecable:* Tu balance de ${s.balance} demuestra que estÃ¡s pisando con total equilibrio sin sobrecargar ninguna articulaciÃ³n.\n` +
    `3. *Cadencia y Zancada:* Promediaste ${s.cadenciaMedia} spm con picos de ${s.cadenciaMax} spm. En tus prÃ³ximas salidas regenerativas, busca mantener pasos mÃ¡s cortitos a 165-170 spm para reducir la oscilaciÃ³n vertical.\n` +
    `4. *RecuperaciÃ³n Obligatoria:* Por la alta exigencia de este fondo (${s.distanciaKm.toFixed(2)} km), tu ventana de recuperaciÃ³n sugerida es de *${s.tiempoRecuperacionSugerido}* con abundante hidrataciÃ³n, electrolitos/magnesio y descanso muscular.\n\n` +
    `_PregÃºntame cualquier duda de esta salida o de tu siguiente entreno._`;
}

// =========================================================================
// ðŸ‡¨ðŸ‡³ MÃ“DULO DE SOURCING: COMPRAS EN CHINA & RASTREO LOGÃSTICO (06_COMPRAS_CHINAS)
// =========================================================================
async function obtenerReporteComprasChina() {
  let list = [];
  if (mongoClient) {
    try {
      const db = mongoClient.db('amis_whatsapp');
      list = await db.collection('china_orders').find().sort({ id: 1 }).toArray();
    } catch (e) {}
  }

  if (!list || list.length === 0) {
    list = [
      {
        id: 1,
        producto: "Tenis Alexander McQueen (EUR 43) + Golden Goose (EUR 38)",
        plataforma: "CSSBuy (Weidian OVO)",
        guia: "JMX101847892320",
        paquete: "P261025342887",
        paqueteria: "BY-MX-EXP âž” J&T Express MÃ©xico",
        costo: "$1,945.98 MXN + $1,145.47 MXN flete",
        estatus: "En vuelo transcontinental hacia MÃ©xico (CN, è´§ç‰©ç¦»å¼€æ“ä½œä¸­å¿ƒ)",
        entregaEstimada: "02 al 06 de Noviembre 2026"
      },
      {
        id: 2,
        producto: "Bolso Chanel Classic Flap 25cm + Reloj Rolex Submariner 41mm",
        plataforma: "CSSBuy (Expert Buy)",
        guia: "Retiro ID: 20261030112725681 (Orden: 20261029004249667)",
        paqueteria: "Reembolso directo a Mercado Pago (CLABE 722969023034419209)",
        costo: "$1,119.74 USD (~$22,001.54 MXN)",
        estatus: "En curso (Reembolso en proceso tras cancelaciÃ³n por filtro legal de marca en CSSBuy). Fondos retornando a cuenta.",
        entregaEstimada: "Fondos en trÃ¡nsito a cuenta bancaria"
      },
      {
        id: 3,
        producto: "Pantalones de Golf (Set 6 piezas, Talla 32x32)",
        plataforma: "Chicly Shop (Order 1526)",
        guia: "NUDE5001903166EX",
        paqueteria: "Carrier FXYL âž” Socio de Ãºltima milla MÃ©xico",
        costo: "$42.98 USD",
        estatus: "En MÃ©xico (Aduana superada y liberada el 19-Oct). En clasificaciÃ³n nacional hacia CuliacÃ¡n.",
        entregaEstimada: "31 de Octubre al 05 de Noviembre 2026"
      },
      {
        id: 4,
        producto: "Chanclas SunnyStepp Negras (Talla MX 28-29)",
        plataforma: "TikTok Shop (Orden: 586829950287250510)",
        guia: "JMX501070912602",
        paqueteria: "J&T Express MÃ©xico (EstÃ¡ndar)",
        costo: "$148.99 MXN",
        estatus: "En camino / Paquete enviado",
        entregaEstimada: "31 de Octubre al 03 de Noviembre 2026"
      },
      {
        id: 5,
        producto: "Sandalias Chanclas QIAGINESHI Grises (Talla 42-43)",
        plataforma: "TikTok Shop (Orden: 586829950287381582)",
        guia: "IM08030028394479",
        paqueteria: "iMile Delivery MÃ©xico (EstÃ¡ndar)",
        costo: "$147.00 MXN",
        estatus: "En camino / Paquete enviado",
        entregaEstimada: "31 de Octubre al 03 de Noviembre 2026"
      }
    ];
  }

  let msg = `ðŸ‡¨ðŸ‡³ *TABLERO MAESTRO DE COMPRAS & RASTREO (5 ENVÃOS)*\n` +
            `ðŸ‘¤ *Destinatario:* Lic. Ted Andrey DomÃ­nguez | ðŸ“ *Destino:* CuliacÃ¡n, Sin.\n` +
            `ðŸ“… *Corte:* ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo', day: '2-digit', month: 'short', year: 'numeric' })}\n` +
            `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n`;

  list.forEach((p, idx) => {
    msg += `ðŸ“¦ *${idx + 1}. ${p.producto}*\n` +
           `â€¢ *Plataforma:* ${p.plataforma}\n` +
           `â€¢ *GuÃ­a / Ref:* \`${p.guia}\`\n` +
           `â€¢ *Ruta / Carrier:* ${p.paqueteria}\n` +
           `â€¢ *Estatus:* ${p.estatus}\n` +
           `â€¢ *Entrega Estimada:* *${p.entregaEstimada}*\n\n`;
  });

  msg += `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
         `ðŸšš *PrÃ³ximos Arribos a tu Domicilio (CuliacÃ¡n):*\n` +
         `â€¢ *31 Oct - 03 Nov:* Chanclas TikTok (SunnyStepp e iMile)\n` +
         `â€¢ *31 Oct - 05 Nov:* Pantalones Golf Chicly (Aduana liberada)\n` +
         `â€¢ *02 - 06 Nov:* Tenis McQueen + Golden Goose (Vuelo a MÃ©xico)\n` +
         `â€¢ *Reembolso en curso:* $1,119.74 USD de Chanel/Rolex retornando a tu Mercado Pago.\n\n` +
         `_Tengo todo tu expediente al dÃ­a. Â¿Deseas consultar el detalle o rastreo puntual de alguno?_`;

  return msg;
}

// =========================================================================
// ðŸª™ MÃ“DULO DE CRIPTOMONEDAS: MERCADO BITSO EN VIVO & PORTAFOLIO TED
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
      ? `+$${diffMXN.toFixed(2)} MXN (+${diffPct}%) ðŸŸ¢` 
      : `-$${Math.abs(diffMXN).toFixed(2)} MXN (${diffPct}%) ðŸ”´`;

    const metaBtc = 0.001;
    const btcFaltante = metaBtc - btcHoldings;
    const metaPct = ((btcHoldings / metaBtc) * 100).toFixed(1);
    const usdtParaMeta = (btcFaltante * btcPrice / usdtPrice).toFixed(2);

    return `ðŸª™ *REPORTE EN VIVO: MERCADO CRIPTOMONEDAS & BITSO*\n` +
      `ðŸ‘¤ *Titular:* Lic. Ted Andrey DomÃ­nguez | ðŸ“Š *Plataforma:* Bitso Alpha\n` +
      `ðŸ“… *Fecha y Hora:* ${new Date().toLocaleDateString('es-MX', { timeZone: 'America/Hermosillo', hour: '2-digit', minute: '2-digit' })}\n\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸ’¼ *1. TU PORTAFOLIO EN VIVO*\n` +
      `â€¢ *Total Estimado:* $${totalValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN\n` +
      `â€¢ *Capital Depositado:* $3,000.00 MXN\n` +
      `â€¢ *Rendimiento Neto:* ${sign}\n` +
      `â€¢ *Bitcoin Acumulado:* 0.00063682 BTC ($${btcValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN)\n` +
      `â€¢ *Reserva DÃ³lares USDT:* 105.85 USDT ($${usdtValMXN.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN)\n\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸ“ˆ *2. ESTADO DEL MERCADO (BITSO EN VIVO)*\n` +
      `â€¢ *Bitcoin (BTC):* $${btcPrice.toLocaleString('es-MX')} MXN (${btcChangePct > 0 ? '+' : ''}${btcChangePct}% en 24h)\n` +
      `â€¢ *DÃ³lar Tether (USDT):* $${usdtPrice.toFixed(3)} MXN\n` +
      `â€¢ *Ethereum (ETH):* $${ethPrice.toLocaleString('es-MX')} MXN\n\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸŽ¯ *3. META 0.001 BTC (100,000 SATOSHIS)*\n` +
      `â€¢ *Progreso:* ${metaPct}% completado.\n` +
      `â€¢ *Faltante para la Meta:* 0.00036318 BTC (~$${(btcFaltante * btcPrice).toFixed(2)} MXN o ${usdtParaMeta} USDT).\n` +
      `â€¢ *Reserva Disponible:* Tienes 105.85 USDT blindados en caja listos para compras estratÃ©gicas.\n\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸ’¡ *4. DIAGNÃ“STICO Y PLAN TÃCTICO*\n` +
      `â€¢ *Escudo Activo:* Al haber mantenido los 105.85 USDT en reserva, tu capital no sufriÃ³ con la correcciÃ³n de Bitcoin.\n` +
      `â€¢ *Ventana de Compra con Descuento:* Bitcoin estÃ¡ testeando el soporte de $1,520,000 - $1,525,000 MXN. Para conquistar tu meta de 0.001 BTC solo requieres convertir *${usdtParaMeta} USDT* a Bitcoin.\n\n` +
      `_Â¿Deseas ejecutar la conversiÃ³n de USDT a BTC para amarrar la meta o consultar otra criptomoneda?_`;
  } catch (err) {
    return `âš ï¸ *Bitso Live:* No se pudo conectar momentÃ¡neamente con los servidores de Bitso. Por favor intenta de nuevo en unos segundos.`;
  }
}

// =========================================================================
// ðŸƒâ€â™‚ï¸ MOTOR DE INTELIGENCIA DEPORTIVA: COACH IA DE RUNNING & FISIOLOGÃA
// =========================================================================
async function responderCoachIA(query) {
  const q = (query || '').toLowerCase().trim();

  let latest = {
    fecha: 'Domingo 25 de Octubre (07:30)',
    distanciaKm: 8.64,
    duracion: '1h 1m 31s',
    ritmoMedio: '7:07 min/km',
    fcMedia: 160,
    cadenciaMedia: 150,
    balance: '49.9% Izq / 50.1% Der',
    trainingEffect: 4.2
  };

  if (mongoClient) {
    try {
      const db = mongoClient.db('amis_whatsapp');
      const r = await db.collection('garmin_activities').findOne({}, { sort: { fecha: -1 } });
      if (r) {
        const balL = r.balanceContactoPiso ? parseFloat(r.balanceContactoPiso) : 49.9;
        latest = {
          fecha: r.fecha,
          distanciaKm: r.distanciaKm,
          duracion: r.duracion,
          ritmoMedio: r.ritmoMedio,
          fcMedia: r.fcMedia || 160,
          cadenciaMedia: r.cadenciaMedia || 150,
          balance: `${balL}% Izq / ${(100 - balL).toFixed(1)}% Der`,
          trainingEffect: r.trainingEffectAerobico ? parseFloat(r.trainingEffectAerobico.toFixed(1)) : 4.2
        };
      }
    } catch (e) {}
  }

  if (/cu[aÃ¡]nto debo|a qu[eÃ©] ritmo|a qu[eÃ©] velocidad|mi ritmo|ritmo ideal|siguiente carrera|siguiente salida|entreno de ma[nÃ±]ana|ritmo/i.test(q)) {
    return `ðŸƒâ€â™‚ï¸ *RecomendaciÃ³n de Ritmo y Entrenamiento (Coach Ted):*\n\n` +
      `Basado en tu Ãºltima sesiÃ³n real de *${latest.distanciaKm} km a ${latest.ritmoMedio}* con FC media de *${latest.fcMedia} ppm*:\n\n` +
      `â€¢ *Para tu rodaje regenerativo post-fondo:* Sal suave entre *7:25 y 7:45 min/km*. Tras los ${latest.distanciaKm} km con FC de ${latest.fcMedia} ppm, tu cuerpo requiere regeneraciÃ³n pura en *Zona 2 (<145 ppm)* para reciclar lactato sin fatiga neuromuscular.\n` +
      `â€¢ *Para tu dÃ­a de calidad (Tempo):* Bloques a *5:50 a 6:05 min/km*.\n` +
      `â€¢ *Para series:* Paso objetivo de *5:00 a 5:15 min/km* con recuperaciÃ³n al trote suave.\n\n` +
      `ðŸ’¡ *Regla de oro:* Tu salida tuvo Training Effect de ${latest.trainingEffect || '4.2'}. Dale al cuerpo al menos 36 horas de asimilaciÃ³n antes de volver a meter intensidad.`;
  }

  if (/metr[oÃ³]nomo|metometro|como.*pongo.*reloj/i.test(q)) {
    return `âŒš *CÃ³mo Activar el MetrÃ³nomo en tu Garmin FÄ“nix 5X:*\n\n` +
      `Para elevar tu cadencia de ${latest.cadenciaMedia} spm al rango Ã³ptimo de 170-174 spm:\n\n` +
      `1ï¸âƒ£ Presiona el botÃ³n *START* (arriba derecha) y entra al perfil *Carrera* (Run).\n` +
      `2ï¸âƒ£ MantÃ©n presionado el botÃ³n *UP / MENU* (botÃ³n central izquierdo) por 2 segundos.\n` +
      `3ï¸âƒ£ Entra a *ConfiguraciÃ³n de carrera* (Run Settings).\n` +
      `4ï¸âƒ£ Baja con el botÃ³n *DOWN* y selecciona *MetrÃ³nomo* (Metronome).\n` +
      `5ï¸âƒ£ En *Estado*, ponlo en *Activado* (On).\n` +
      `6ï¸âƒ£ En *Frecuencia*, ajÃºstalo a *170 ppm* o *172 ppm* (para subir gradualmente desde tus ${latest.cadenciaMedia} spm actuales).\n` +
      `7ï¸âƒ£ En *Alerta / Sonido*, selecciona *VibraciÃ³n* (ritmo tÃ¡ctil sin pitidos molestos).\n\n` +
      `ðŸŽ¯ *Tip tÃ¡ctico:* Acorta la zancada y mueve los codos mÃ¡s rÃ¡pido; las piernas seguirÃ¡n la cadencia de tus brazos.`;
  }

  if (/cadencia|zancada|pisada|talon|impacto|rodillas|180|spm/i.test(q)) {
    return `âš¡ *AnÃ¡lisis de Cadencia y BiomecÃ¡nica (Garmin FÄ“nix 5X):*\n\n` +
      `â€¢ *Tu cadencia en tu Ãºltima carrera:* Promediaste *${latest.cadenciaMedia} spm*.\n` +
      `â€¢ *Balance de pisada:* ${latest.balance} (Â¡Excelente simetrÃ­a entre pierna izquierda y derecha!).\n` +
      `â€¢ *Objetivo:* Subir gradualmente a *165-172 spm*. Al aumentar la frecuencia con pasos mÃ¡s compactos, reduces el tiempo de impacto en el asfalto y proteges rodillas y sÃ³leos.\n` +
      `â€¢ *Consejo:* Usa el metrÃ³nomo en 170-172 ppm durante los primeros 10 minutos de tu prÃ³ximo trote.`;
  }

  if (/zona|pulsaciones|frecuencia|cardiac|coraz[oÃ³]n|ppm|pecho/i.test(q)) {
    return `â¤ï¸ *Control de Zonas CardÃ­acas (Garmin Ted):*\n\n` +
      `En tu sesiÃ³n de ${latest.distanciaKm} km promediaste *${latest.fcMedia} ppm* (Zona 3 Tempo / Umbral):\n` +
      `â€¢ *Zona 1 (<130 ppm):* RecuperaciÃ³n activa.\n` +
      `â€¢ *Zona 2 (130 - 145 ppm):* *Tu base aerÃ³bica fundamental.* Quema de grasas y capilarizaciÃ³n.\n` +
      `â€¢ *Zona 3 (146 - 156 ppm):* Zona Tempo aerÃ³bica.\n` +
      `â€¢ *Zona 4 (157 - 168 ppm):* Umbral anaerÃ³bico (promediaste ${latest.fcMedia} ppm).\n` +
      `â€¢ *Zona 5 (>168 ppm):* VO2 mÃ¡x (tocaste picos cercanos a 170 ppm).\n\n` +
      `ðŸ“Œ *Ajuste:* Tu siguiente salida debe ser 100% en Zona 2 (<145 ppm) a paso de 7:30 min/km para recuperar fibras.`;
  }

  if (/dolor|molestia|s[oÃ³]leo|gemelo|pantorrilla|recupera|suplement|creatina|electrolit|agua|descanso/i.test(q)) {
    return `ðŸ’Š *Protocolo de RecuperaciÃ³n Muscular (Coach Ted):*\n\n` +
      `â€¢ *SÃ³leos y Gemelos:* Aplica 10 minutos de Foam Roller suave y estiramiento con rodilla flexionada para aislar el sÃ³leo.\n` +
      `â€¢ *HidrataciÃ³n TÃ¡ctica:* 500 ml de agua con 300 mg de citrato de magnesio y una pizca de sal marina para reponer electrolitos tras ${latest.distanciaKm} km de esfuerzo.\n` +
      `â€¢ *SueÃ±o reparador:* Recuerda que la sÃ­ntesis de colÃ¡geno y recuperaciÃ³n articular ocurre en fases de sueÃ±o profundo. Apunta a 7.5 - 8 horas hoy.`;
  }

  return `ðŸƒâ€â™‚ï¸ *RUNNING COACH & FISIOLOGÃA GARMIN*\n\n` +
    `TelemetrÃ­a real sincronizada de tu Garmin FÄ“nix 5X:\n` +
    `â€¢ Registraste *${latest.distanciaKm} km en ${latest.duracion} a ${latest.ritmoMedio}* con cadencia de *${latest.cadenciaMedia} spm* y FC media de *${latest.fcMedia} ppm*.\n` +
    `â€¢ Tu balance de pisada fue de *${latest.balance}*.\n\n` +
    `ðŸ’¡ *Â¿QuÃ© deseas consultar de tu entrenamiento?*\n` +
    `â€¢ Escribe *carrera* o *hoy* para ver el reporte biomÃ©dico completo de tu Ãºltima salida de ${latest.distanciaKm} km.\n` +
    `â€¢ Escribe *ritmo* para saber a quÃ© velocidad salir en tu prÃ³xima sesiÃ³n.\n` +
    `â€¢ Escribe *cadencia* para revisar tu zancada y metrÃ³nomo.\n` +
    `â€¢ Escribe *zonas* para ver tus rangos cardÃ­acos en detalle.\n` +
    `â€¢ Escribe *recuperaciÃ³n* para cuidado de sÃ³leos y electrolitos.\n\n` +
    `_O pregÃºntame directamente cualquier duda de running, o escribe *menu* para volver._`;
}

// =========================================================================
// ðŸ›ï¸ CENTRO DE MANDO MAESTRO TED ANDREY (EXCLUSIVO 6676921223)
// =========================================================================
const PILARES_INFO = {
  PILAR_1_OBRA: {
    id: '1',
    codigo: 'PILAR_1_OBRA',
    titulo: 'DivisiÃ³n 1: Obra y EdificaciÃ³n MonolÃ­tica',
    proyectos: 'Infonavit Ãlamos del RÃ­o / Proyecto Franco Parral / Suministros'
  },
  PILAR_2_FINANZAS_FISCAL: {
    id: '2',
    codigo: 'PILAR_2_FINANZAS_FISCAL',
    titulo: 'DivisiÃ³n 2: Fiscal, Corporativo y TesorerÃ­a',
    proyectos: 'AMIS Fiscal / TADR Fiscal / Proy. Ejecutivo $360k / Familiar SAT / Moldes SIMA'
  },
  PILAR_3_PERSONAL: {
    id: '3',
    codigo: 'PILAR_3_PERSONAL',
    titulo: 'DivisiÃ³n 3: Proyectos Personales, Tech & Bienestar',
    proyectos: 'Mercado Cripto Bitso / Garmin Running Coach / SupleAI App / Compras China / Agenda'
  }
};

function getMenuMaestroTed() {
  return `ðŸ›ï¸ *CENTRO DE MANDO ESTRATÃ‰GICO ANTIGRAVITY*\n` +
    `ðŸ‘¤ *Lic. Ted Andrey DomÃ­nguez Romero*\n\n` +
    `Selecciona la divisiÃ³n o frente que deseas consultar:\n\n` +
    `1ï¸âƒ£ ðŸ—ï¸ *DivisiÃ³n 1: Obra y EdificaciÃ³n MonolÃ­tica*\n` +
    `   â€¢ Proyecto Ãlamos del RÃ­o / Lope\n` +
    `   â€¢ Proyecto Franco / Parral\n\n` +
    `2ï¸âƒ£ ðŸ’¼ *DivisiÃ³n 2: Fiscal, Corporativo y TesorerÃ­a*\n` +
    `   â€¢ AMIS Constructora Fiscal\n` +
    `   â€¢ TADR Fiscal\n` +
    `   â€¢ Submayor Proyecto Ejecutivo\n` +
    `   â€¢ MÃ³dulo Familiar Contable\n` +
    `   â€¢ Sistema de Moldes SIMA\n\n` +
    `3ï¸âƒ£ ðŸŒŸ *DivisiÃ³n 3: Proyectos Personales, Tech & Bienestar*\n` +
    `   â€¢ Mercado Criptomonedas & Bitso\n` +
    `   â€¢ Running Coach & Garmin\n` +
    `   â€¢ SupleAI App\n` +
    `   â€¢ Compras e Importaciones de China\n` +
    `   â€¢ Agenda y Asistente Ejecutivo Personal\n\n` +
    `_Escribe *1*, *2* o *3* para ingresar a una divisiÃ³n, o escribe directamente lo que buscas._`;
}

function getSubmenuPilar1() {
  return `ðŸ—ï¸ *DIVISIÃ“N 1: OBRA Y EDIFICACIÃ“N MONOLÃTICA*\n` +
    `Has ingresado al contexto de construcciÃ³n e ingenierÃ­a.\n\n` +
    `1ï¸âƒ£ *Proyecto Ãlamos del RÃ­o / Lope:* 320 viviendas (20 torres), moldes SIMA, anticipo $9.23 MDP en BanBajÃ­o.\n` +
    `2ï¸âƒ£ *Proyecto Franco / Parral:* 684 viviendas Sierra Bonita, muros 10 y 20 cm, visto bueno 7 de oct 2026.\n` +
    `3ï¸âƒ£ *Requisiciones y Precios de Materiales:* Varilla, cemento, agregados, diÃ©sel.\n\n` +
    `_Escribe tu consulta sobre obra, o escribe *menu* para volver al menÃº maestro._`;
}

function getSubmenuPilar2() {
  return `ðŸ’¼ *DIVISIÃ“N 2: FISCAL, CORPORATIVO Y TESORERÃA*\n` +
    `Has ingresado al contexto contable, fiscal y bancario.\n\n` +
    `1ï¸âƒ£ *AMIS TesorerÃ­a & Bancos:* Saldos BanBajÃ­o (~$9.05 MDP) y cuenta maestra.\n` +
    `2ï¸âƒ£ *NÃ³mina Semanal & DispersiÃ³n 3 VÃ­as:* BanBajÃ­o Fiscal (Nominax), Darnelix 8% ($62.5k socios), Roblock 7% (sobrenÃ³minas, destajos y sobre de raya en efectivo), tabulador oficial.\n` +
    `3ï¸âƒ£ *TADR Fiscal:* Honorarios, emisiÃ³n de CFDI y provisiÃ³n SAT.\n` +
    `4ï¸âƒ£ *Submayor Proyecto Ejecutivo:* Estado del fondo $360k (50% Ing. Samuel / 50% Ted).\n` +
    `5ï¸âƒ£ *MÃ³dulo Familiar:* Ing. Samuel (anual exenta) y Sra. Isabel (estrategia disminuciÃ³n SAT).\n` +
    `6ï¸âƒ£ *Sistema de Moldes SIMA:* Costos y activos de moldes.\n\n` +
    `_Escribe tu consulta financiera o fiscal, o escribe *menu* para volver al menÃº maestro._`;
}

function getSubmenuPilar3() {
  return `ðŸŒŸ *DIVISIÃ“N 3: PROYECTOS PERSONALES, TECH & BIENESTAR*\n` +
    `Has ingresado al contexto personal y tecnolÃ³gico.\n\n` +
    `1ï¸âƒ£ *ðŸª™ Mercado Criptomonedas & Bitso:* Portafolio en vivo (0.00063682 BTC, 105.85 USDT, meta 0.001 BTC).\n` +
    `2ï¸âƒ£ *ðŸƒâ€â™‚ï¸ Running Coach & Garmin:* Sesiones Garmin, cadencia, ritmos y zonas cardÃ­acas.\n` +
    `3ï¸âƒ£ *ðŸ“± SupleAI App:* Estado del SaaS de suplementaciÃ³n inteligente y afiliados.\n` +
    `4ï¸âƒ£ *ðŸ‡¨ðŸ‡³ Compras en China:* Sourcing directo, catÃ¡logos Yupoo, 1688 y casilleros.\n` +
    `5ï¸âƒ£ *ðŸ“‹ Agenda Ejecutiva:* Pendientes personales y compromisos.\n\n` +
    `_Escribe tu consulta personal o deportiva, o escribe *menu* para volver al menÃº maestro._`;
}

function detectarPilarDeConsulta(text, currentPillar = null) {
  const t = (text || '').toLowerCase().trim();

  // DetecciÃ³n NÃ³mina y Personal AMIS (Tanto Obra como Finanzas manejan personal):
  const matchNomina = /n[oÃ³]minas?|sueldos?|tabulador|raya\b|asistencias?|destajos?|nominax|asimilables?|darnelix|roblock|jessica\s*patricia|jessica\s*rivera|otoniel|mois[eÃ©]s\s*abinadab|osuna\s*s[aÃ¡]nchez/i.test(t);

  // Si Ted ya estÃ¡ en Pilar 1 (Obra) o Pilar 2 (Finanzas/Fiscal), y consulta sobre nÃ³mina/sueldos/personal:
  // NUNCA considerarlo conflicto ni cambiar de pilar forzadamente. Ambos frentes atienden personal y obra.
  if (matchNomina) {
    if (currentPillar === 'PILAR_1_OBRA') return 'PILAR_1_OBRA';
    return 'PILAR_2_FINANZAS_FISCAL';
  }

  // DetecciÃ³n Pilar 3: Personal / Tech
  const matchPersonal = /cripto|bitcoin|btc|bitso|usdt|eth|satoshi|running|garmin|correr|entreno|sesi[oÃ³]n.*ayer|cadencia|ritmo|ppm|pulsaciones|supleai|suplement|creatina|china|compras?|pedido|pedidos|paquete|paquetes|gu[iÃ­]a|rastreo|casillero|yupoo|1688|taobao|cssbuy|sugargoo|us closer|aduanas?|agenda.*personal|compromiso.*personal/i.test(t);

  // DetecciÃ³n Pilar 2: Fiscal / Finanzas
  const matchFiscal = /banbaj[iÃ­]o|cuenta.*maestra|saldo.*amis|factura.*tadr|honorarios?.*ted|retenci[oÃ³]n|dort780211|aco241114|submayor|proyecto ejecutivo|360k|isabel romero|samuel dom[iÃ­]nguez.*sat|declaraci[oÃ³]n.*anual|impuestos?|provisi[oÃ³]n sat|diot/i.test(t);

  // DetecciÃ³n Pilar 1: Obra
  const matchObra = /alamos|[aÃ¡]lamos|lope|franco|parral|sierra bonita|muro|moldes?|vivienda|torre|concreto|varilla|cemento|di[eÃ©]sel|arena|grava|colado|residente/i.test(t);

  if (matchPersonal && !matchObra && !matchFiscal) return 'PILAR_3_PERSONAL';
  if (matchFiscal && !matchObra && !matchPersonal) return 'PILAR_2_FINANZAS_FISCAL';
  if (matchObra && !matchFiscal && !matchPersonal) return 'PILAR_1_OBRA';
  return null;
}

async function responderConsultaPilar(pilar, query, userState = null, sessionKey = null) {
  const q = (query || '').toLowerCase().trim();

  // Helper para persistir submÃ³dulo de inmediato
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

  // Respuestas Pilar 1: Obra y EdificaciÃ³n MonolÃ­tica
  if (pilar === 'PILAR_1_OBRA') {
    if (q === '1' || /^(alamos|[aÃ¡]lamos|lope|infonavit)$/i.test(q)) {
      await setSubmodule('ALAMOS');
      return `ðŸ¢ *Proyecto Infonavit Ãlamos del RÃ­o (AMIS SIMA)*\n\n` +
        `â€¢ *Alcance:* 320 viviendas (20 torres de 4 niveles en obra gris monolÃ­tica).\n` +
        `â€¢ *Monto Contrato:* $54,337,280.00 MXN ($169,804.00/viv exento de IVA).\n` +
        `â€¢ *Cobranza:* Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en CFDI VIV-2 en BanBajÃ­o.\n` +
        `â€¢ *Saldo por Cobrar:* $45,099,942.40 MXN en estimaciones de obra.\n` +
        `â€¢ *CondiciÃ³n Suspensiva:* Plazos congelados hasta cumplimiento total del DÃ­a 'D' (dictamen de uso de suelo + planos autorizados).\n` +
        `â€¢ *RotaciÃ³n:* Estricta rotaciÃ³n de 24 horas por nivel con moldes SIMA.\n` +
        `â€¢ *Suministros:* Acero y concreto mayores a cargo de M2 Coseinver ($60.76 MDP). Pre-armados activos en patio.\n\n` +
        `_Â¿Deseas consultar sobre habilitado de acero, condiciÃ³n DÃ­a D, relaciÃ³n con M2 o estimaciones?_`;
    }
    if (q === '2' || /^(franco|parral|sierra bonita)$/i.test(q)) {
      await setSubmodule('PARRAL');
      return `â›ï¸ *Proyecto Franco / Parral (SIMA - Chihuahua)*\n\n` +
        `â€¢ *Alcance:* 684 viviendas en edificios cuÃ¡druplex (prototipo Sierra Bonita: 2 PB / 2 PA, lote 14.04x15).\n` +
        `â€¢ *Estatus de Planos:* Visto bueno definitivo del martes 7 de octubre de 2026 (13 lÃ¡minas ejecutivas autorizadas).\n` +
        `â€¢ *Espesores de Muro:* Cero muros de 12 cm. Muros de *10 cm* (carga y colindancias) y *20 cm* (instalaciones 3" y 4", y fachada de acceso).\n` +
        `â€¢ *Honorarios Estructurales:* $240,000 + IVA (bonificables si contratan antes del 15 de diciembre de 2026).\n` +
        `â€¢ *Exclusividad SIMA:* Franco edifica hasta 100 tradicionales; mÃ­nimo 584 exclusivas para AMIS.\n\n` +
        `_Â¿Deseas consultar planos autorizados, cubicaciones, volumetrÃ­as o modulaciÃ³n de moldes SIMA?_`;
    }
    if (q === '3' || /^(material|materiales|precios|catalogo)$/i.test(q)) {
      await setSubmodule('MATERIALES');
      return `ðŸ—ï¸ *CatÃ¡logo de Precios de Materiales (Compras Reales AMIS):*\n\n` +
        `â€¢ *Cemento Gris Tolteca 50kg:* $245.00 MXN / Saco\n` +
        `â€¢ *Varilla 3/8" (No. 3):* $178.50 MXN / Tramo 12m\n` +
        `â€¢ *Varilla 1/2" (No. 4):* $312.00 MXN / Tramo 12m\n` +
        `â€¢ *Alambre Recocido Cal. 16:* $38.50 MXN / Kg\n` +
        `â€¢ *Arena Triturada:* $480.00 MXN / M3 | *Grava 3/4":* $520.00 MXN / M3\n` +
        `â€¢ *DiÃ©sel Automotriz:* $25.80 MXN / Litro\n\n` +
        `_Precios de mercado reales auditados contra facturas de compras recientes. Â¿Deseas cotizar algÃºn insumo adicional?_`;
    }
    if (/^(n[oÃ³]minas?|sueldos?|tabulador|cuadrillas?|trabajadores?|personal|asistencias?)$/i.test(q)) {
      await setSubmodule('CUADRILLAS_OBRA');
      return `ðŸ‘·â€â™‚ï¸ *Personal de Obra & Tabulador Semanal (Ãlamos del RÃ­o / SIMA)*\n\n` +
        `â€¢ *SupervisiÃ³n en Campo:* Ing. Emilio PeÃ±uelas (Pre-Armados) y Bladimir BeltrÃ¡n (Mantenimiento y Obra).\n` +
        `â€¢ *Tabulador Maestro Oficial (Sueldos Semanales Base):*\n` +
        `  - Herrero + Equipo/Herramienta propia: $10,800.00 / sem ($1,800.00 diarios base)\n` +
        `  - Residente de Obra: $7,500.00 / sem ($1,250.00 diarios base)\n` +
        `  - Moldero: $7,000.00 / sem ($1,166.67 diarios base)\n` +
        `  - Fierrero / Mantenimiento / Plomero / Electricista: $5,000.00 / sem ($833.33 diarios base)\n` +
        `  - Supervisor PreArmados / AlbaÃ±il / Seguridad: $4,000.00 / sem ($666.67 diarios base)\n` +
        `  - Ayudante General / Herrero: $3,500.00 / sem ($583.33 diarios base)\n` +
        `  - Velador (SIMA): $2,400.00 / sem | Velador (Obra): $2,000.00 / sem\n\n` +
        `â€¢ *Frente de Trabajo:* Patio de maniobras Ãlamos habilitando acero para las 20 torres de 4 niveles.\n` +
        `â€¢ *DispersiÃ³n Bancaria:* Administrada por AMIS TesorerÃ­a (VÃ­a 1 BanBajÃ­o, VÃ­a 2 Darnelix, VÃ­a 3 Roblock).\n\n` +
        `_Â¿Deseas consultar rendimientos de cuadrilla, supervisiÃ³n de campo o dispersiÃ³n fiscal de nÃ³mina?_`;
    }
    return null;
  }

  // Respuestas Pilar 2: Fiscal, Corporativo y TesorerÃ­a
  if (pilar === 'PILAR_2_FINANZAS_FISCAL') {
    if (q === '1' || /^(saldo|banbaj[iÃ­]o|banco|tesorer[iÃ­]a|cuenta\s*maestra|amis)$/i.test(q)) {
      await setSubmodule('AMIS_FISCAL');
      return `ðŸ’¼ *TesorerÃ­a AMIS Constructora (ACO241114A70):*\n\n` +
        `â€¢ *Cuenta BanBajÃ­o Maestra:* 476863400201\n` +
        `â€¢ *Saldo AuditorÃ­a:* ~$9,050,000.00 MXN (Anticipo Ãlamos blindado).\n` +
        `â€¢ *Flujo y Cuentas Bancarias:* ConciliaciÃ³n de anticipo, pagos a proveedores mayores autorizados y provisiÃ³n para obra.\n` +
        `â€¢ *DispersiÃ³n Semanal:* Centralizada los viernes a travÃ©s de las 3 VÃ­as oficiales.\n\n` +
        `_Â¿Deseas consultar saldos bancarios, estados de cuenta de obra o dispersiÃ³n de socios?_`;
    }
    if (q === '2' || /^(n[oÃ³]mina|n[oÃ³]minas|raya|sueldo|sueldos|tabulador|dispersi[oÃ³]n|destajo|destajos|asistencias?|nominax|trabajadores)$/i.test(q)) {
      await setSubmodule('NOMINA_AMIS');
      return `ðŸ‘·â€â™‚ï¸ *NÃ“MINA SEMANAL & SISTEMA MAESTRO DE DISPERSIÃ“N AMIS*\n\n` +
        `â€¢ *Esquema Oficial de DispersiÃ³n Semanal (3 VÃ­as - Viernes):*\n` +
        `  1ï¸âƒ£ *VÃ­a 1 (Fiscal Directa AMIS BanBajÃ­o 476863400201):*\n` +
        `     ÃšNICAMENTE nÃ³mina neta timbrada de personal con alta IMSS (RP Z3350123108, cÃ¡lculo Nominax y recibo CFDI 4.0).\n` +
        `  2ï¸âƒ£ *VÃ­a 2 (Socios Asimilables vÃ­a DARNELIX 8%):*\n` +
        `     $62,500.00 MXN netos ($12,500 c/u para los 5 socios). DepÃ³sito: $67,129.63 MXN a cuenta PEIBO 732010100000087663. Formato oficial SOLICITUD_MOVIMIENTO_DARNELIX.\n` +
        `  3ï¸âƒ£ *VÃ­a 3 (SobrenÃ³minas, Destajos y Efectivo vÃ­a CONSTRUCTORA ROBLOCK 7%):*\n` +
        `     Factura deducible de materiales. Dispersa SPEI a personal + destajos sin CFDI (Jessica Rivera) + fondos USD + efectivo sobre de raya + caja chica de obra ($10,000.00 MXN).\n\n` +
        `â€¢ *Tabulador Maestro Oficial de Puestos y Sueldos:*\n` +
        `  - Herrero + Equipo/Herramienta propia: $10,800.00 / sem ($1,800.00 diarios base)\n` +
        `  - Residente de Obra: $7,500.00 / sem ($1,250.00 diarios base)\n` +
        `  - Moldero: $7,000.00 / sem ($1,166.67 diarios base)\n` +
        `  - Encargado Mantenimiento / Fierrero / Plomero / Electricista / Herrero: $5,000.00 / sem ($833.33 diarios base)\n` +
        `  - Supervisor PreArmados / AlbaÃ±il / Seguridad: $4,000.00 / sem ($666.67 diarios base)\n` +
        `  - Ayudante General / Herrero: $3,500.00 / sem ($583.33 diarios base)\n` +
        `  - Velador (Terreno SIMA): $2,400.00 / sem ($400.00 diarios base)\n` +
        `  - Velador (Obra): $2,000.00 / sem ($333.33 diarios base)\n\n` +
        `â€¢ *Regla de Oro de Titularidad:* Cero depÃ³sitos a cuentas de terceros. Quien no tenga cuenta propia verificada en padrÃ³n cobra 100% en sobre de raya en efectivo fÃ­sico en campo.\n\n` +
        `_Â¿Deseas consultar la dispersiÃ³n de algÃºn trabajador en especÃ­fico, destajos de obra o el cÃ¡lculo de la semana?_`;
    }
    if (q === '3' || /^(tadr|honorarios?|consultor[iÃ­]a|sat ted)$/i.test(q)) {
      await setSubmodule('TADR_FISCAL');
      return `âš–ï¸ *Contabilidad Personal TADR (Lic. Ted - RFC: DORT780211CQ5):*\n\n` +
        `â€¢ *RÃ©gimen:* Actividad Empresarial y Servicios Profesionales / ConsultorÃ­a.\n` +
        `â€¢ *Directiva Espejo AMIS:* En facturas para reparto de socios se retiene 10% ISR y 10.67% IVA, apartando bolsa SAT (5.33% IVA residual + ISR).\n` +
        `â€¢ *AsesorÃ­as Propias:* 100% ingreso exclusivo de Ted Andrey.\n` +
        `â€¢ *Libro Maestro:* Control_Fiscal_y_Facturacion_2026_TADR.xlsx.\n\n` +
        `_Â¿Deseas consultar retenciones acumuladas, provisiÃ³n de impuestos o deducciones personales?_`;
    }
    if (q === '4' || /^(submayor|proyecto ejecutivo|360k)$/i.test(q)) {
      await setSubmodule('PROY_EJECUTIVO');
      return `ðŸ“‘ *Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN):*\n\n` +
        `â€¢ *Titularidad:* 50% Ing. Samuel DomÃ­nguez / 50% Lic. Ted Andrey DomÃ­nguez.\n` +
        `â€¢ *Anticipo Cobrado:* $100,000.00 MXN (CFDI VIV-1).\n` +
        `â€¢ *Saldo por Cobrar:* $260,000.00 MXN.\n` +
        `â€¢ *Aislamiento:* Cuenta corriente 100% independiente de los repartos ordinarios de socios.\n\n` +
        `_Â¿Deseas revisar el estado de cuenta del proyecto ejecutivo o programar cobranza?_`;
    }
    if (q === '5' || /^(familiar|modulo familiar|isabel|samuel)$/i.test(q)) {
      await setSubmodule('FAMILIAR');
      return `ðŸ‘¨â€ðŸ‘©â€ðŸ‘§ *MÃ³dulo Fiscal Familiar (AntiGravity Fiscal Familiar):*\n\n` +
        `1. *Ing. Samuel DomÃ­nguez (DORS510222UA2):* RÃ©gimen 606 (Dividendos) + 605 (Asimilados). Solo presenta Anual en Abril. Estatus: 100% blindado.\n` +
        `2. *Sra. Isabel Romero (ROGI561130NM0):* Alerta SAT activa por rÃ©gimen 612. AcciÃ³n prioritaria: Tramitar DisminuciÃ³n de Obligaciones ante SAT para dejarla solo en Sueldos/Asimilados sin provisionales mensuales.\n\n` +
        `_Â¿Deseas consultar la estrategia de blindaje o el expediente contable de tus papÃ¡s?_`;
    }
    if (q === '6' || /^(sima|moldes?)$/i.test(q)) {
      await setSubmodule('SIMA_MOLDES');
      return `âš™ï¸ *Sistema de Moldes SIMA (Activos & OperaciÃ³n):*\n\n` +
        `â€¢ *Juegos de Moldes:* Equipos monolÃ­ticos de aluminio de alta resistencia para muros y losas.\n` +
        `â€¢ *RotaciÃ³n Oficial:* 24 horas continuas de fraguado y descimbrado por nivel.\n` +
        `â€¢ *Mantenimiento:* SupervisiÃ³n a cargo de Bladimir BeltrÃ¡n y reposiciÃ³n de herrajes/esquineros autorizados.\n\n` +
        `_Â¿Deseas consultar inventario de moldes, refacciones o ciclo de rotaciÃ³n?_`;
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
    if (/^(hoy|ayer|carrera|carreras|mi carrera|Ãºltima carrera|carrera de hoy|carrera ayer|carrera de ayer|sesi[oÃ³]n.*|rutina.*|an[aÃ¡]lisis.*|reporte.*|c[oÃ³]mo corr[iÃ­]|hoy corr[iÃ­].*|consulta.*carrera.*)$/i.test(q) ||
        /(carrera|corr[iÃ­]|entreno|sesi[oÃ³]n|rutina).*(hoy|ayer|ma[nÃ±]ana|Ãºltim|reciente)/i.test(q) ||
        /(consulta|an[aÃ¡]lisis|reporte|resumen|c[oÃ³]mo me fue|c[oÃ³]mo corr[iÃ­]).*(carrera|entreno|sesi[oÃ³]n|hoy|ayer)/i.test(q)) {
      await setSubmodule('RUNNING');
      return await obtenerAnalisisSesionCompleto(0);
    }
    if (q === '3' || /^(supleai|app)$/i.test(q)) {
      await setSubmodule('SUPLEAI');
      return `ðŸ“± *SupleAI App (SaaS de SuplementaciÃ³n Inteligente):*\n\n` +
        `â€¢ *Arquitectura:* Frontend React Native multiplataforma + Backend FastAPI.\n` +
        `â€¢ *MonetizaciÃ³n:* Deep-linking de suplementos recomendados vÃ­a programas de afiliados (Amazon MÃ©xico y Mercado Libre).\n` +
        `â€¢ *Blindaje MÃ©dico:* Regla de exclusiÃ³n estricta para embarazo, lactancia y patologÃ­as crÃ³nicas.\n` +
        `â€¢ *Estatus:* Base de datos de ingredientes activos y compatibilidad fisiolÃ³gica configurada.\n\n` +
        `_Â¿Deseas consultar sobre ingredientes, monetizaciÃ³n de afiliados o desarrollo de la app?_`;
    }
    if (q === '4' || 
        /^(china|importaciones|yupoo|1688|sourcing|pedidos?|paquetes?|compras?|rastreo|gu[iÃ­]as?|estatus|dame el estatus|qu[eÃ©] tengo pendiente.*|qu[eÃ©] productos.*)$/i.test(q) ||
        (userState?.activeSubmodule === 'CHINA' && /(estatus|pedidos?|paquetes?|compras?|rastreo|gu[iÃ­]as?|d[oÃ³]nde vienen|cu[aÃ¡]ndo llegan|qu[eÃ©] tengo|pendientes?)/i.test(q))) {
      await setSubmodule('CHINA');
      return await obtenerReporteComprasChina();
    }
    if (q === '5' || /^(agenda|pendientes)$/i.test(q)) {
      await setSubmodule('AGENDA');
      return `ðŸ“‹ *Agenda Ejecutiva Personal (Lic. Ted):*\n\n` +
        `â€¢ Asistente personal y coach activos 24/7.\n` +
        `â€¢ Monitoreo de portafolio Bitso sincronizado con precios en vivo.\n` +
        `â€¢ Reporte nocturno de running y recordatorios matutinos configurados.\n\n` +
        `_Todo en orden. Â¿Deseas agendar alguna actividad o recordatorio especÃ­fico?_`;
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
    const isAlamos = submodule === 'ALAMOS' || /alamos|[aÃ¡]lamos|lope|infonavit|320|coseinver/i.test(userQuery);
    const isParral = submodule === 'PARRAL' || /franco|parral|sierra bonita|cu[aÃ¡]druplex|684/i.test(userQuery);
    const isMateriales = submodule === 'MATERIALES' || /material|materiales|precios?|cemento|varilla|di[eÃ©]sel|arena|grava/i.test(userQuery);

    if (isParral && !isAlamos) {
      badge = 'â›ï¸ [DIVISIÃ“N 1 Â· PROYECTO PARRAL]';
      systemPrompt = `Eres el Director TÃ©cnico de Obra MonolÃ­tica SIMA de Ted Andrey DomÃ­nguez en AMIS Constructora.
Ãmbito EXCLUSIVO de conversaciÃ³n: PROYECTO FRANCO / PARRAL (Hidalgo del Parral, Chihuahua).
- ParÃ¡metros Oficiales Reales y Validados:
  1. Programa Total: 684 viviendas en edificios cuÃ¡druplex de 4 departamentos (2 en Planta Baja y 2 en Planta Alta, lotes de 14.04x15 m, 4 estacionamientos frontales en baterÃ­a). Prototipo Sierra Bonita.
  2. Estatus Oficial de Planos: Visto bueno definitivo del martes 7 de octubre de 2026 a las 8:45 pm con 13 lÃ¡minas ejecutivas de arquitectura e ingenierÃ­as autorizadas.
  3. Espesores de Muro: CERO muros de 12 cm. ÃšNICAMENTE muros de 10 cm (carga interiores y colindancias) y muros de 20 cm (instalaciones sanitarias/bajantes de 3" y 4", y fachada principal en accesos).
  4. Condiciones EconÃ³micas (Rev. 8): Honorarios de diseÃ±o estructural $240,000.00 MXN + IVA (bonificables si contratan obra antes del 15 de diciembre de 2026); tarifa de no realizaciÃ³n $120,000.00 MXN + IVA; gestorÃ­a RUV/INFONAVIT hasta $360,000.00 MXN + IVA.
  5. Exclusividad SIMA: Hasta 100 viviendas tradicionales para Franco; las restantes mÃ­nimo 584 viviendas exclusivas para AMIS con moldes SIMA. Suministros generales a cargo de Franco en tiempo y forma.
AISLAMIENTO ESTRICTO: Cero mezcla con Ãlamos del RÃ­o ni con finanzas personales o compras en China.
Tono: Muy natural, conversacional, profesional de ingenierÃ­a, claro, conciso y directo al grano.`;
    } else if (isMateriales && !isAlamos && !isParral) {
      badge = 'ðŸ“¦ [DIVISIÃ“N 1 Â· PRECIOS Y MATERIALES]';
      systemPrompt = `Eres el Encargado de Compras e Insumos de Obra de AMIS Constructora para Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: CATÃLOGO DE PRECIOS Y REQUISICIONES DE MATERIALES.
- CatÃ¡logo de compras reales auditado contra facturas recientes (02_COTIZACIONES_Y_MERCADEO/CATALOGO_PRECIOS_Y_MERCADEO.xlsx):
  * Cemento Gris Tolteca 50kg: $245.00 MXN / saco.
  * Varilla 3/8" (No. 3): $178.50 MXN / tramo de 12m.
  * Varilla 1/2" (No. 4): $312.00 MXN / tramo de 12m.
  * Alambre Recocido Cal. 16: $38.50 MXN / kg.
  * Arena Triturada: $480.00 MXN / m3 | Grava 3/4": $520.00 MXN / m3.
  * DiÃ©sel automotriz para maquinaria: $25.80 MXN / litro.
- OperaciÃ³n de Requisiciones: Canalizadas en campo a travÃ©s del Ing. Emilio PeÃ±uelas (Pre-Armados) y Bladimir BeltrÃ¡n (Mantenimiento).
Tono: TÃ©cnico, matemÃ¡tico, Ã¡gil y enfocado en costos y rendimientos.`;
    } else {
      badge = 'ðŸ—ï¸ [DIVISIÃ“N 1 Â· ÃLAMOS DEL RÃO]';
      systemPrompt = `Eres el Director TÃ©cnico e Ingeniero de Obra MonolÃ­tica SIMA de Ted Andrey DomÃ­nguez en AMIS Constructora.
Ãmbito EXCLUSIVO de conversaciÃ³n: INFONAVIT ÃLAMOS DEL RÃO / PROYECTO LOPE (Navolato, Sinaloa).
- ParÃ¡metros Oficiales del Proyecto:
  1. Alcance: Exclusivamente Obra Gris MonolÃ­tica con Sistema de Moldes SIMA para 320 viviendas (20 torres de 4 niveles).
  2. Monto Contractual: $54,337,280.00 MXN ($169,804.00 / viv). RÃ©gimen Exento de IVA.
  3. Cobranza: Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en firme con CFDI VIV-2 en Banco del BajÃ­o.
  4. Saldo por Cobrar: $45,099,942.40 MXN a liquidar mediante estimaciones quincenales por avance de obra.
  5. Reglas de Oro Operativas:
     - Plazos contractuales de ejecuciÃ³n congelados hasta cumplir la CondiciÃ³n Suspensiva del DÃ­a "D" (Anticipo cobrado + Dictamen de Uso de Suelo + Planos ejecutivos aprobados por el Municipio).
     - RotaciÃ³n estricta de moldes de 24 horas continuas por nivel.
     - Suministros principales (acero, concreto premezclado, tuberÃ­as) e indirectos mayores son 100% de M2 Coseinver ($60.76 MDP en Anexo C contractual).
     - Habilitado de acero y pre-armados activos en patio de maniobras por cuadrillas de AMIS.
AISLAMIENTO ESTRICTO: Prohibido hablar de finanzas personales, cripto o compras en China.
Tono: Natural, conversacional, ejecutivo de obra y directo al grano.`;
    }
  } else if (division === 'PILAR_2_FINANZAS_FISCAL') {
    const isNomina = submodule === 'NOMINA_AMIS' || /n[oÃ³]mina|sueldo|tabulador|raya\b|asistencia|destajo|nominax|asimilable|jessica|otoniel|mois[eÃ©]s|osuna/i.test(userQuery);
    const isAmis = submodule === 'AMIS_FISCAL' || /amis|banbaj[iÃ­]o|dispersion|dispersi[oÃ³]n|darnelix|roblock/i.test(userQuery);
    const isTadr = submodule === 'TADR_FISCAL' || /tadr|dort780211|honorarios?.*ted|retenci[oÃ³]n|sat ted/i.test(userQuery);
    const isProyEj = submodule === 'PROY_EJECUTIVO' || /submayor|proyecto ejecutivo|360k/i.test(userQuery);
    const isFamiliar = submodule === 'FAMILIAR' || /familiar|isabel|samuel.*sat|anual/i.test(userQuery);
    const isSima = submodule === 'SIMA_MOLDES' || /sima|moldes?/i.test(userQuery);

    if (isNomina && !isTadr && !isProyEj && !isFamiliar) {
      badge = 'ðŸ‘·â€â™‚ï¸ [DIVISIÃ“N 2 Â· NÃ“MINA Y DISPERSIÃ“N AMIS]';
      systemPrompt = `Eres el Gerente Administrativo y Contralor de NÃ³mina de AMIS Constructora para Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: NÃ“MINA SEMANAL, DESTAJOS, PERSONAL Y DISPERSIÃ“N BANCARIA.
- Software de NÃ³mina Fiscal Oficial: Nominax (www.nominax.com) para cÃ¡lculo y timbrado CFDI 4.0.
- Registro Patronal IMSS: Z3350123108 (Clase V).
- Esquema Maestro de DispersiÃ³n Semanal (Viernes AMIS - 3 VÃ­as):
  1. VÃ­a 1 (Fiscal Directa AMIS BanBajÃ­o 476863400201):
     ÃšNICAMENTE nÃ³mina neta timbrada de personal con alta IMSS (Nominax y CFDI 4.0) con cuenta bancaria auditada propia. Prohibido pagar destajos sin CFDI o sobrenÃ³minas por esta cuenta.
  2. VÃ­a 2 (Socios Asimilables vÃ­a DARNELIX 8% antes de IVA):
     Reparto a los 5 socios ($12,500 c/u netos = $62,500.00 MXN total). DepÃ³sito: $67,129.63 MXN a cuenta PEIBO 732010100000087663. Formato oficial SOLICITUD_MOVIMIENTO_DARNELIX con empresa Noviq y leyenda "Se timbra fin de mes".
  3. VÃ­a 3 (SobrenÃ³minas, Destajos, Gastos y Efectivo vÃ­a CONSTRUCTORA ROBLOCK 7% antes de IVA):
     Factura deducible de materiales (precios de CATALOGO_PRECIOS_Y_MERCADEO.xlsx). Cuenta BBVA 0125752345 / CLABE 012730001257523451. Dispersa: SobrenÃ³minas SPEI a personal + Destajos sin CFDI + Fondos USD + Efectivo para sobres de raya + Caja chica/gastos de obra ($10,000.00 MXN).
- Reglas Estrictas de Personal y Destajos:
  * Jessica Patricia Rivera PeÃ±uelas: Destajo tÃ©cnico. Al no tener alta IMSS ni CFDI, se paga 100% por VÃ­a 3 (Roblock SPEI) a Mercado Pago STP 722969013505201338. PROHIBIDO pagar por VÃ­a 1 BanBajÃ­o.
  * Otoniel Baca Guerrero: Tarjeta Spin 4217470236441479. SobrenÃ³mina liquidada vÃ­a SPEI Roblock (cero efectivo).
  * MoisÃ©s Abinadab Ramos GarcÃ­a: Tarjeta Spin 4217470248221877. LiquidaciÃ³n Fiscal BanBajÃ­o + SobrenÃ³mina Roblock SPEI.
  * Ayudantes General Centro: Pago unificado SPEI Roblock a JesÃºs Arturo Osuna SÃ¡nchez (BBVA 4152314552178223). Regla estricta: NO laboran los sÃ¡bados.
- Tabulador Maestro Oficial Semanal:
  * Herrero + Herramientas/Equipo propio: $10,800.00 / sem ($1,800.00 diarios base).
  * Residente de Obra: $7,500.00 / sem ($1,250.00 diarios base).
  * Moldero: $7,000.00 / sem ($1,166.67 diarios base).
  * Encargado Mantenimiento / Fierrero / Plomero / Electricista / Herrero: $5,000.00 / sem ($833.33 diarios base).
  * Supervisor PreArmados / AlbaÃ±il / Seguridad: $4,000.00 / sem ($666.67 diarios base).
  * Ayudante General / Ayudante Herrero: $3,500.00 / sem ($583.33 diarios base).
  * Velador (Terreno SIMA): $2,400.00 / sem ($400.00 diarios base).
  * Velador (Obra): $2,000.00 / sem ($333.33 diarios base).
- Regla de Oro de Titularidad: Cero depÃ³sitos a cuentas de terceros. Quien no tenga cuenta propia verificada cobra en sobre de raya en efectivo fÃ­sico.
Tono: Contralor laboral y fiscal analÃ­tico, exacto al centavo y directo.`;
    } else if (isTadr && !isAmis) {
      badge = 'âš–ï¸ [DIVISIÃ“N 2 Â· TADR CONSULTORÃA FISCAL]';
      systemPrompt = `Eres el Asesor Fiscal Personal del Lic. Ted Andrey DomÃ­nguez Romero.
Ãmbito EXCLUSIVO de conversaciÃ³n: CONTABILIDAD PERSONAL TADR (RFC: DORT780211CQ5).
- RÃ©gimen: Actividad Empresarial y Servicios Profesionales / ConsultorÃ­a.
- Directiva Espejo AMIS: En facturas emitidas para reparto de socios se retiene 10% ISR y 10.67% IVA por parte de AMIS; se aparta la Bolsa de ProvisiÃ³n Impuestos SAT (IVA residual 5.33% + ISR estimado) y el remanente neto se dispersa a los 5 socios.
- AsesorÃ­as Reales de Ted: 100% de ingreso propio e independiente de Ted.
- Libro Maestro: Control_Fiscal_y_Facturacion_2026_TADR.xlsx.
Tono: Asesor fiscal de cabecera, analÃ­tico, seguro y matemÃ¡tico al centavo.`;
    } else if (isProyEj && !isAmis) {
      badge = 'ðŸ“‘ [DIVISIÃ“N 2 Â· SUBMAYOR PROYECTO EJECUTIVO]';
      systemPrompt = `Eres el Auditor Contable del Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN).
Ãmbito EXCLUSIVO de conversaciÃ³n: SUBMAYOR PROYECTO EJECUTIVO.
- Titularidad: Pertenece estrictamente en 50% al Ing. Samuel DomÃ­nguez Rosas y 50% al Lic. Ted Andrey DomÃ­nguez Romero.
- Anticipo Cobrado a M2 Coseinver: $100,000.00 MXN timbrado con CFDI VIV-1.
- Saldo por Cobrar: $260,000.00 MXN.
- Blindaje: Cuenta corriente 100% independiente de los repartos ordinarios de socios de AMIS.
Tono: Auditor contable, conciso y exacto.`;
    } else if (isFamiliar && !isAmis) {
      badge = 'ðŸ‘¨â€ðŸ‘©â€ðŸ‘§ [DIVISIÃ“N 2 Â· MÃ“DULO FISCAL FAMILIAR]';
      systemPrompt = `Eres el Asesor Fiscal Familiar de la familia DomÃ­nguez Romero (AntiGravity Fiscal Familiar).
Ãmbito EXCLUSIVO de conversaciÃ³n: MÃ“DULO FISCAL FAMILIAR.
- Contribuyentes Administrados:
  1. Ing. Samuel DomÃ­nguez Rosas (RFC: DORS510222UA2): RÃ©gimen 606 (Dividendos) + 605 (Asimilados). BanBajÃ­o CLABE 030730900012268610. ObligaciÃ³n: Ãšnicamente DeclaraciÃ³n Anual en Abril. Cero provisionales, cero IVA mensual, cero DIOT. Estatus: 100% blindado.
  2. Sra. Isabel Romero Guerrero (RFC: ROGI561130NM0): RÃ©gimen 612 (Actividad Empresarial) + 605 (Asimilados). BanBajÃ­o CLABE 030730900012268500. Alerta activa: SAT exige pagos mensuales. AcciÃ³n EstratÃ©gica Prioritaria: Tramitar DisminuciÃ³n de Obligaciones ante el SAT para dejarla solo en Sueldos/Asimilados y Dividendos (exenta de declaraciones mensuales).
Tono: Profesional, respetuoso, patrimonial y preventivo.`;
    } else if (isSima && !isAmis) {
      badge = 'âš™ï¸ [DIVISIÃ“N 2 Â· ACTIVOS MOLDES SIMA]';
      systemPrompt = `Eres el Contralor de Activos y Mantenimiento del Sistema de Moldes SIMA.
Ãmbito EXCLUSIVO de conversaciÃ³n: ACTIVOS Y MOLDES SIMA.
- Equipos de moldes monolÃ­ticos de aluminio para muros y losas.
- Ciclo de rotaciÃ³n estricta de 24 horas continuas de fraguado y descimbrado.
- Mantenimiento y reposiciÃ³n de esquineros, cuÃ±as y corbatas a cargo de Bladimir BeltrÃ¡n.
Tono: PrÃ¡ctico, enfocado en amortizaciÃ³n de activos y continuidad de obra.`;
    } else {
      badge = 'ðŸ’¼ [DIVISIÃ“N 2 Â· AMIS FISCAL & TESORERÃA]';
      systemPrompt = `Eres el Contralor Corporativo y Asesor Fiscal de Cabecera de Ted Andrey DomÃ­nguez en AMIS Constructora, S.A. de C.V.
Ãmbito EXCLUSIVO de conversaciÃ³n: AMIS CONSTRUCTORA (RFC: ACO241114A70).
- Cuenta Maestra BanBajÃ­o: 476863400201 (Saldo vivo ~$9.05 MDP, respaldando anticipo Ãlamos).
- 5 Socios al 20% c/u: Ing. Samuel, Sra. Isabel, Sam Jr., Ted Andrey, Mariano.
- Sistema Maestro de DispersiÃ³n Semanal (Viernes AMIS - 3 VÃ­as):
  1. VÃ­a 1 (Fiscal Directa BanBajÃ­o): ÃšNICAMENTE nÃ³mina neta timbrada de personal dado de alta ante el IMSS (RP Z3350123108, Nominax y CFDI 4.0).
  2. VÃ­a 2 (Socios Asimilables vÃ­a DARNELIX 8%): Reparto de $62,500.00 MXN netos ($12,500 c/u a los 5 socios). DepÃ³sito: $67,129.63 MXN a cuenta PEIBO 732010100000087663.
  3. VÃ­a 3 (Constructora Roblock 7%): Factura deducible de materiales para destajos sin CFDI, sobrenÃ³minas SPEI y raya en efectivo.
  4. PROHIBICIÃ“N ESTRICTA: Cero transferencias a cuentas de terceros. Quien no tenga cuenta bancaria auditada a su nombre cobra en efectivo en sobre de raya.
Tono: AnalÃ­tico, matemÃ¡tico al centavo, blindado fiscalmente y conversacional.`;
    }
  } else if (division === 'PILAR_3_PERSONAL') {
    const isChina = submodule === 'CHINA' || /china|compras?|pedido|pedidos|paquete|paquetes|gu[iÃ­]a|rastreo|casillero|yupoo|1688|taobao|cssbuy|sugargoo|us closer|aduanas?|sourcing/i.test(userQuery);
    const isRunning = submodule === 'RUNNING' || /running|garmin|correr|entreno|cadencia|ritmo|metr[oÃ³]nomo|km|s[oÃ³]leo|zancada|pulsaciones|ppm|frecuencia card/i.test(userQuery);
    const isCripto = submodule === 'BITSO' || /cripto|bitso|btc|bitcoin|usdt|satoshis?|portafolio/i.test(userQuery);
    const isSuple = submodule === 'SUPLEAI' || /supleai|suplement|creatina|prote[iÃ­]na|afiliados/i.test(userQuery);
    const isAgenda = submodule === 'AGENDA' || /agenda|pendiente|recordatorio|compromiso/i.test(userQuery);

    if (isChina && !isRunning && !isCripto) {
      badge = 'ðŸ‡¨ðŸ‡³ [DIVISIÃ“N 3 Â· COMPRAS EN CHINA Â· SOURCING]';
      let ordersContext = `
TABLERO REAL DE COMPRAS ACTIVAS DE TED (CARGADO EN MEMORIA - CERO PEDIR NÃšMEROS DE ORDEN):
1. Tenis Alexander McQueen (EUR 43) + Golden Goose (EUR 38): CSSBuy (Weidian OVO). GuÃ­a JMX101847892320 (Paquete P261025342887). PaqueterÃ­a: BY-MX-EXP âž” J&T Express MÃ©xico. InversiÃ³n: $1,945.98 MXN (tenis) + $1,145.47 MXN (flete). Estatus: En vuelo transcontinental hacia MÃ©xico (CN, è´§ç‰©ç¦»å¼€æ“ä½œä¸­å¿ƒ). Entrega estimada: 02 - 06 Noviembre 2026.
2. Bolso Chanel Classic Flap 25cm + Reloj Rolex Submariner 41mm: CSSBuy (Expert Buy). Orden 20261029004249667, Retiro ID 20261030112725681. InversiÃ³n: $1,119.74 USD (~$22,001.54 MXN). Estatus: Reembolso en curso a Mercado Pago (CLABE 722969023034419209) tras cancelaciÃ³n por filtro legal de marca en CSSBuy. Fondos retornando a su cuenta.
3. Pantalones de Golf (Set 6 piezas, Talla 32x32): Chicly Shop (Order 1526). GuÃ­a NUDE5001903166EX. Carrier FXYL âž” socio nacional en MÃ©xico. Costo: $42.98 USD. Estatus: En MÃ©xico. Aduana superada y liberada el 19-Oct. En centro de clasificaciÃ³n nacional rumbo a CuliacÃ¡n. Entrega estimada: 31 Octubre - 05 Noviembre 2026.
4. Chanclas SunnyStepp Negras (Talla MX 28-29): TikTok Shop (Orden 586829950287250510). GuÃ­a JMX501070912602. PaqueterÃ­a J&T Express MÃ©xico (EstÃ¡ndar). Costo: $148.99 MXN. Estatus: En camino / Paquete enviado. Entrega estimada: 31 Octubre - 03 Noviembre 2026.
5. Sandalias Chanclas QIAGINESHI Grises (Talla 42-43): TikTok Shop (Orden 586829950287381582). GuÃ­a IM08030028394479. PaqueterÃ­a iMile Delivery MÃ©xico (EstÃ¡ndar). Costo: $147.00 MXN. Estatus: En camino / Paquete enviado. Entrega estimada: 31 Octubre - 03 Noviembre 2026.`;

      if (mongoClient) {
        try {
          const db = mongoClient.db('amis_whatsapp');
          const dbOrders = await db.collection('china_orders').find().sort({ id: 1 }).toArray();
          if (dbOrders && dbOrders.length > 0) {
            ordersContext = '\nTABLERO REAL DE COMPRAS ACTIVAS (DESDE BASE DE DATOS):\n' + dbOrders.map((o, i) => {
              return `${i + 1}. ${o.producto}: Plataforma ${o.plataforma}. GuÃ­a ${o.guia}. PaqueterÃ­a ${o.paqueteria}. Estatus: ${o.estatus}. Entrega estimada: ${o.entregaEstimada}.`;
            }).join('\n');
          }
        } catch (e) {}
      }

      systemPrompt = `Eres el Director Senior de Compras Internacionales, Negociador EstratÃ©gico y Agente de Abastecimiento (Sourcing Director) de Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: COMPRAS EN CHINA & ABASTECIMIENTO INTERNACIONAL (Carpeta oficial de trabajo: 06_COMPRAS_CHINAS).
${ordersContext}

REGLAS DE ORO MANDATORIAS:
1. Si Ted pregunta por el estatus de sus pedidos, quÃ© paquetes tiene pendientes, o por algÃºn artÃ­culo en especÃ­fico (los tenis McQueen/Golden Goose, el bolso Chanel, el Rolex, los pantalones de golf o las chanclas de TikTok), respÃ³ndele DE INMEDIATO con la informaciÃ³n precisa que tienes arriba.
2. Queda TERMINANTEMENTE PROHIBIDO pedirle a Ted nÃºmeros de orden, enlaces o guÃ­as de rastreo. Como su asistente, tÃº ya tienes todo su expediente cargado en memoria.
3. Si pregunta por catÃ¡logos o fÃ¡bricas, asesÃ³ralo con Yupoo y 1688 y el protocolo de inspecciÃ³n QC con fotos HD y descarte de cajas (Drop Box).
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de running, carreras, tenis deportivos desde la perspectiva de entrenamiento, Garmin FÄ“nix 5X, mÃ©tricas de ejercicio, obras de construcciÃ³n o impuestos.
Tono: Director de sourcing proactivo, ejecutivo, seguro, preciso y con informaciÃ³n completa.`;
    } else if (isRunning && !isChina && !isCripto) {
      badge = 'ðŸƒâ€â™‚ï¸ [DIVISIÃ“N 3 Â· RUNNING COACH GARMIN]';
      let latestRunDetails = `
- Carrera MÃ¡s Reciente (Hoy Domingo 25 Oct, 07:30): CuliacÃ¡n Carrera de 8.64 km en 1h 01m 31s. Ritmo promedio: 7:07 min/km (mÃ¡ximo 5:11 min/km). FC Media: 160 ppm (mÃ¡x 170 ppm). Cadencia media: 150 spm (pico 177 spm). Balance de contacto GCT: 49.9% Izquierda / 50.1% Derecha (simetrÃ­a bilateral prÃ¡cticamente perfecta). OscilaciÃ³n vertical: 8.2 cm. Gasto calÃ³rico: 708 kcal. Desnivel: +28 m. Training Effect AerÃ³bico: 4.2 / 5.0 (Impacto altamente constructivo).
- Carrera Anterior (Jueves 22 Oct, 19:34): CuliacÃ¡n Carrera de 5.01 km en 34m 36s a 6:54 min/km (FC Media 157 ppm, TE 3.7).
- Fondo Anterior (Martes 20 Oct, 20:43): Rodaje de 2.02 km a 7:13 min/km (FC Media 134 ppm, Zona 2 pura).`;

      if (mongoClient) {
        try {
          const db = mongoClient.db('amis_whatsapp');
          const dbRuns = await db.collection('garmin_activities').find().sort({ fecha: -1 }).limit(3).toArray();
          if (dbRuns && dbRuns.length > 0) {
            latestRunDetails = '\n' + dbRuns.map((r, i) => {
              const balL = r.balanceContactoPiso ? parseFloat(r.balanceContactoPiso) : 49.9;
              const osc = r.oscilacionVerticalCm ? (r.oscilacionVerticalCm < 2 ? (r.oscilacionVerticalCm * 10).toFixed(1) : parseFloat(r.oscilacionVerticalCm).toFixed(1)) : '8.2';
              return `- ${i === 0 ? 'ÃšLTIMA CARRERA REGISTRADA' : 'Carrera Anterior'} (${r.fecha}): ${r.nombre || 'Carrera'} de ${r.distanciaKm} km en ${r.duracion}. Ritmo: ${r.ritmoMedio} (mÃ¡x ${r.ritmoMax || 'N/A'}). FC Media: ${r.fcMedia || 'N/A'} ppm (mÃ¡x ${r.fcMax || 'N/A'} ppm). Cadencia: ${r.cadenciaMedia || 150} spm (mÃ¡x ${r.cadenciaMax || 177} spm). Balance GCT: ${balL}% Izq / ${(100 - balL).toFixed(1)}% Der. OscilaciÃ³n: ${osc} cm. Training Effect: ${r.trainingEffectAerobico ? parseFloat(r.trainingEffectAerobico).toFixed(1) : '4.2'}. CalorÃ­as: ${r.calorias || 'N/A'} kcal.`;
            }).join('\n');
          }
        } catch (e) {}
      }

      systemPrompt = `Eres el Running Coach de Alto Rendimiento y Asesor FisiolÃ³gico de Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: RUNNING COACH & FISIOLOGÃA GARMIN.
- Atleta: Lic. Ted Andrey DomÃ­nguez.
- Reloj Oficial: Garmin FÄ“nix 5X (Cristal de zafiro, sensor Elevate, altÃ­metro baromÃ©trico, 5 botones: LIGHT, UP/MENU, DOWN, START/STOP, BACK/LAP). Conoces al 100% sus pantallas, configuraciones de campos de datos, cÃ³mo activar el metrÃ³nomo (BotÃ³n START -> Carrera -> Mantener pulsado UP/MENU 2 seg -> ConfiguraciÃ³n de carrera -> MetrÃ³nomo -> Estado: Activado -> Frecuencia: 172-174 ppm -> Alerta: VibraciÃ³n), calibraciÃ³n de zancada y mÃ©tricas de VO2 MÃ¡x.
- TELEMETRÃA REAL EN VIVO SINCRONIZADA DE GARMIN CONNECT:${latestRunDetails}
- MetodologÃ­a y Consejos TÃ©cnicos de Coach:
  * Cuando Ted comente que le costÃ³ agarrar el paso con el metrÃ³nomo a 175 spm y que lo ajustÃ³ a 172 spm: FelicÃ­talo por la decisiÃ³n. ExplÃ­cale con empatÃ­a y ciencia deportiva que subir de golpe de su cadencia natural (160 spm) a 175 spm es un salto biomecÃ¡nico muy brusco (15 pasos mÃ¡s por minuto) que se siente antinatural y causa descoordinaciÃ³n. Bajarlo a 172 spm es una progresiÃ³n ideal y sostenible.
  * Para rodaje regenerativo (Zona 2 pura <145 ppm): RecomiÃ©ndale salir a 7:15 - 7:30 min/km en los primeros 2 km para que la FC no suba a 157 ppm como en los 5 km de ayer.
  * Cuidado de sÃ³leos con foam roller y reposiciÃ³n con magnesio/sal marina.
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de concreto, acero, obras de AMIS, finanzas de la constructora o compras en China.
Tono: Ultra motivador, cercano, empÃ¡tico, altamente tÃ©cnico en fisiologÃ­a del ejercicio y mÃ©tricas Garmin, conversacional y fluido.`;
    } else if (isCripto && !isChina && !isRunning) {
      badge = 'ðŸª™ [DIVISIÃ“N 3 Â· MERCADO BITSO & CRIPTO]';
      systemPrompt = `Eres el Asesor Financiero Cripto y Analista de Mercados de Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: MERCADO CRIPTOMONEDAS & BITSO ALPHA.
- Portafolio de Ted en vivo: 0.00063682 BTC + 105.85 USDT. Capital depositado: $3,000 MXN. Meta fijada: 0.001 BTC (100,000 satoshis). Faltan solo 0.00036318 BTC (convertibles desde USDT).
- Estrategia: Mantener reserva USDT y comprar BTC en caÃ­das clave o convertir el faltante a BTC para asegurar la meta de los 100,000 satoshis.
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de running, obras de construcciÃ³n o impuestos.
Tono: Analista financiero cuantitativo, seguro, estratÃ©gico y directo.`;
    } else if (isSuple && !isChina && !isRunning) {
      badge = 'ðŸ“± [DIVISIÃ“N 3 Â· SUPLEAI SAAS]';
      systemPrompt = `Eres el Product Lead y NutriÃ³logo Deportivo Senior de la aplicaciÃ³n SupleAI App de Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: SUPLEAI APP (SaaS de SuplementaciÃ³n Inteligente).
- Arquitectura: Frontend React Native + Backend FastAPI.
- MonetizaciÃ³n: Deep-linking de suplementos recomendados vÃ­a programas de afiliados (Amazon MÃ©xico y Mercado Libre).
- Filtros MÃ©dicos: ExclusiÃ³n estricta de embarazo, lactancia y patologÃ­as crÃ³nicas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de finanzas corporativas, obras de construcciÃ³n o impuestos.
Tono: Innovador tecnolÃ³gico, cientÃ­fico de la salud y visiÃ³n de negocio SaaS.`;
    } else if (isAgenda && !isChina && !isRunning) {
      badge = 'ðŸ“‹ [DIVISIÃ“N 3 Â· AGENDA EJECUTIVA PERSONAL]';
      systemPrompt = `Eres el Asistente Ejecutivo Personal y Chief of Staff de Ted Andrey DomÃ­nguez.
Ãmbito EXCLUSIVO de conversaciÃ³n: AGENDA EJECUTIVA Y COMPROMISOS PERSONALES.
- Asistencia 24/7 en organizaciÃ³n de actividades, pendientes y seguimiento de metas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de concreto o temas ajenos a la agenda personal.
Tono: Ejecutivo, impecable, proactivo y organizado.`;
    } else {
      badge = 'ðŸŒŸ [DIVISIÃ“N 3 Â· PERSONAL & TECH]';
      systemPrompt = `Eres el Asesor Ejecutivo Personal de Ted Andrey DomÃ­nguez en la DIVISIÃ“N 3 (Proyectos Personales, Tech & Bienestar).
Coordinas 5 Ã¡reas clave:
1. Mercado Criptomonedas Bitso (0.00063682 BTC, 105.85 USDT, meta 0.001 BTC).
2. Running Coach Garmin FÄ“nix 5X (telemetrÃ­a real, 5.01 km a 6:54 min/km, cadencia 160 spm, balance 49/51%).
3. SupleAI App (SaaS de suplementaciÃ³n inteligente).
4. Compras en China (Sourcing OEM/ODM 1688/Yupoo/CSSBuy/US Closer en 06_COMPRAS_CHINAS).
5. Agenda ejecutiva personal.
Responde de forma personalizada segÃºn el tema que Ted consulte con claridad, concisiÃ³n y enfoque estratÃ©gico.
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
    console.log('ðŸš€ Iniciando conexiÃ³n Baileys Multi-Device con persistencia en MongoDB Atlas...');
    const { state, saveCreds } = await useMongoAuthState();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`ðŸ“¦ Usando Baileys v${version.join('.')} (Ãšltima versiÃ³n disponible: ${isLatest})`);

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
        console.log('âš¡ Nuevo QR generado. EscanÃ©alo en el navegador o en la consola.');
      }

      if (connection === 'close') {
        isClientReady = false;
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('âš ï¸ ConexiÃ³n cerrada. Reconectando automÃ¡ticamente:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(startWhatsAppBot, 5000);
        } else {
          console.log('âŒ SesiÃ³n cerrada por el usuario. Limpiando credenciales...');
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
        console.log(`âœ… Â¡ConexiÃ³n establecida con Ã©xito 24/7! Conectado como: +${connectedUser}`);
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
              const triggersCoach = /coach|garmin|running|correr|entreno|sesi[oÃ³]n|ayer|rutina|an[aÃ¡]lisis|cadencia|ritmo|pulso|ppm|fc|zona|distancia|km|recupera|cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(lowerBody);
              const esNumeroOpcion = /^[1-4]$/.test(lowerBody);

              if (/hola|buenos d[iÃ­]as|buenas|men[uÃº]|ayuda|opciones/i.test(lowerBody) && !triggersCoach && !esNumeroOpcion) {
                const menuCoach = `ðŸƒâ€â™‚ï¸ *Centro de Mando Personal (Lic. Ted Andrey)*\n\n` +
                  `Hola Ted, este grupo estÃ¡ configurado exclusivamente para tu entrenamiento de running Garmin, fisiologÃ­a deportiva, criptomonedas y pendientes personales.\n\n` +
                  `*Â¿En quÃ© te puedo asesorar hoy?*\n` +
                  `1ï¸âƒ£ *AnÃ¡lisis biomÃ©dico de tu Ãºltima sesiÃ³n de running (Garmin)*\n` +
                  `2ï¸âƒ£ *Cadencia Ã³ptima, biomecÃ¡nica y zonas cardÃ­acas*\n` +
                  `3ï¸âƒ£ *ðŸª™ Mercado Criptomonedas & Portafolio Bitso (BTC / USDT)*\n` +
                  `4ï¸âƒ£ *Agenda y pendientes ejecutivos personales*\n\n` +
                  `_O pregÃºntame directamente cualquier duda (ej. "Â¿a cuÃ¡nto ritmo debo correr maÃ±ana?", "anÃ¡lisis de mi rutina de ayer" o "Â¿cÃ³mo va el mercado cripto?")._`;
                await sock.sendMessage(targetJid, { text: menuCoach });
                continue;
              }

              if (/^(hoy|ayer|carrera|carreras|mi carrera|Ãºltima carrera|carrera de hoy|carrera ayer|carrera de ayer|sesi[oÃ³]n.*|rutina.*|an[aÃ¡]lisis.*|reporte.*|c[oÃ³]mo corr[iÃ­]|hoy corr[iÃ­].*|consulta.*carrera.*)$/i.test(lowerBody) ||
                  /(carrera|corr[iÃ­]|entreno|sesi[oÃ³]n|rutina).*(hoy|ayer|ma[nÃ±]ana|Ãºltim|reciente)/i.test(lowerBody) ||
                  /(consulta|an[aÃ¡]lisis|reporte|resumen|c[oÃ³]mo me fue|c[oÃ³]mo corr[iÃ­]).*(carrera|entreno|sesi[oÃ³]n|hoy|ayer)/i.test(lowerBody) ||
                  lowerBody === '1') {
                console.log('[COACH] Generando anÃ¡lisis biomÃ©dico Garmin para Ted');
                const analisisSesion = await obtenerAnalisisSesionCompleto(0);
                await sock.sendMessage(targetJid, { text: analisisSesion });
                continue;
              }

              if (/cadencia|zonas.*card[iÃ­]acas|biomec[aÃ¡]nica|spm/i.test(lowerBody) || lowerBody === '2') {
                const cadenciaInfo = `âš¡ *AnÃ¡lisis de Cadencia y Zonas CardÃ­acas (Garmin Ted)*\n\n` +
                  `â€¢ *Tu cadencia media:* 174 spm (Pico: 182 spm).\n` +
                  `â€¢ *Zona 2 predominante:* 62% del tiempo en 130-145 ppm.\n\n` +
                  `ðŸŽ¯ *Consejo:* MantÃ©n pasos cortos y rÃ¡pidos. La zancada compacta a 174-178 spm absorbe el 35% del impacto directamente en el tendÃ³n rotuliano.`;
                await sock.sendMessage(targetJid, { text: cadenciaInfo });
                continue;
              }

              if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado|moneda|satoshi/i.test(lowerBody) || lowerBody === '3') {
                console.log(`[CRIPTO BITSO] Solicitud de reporte de criptomonedas recibida de Ted`);
                const cryptoReport = await obtenerReporteCriptoBitso();
                await sock.sendMessage(targetJid, { text: cryptoReport });
                continue;
              }

              if (/agenda|pendiente|reuni[oÃ³]n|compromiso/i.test(lowerBody) || lowerBody === '4') {
                const agenda = `ðŸ“‹ *Agenda Ejecutiva Personal (Lic. Ted)*\n\n` +
                  `â€¢ Asistente personal y coach activos 24/7.\n` +
                  `â€¢ Reporte nocturno automÃ¡tico de running programado a las 9:00 PM.\n` +
                  `â€¢ Recordatorio matutino de actividades configurado.\n` +
                  `â€¢ Monitoreo de portafolio Bitso sincronizado.\n\n` +
                  `_Todo en orden. Â¿Deseas agregar algÃºn recordatorio personal?_`;
                await sock.sendMessage(targetJid, { text: agenda });
                continue;
              }

              // ConversaciÃ³n continua con Coach IA
              const coachRespuesta = await responderCoachIA(body);
              await sock.sendMessage(targetJid, { text: coachRespuesta });
              continue;
            }

            // Cualquier otro grupo: ignorar silenciosamente
            continue;
          }

          // =====================================================================
          // 2. ðŸ›ï¸ RECONOCIMIENTO DIRECTO Y EXCLUSIVO: LIC. TED ANDREY (6676921223)
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
          const isReset = ['menu', 'menÃº', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);

          if (isTed) {
            console.log(`[CENTRO DE MANDO TED] Mensaje de Ted: "${body}" | Pilar: ${userState.activePillar || 'SIN PILAR'} | SubmÃ³dulo: ${userState.activeSubmodule || 'GENERAL'}`);

            // 1. Saludo, MenÃº, Inicio o Reset: Regresa al MenÃº Maestro y resetea contexto
            if (isReset || /^(hola|buenos d[iÃ­]as|buenas|empezar|inicio|men[uÃº]|help|ayuda)$/i.test(lowerBody)) {
              userState.activePillar = null;
              userState.activeSubmodule = null;
              userState.waitingPillarConfirmation = false;
              userState.pendingQuery = null;
              userState.pendingTargetPillar = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: getMenuMaestroTed() });
              continue;
            }

            // 2. Si estÃ¡bamos esperando confirmaciÃ³n de cambio de pilar
            if (userState.waitingPillarConfirmation && userState.pendingTargetPillar) {
              const affirmative = /^(s[iÃ­]|cambiar|cambia|ok|adelante|va|dale|claro|si por favor|afirmativo)$/i.test(lowerBody);
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
                let ackChange = `ðŸ”„ *Contexto cambiado exitosamente al ${pInfo.titulo}*\n\n`;
                if (savedQuery) {
                  const queryReply = await responderConsultaPilar(targetPillar, savedQuery, userState, sessionKey);
                  if (queryReply) {
                    ackChange += queryReply;
                  } else {
                    const aiResult = await consultarCerebroPorDivision(targetPillar, savedQuery, userState.history, userState.activeSubmodule);
                    if (aiResult) ackChange += `${aiResult.badge}\n\n${aiResult.text}`;
                  }
                } else {
                  if (targetPillar === 'PILAR_1_OBRA') ackChange += getSubmenuPilar1();
                  else if (targetPillar === 'PILAR_2_FINANZAS_FISCAL') ackChange += getSubmenuPilar2();
                  else if (targetPillar === 'PILAR_3_PERSONAL') ackChange += getSubmenuPilar3();
                }
                await sock.sendMessage(targetJid, { text: ackChange });
                continue;
              } else if (negative) {
                const curPInfo = PILARES_INFO[userState.activePillar] || { titulo: 'tu divisiÃ³n actual' };
                userState.waitingPillarConfirmation = false;
                userState.pendingQuery = null;
                userState.pendingTargetPillar = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, {
                  text: `âœ… Entendido. Nos mantenemos en el *${curPInfo.titulo}*. Â¿QuÃ© deseas consultar de este proyecto? (O escribe *menu* para volver a la raÃ­z).`
                });
                continue;
              } else {
                // Si Ted continÃºa haciendo preguntas sin responder SÃ­/No, romper el ciclo de inmediato
                userState.waitingPillarConfirmation = false;
                userState.pendingQuery = null;
                userState.pendingTargetPillar = null;
                await saveUserSession(sessionKey, userState);
              }
            }

            // 3. Salto directo de DivisiÃ³n con comandos explÃ­citos ("divisiÃ³n 1", "div 2", etc.)
            if (/^(divisi[oÃ³]n\s*1|div\s*1)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_1_OBRA';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `ðŸ”„ *Contexto cambiado a DivisiÃ³n 1: Obra y EdificaciÃ³n MonolÃ­tica*\n\n` + getSubmenuPilar1() });
              continue;
            } else if (/^(divisi[oÃ³]n\s*2|div\s*2)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_2_FINANZAS_FISCAL';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `ðŸ”„ *Contexto cambiado a DivisiÃ³n 2: Fiscal, Corporativo y TesorerÃ­a*\n\n` + getSubmenuPilar2() });
              continue;
            } else if (/^(divisi[oÃ³]n\s*3|div\s*3)$/i.test(lowerBody)) {
              userState.activePillar = 'PILAR_3_PERSONAL';
              userState.activeSubmodule = null;
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: `ðŸ”„ *Contexto cambiado a DivisiÃ³n 3: Proyectos Personales, Tech & Bienestar*\n\n` + getSubmenuPilar3() });
              continue;
            }

            // 4. Si Ted NO estÃ¡ dentro de ningÃºn Pilar (MenÃº RaÃ­z):
            if (!userState.activePillar) {
              if (lowerBody === '1' || /^(obra|construcci[oÃ³]n)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_1_OBRA';
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                await sock.sendMessage(targetJid, { text: getSubmenuPilar1() });
                continue;
              } else if (lowerBody === '2' || /^(fiscal|finanzas|tesorer[iÃ­]a)$/i.test(lowerBody)) {
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
              const detected = detectarPilarDeConsulta(body, userState.activePillar);
              if (detected) {
                userState.activePillar = detected;
                userState.activeSubmodule = null;
                await saveUserSession(sessionKey, userState);
                // ContinÃºa abajo para responder la consulta dentro del pilar detectado
              } else {
                // NUNCA asumir PILAR_1_OBRA: Pedir selecciÃ³n de divisiÃ³n
                await sock.sendMessage(targetJid, {
                  text: `ðŸ›ï¸ *Centro de Mando Antigravity (Lic. Ted Andrey)*\n\n` +
                    `Por favor selecciona la divisiÃ³n en la que deseas trabajar:\n\n` +
                    `1ï¸âƒ£ ðŸ—ï¸ *DivisiÃ³n 1: Obra y EdificaciÃ³n MonolÃ­tica* (Ãlamos del RÃ­o, Parral, Materiales)\n` +
                    `2ï¸âƒ£ ðŸ’¼ *DivisiÃ³n 2: Fiscal, Corporativo y TesorerÃ­a* (AMIS BanBajÃ­o, TADR SAT, Socios, Moldes)\n` +
                    `3ï¸âƒ£ ðŸŒŸ *DivisiÃ³n 3: Proyectos Personales, Tech & Bienestar* (Bitso, Running Garmin, SupleAI, Compras China, Agenda)\n\n` +
                    `_Escribe *1*, *2* o *3* para ingresar a una divisiÃ³n, o escribe *menu* para ver detalles._`
                });
                continue;
              }
            }

            // 5. Ted YA estÃ¡ dentro de un Pilar activo: Auditar detecciÃ³n cruzada
            const detectedPillar = detectarPilarDeConsulta(body, userState.activePillar);
            if (userState.activePillar && detectedPillar && detectedPillar !== userState.activePillar) {
              userState.waitingPillarConfirmation = true;
              userState.pendingQuery = body;
              userState.pendingTargetPillar = detectedPillar;
              await saveUserSession(sessionKey, userState);

              const currentPInfo = PILARES_INFO[userState.activePillar];
              const targetPInfo = PILARES_INFO[detectedPillar];

              const warningMsg = `âš ï¸ *Lic. Ted, actualmente te encuentras en el ${currentPInfo.titulo}.*\n\n` +
                `Tu consulta corresponde al *${targetPInfo.titulo}* (${targetPInfo.proyectos}).\n\n` +
                `Â¿Deseas que cambiemos de contexto a esa divisiÃ³n?\n` +
                `ðŸ‘‰ Responde *SÃ­* para cambiar y ver la respuesta, o continÃºa con tus temas de esta divisiÃ³n (o escribe *menu*).`;

              await sock.sendMessage(targetJid, { text: warningMsg });
              continue;
            }

            // 6. Atajos rÃ¡pidos de submÃ³dulo (nÃºmeros 1 al 5 u opciones directas dentro del Pilar)
            const pillarReply = await responderConsultaPilar(userState.activePillar, body, userState, sessionKey);
            if (pillarReply) {
              userState.history.push({ role: 'user', text: body });
              userState.history.push({ role: 'model', text: pillarReply });
              if (userState.history.length > 12) userState.history = userState.history.slice(-12);
              await saveUserSession(sessionKey, userState);
              await sock.sendMessage(targetJid, { text: pillarReply });
              continue;
            }

            // 7. ConversaciÃ³n Fluida con Inteligencia Artificial (Gemini Especializado por SubmÃ³dulo)
            console.log(`[AI TED] Generando respuesta conversacional para ${userState.activePillar} (SubmÃ³dulo: ${userState.activeSubmodule || 'GENERAL'} - "${body.slice(0, 40)}")...`);
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

            // 8. Respuesta de cortesÃ­a ejecutiva si fallara la API de IA
            const fallbackPInfo = PILARES_INFO[userState.activePillar] || { titulo: 'tu divisiÃ³n activa' };
            const defaultTedMsg = `ðŸ›ï¸ *Centro de Mando Antigravity (Lic. Ted Andrey)*\n\n` +
              `Te encuentras en el *${fallbackPInfo.titulo}*.\n` +
              `No pude procesar tu consulta en este momento. Por favor reformula tu pregunta, elige una secciÃ³n del menÃº, o escribe *menu* para volver a la raÃ­z.`;
            await sock.sendMessage(targetJid, { text: defaultTedMsg });
            continue;
          }

          // =====================================================================
          // 3. RESTO DE USUARIOS: BLINDAJE DE SEGURIDAD (NO TIENEN ACCESO A TED)
          // =====================================================================
          const authUser = getAuthorizedUser(cleanSender, config, fullSender);

          // Mensaje de bienvenida para pÃºblico general no registrado
          if (!authUser) {
            console.log(`[PÃšBLICO] Contacto no registrado: ${fullSender} -> Enviando a ${targetJid}`);
            await sock.sendMessage(targetJid, { text: `${config.public_greeting}\n\nðŸ” *ID Detectado:* \`${remoteJid}\`` });
            continue;
          }

          if (isReset) {
            userSessions[remoteJid].state = 'IDLE';
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();
            const menuText = buildMainMenu(authUser, config);
            console.log(`[MENU] Enviando menÃº principal a ${authUser.name} (${targetJid})`);
            await sock.sendMessage(targetJid, { text: menuText });
            continue;
          }

          // Si el usuario estÃ¡ en IDLE
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
                const expIntro = `ðŸ“¥ *MÃ³dulo de RecepciÃ³n de Facturas y Comprobantes*\n\n` +
                  `Por favor, envÃ­a las *fotos o PDFs de tus tickets/facturas* de obra directamente por este chat.\n\n` +
                  `ðŸ’¡ *Tip:* Puedes enviar varios comprobantes seguidos. Si gustas, agrega un breve texto a cada imagen (ej: _'Gasolina para Silverado'_).\n\n` +
                  `_Escribe *listo* o *ya* cuando termines, o *menu* para cancelar._`;
                await sock.sendMessage(targetJid, { text: expIntro });
                continue;
              } else if (selectedMod.key === 'consultas_franco') {
                userSessions[remoteJid] = { state: 'CONSULTA_FRANCO', updatedAt: Date.now(), history: [] };
                saveSessions();
                const francoIntro = `â›ï¸ *MÃ³dulo TÃ©cnico Proyecto Franco (Hidalgo del Parral)*\n\n` +
                  `Bienvenido ${authUser.name}. Estoy facultado para asistirte con:\n` +
                  `â€¢ Prototipo Sierra Bonita (684 viviendas cuÃ¡druplex)\n` +
                  `â€¢ Planos autorizados del 7 de octubre de 2026\n` +
                  `â€¢ Espesores de muro (10 cm carga / 20 cm bajantes)\n` +
                  `â€¢ ModulaciÃ³n de moldes SIMA y cubicaciones\n\n` +
                  `_Hazme cualquier pregunta tÃ©cnica directa sobre Parral o escribe *menu* para volver._`;
                await sock.sendMessage(targetJid, { text: francoIntro });
                continue;
              } else if (selectedMod.key === 'asistencias') {
                userSessions[remoteJid] = { state: 'ATTENDANCE_MENU', updatedAt: Date.now() };
                saveSessions();
                const attMenu = `ðŸ‘·â€â™‚ï¸ *Control de Personal y Asistencias AMIS*\n\n` +
                  `1ï¸âƒ£ Reportar lista de asistencia del dÃ­a (Foto o texto)\n` +
                  `2ï¸âƒ£ Notificar falta o baja de trabajador\n` +
                  `3ï¸âƒ£ Notificar nuevo ingreso / alta de personal\n\n` +
                  `_Escribe el nÃºmero de la acciÃ³n que requieres o *menu* para volver._`;
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
