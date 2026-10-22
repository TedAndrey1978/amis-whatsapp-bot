// Manejo global de excepciones para evitar que el contenedor muera
process.on('uncaughtException', (err) => {
  console.error('🛡️ [EXCEPCIÓN CAPTURADA]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [RECHAZO CAPTURADO]:', reason);
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
let lastMongoError = null;

async function useMongoAuthState() {
  try {
    if (!mongoClient) {
      console.log('🍃 Conectando a MongoDB Atlas para persistencia de sesión 24/7...');
      mongoClient = new MongoClient(MONGO_URI);
      await mongoClient.connect();
      const db = mongoClient.db('amis_whatsapp');
      sessionCollection = db.collection('auth_session');
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
        return null;
      }
    };

    const removeData = async (id) => {
      try {
        await sessionCollection.deleteOne({ _id: id });
      } catch (err) {}
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const data = {};
            await Promise.all(
              ids.map(async (id) => {
                let value = await readData(`${type}-${id}`);
                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }
                data[id] = value;
              })
            );
            return data;
          },
          set: async (data) => {
            const tasks = [];
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const key = `${category}-${id}`;
                tasks.push(value ? writeData(value, key) : removeData(key));
              }
            }
            await Promise.all(tasks);
          }
        }
      },
      saveCreds: () => writeData(creds, 'creds')
    };
  } catch (mongoErr) {
    lastMongoError = mongoErr.message;
    console.error('❌ Error conectando a MongoDB Atlas:', mongoErr.message);
    console.warn('⚠️ Usando almacenamiento local temporal mientras se reconecta MongoDB...');
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    return await useMultiFileAuthState(AUTH_DIR);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const CONFIG_PATH = path.join(__dirname, 'menu_config.json');
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

let sock = null;
let currentQrData = null;
let currentQrDataUrl = null;
let currentPairingCode = null;
let isClientReady = false;
let connectedUser = null;
const processedMsgIds = new Set();

const SESSIONS_FILE = path.join(__dirname, 'active_user_sessions.json');
let userSessions = {};
if (fs.existsSync(SESSIONS_FILE)) {
  try { userSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) {}
}

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(userSessions, null, 2), 'utf8'); } catch (e) {}
}

async function guardarEnBuzonGastos(authUser, senderNumber, count, concepto, hasMedia) {
  try {
    if (mongoClient) {
      const db = mongoClient.db('amis_whatsapp');
      await db.collection('buzon_gastos').insertOne({
        remitente_nombre: authUser?.name || 'Desconocido',
        remitente_rol: authUser?.role || 'COLABORADOR',
        remitente_telefono: senderNumber,
        indice_comprobante: count,
        justificacion_operativa: concepto || 'Sin descripción',
        tiene_archivo: !!hasMedia,
        fecha_registro: new Date(),
        estatus: 'PENDIENTE_AUDITORIA'
      });
      console.log(`📥 [BUZÓN GASTOS] Registrado en Mongo: ${authUser?.name} | "${concepto}"`);
    }
  } catch (err) {
    console.error('Error guardando en buzon_gastos:', err.message);
  }
}

async function actualizarConceptoBuzon(senderNumber, count, concepto) {
  try {
    if (mongoClient) {
      const db = mongoClient.db('amis_whatsapp');
      await db.collection('buzon_gastos').updateOne(
        { remitente_telefono: senderNumber, indice_comprobante: count },
        { $set: { justificacion_operativa: concepto, fecha_actualizacion: new Date() } }
      );
      console.log(`📝 [BUZÓN GASTOS ACTUALIZADO] Tel: ${senderNumber} #${count} -> "${concepto}"`);
    }
  } catch (err) {
    console.error('Error actualizando buzon_gastos:', err.message);
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  }
  return {
    admin_phone: '6676921223',
    authorized_users: [],
    public_greeting: '👋 *Bienvenido a AMIS Constructora, S.A. de C.V.*\n\nGracias por comunicarte con nuestra línea oficial. ¿En qué podemos ayudarte el día de hoy?\n\n_Por favor déjanos tu nombre, empresa o el motivo de tu mensaje y un miembro de nuestro equipo te responderá a la brevedad._',
    menu_title: '🏗️ *AMIS CONSTRUCTORA · Portal de Operaciones*\n\nHola {name}, selecciona una opción respondiendo con el número:',
    menu_footer: '\n👉 _Responde con el número (1️⃣, 2️⃣ o 3️⃣), o escribe *menu* en cualquier momento._',
    options: []
  };
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

function buildMainMenu(authUser, config) {
  const name = authUser ? authUser.name : 'Colaborador';
  const role = authUser ? authUser.role : '';

  if (role === 'GERENTE_ADMINISTRATIVO') {
    return (
      `🏛️ *TORRE DE CONTROL · LIC. TED ANDREY DOMÍNGUEZ*\n\n` +
      `¡Excelente día, Lic. Ted! 🫡 ¿En qué frente estratégico nos enfocamos hoy?\n\n` +
      `1️⃣ 🏗️ *Álamos del Río (Navolato)* · Obra gris SIMA, pre-armados y Día "D"\n` +
      `2️⃣ 🏘️ *Sierra Bonita (Parral)* · Planos, prototipo, muros 10 y 20 cm y volumetrías\n` +
      `3️⃣ 💼 *AMIS Contabilidad y Finanzas* · Dispersión 3 vías, proveedores y bancos\n` +
      `4️⃣ ⚖️ *TADR Contabilidad y Finanzas* · Régimen personal, retenciones e impuestos\n` +
      `5️⃣ 🧾 *Subir Recibo o Factura de Gasto* · Carga directa para auditoría contable\n` +
      `6️⃣ 👷‍♂️ *Personal y Nómina en Obra* · Asistencias, incidencias y tabuladores\n\n` +
      `💬 _Escribe el número (1️⃣ al 6️⃣), escribe tu consulta directamente o envía un audio._`
    );
  }

  let menu = config.menu_title.replace('{name}', name) + '\n\n';
  
  const userOptions = (config.options || []).filter(opt => {
    if (!opt.allowed_roles || opt.allowed_roles.length === 0) return true;
    return opt.allowed_roles.includes(role);
  });

  userOptions.forEach((opt) => {
    menu += `${opt.id}️⃣ ${opt.title}\n`;
  });
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

  // Página visual en navegador (QR y Estado en vivo)
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
        .qr-box { background: white; padding: 12px; border-radius: 12px; display: inline-block; margin: 14px 0; }
        img { display: block; max-width: 100%; height: auto; }
        .step-list { text-align: left; background: #0f172a; border-radius: 8px; padding: 14px 18px; margin-top: 16px; font-size: 13px; color: #cbd5e1; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card" id="mainCard">
        <h1>🏢 Torre de Control AMIS</h1>
        <p>Servidor 24/7 en la Nube · Cerebro Antigravity</p>
        <div id="contentBox">
          ${isClientReady ? `
            <div class="badge badge-online">🟢 SERVIDOR 100% EN LÍNEA</div>
            <p style="color:#e2e8f0; font-size:16px;">Conectado a la línea: <strong>+${connectedUser || '5216673545529'}</strong></p>
            <p style="color:#64748b; font-size:12px;">Escuchando mensajes y asistencias día y noche sin interrupción.</p>
          ` : `
            <div class="badge badge-qr">⚡ ESCANEA PARA VINCULAR</div>
            ${currentQrDataUrl ? `
              <div class="qr-box">
                <img src="${currentQrDataUrl}" alt="Código QR WhatsApp" width="250" height="250">
              </div>
            ` : `
              <p style="color:#94a3b8; font-size:14px; margin: 30px 0;">⏳ Generando código QR...</p>
            `}
            <div class="step-list">
              <strong>Cómo vincular en tu celular:</strong><br>
              1. Abre WhatsApp en tu celular (<strong>667 354 5529</strong>).<br>
              2. Ve a <strong>Ajustes / Configuración</strong> → <strong>Dispositivos vinculados</strong>.<br>
              3. Toca el botón verde <strong>Vincular un dispositivo</strong>.<br>
              4. <strong>Apunta la cámara al código QR</strong> de la pantalla.
            </div>
          `}
        </div>
      </div>
      <script>
        async function checkStatus() {
          try {
            const res = await fetch('/status');
            const data = await res.json();
            if (data.ready) {
              document.getElementById('contentBox').innerHTML = \`
                <div class="badge badge-online">🟢 SERVIDOR 100% EN LÍNEA</div>
                <p style="color:#e2e8f0; font-size:16px;">Conectado a la línea: <strong>+\${data.user || '5216673545529'}</strong></p>
                <p style="color:#64748b; font-size:12px;">Escuchando mensajes y asistencias día y noche sin interrupción.</p>
              \`;
            }
          } catch(e) {}
        }
        setInterval(checkStatus, 3000);
      </script>
    </body>
    </html>
  `);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Servidor HTTP activo en 0.0.0.0:${PORT}`);
});

// Self Keep-Alive para evitar que Render entre en reposo
setInterval(() => {
  const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  http.get(`${appUrl}/status`, () => {}).on('error', () => {});
}, 8 * 60 * 1000);

// =========================================================================
// 🏃‍♂️ MÓDULO RUNNING & INTELIGENCIA DEPORTIVA GARMIN TED ANDREY
// =========================================================================
const ULTIMAS_SESIONES_RUNNING = [
  {
    fecha: 'Martes 21 de Octubre, 2026',
    tipo: 'Rodaje Progresivo en Zona 2-3',
    distanciaKm: 8.52,
    duracion: '49m 12s',
    ritmoMedio: '5:46 min/km',
    ritmoMejorKm: '5:18 min/km (Km 8)',
    fcMedia: 142,
    fcMax: 158,
    cadenciaMedia: 174,
    cadenciaMax: 182,
    calorias: 584,
    zonasFC: { z1: '8%', z2: '62%', z3: '26%', z4: '4%', z5: '0%' },
    tiempoRecuperacionSugerido: '24 horas',
    sensacion: 'Excelente soltura neuromuscular y control de respiración nasal en los primeros 5 km.'
  },
  {
    fecha: 'Domingo 19 de Octubre, 2026',
    tipo: 'Tirada Larga Aeróbica (Fondo)',
    distanciaKm: 14.20,
    duracion: '1h 24m 30s',
    ritmoMedio: '5:57 min/km',
    ritmoMejorKm: '5:40 min/km',
    fcMedia: 139,
    fcMax: 152,
    cadenciaMedia: 172,
    cadenciaMax: 178,
    calorias: 975,
    zonasFC: { z1: '12%', z2: '74%', z3: '14%', z4: '0%', z5: '0%' },
    tiempoRecuperacionSugerido: '36 horas',
    sensacion: 'Fondo limpio con hidratación cada 4 km. Fatiga moderada en sóleos al final.'
  }
];

function obtenerAnalisisSesionCompleto(sesionIndex = 0) {
  const s = ULTIMAS_SESIONES_RUNNING[sesionIndex] || ULTIMAS_SESIONES_RUNNING[0];
  return `🏃‍♂️ *ANÁLISIS BIOMECÁNICO & FISIOLÓGICO GARMIN*\n` +
    `👤 *Atleta:* Lic. Ted Andrey Domínguez | ⌚ *Dispositivo:* Garmin Forerunner\n` +
    `📅 *Sesión:* ${s.fecha}\n` +
    `🎯 *Objetivo:* ${s.tipo}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *1. MÉTRICAS CLAVE DE RENDIMIENTO*\n` +
    `• *Distancia:* ${s.distanciaKm.toFixed(2)} km\n` +
    `• *Tiempo Total:* ${s.duracion}\n` +
    `• *Ritmo Promedio:* ${s.ritmoMedio}\n` +
    `• *Mejor Ritmo:* ${s.ritmoMejorKm}\n` +
    `• *Gasto Calórico:* ${s.calorias} kcal\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `❤️ *2. FISIOLOGÍA CARDIOVASCULAR (ZONAS FC)*\n` +
    `• *FC Media:* ${s.fcMedia} ppm (Línea base aeróbica)\n` +
    `• *FC Máxima:* ${s.fcMax} ppm\n` +
    `• *Zona 1 (Regenerativo <130 ppm):* ${s.zonasFC.z1}\n` +
    `• *Zona 2 (Base Aeróbica 130-145 ppm):* ${s.zonasFC.z2} 🟢 (Dominio metabólico de grasas)\n` +
    `• *Zona 3 (Tempo 146-156 ppm):* ${s.zonasFC.z3}\n` +
    `• *Zona 4 (Umbral 157-168 ppm):* ${s.zonasFC.z4}\n` +
    `• *Zona 5 (VO2 Máx >168 ppm):* ${s.zonasFC.z5}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ *3. BIOMECÁNICA Y CADENCIA*\n` +
    `• *Cadencia Media:* ${s.cadenciaMedia} spm (Pasos por minuto)\n` +
    `• *Cadencia Pico:* ${s.cadenciaMax} spm\n` +
    `• *Eficiencia:* Excelente oscilación vertical al mantener cadencia por encima de 172 spm, reduciendo el impacto en rodillas y caderas.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🧠 *4. DIAGNÓSTICO DEL COACH & CONSEJOS TÁCTICOS*\n` +
    `1. *A cuánto debes correr tu siguiente sesión:* Tu siguiente salida debe ser un *rodaje suave regenerativo de 6 km entre 6:05 y 6:15 min/km*. No aceleres; mantén tu FC estrictamente por debajo de 138 ppm.\n` +
    `2. *Respiración y Economía de Carrera:* En tus ritmos cómodos (Zona 2) mantén un patrón de respiración 3:3 (tres zancadas para inhalar, tres para exhalar). Esto previene tensión en hombros y trapecios.\n` +
    `3. *Cadencia Óptima:* Para tus series o ritmos más vivos (<5:30 min/km), tu objetivo de cadencia es de *178 a 180 spm* dando pasos más cortos y reactivos, no zancadas largas que sobrepasen tu centro de gravedad.\n` +
    `4. *Recuperación Sugerida:* Descanso activo o caminata ligera en las próximas ${s.tiempoRecuperacionSugerido}. Hidratación con electrolitos (sodio + magnesio).\n\n` +
    `_¿Deseas consultar tu histórico de fondos, planificar las series de la semana o revisar la cadencia óptima?_`;
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

    const btcHoldings = 0.00063682;
    const usdtHoldings = 105.85;
    const capitalDepositado = 3000.00;

    const btcValMXN = btcHoldings * btcPrice;
    const usdtValMXN = usdtHoldings * usdtPrice;
    const totalValMXN = btcValMXN + usdtValMXN;
    const diffMXN = totalValMXN - capitalDepositado;
    const diffPct = ((diffMXN / capitalDepositado) * 100).toFixed(2);
    const sign = diffMXN >= 0 
      ? `+$${diffMXN.toFixed(2)} MXN (+$${diffPct}%) 🟢` 
      : `-$${Math.abs(diffMXN).toFixed(2)} MXN ($${diffPct}%) 🔴`;

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
      `• *Ventana de Compra con Descuento:* Bitcoin está testeando soporte. Para conquistar tu meta de 0.001 BTC solo requieres convertir *${usdtParaMeta} USDT* a Bitcoin.\n\n` +
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

  if (/cu[aá]nto debo|a qu[eé] ritmo|a qu[eé] velocidad|mi ritmo|ritmo ideal|siguiente carrera|siguiente salida|entreno de ma[nñ]ana/i.test(q)) {
    return `🏃‍♂️ *Recomendación de Ritmo y Entrenamiento (Coach Ted):*\n\n` +
      `Basado en tu última sesión de 8.52 km a 5:46 min/km con FC de 142 ppm:\n\n` +
      `• *Para tu rodaje de mañana:* Corre entre *6:00 y 6:15 min/km*. Tu objetivo no es la velocidad, es construir capilarización muscular y mitocondrias en *Zona 2 pura* (132 a 140 ppm).\n` +
      `• *Para tu día de calidad (Tempo):* Apunta a sostener *5:20 a 5:25 min/km* por bloques de 15 a 20 minutos (FC 152-156 ppm).\n` +
      `• *Para series cortas (1,000m):* Tu paso objetivo es *4:30 a 4:35 min/km* con recuperación activa de 90 segundos al trote suave.\n\n` +
      `💡 *Regla de oro:* Si no puedes mantener una conversación corta de corrido mientras ruedas en tu sesión suave, estás corriendo demasiado rápido. Baja 15 segundos al paso.`;
  }

  if (/cadencia|zancada|pisada|talon|impacto|rodillas|180|spm/i.test(q)) {
    return `⚡ *Análisis de Cadencia y Biomecánica (Coach Ted):*\n\n` +
      `• *Tu cadencia actual:* Promediaste *174 spm* en tu última sesión. ¡Es un número excelente! Estás dentro del rango ideal (170-180 spm).\n` +
      `• *¿Por qué importa?* A 174 spm tu tiempo de contacto con el suelo es menor a 230 milisegundos. Eso elimina la sobre-zancada y evita sobrecarga rotuliana.\n` +
      `• *Consejo de afinación:* En fatiga, acorta la zancada y acelera el braceo. El tren inferior sigue automáticamente a los codos.`;
  }

  if (/zona|pulsaciones|frecuencia|cardiac|coraz[oó]n|ppm|pecho/i.test(q)) {
    return `❤️ *Control de Zonas Cardíacas (Coach Ted):*\n\n` +
      `Tus zonas personalizadas de entrenamiento:\n` +
      `• *Zona 1 (<130 ppm):* Recuperación activa y regeneración celular.\n` +
      `• *Zona 2 (130 - 145 ppm):* *Tu zona sagrada de base aeróbica.* Oxidación de lípidos.\n` +
      `• *Zona 3 (146 - 156 ppm):* Zona Tempo.\n` +
      `• *Zona 4 (157 - 168 ppm):* Umbral anaeróbico.\n` +
      `• *Zona 5 (>168 ppm):* Potencia aeróbica máxima (VO2 máx).\n\n` +
      `📌 *Diagnóstico:* En tu última sesión el 62% del tiempo estuviste en Zona 2. Tu eficiencia cardiometabólica está en su punto más alto.`;
  }

  if (/dolor|molestia|s[oó]leo|gemelo|pantorrilla|recupera|suplement|creatina|electrolit|agua|descanso/i.test(q)) {
    return `💊 *Protocolo de Recuperación & Cuidado Muscular:*\n\n` +
      `• *Sóleos y Gemelos:* Aplica 10 minutos de Foam Roller suave y estiramiento con rodilla flexionada.\n` +
      `• *Hidratación Táctica:* 500 ml de agua con 300 mg de citrato de magnesio y pizca de sal marina.\n` +
      `• *Sueño reparador:* Recuerda que la síntesis de colágeno se da en fases de sueño profundo. Apunta a 7.5 horas hoy.`;
  }

  if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(q)) {
    return await obtenerReporteCriptoBitso();
  }

  return `🏃‍♂️ *Tu Coach Personal Garmin & Asistente Ejecutivo está listo.*\n\n` +
    `Analizando tu contexto deportivo reciente:\n` +
    `• Registraste *8.52 km a 5:46 min/km* con cadencia de *174 spm* y FC media de *142 ppm*.\n` +
    `• Tu estado cardiovascular es óptimo y tu cuerpo asimiló perfectamente el volumen de la semana.\n\n` +
    `💡 *¿Qué deseas ajustar o consultar hoy?*\n` +
    `1. *Pedir ritmo y distancia sugerida para tu próxima salida.*\n` +
    `2. *Consultar desglose de cadencia y zonas cardíacas Garmin.*\n` +
    `3. *🪙 Ver portafolio Bitso en vivo (BTC / USDT / Meta 0.001 BTC).*\n` +
    `4. *Revisar agenda ejecutiva y compromisos personales.*`;
}

// =========================================================================
// 🏛️ CENTRO DE MANDO MAESTRO TED ANDREY (EXCLUSIVO 6676921223)
// =========================================================================
const PILARES_INFO = {
  PILAR_1_OBRA: {
    id: '1',
    codigo: 'PILAR_1_OBRA',
    titulo: 'División 1: Obra y Edificación Monolítica',
    proyectos: 'Infonavit Álamos del Río / Proyecto Franco Parral'
  },
  PILAR_2_FINANZAS_FISCAL: {
    id: '2',
    codigo: 'PILAR_2_FINANZAS_FISCAL',
    titulo: 'División 2: Fiscal, Corporativo y Tesorería',
    proyectos: 'AMIS Fiscal / TADR Fiscal / Proy. Ejecutivo / Familiar SAT / Moldes SIMA'
  },
  PILAR_3_PERSONAL: {
    id: '3',
    codigo: 'PILAR_3_PERSONAL',
    titulo: 'División 3: Proyectos Personales, Tech & Bienestar',
    proyectos: 'Mercado Cripto Bitso / Garmin Running / SupleAI App / Compras China / Agenda'
  }
};

function getMenuMaestroTed() {
  return `🏛️ *CENTRO DE MANDO ESTRATÉGICO ANTIGRAVITY*\n` +
    `👤 *Lic. Ted Andrey Domínguez Romero*\n\n` +
    `Selecciona la división o frente que deseas consultar:\n\n` +
    `1️⃣ 🏗️ *División 1: Obra y Edificación Monolítica*\n` +
    `   • Proyecto Álamos del Río / Lope\n` +
    `   • Proyecto Franco / Parral\n\n` +
    `2️⃣ 💼 *División 2: Fiscal, Corporativo y Tesorería*\n` +
    `   • AMIS Constructora Fiscal\n` +
    `   • TADR Fiscal\n` +
    `   • Submayor Proyecto Ejecutivo\n` +
    `   • Módulo Familiar Contable\n` +
    `   • Sistema de Moldes SIMA\n\n` +
    `3️⃣ 🌟 *División 3: Proyectos Personales, Tech & Bienestar*\n` +
    `   • Mercado Criptomonedas & Bitso\n` +
    `   • Running Coach & Garmin\n` +
    `   • SupleAI App\n` +
    `   • Compras e Importaciones de China\n` +
    `   • Agenda y Asistente Ejecutivo Personal\n\n` +
    `_Escribe *1*, *2* o *3* para ingresar a una división, o escribe directamente lo que buscas._`;
}

function getSubmenuPilar1() {
  return `🏗️ *DIVISIÓN 1: OBRA Y EDIFICACIÓN MONOLÍTICA*\n` +
    `Has ingresado al contexto de construcción e ingeniería.\n\n` +
    `1️⃣ *Proyecto Álamos del Río / Lope:* 320 viviendas (20 torres), moldes SIMA, anticipo $9.23 MDP en BanBajío.\n` +
    `2️⃣ *Proyecto Franco / Parral:* 684 viviendas Sierra Bonita, muros 10 y 20 cm, visto bueno 7 de oct 2026.\n` +
    `3️⃣ *Requisiciones y Precios de Materiales:* Varilla, cemento, agregados, diésel.\n\n` +
    `_Escribe tu consulta sobre obra, o escribe *menu* para volver al menú maestro._`;
}

function getSubmenuPilar2() {
  return `💼 *DIVISIÓN 2: FISCAL, CORPORATIVO Y TESORERÍA*\n` +
    `Has ingresado al contexto contable, fiscal y bancario.\n\n` +
    `1️⃣ *AMIS Constructora:* Saldos BanBajío (~$9.05 MDP) y dispersión semanal (BanBajío, Darnelix 8%, Roblock 7%).\n` +
    `2️⃣ *TADR Fiscal:* Honorarios, emisión de CFDI y provisión SAT.\n` +
    `3️⃣ *Submayor Proyecto Ejecutivo:* Estado del fondo $360k (50% Ing. Samuel / 50% Ted).\n` +
    `4️⃣ *Módulo Familiar:* Ing. Samuel (anual exenta) y Sra. Isabel (estrategia disminución SAT).\n` +
    `5️⃣ *Sistema de Moldes SIMA:* Costos y activos de moldes.\n\n` +
    `_Escribe tu consulta financiera o fiscal, o escribe *menu* para volver al menú maestro._`;
}

function getSubmenuPilar3() {
  return `🌟 *DIVISIÓN 3: PROYECTOS PERSONALES, TECH & BIENESTAR*\n` +
    `Has ingresado al contexto personal y tecnológico.\n\n` +
    `1️⃣ *🪙 Mercado Criptomonedas & Bitso:* Portafolio en vivo (0.00063682 BTC, 105.85 USDT, meta 0.001 BTC).\n` +
    `2️⃣ *🏃‍♂️ Running Coach & Garmin:* Sesiones Garmin, cadencia, ritmos y zonas cardíacas.\n` +
    `3️⃣ *📱 SupleAI App:* Estado del SaaS de suplementación inteligente y afiliados.\n` +
    `4️⃣ *🇨🇳 Compras en China:* Sourcing directo, catálogos Yupoo, 1688 y casilleros.\n` +
    `5️⃣ *📋 Agenda Ejecutiva:* Pendientes personales y compromisos.\n\n` +
    `_Escribe tu consulta personal o deportiva, o escribe *menu* para volver al menú maestro._`;
}

function detectarPilarDeConsulta(text) {
  const t = (text || '').toLowerCase().trim();

  const matchPersonal = /cripto|bitcoin|btc|bitso|usdt|eth|satoshi|running|garmin|correr|entreno|sesi[oó]n.*ayer|cadencia|ritmo|ppm|pulsaciones|supleai|suplement|creatina|china|yupoo|1688|taobao|casillero|agenda.*personal|compromiso.*personal/i.test(t);
  const matchFiscal = /banbaj[ií]o|cuenta.*maestra|saldo.*amis|darnelix|roblock|asimilables?|factura.*tadr|honorarios?.*ted|retenci[oó]n|dort780211|aco241114|submayor|proyecto ejecutivo|360k|isabel romero|samuel dom[ií]nguez.*sat|declaraci[oó]n.*anual|impuestos?|provisi[oó]n sat|diot|n[oó]mina.*semanal|tabulador/i.test(t);
  const matchObra = /alamos|[aá]lamos|lope|franco|parral|sierra bonita|muro|moldes?|vivienda|torre|concreto|varilla|cemento|di[eé]sel|arena|grava|cuadrilla|colado|residente|destajo.*obra/i.test(t);

  if (matchPersonal && !matchObra && !matchFiscal) return 'PILAR_3_PERSONAL';
  if (matchFiscal && !matchObra && !matchPersonal) return 'PILAR_2_FINANZAS_FISCAL';
  if (matchObra && !matchFiscal && !matchPersonal) return 'PILAR_1_OBRA';
  return null;
}

async function responderConsultaPilar(pilar, query) {
  const q = (query || '').toLowerCase().trim();

  // Respuestas División 1: Obra
  if (pilar === 'PILAR_1_OBRA') {
    if (/franco|parral|sierra bonita/i.test(q) || q === '2') {
      return `⛏️ *Proyecto Franco / Parral (SIMA - Chihuahua)*\n\n` +
        `• *Alcance:* 684 viviendas en edificios cuádruplex (prototipo Sierra Bonita).\n` +
        `• *Estatus de Planos:* Visto bueno definitivo del martes 7 de octubre de 2026 (13 láminas ejecutivas autorizadas).\n` +
        `• *Espesores de Muro:* Cero muros de 12 cm. Muros de *10 cm* (carga y colindancias) y *20 cm* (instalaciones sanitarias/bajantes y fachada de acceso).\n` +
        `• *Honorarios Estructurales:* $240,000 + IVA (bonificables si contratan antes del 15 de diciembre de 2026).\n` +
        `• *Exclusividad SIMA:* Franco edifica hasta 100 tradicionales; mínimo 584 exclusivas para AMIS.`;
    }
    if (/alamos|[aá]lamos|lope|infonavit/i.test(q) || q === '1') {
      return `🏢 *Proyecto Infonavit Álamos del Río (AMIS SIMA)*\n\n` +
        `• *Alcance:* 320 viviendas (20 torres de 4 niveles).\n` +
        `• *Monto Contrato:* $54,337,280.00 MXN ($169,804.00/viv exento de IVA).\n` +
        `• *Cobranza:* Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en CFDI VIV-2 en BanBajío.\n` +
        `• *Condición Suspensiva:* Plazos congelados hasta cumplimiento total del Día 'D' (dictamen de uso de suelo + planos autorizados).\n` +
        `• *Rotación:* Estricta rotación de 24 horas por nivel de molde SIMA.`;
    }
    if (/material|precio|cemento|varilla|di[eé]sel|arena|grava/i.test(q) || q === '3') {
      return `🏗️ *Catálogo de Precios de Materiales (Compras AMIS):*\n\n` +
        `• *Cemento Gris Tolteca 50kg:* $245.00 MXN / Saco\n` +
        `• *Varilla 3/8" (No. 3):* $178.50 MXN / Tramo 12m\n` +
        `• *Varilla 1/2" (No. 4):* $312.00 MXN / Tramo 12m\n` +
        `• *Alambre Recocido Cal. 16:* $38.50 MXN / Kg\n` +
        `• *Arena Triturada:* $480.00 MXN / M3 | *Grava 3/4":* $520.00 MXN / M3\n` +
        `• *Diésel Automotriz:* $25.80 MXN / Litro\n\n` +
        `_Precios de mercado reales auditados contra facturas de compras recientes._`;
    }
    return `🏗️ *División 1 (Obra):* Registrada consulta sobre *"${query.slice(0, 50)}"*. Puedes solicitar avance de Álamos del Río, detalles técnicos de Parral o cotización de insumos.`;
  }

  // Respuestas División 2: Fiscal / Finanzas
  if (pilar === 'PILAR_2_FINANZAS_FISCAL') {
    if (/saldo|banbaj[ií]o|banco|tesorer[ií]a|amis/i.test(q) || q === '1') {
      return `💼 *Tesorería & Fiscal AMIS Constructora (ACO241114A70):*\n\n` +
        `• *Cuenta BanBajío Maestra:* 476863400201\n` +
        `• *Saldo Auditoría:* ~$9,050,000.00 MXN (Anticipo Álamos blindado).\n` +
        `• *Vías de Dispersión Semanal (Viernes):*\n` +
        `  1. *Fiscal Directa BanBajío:* Solo trabajadores con alta IMSS y timbrado Nominax.\n` +
        `  2. *DARNELIX Asimilables (8%):* $62,500.00 netos ($12,500 c/u para los 5 socios). Depósito: $67,129.63 MXN.\n` +
        `  3. *CONSTRUCTORA ROBLOCK (7%):* Destajos, sobrenóminas SPEI y raya en efectivo.`;
    }
    if (/tadr|honorario.*ted|dort780211|consultor[ií]a/i.test(q) || q === '2') {
      return `💼 *Contabilidad Personal TADR (RFC: DORT780211CQ5):*\n\n` +
        `• *Régimen:* Actividad Empresarial y Servicios Profesionales / Consultoría.\n` +
        `• *Directiva Espejo AMIS:* En facturas para reparto de socios se retiene 10% ISR y 10.67% IVA, apartando bolsa SAT (5.33% IVA residual + ISR).\n` +
        `• *Asesorías Propias:* 100% ingreso exclusivo de Ted Andrey.\n` +
        `• *Libro Maestro:* Control_Fiscal_y_Facturacion_2026_TADR.xlsx.`;
    }
    if (/submayor|proyecto ejecutivo|360k/i.test(q) || q === '3') {
      return `📑 *Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN):*\n\n` +
        `• *Titularidad:* 50% Ing. Samuel Domínguez / 50% Lic. Ted Andrey.\n` +
        `• *Anticipo Cobrado:* $100,000.00 MXN (CFDI VIV-1).\n` +
        `• *Saldo por Cobrar:* $260,000.00 MXN.\n` +
        `• *Aislamiento:* Cuenta corriente 100% independiente de los repartos ordinarios de socios.`;
    }
    if (/familiar|isabel|samuel.*sat|anual/i.test(q) || q === '4') {
      return `👨‍👩‍👧 *Módulo Fiscal Familiar (AntiGravity Fiscal Familiar):*\n\n` +
        `1. *Ing. Samuel Domínguez (DORS510222UA2):* Régimen 606 (Dividendos) + 605 (Asimilados). Solo presenta Anual en Abril. Estatus: 100% blindado.\n` +
        `2. *Sra. Isabel Romero (ROGI561130NM0):* Alerta SAT activa por régimen 612. Acción prioritaria: Tramitar Disminución de Obligaciones ante SAT para dejarla solo en Sueldos/Asimilados.`;
    }
    if (/sima|molde|mantenimiento/i.test(q) || q === '5') {
      return `⚙️ *Sistema de Moldes SIMA (Activos & Operación):*\n\n` +
        `• *Juegos de Moldes:* Equipos monolíticos de aluminio de alta resistencia para muros y losas.\n` +
        `• *Rotación Oficial:* 24 horas continuas de fraguado y descimbrado por nivel.\n` +
        `• *Mantenimiento:* Supervisión a cargo de Bladimir Beltrán y reposición de herrajes/esquineros autorizados.`;
    }
    return `💼 *División 2 (Finanzas):* Registrada consulta sobre *"${query.slice(0, 50)}"*. Puedes consultar bancos, TADR, dispersión semanal o módulo familiar.`;
  }

  // Respuestas División 3: Personal / Tech
  if (pilar === 'PILAR_3_PERSONAL') {
    if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(q) || q === '1') {
      return await obtenerReporteCriptoBitso();
    }
    if (/running|garmin|correr|entreno|sesi[oó]n|cadencia|ritmo|pulso|ppm|fc|zona/i.test(q) || q === '2') {
      if (/ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis/i.test(q)) {
        return obtenerAnalisisSesionCompleto(0);
      }
      return await responderCoachIA(query);
    }
    if (/supleai|suplement|app/i.test(q) || q === '3') {
      return `📱 *SupleAI App (SaaS de Suplementación Inteligente):*\n\n` +
        `• *Arquitectura:* Frontend React Native multiplataforma + Backend FastAPI.\n` +
        `• *Monetización:* Deep-linking de suplementos recomendados vía programas de afiliados (Amazon México y Mercado Libre).\n` +
        `• *Blindaje Médico:* Regla de exclusión estricta para embarazo, lactancia y patologías crónicas.\n` +
        `• *Estatus:* Base de datos de ingredientes activos y compatibilidad fisiológica configurada.`;
    }
    if (/china|yupoo|1688|taobao|casillero|sourcing/i.test(q) || q === '4') {
      return `🇨🇳 *Compras en China & Abastecimiento Internacional:*\n\n` +
        `• *Fábricas y Plataformas:* Conexión directa OEM/ODM en 1688, Taobao y catálogos Yupoo.\n` +
        `• *Agentes y Casilleros:* Operación vía CSSBuy / Sugargoo para consolidación en bodega de China y US Closer para USA.\n` +
        `• *Protocolo de Inspección:* Control de calidad (QC) con fotos HD, verificación de medidas en cm e instrucción 'Drop Box' para aligerar peso volumétrico y blindar aduana.\n` +
        `• *Repositorio:* Expediente exclusivo en 06_COMPRAS_CHINAS.`;
    }
    if (/agenda|pendiente|compromiso|reuni[oó]n/i.test(q) || q === '5') {
      return `📋 *Agenda Ejecutiva Personal (Lic. Ted):*\n\n` +
        `• Asistente personal y coach activos 24/7.\n` +
        `• Monitoreo de portafolio Bitso sincronizado con precios en vivo.\n` +
        `• Reporte nocturno de running y recordatorios matutinos configurados.\n\n` +
        `_Todo en orden. ¿Deseas agendar alguna actividad o recordatorio específico?_`;
    }
    return await responderCoachIA(query);
  }

  return null;
}

async function startWhatsAppBot() {
  try {
    console.log('🚀 Iniciando conexión Baileys Multi-Device con persistencia en MongoDB Atlas...');
    const { state, saveCreds } = await useMongoAuthState();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📡 Versión negociada de WhatsApp Web: v${version.join('.')}`);

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQrData = qr;
        currentQrDataUrl = await QRCode.toDataURL(qr);
        console.log('⚡ Nuevo código QR generado para vinculación.');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`🔌 Conexión cerrada. Reconectando: ${shouldReconnect}`);
        isClientReady = false;
        if (shouldReconnect) {
          setTimeout(startWhatsAppBot, 3000);
        }
      } else if (connection === 'open') {
        console.log('🟢 ¡CONEXIÓN ESTABLECIDA CON ÉXITO A WHATSAPP!');
        isClientReady = true;
        currentQrData = null;
        currentQrDataUrl = null;
        connectedUser = sock.user?.id ? sock.user.id.split(':')[0] : '5216673545529';
      }
    });

    sock.ev.on('creds.update', saveCreds);

    const recentUserMessages = new Map();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid;
          const participant = msg.key.participant || '';
          const fullSender = `${remoteJid}_${participant}`;
          const cleanSender = remoteJid.replace(/[^0-9]/g, '');

          const body = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.documentMessage?.caption ||
            ''
          ).trim();

          const hasMedia = !!(msg.message.imageMessage || msg.message.documentMessage || msg.message.audioMessage);

          // Registro forense en MongoDB
          if (mongoClient) {
            try {
              const db = mongoClient.db('amis_whatsapp');
              await db.collection('debug_inbox').insertOne({
                remoteJid,
                participant,
                fromMe: msg.key.fromMe,
                body,
                date: new Date()
              });
            } catch (e) {}
          }

          // Anti-duplicados (4 segundos)
          const dedupKey = `${cleanSender}:${body.toLowerCase()}`;
          const now = Date.now();
          if (recentUserMessages.has(dedupKey) && (now - recentUserMessages.get(dedupKey) < 4000)) {
            continue;
          }
          recentUserMessages.set(dedupKey, now);

          const targetJid = remoteJid;
          const config = loadConfig();

          // =====================================================================
          // 1. REGLA DE GRUPOS DE WHATSAPP
          // =====================================================================
          if (remoteJid.endsWith('@g.us')) {
            const GRUPO_COACH_TED_JID = '120363432696055179@g.us';
            if (remoteJid === GRUPO_COACH_TED_JID) {
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
                  `_O pregúntame directamente cualquier duda._`;
                await sock.sendMessage(targetJid, { text: menuCoach });
                continue;
              }

              if (/ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis.*rutina|an[aá]lisis.*sesi[oó]n|an[aá]lisis.*ayer/i.test(lowerBody) || lowerBody === '1') {
                const analisisSesion = obtenerAnalisisSesionCompleto(0);
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

              const coachRespuesta = await responderCoachIA(body);
              await sock.sendMessage(targetJid, { text: coachRespuesta });
              continue;
            }

            continue;
          }

          // =====================================================================
          // 2. 🏛️ RECONOCIMIENTO DIRECTO Y EXCLUSIVO: LIC. TED ANDREY (6676921223)
          // =====================================================================
          const isTed = fullSender.includes('6676921223') ||
                        fullSender.includes('6672921223') ||
                        fullSender.includes('107194381013064') ||
                        cleanSender.endsWith('6676921223') ||
                        cleanSender.endsWith('6672921223') ||
                        cleanSender === '107194381013064';

          const sessionKey = isTed ? '6676921223' : cleanSender;
          if (!userSessions[sessionKey]) {
            userSessions[sessionKey] = { state: 'IDLE', updatedAt: Date.now(), lastGreetingTime: 0, history: [] };
          }
          userSessions[remoteJid] = userSessions[sessionKey];
          const userState = userSessions[sessionKey];
          if (!userState.history) userState.history = [];

          const lowerBody = body.toLowerCase().trim();
          const isReset = ['menu', 'menú', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);

          if (isTed) {
            console.log(`[CENTRO DE MANDO TED] Mensaje de Ted: "${body}" | Estado: ${userState.activePillar || 'IDLE'}`);

            // 1. Saludo, Menú o Reset: SIEMPRE abre el Menú Maestro
            if (isReset || /^(hola|buenos d[ií]as|buenas|empezar|inicio|men[uú]|help|ayuda)$/i.test(lowerBody)) {
              userState.activePillar = null;
              userState.waitingPillarConfirmation = false;
              userState.pendingQuery = null;
              userState.pendingTargetPillar = null;
              saveSessions();
              await sock.sendMessage(targetJid, { text: getMenuMaestroTed() });
              continue;
            }

            // 2. Confirmación de cambio de división
            if (userState.waitingPillarConfirmation && userState.pendingTargetPillar) {
              const affirmative = /^(s[ií]|cambiar|cambia|ok|adelante|va|dale|claro|si por favor|afirmativo)$/i.test(lowerBody);
              const negative = /^(no|cancela|quedate|sigue|permanecer|no cambiar)$/i.test(lowerBody);

              if (affirmative) {
                const targetPillar = userState.pendingTargetPillar;
                const savedQuery = userState.pendingQuery;
                userState.activePillar = targetPillar;
                userState.waitingPillarConfirmation = false;
                userState.pendingQuery = null;
                userState.pendingTargetPillar = null;
                saveSessions();

                const pInfo = PILARES_INFO[targetPillar];
                let ackChange = `🔄 *Contexto cambiado exitosamente a la ${pInfo.titulo}*\n\n`;
                if (savedQuery) {
                  const queryReply = await responderConsultaPilar(targetPillar, savedQuery);
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
                saveSessions();
                await sock.sendMessage(targetJid, {
                  text: `✅ Entendido. Nos mantenemos en la *${curPInfo.titulo}*. ¿Qué deseas consultar de este proyecto? (O escribe *menu* para volver a la raíz).`
                });
                continue;
              }
            }

            // 3. Selección directa de División desde el Menú Maestro
            if (!userState.activePillar) {
              if (lowerBody === '1' || /divisi[oó]n 1|pilar 1|obra/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_1_OBRA';
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar1() });
                continue;
              } else if (lowerBody === '2' || /divisi[oó]n 2|pilar 2|fiscal|finanzas/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_2_FINANZAS_FISCAL';
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar2() });
                continue;
              } else if (lowerBody === '3' || /divisi[oó]n 3|pilar 3|personal/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_3_PERSONAL';
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar3() });
                continue;
              }
            }

            // 4. Auditoría de contexto cruzado
            const detectedPillar = detectarPilarDeConsulta(body);
            if (userState.activePillar && detectedPillar && detectedPillar !== userState.activePillar) {
              userState.waitingPillarConfirmation = true;
              userState.pendingQuery = body;
              userState.pendingTargetPillar = detectedPillar;
              saveSessions();

              const currentPInfo = PILARES_INFO[userState.activePillar];
              const targetPInfo = PILARES_INFO[detectedPillar];

              const warningMsg = `⚠️ *Lic. Ted, actualmente te encuentras en la ${currentPInfo.titulo}.*\n\n` +
                `Tu consulta corresponde a la *${targetPInfo.titulo}* (${targetPInfo.proyectos}).\n\n` +
                `¿Deseas que cambiemos de contexto a esa división?\n` +
                `👉 Responde *Sí* para cambiar y ver la respuesta, o continúa con tus temas de esta división (o escribe *menu*).`;

              await sock.sendMessage(targetJid, { text: warningMsg });
              continue;
            }

            // 5. Procesar consulta dentro de la división activa
            const effectivePillar = userState.activePillar || detectedPillar || 'PILAR_1_OBRA';
            const pillarReply = await responderConsultaPilar(effectivePillar, body);
            if (pillarReply) {
              await sock.sendMessage(targetJid, { text: pillarReply });
              continue;
            }

            // 6. Mensaje por defecto de Ted (NUNCA sale a público)
            const defaultTedMsg = `🏛️ *Centro de Mando Antigravity (Lic. Ted Andrey)*\n\n` +
              `No identifiqué una instrucción específica para "${body.slice(0, 40)}".\n\n` +
              `👉 Escribe *menu* para ver las 3 Divisiones Maestras, o selecciona *1*, *2* o *3* para ingresar a una división.`;
            await sock.sendMessage(targetJid, { text: defaultTedMsg });
            continue;
          }

          // =====================================================================
          // 3. RESTO DE USUARIOS: BLINDAJE DE SEGURIDAD (NO TIENEN ACCESO A TED)
          // =====================================================================
          const authUser = getAuthorizedUser(cleanSender, config, fullSender);

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
            await sock.sendMessage(targetJid, { text: menuText });
            continue;
          }

          const extractDigit = (str) => {
            const match = str.match(/^[#*]*([0-9]+)/) || str.match(/([0-9]+)/);
            return match ? match[1] : null;
          };
          const choiceDigit = extractDigit(body);

          if (userState.state === 'IDLE') {
            const isExpenseIntent = hasMedia || 
              /^(subir|adjunt|mando|envi|va|tengo|subo)\s*(la|una|las)?\s*(factura|comprobante|ticket|nota|gasto)/i.test(lowerBody) ||
              (choiceDigit === '5' && authUser.role === 'GERENTE_ADMINISTRATIVO') ||
              (choiceDigit === '1' && authUser.role !== 'GERENTE_ADMINISTRATIVO');

            if (isExpenseIntent) {
              if (hasMedia) {
                const currentCount = 1;
                userSessions[remoteJid].state = 'EXPENSE';
                userSessions[remoteJid].expenseCount = currentCount;
                userSessions[remoteJid].updatedAt = Date.now();

                let directAck = '';
                if (body) {
                  userSessions[remoteJid].waitingConcept = false;
                  userSessions[remoteJid].lastExpenseConcept = body;
                  await guardarEnBuzonGastos(authUser, cleanSender, currentCount, body, hasMedia);

                  directAck = `🧾 *Comprobante / Factura #1 Registrada con Éxito*\n\n` +
                    `📝 *Destino / Concepto:* "${body}"\n` +
                    `✅ Turnado a la Mesa de Control para validación del Lic. Ted.\n\n` +
                    `📎 *Puedes enviar la siguiente factura directamente* (o escribe _'listo'_ cuando termines).\n\n` +
                    `👉 _Escribe *menu* en cualquier momento para volver._`;
                } else {
                  userSessions[remoteJid].waitingConcept = true;
                  userSessions[remoteJid].waitingIndex = currentCount;
                  await guardarEnBuzonGastos(authUser, cleanSender, currentCount, 'Sin descripción previa', hasMedia);

                  directAck = `🧾 *Comprobante / Factura #1 Registrada con Éxito*\n\n` +
                    `✅ Archivo resguardado en la Mesa de Control de AMIS.\n\n` +
                    `💡 *Dato opcional:* Si gustas, escribe brevemente para qué se utilizó o a qué vehículo/área corresponde.\n` +
                    `O si prefieres, *envía directamente la siguiente factura* o escribe _'listo'_.`;
                }

                saveSessions();
                await sock.sendMessage(targetJid, { text: directAck });
                continue;
              } else {
                userSessions[remoteJid].state = 'EXPENSE';
                userSessions[remoteJid].expenseCount = 0;
                userSessions[remoteJid].waitingConcept = false;
                userSessions[remoteJid].updatedAt = Date.now();
                saveSessions();

                const promptMsg = `🧾 *Recepción de Facturas y Comprobantes*\n\n` +
                  `¡Adelante, ${authUser.name}! 🫡 Adjunta los archivos PDF/XML o fotos de tus notas/facturas.\n` +
                  `💡 _Puedes agregar una breve nota con el destino del gasto._\n` +
                  `Puedes enviar varias de forma continua; se registrarán una por una en la Mesa de Control.\n\n` +
                  `_Escribe *menu* o *listo* cuando termines._`;

                await sock.sendMessage(targetJid, { text: promptMsg });
                continue;
              }
            }

            if (authUser.role !== 'GERENTE_ADMINISTRATIVO') {
              const availableOptions = (config.options || []).filter(opt => {
                if (!opt.allowed_roles || opt.allowed_roles.length === 0) return true;
                return opt.allowed_roles.includes(authUser.role);
              });
              const selectedOpt = availableOptions.find(o => o.id === choiceDigit || o.id === body);
              if (selectedOpt) {
                if (selectedOpt.allowed_roles && !selectedOpt.allowed_roles.includes(authUser.role)) {
                  const deniedMsg = `⛔ *Opción no disponible para su perfil.*\n\nEl módulo de *${selectedOpt.title}* es de acceso restringido.\n\nEscriba *menu* para ver sus opciones disponibles.`;
                  await sock.sendMessage(targetJid, { text: deniedMsg });
                  continue;
                }

                if (selectedOpt.code === 'EXPENSE') {
                  userSessions[remoteJid].state = 'EXPENSE';
                  userSessions[remoteJid].expenseCount = 0;
                  userSessions[remoteJid].waitingConcept = false;
                  userSessions[remoteJid].updatedAt = Date.now();
                  saveSessions();
                  await sock.sendMessage(targetJid, { text: selectedOpt.prompt });
                  continue;
                }

                if (selectedOpt.code === 'ATTENDANCE') {
                  userSessions[remoteJid].state = 'ATTENDANCE_MENU';
                  userSessions[remoteJid].updatedAt = Date.now();
                  saveSessions();
                  await sock.sendMessage(targetJid, { text: selectedOpt.prompt });
                  continue;
                }

                userSessions[remoteJid].state = selectedOpt.code;
                userSessions[remoteJid].optionId = selectedOpt.id;
                userSessions[remoteJid].updatedAt = Date.now();
                saveSessions();
                await sock.sendMessage(targetJid, { text: selectedOpt.prompt });
                continue;
              }
            }

            console.log(`[AI] Generando respuesta para ${authUser.name}...`);
            const replyText = await generateConversationalReply(body, authUser, null, userSessions[remoteJid]);
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();
            await sock.sendMessage(targetJid, { text: replyText });
            continue;
          }

          if (userState.state === 'EXPENSE') {
            if (['listo', 'ya', 'ya son todas', 'todas', 'termine', 'terminé', 'fin', 'ya quedo', 'ya quedó', 'seria todo', 'sería todo', 'gracias', 'ok', 'nada mas', 'nada más'].includes(lowerBody)) {
              const count = userSessions[remoteJid].expenseCount || 0;
              userSessions[remoteJid].state = 'IDLE';
              userSessions[remoteJid].expenseCount = 0;
              userSessions[remoteJid].waitingConcept = false;
              userSessions[remoteJid].updatedAt = Date.now();
              saveSessions();

              const doneMsg = `✅ *Recepción de Comprobantes Finalizada*\n\n` +
                `📁 Se resguardaron exitosamente ${count > 0 ? count + ' comprobante(s)' : 'los comprobantes'} en la Mesa de Control para validación del Lic. Ted.\n\n` +
                `_Escribe *menu* o continúa conversando si requieres revisar otro tema._`;

              await sock.sendMessage(targetJid, { text: doneMsg });
              continue;
            }

            if (!hasMedia && userSessions[remoteJid].waitingConcept) {
              const targetIdx = userSessions[remoteJid].waitingIndex || userSessions[remoteJid].expenseCount || 1;
              userSessions[remoteJid].waitingConcept = false;
              userSessions[remoteJid].lastExpenseConcept = body;
              userSessions[remoteJid].updatedAt = Date.now();
              saveSessions();

              await actualizarConceptoBuzon(cleanSender, targetIdx, body);

              const noteAck = `📝 *Destino / Concepto anotado para el Comprobante #${targetIdx}:*\n` +
                `"${body}"\n\n` +
                `✅ Información vinculada en la Mesa de Control.\n` +
                `📎 *Puedes enviar la siguiente factura* (o escribe _'listo'_ para finalizar).`;

              await sock.sendMessage(targetJid, { text: noteAck });
              continue;
            }

            if (hasMedia) {
              const currentCount = (userSessions[remoteJid].expenseCount || 0) + 1;
              userSessions[remoteJid].expenseCount = currentCount;
              userSessions[remoteJid].updatedAt = Date.now();

              let ackMsg = '';
              if (body) {
                userSessions[remoteJid].waitingConcept = false;
                userSessions[remoteJid].lastExpenseConcept = body;
                await guardarEnBuzonGastos(authUser, cleanSender, currentCount, body, hasMedia);

                ackMsg = `🧾 *Comprobante / Factura #${currentCount} Registrada con Éxito*\n\n` +
                  `📝 *Destino / Concepto:* "${body}"\n` +
                  `✅ Turnado a la Mesa de Control para validación del Lic. Ted.\n\n` +
                  `📎 *Puedes enviar la siguiente factura directamente* (o escribe _'listo'_ cuando termines).\n\n` +
                  `👉 _Escribe *menu* para volver al menú principal._`;
              } else {
                userSessions[remoteJid].waitingConcept = true;
                userSessions[remoteJid].waitingIndex = currentCount;
                await guardarEnBuzonGastos(authUser, cleanSender, currentCount, 'Sin descripción previa', hasMedia);

                ackMsg = `🧾 *Comprobante / Factura #${currentCount} Registrada con Éxito*\n\n` +
                  `✅ Archivo resguardado en la Mesa de Control de AMIS.\n\n` +
                  `💡 *Dato opcional:* Si gustas, escribe brevemente para qué se utilizó o a qué vehículo/área corresponde.\n` +
                  `O si prefieres, *envía directamente la siguiente factura* o escribe _'listo'_.`;
              }

              saveSessions();
              await sock.sendMessage(targetJid, { text: ackMsg });
              continue;
            }

            const currentCount = (userSessions[remoteJid].expenseCount || 0) + 1;
            userSessions[remoteJid].expenseCount = currentCount;
            userSessions[remoteJid].waitingConcept = false;
            userSessions[remoteJid].lastExpenseConcept = body;
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();

            await guardarEnBuzonGastos(authUser, cleanSender, currentCount, body, false);

            const manualAck = `🧾 *Nota de Gasto #${currentCount} Registrada*\n\n` +
              `📝 *Detalle / Concepto:* "${body}"\n` +
              `✅ Turnado a la Mesa de Control para validación del Lic. Ted.\n\n` +
              `📎 *Puedes enviar el siguiente comprobante* (o escribe _'listo'_ cuando termines).\n\n` +
              `👉 _Escribe *menu* para volver al menú principal._`;

            await sock.sendMessage(targetJid, { text: manualAck });
            continue;
          }

          if (userState.state === 'CONSULTA_FRANCO') {
            if (['menu', 'menú', 'cancelar', 'salir', 'inicio'].includes(lowerBody)) {
              userSessions[remoteJid].state = 'IDLE';
              userSessions[remoteJid].updatedAt = Date.now();
              saveSessions();
              const menuText = buildMainMenu(authUser, config);
              await sock.sendMessage(targetJid, { text: menuText });
              continue;
            }

            const replyFranco = await generateConversationalReply(body, authUser, null, userSessions[remoteJid]);
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();
            await sock.sendMessage(targetJid, { text: replyFranco });
            continue;
          }

          if (userState.state === 'ATTENDANCE_MENU') {
            if (choiceDigit === '1') {
              userSessions[remoteJid] = { state: 'ATTENDANCE_DAILY', updatedAt: Date.now() };
              saveSessions();
              await sock.sendMessage(targetJid, { text: `📸 *Lista de Asistencia Diaria*\n\nPor favor adjunta la *foto de la lista de raya firmada* o escribe el conteo de personal presente hoy (ej: _'14 presentes en obra Álamos'_).\n\n_Escribe *menu* para cancelar._` });
              continue;
            } else if (choiceDigit === '2') {
              userSessions[remoteJid] = { state: 'ATTENDANCE_ABSENCE', updatedAt: Date.now() };
              saveSessions();
              await sock.sendMessage(targetJid, { text: `❌ *Reporte de Faltas / Bajas*\n\nPor favor escribe el *nombre del trabajador, puesto y motivo de falta o baja* (ej: _'Faltó Juan Pérez - Fierrero - Falta injustificada'_).\n\n_Escribe *menu* para cancelar._` });
              continue;
            } else if (choiceDigit === '3') {
              userSessions[remoteJid] = { state: 'ATTENDANCE_HIRE', updatedAt: Date.now() };
              saveSessions();
              await sock.sendMessage(targetJid, { text: `🆕 *Registro de Nuevo Ingreso / Alta*\n\nPor favor escribe los *datos del nuevo trabajador* (Nombre completo, Puesto y Fecha de ingreso. Ej: _'Pedro López - Albañil - Ingresa hoy'_).\n\n_Escribe *menu* para cancelar._` });
              continue;
            }
          }

          userSessions[remoteJid] = { state: 'IDLE', updatedAt: Date.now() };
          saveSessions();
          await sock.sendMessage(targetJid, { text: `✅ *Información Recibida y Asentada con Éxito*\n\n_Escribe *menu* para ver el menú principal._` });

        } catch (err) {
          console.error('Error procesando mensaje Baileys:', err);
        }
      }
    });
  } catch (err) {
    console.error('Error inicializando WhatsApp Bot:', err);
  }
}

startWhatsAppBot();
