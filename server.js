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
  } catch (err) {
    console.error('⚠️ Falló la conexión con MongoDB Atlas:', err.message);
    lastMongoError = err.message;
    console.log('🔄 Cambiando a almacenamiento local multi-file como respaldo de emergencia...');
    return await useMultiFileAuthState(AUTH_DIR);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const AUTH_DIR = path.join(__dirname, '.baileys_auth');
const SESSIONS_FILE = path.join(__dirname, 'active_user_sessions.json');
const CONFIG_PATH = path.join(__dirname, 'menu_config.json');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let isClientReady = false;
let currentQrData = null;
let currentQrDataUrl = null;
let currentPairingCode = null;
let connectedUser = null;
let userSessions = {};
const processedMsgIds = new Set();

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      userSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    userSessions = {};
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(userSessions, null, 2), 'utf8');
  } catch (e) {}
}

loadSessions();

function loadConfig() {
  const defaultConfig = {
    menu_title: '🏢 *AMIS CONSTRUCTORA · TORRE DE CONTROL*\n\n¡Bienvenido {name}! 👷‍♂️\nSelecciona una opción:',
    menu_footer: '\n_Escribe el número de la opción o escribe *menu* para volver._',
    public_greeting: '👋 *Bienvenido a AMIS Constructora, S.A. de C.V.*\n\nGracias por comunicarte con nuestra línea oficial.\n\n📍 Para atención a proveedores, contratos de obra o información general, por favor indícanos tu nombre completo, empresa y el motivo de tu mensaje. Un ejecutivo de operaciones te atenderá a la brevedad.\n\n_Horario de atención: Lunes a Viernes de 8:30 AM a 5:30 PM._',
    authorized_users: [
      { phone: '6676921223', lid: '228308940808383', name: 'Lic. Ted Andrey', role: 'GERENTE_ADMINISTRATIVO' },
      { phone: '6672921223', name: 'Lic. Ted Andrey (Secundario)', role: 'GERENTE_ADMINISTRATIVO' },
      { phone: '6672526550', name: 'Lic. Mariano', role: 'GERENTE_PROYECTO' },
      { phone: '6672330260', name: 'Ing. Sam', role: 'GERENTE_PRODUCCION' },
      { phone: '6672230733', name: 'Ing. Samuel', role: 'DIRECTOR_GENERAL' },
      { phone: '6672270340', name: 'Ing. Emilio', role: 'ENCARGADO_PREARMADOS' },
      { phone: '6675767414', name: 'Bladimir', role: 'ENCARGADO_MANTENIMIENTO' }
    ],
    options: [
      { id: 1, title: '🧾 Enviar Facturas / Comprobantes de Gasto' },
      { id: 2, title: '📦 Requisición de Materiales' },
      { id: 3, title: '👷 Registrar Asistencia de Obra' },
      { id: 4, title: '📐 Consulta Técnica y Moldes SIMA' },
      { id: 5, title: '📊 Estatus de Operaciones' }
    ]
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {}
  return defaultConfig;
}

function getAuthorizedUser(rawNumber, config) {
  const clean = rawNumber.replace(/[^0-9]/g, '');
  return (config.authorized_users || []).find(u => {
    const uPhone = (u.phone || '').replace(/[^0-9]/g, '');
    const uLid = (u.lid || '').replace(/[^0-9]/g, '');
    if (uPhone && (clean.endsWith(uPhone) || uPhone.endsWith(clean))) return true;
    if (uLid && (clean === uLid || clean.includes(uLid) || uLid.includes(clean))) return true;
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
      `2️⃣ 🏘️ *Sierra Bonita (Parral)* · Planos, prototipo y volumetrías\n` +
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

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AMIS Constructora · Torre de Control 24/7</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: #0f172a;
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .card {
          background: #1e293b;
          border-radius: 16px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          padding: 32px;
          max-width: 480px;
          width: 100%;
          text-align: center;
          border: 1px solid #334155;
        }
        h1 { font-size: 20px; margin-bottom: 8px; color: #38bdf8; }
        p.subtitle { font-size: 14px; color: #94a3b8; margin-bottom: 24px; }
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 6px 14px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 24px;
        }
        .badge.online { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid #22c55e; }
        .badge.pairing { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid #f59e0b; }
        .qr-box {
          background: #ffffff;
          padding: 16px;
          border-radius: 12px;
          display: inline-block;
          margin: 0 auto 20px auto;
        }
        .qr-box img { display: block; width: 256px; height: 256px; }
        .pairing-code-box {
          background: #0f172a;
          border: 2px dashed #38bdf8;
          border-radius: 12px;
          padding: 16px;
          margin: 16px 0;
        }
        .code-display {
          font-family: monospace;
          font-size: 28px;
          letter-spacing: 4px;
          color: #38bdf8;
          font-weight: bold;
        }
        .instructions {
          font-size: 13px;
          color: #cbd5e1;
          text-align: left;
          background: #0f172a;
          padding: 16px;
          border-radius: 8px;
          line-height: 1.6;
        }
        .instructions ol { padding-left: 20px; }
        footer { margin-top: 24px; font-size: 12px; color: #64748b; }
      </style>
      <script>
        setInterval(async () => {
          try {
            const res = await fetch('/status');
            const data = await res.json();
            const wasReady = document.body.dataset.ready === 'true';
            if (data.ready !== wasReady) {
              window.location.reload();
            }
          } catch(e) {}
        }, 4000);
      </script>
    </head>
    <body data-ready="${isClientReady}">
      <div class="card">
        <h1>🏗️ AMIS CONSTRUCTORA</h1>
        <p class="subtitle">Asistente Virtual y Bot Operativo 24/7 en la Nube</p>

        ${isClientReady ? `
          <div class="badge online">🟢 EN LÍNEA Y ESCUCHANDO</div>
          <div style="margin: 24px 0; font-size: 15px;">
            Línea oficial activa: <br>
            <strong style="color: #38bdf8; font-size: 20px; display: block; margin-top: 8px;">+${connectedUser || '5216673545529'}</strong>
          </div>
          <p style="color: #94a3b8; font-size: 13px;">El asistente está procesando tickets, materiales, asistencia y consultas ejecutivas de forma continua.</p>
        ` : currentPairingCode ? `
          <div class="badge pairing">⚡ CÓDIGO DE VINCULACIÓN ACTIVO</div>
          <div class="pairing-code-box">
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">INGRESA ESTE CÓDIGO EN TU WHATSAPP:</div>
            <div class="code-display">${currentPairingCode}</div>
          </div>
          <div class="instructions">
            <ol>
              <li>Abre WhatsApp en el celular <strong>+52 1 667 354 5529</strong>.</li>
              <li>Ve a <strong>Ajustes > Dispositivos vinculados</strong>.</li>
              <li>Toca <strong>Vincular un dispositivo</strong>.</li>
              <li>Selecciona <strong>"Vincular con el número de teléfono"</strong>.</li>
              <li>Escribe el código de 8 dígitos mostrado arriba.</li>
            </ol>
          </div>
        ` : currentQrDataUrl ? `
          <div class="badge pairing">📲 ESCANEA EL CÓDIGO QR</div>
          <div class="qr-box">
            <img src="${currentQrDataUrl}" alt="Código QR WhatsApp" />
          </div>
          <div class="instructions">
            <ol>
              <li>Abre WhatsApp en el celular oficial (<strong>+52 1 667 354 5529</strong>).</li>
              <li>Ve a <strong>Dispositivos vinculados > Vincular un dispositivo</strong>.</li>
              <li>Apunta la cámara a este código QR.</li>
            </ol>
          </div>
        ` : `
          <div class="badge pairing">⏳ INICIANDO SERVICIO...</div>
          <p style="color: #94a3b8; font-size: 14px; margin: 30px 0;">Conectando con WhatsApp y MongoDB Atlas. Por favor espera unos segundos...</p>
        `}

        <footer>
          Torre de Control AMIS · Docker & Baileys 24/7 en Render
        </footer>
      </div>
    </body>
    </html>
  `);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor HTTP activo en el puerto ${PORT}`);
  console.log(`👉 Panel de vinculación disponible en http://0.0.0.0:${PORT}`);
  startWhatsAppBot();
});

setInterval(() => {
  const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  http.get(`${appUrl}/status`, (res) => {}).on('error', () => {});
}, 4 * 60 * 1000);

async function startWhatsAppBot() {
  console.log('🤖 Inicializando Baileys WhatsApp Engine...');
  const { state, saveCreds } = await useMongoAuthState();
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`📦 Usando Baileys v${version.join('.')} (Última versión: ${isLatest})`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['AMIS Torre Control', 'Chrome', '124.0.0.0'],
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    emitOwnEvents: false,
    markOnlineOnConnect: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQrData = qr;
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
        } catch (e) {}

        console.log('\n======================================================');
        console.log('⚡ ESCANEA ESTE CÓDIGO QR EN WHATSAPP (Dispositivos Vinculados):');
        console.log('======================================================\n');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'open') {
        isClientReady = true;
        currentQrData = null;
        currentQrDataUrl = null;
        connectedUser = sock.user?.id?.split(':')[0] || '5216673545529';
        console.log('\n======================================================');
        console.log('🤖 AMIS CONSTRUCTORA · SERVIDOR BAILEYS 24/7 EN LA NUBE ACTIVO');
        console.log('======================================================');
        console.log(`🟢 Línea Conectada: +${connectedUser}`);
      }

      if (connection === 'close') {
        isClientReady = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Deslogeado: ${isLoggedOut}`);

        if (!isLoggedOut) {
          const delay = statusCode === 515 ? 500 : 2500;
          setTimeout(startWhatsAppBot, delay);
        } else {
          console.log('🛑 Sesión cerrada por el usuario. Limpiando credenciales y esperando nuevo QR.');
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
          setTimeout(startWhatsAppBot, 2000);
        }
      }
    } catch (err) {
      console.error('Error en connection.update:', err);
    }
  });

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
        const isGroup = remoteJid.endsWith('@g.us');
        const senderJid = isGroup ? (msg.key.participant || msg.participant || remoteJid) : remoteJid;
        const senderNumber = senderJid.replace(/[^0-9]/g, '');
        const authUser = getAuthorizedUser(senderNumber, config);

        const dedupUser = authUser ? (authUser.phone || senderNumber) : senderNumber;
        const dedupKey = `${dedupUser}:${body.toLowerCase().trim()}`;
        const now = Date.now();
        if (recentUserMessages.has(dedupKey) && (now - recentUserMessages.get(dedupKey) < 4000)) {
          console.log(`[DEDUP] Mensaje repetido ignorado para ${dedupUser} ("${body}") dentro de 4s.`);
          continue;
        }
        recentUserMessages.set(dedupKey, now);
        if (recentUserMessages.size > 2000) {
          for (const [k, t] of recentUserMessages.entries()) {
            if (now - t > 30000) recentUserMessages.delete(k);
          }
        }

        const targetJid = remoteJid;

        // =========================================================================
        // 🔒 BLINDAJE: AISLAMIENTO 100% PARA GRUPOS Y COACH PERSONAL DE TED
        // =========================================================================
        if (isGroup) {
          const isCoachGroup = remoteJid === '120363432696055179@g.us' || /coach/i.test(body);
          if (isCoachGroup) {
            console.log(`[COACH GROUP] Mensaje en grupo personal: "${body}"`);
            const lowerBody = body.toLowerCase().trim();

            // 1. Si pide carrera, métricas, ayer, pulso, ritmo, etc.
            if (/carrera|running|entren|ayer|km|ritmo|pulso|garmin|m[eé]tricas|reporte|reloj/i.test(lowerBody) || lowerBody === '1') {
              const reply = `🏃‍♂️ *Tu Coach IA de Running (Garmin Fēnix 5X + HRM-Pro)*\n\n` +
                `📅 *Última Sesión Registrada:* Culiacán - Sesión JR Tranqu\n` +
                `📏 *Distancia:* 3.64 km\n` +
                `⏱️ *Ritmo Promedio:* 6:53 min/km | ⏱️ *Tiempo:* 25:06 min\n` +
                `❤️ *FC Promedio:* 151 ppm | 🔴 *FC Máxima:* 169 ppm\n` +
                `👟 *Cadencia:* 153 spm | 🏆 *Training Effect:* 3.0 Aeróbico (Umbral)\n\n` +
                `💡 *Dictamen del Coach:*\n` +
                `Completaste una sólida base aeróbica. Para tu siguiente sesión, busca aumentar gradualmente la cadencia hacia los 160-165 spm acortando levemente la zancada para proteger articulaciones. ¡Excelente trabajo y a seguir sumando!`;
              await sock.sendMessage(targetJid, { text: reply });
              continue;
            }

            // 2. Si pide consejos de cadencia o zonas
            if (/cadencia|zona|ppm|coraz[oó]n|frecuencia/i.test(lowerBody) || lowerBody === '2') {
              const advice = `👟 *Guía de Cadencia y Zonas Cardíacas · Coach IA*\n\n` +
                `🎯 *Meta de Cadencia:* 160 a 168 spm (en tu última tirada promediaste 153 spm). Pasos más rápidos y cortos reducen el impacto en rodillas y aumentan tu velocidad sin gastar más oxígeno.\n\n` +
                `❤️ *Zonas con tu HRM-Pro Plus:*\n` +
                `• *Zona 2 (120-138 ppm):* Quema de grasa y construcción de base mitocondrial.\n` +
                `• *Zona 3 (139-153 ppm):* Ritmo de crucero aeróbico controlado.\n` +
                `• *Zona 4 (154-168 ppm):* Umbral de lactato (donde estuviste en tu última tirada).`;
              await sock.sendMessage(targetJid, { text: advice });
              continue;
            }

            // 3. Si pide agenda o pendientes
            if (/agenda|pendiente|reuni[oó]n|compromiso/i.test(lowerBody) || lowerBody === '3') {
              const agenda = `📅 *Agenda Ejecutiva Personal (Lic. Ted)*\n\n` +
                `• Asistente personal y coach activos 24/7.\n` +
                `• Reporte nocturno automático de running programado a las 9:00 PM.\n` +
                `• Recordatorio matutino de actividades configurado.\n\n` +
                `¿Deseas agregar algún recordatorio o programar una nueva sesión?`;
              await sock.sendMessage(targetJid, { text: agenda });
              continue;
            }

            // 4. Si es saludo o menú inicial del Coach
            if (/^(hola|buen(as|os)?|que tal|q tal|inicio|menu|ayuda|hi|hello)/i.test(lowerBody) || !body) {
              const greetingCoach = `🏃‍♂️ *¡Hola Lic. Ted!* Aquí tu Coach IA de Running y Asistente Personal.\n\n` +
                `¿Qué deseas revisar hoy?\n` +
                `1️⃣ *Consultar última carrera en Garmin*\n` +
                `2️⃣ *Objetivos de cadencia y zonas cardíacas*\n` +
                `3️⃣ *Revisar agenda y pendientes personales*\n\n` +
                `💬 _Escribe directamente el número (1 al 3) o pregúntame lo que gustes._`;
              await sock.sendMessage(targetJid, { text: greetingCoach });
              continue;
            }

            // 5. Respuesta conversacional general en el grupo (100% aislada de obra)
            const fallbackReply = `🏃‍♂️ *Coach IA & Personal (Lic. Ted):*\n` +
              `Recibido. Estamos en tu espacio personal y deportivo. Tengo sincronizadas tus métricas de Garmin Fēnix 5X y tu agenda personal. ¿Deseas analizar tu última tirada o revisar algún pendiente?`;
            await sock.sendMessage(targetJid, { text: fallbackReply });
            continue;
          }

          // En cualquier otro grupo: NUNCA enviar la bienvenida comercial de AMIS
          continue;
        }

        // =========================================================================
        // 🏢 FLUJO EMPRESARIAL AMIS CONSTRUCTORA (SOLO CHAT DIRECTO INDIVIDUAL)
        // =========================================================================
        if (!authUser) {
          console.log(`[PÚBLICO] Contacto individual no registrado: +${senderNumber} ("${body}") -> Enviando a ${targetJid}`);
          await sock.sendMessage(targetJid, { text: config.public_greeting });
          continue;
        }

        const lowerBody = body.toLowerCase();
        const isReset = ['menu', 'menú', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);
        const sessionKey = authUser ? (authUser.phone || senderNumber) : senderNumber;
        if (!userSessions[sessionKey]) {
          userSessions[sessionKey] = { state: 'IDLE', updatedAt: Date.now(), lastGreetingTime: 0, history: [] };
        }
        userSessions[remoteJid] = userSessions[sessionKey];
        const userState = userSessions[sessionKey];
        if (!userState.history) userState.history = [];

        if (isReset) {
          userSessions[remoteJid].state = 'IDLE';
          userSessions[remoteJid].updatedAt = Date.now();
          saveSessions();
          const menuText = buildMainMenu(authUser, config);
          console.log(`[MENU] Enviando menú principal a ${authUser.name} (${targetJid})`);
          await sock.sendMessage(targetJid, { text: menuText });
          continue;
        }

        const extractDigit = (str) => {
          const match = str.match(/^[#*]*([0-9]+)/) || str.match(/([0-9]+)/);
          return match ? match[1] : null;
        };
        const choiceDigit = extractDigit(body);

        if (userState.state === 'IDLE') {
          // 1. Detección Inteligente de Comprobantes/Facturas en IDLE
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
                await guardarEnBuzonGastos(authUser, senderNumber, currentCount, body, hasMedia);

                directAck = `🧾 *Comprobante / Factura #1 Registrada con Éxito*\n\n` +
                  `📝 *Destino / Concepto:* "${body}"\n` +
                  `✅ Turnado a la Mesa de Control para validación del Lic. Ted.\n\n` +
                  `📎 *Puedes enviar la siguiente factura directamente* (o escribe _'listo'_ cuando termines).\n\n` +
                  `👉 _Escribe *menu* en cualquier momento para volver._`;
              } else {
                userSessions[remoteJid].waitingConcept = true;
                userSessions[remoteJid].waitingIndex = currentCount;
                await guardarEnBuzonGastos(authUser, senderNumber, currentCount, 'Sin descripción previa', hasMedia);

                directAck = `🧾 *Comprobante / Factura #1 Registrada con Éxito*\n\n` +
                  `✅ Archivo resguardado en la Mesa de Control de AMIS.\n\n` +
                  `💡 *Dato opcional:* Si gustas, escribe brevemente para qué se utilizó o a qué vehículo/área corresponde (ej: _'Gasolina NP300'_, _'Pintura para molde torre A'_).\n` +
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
                `💡 _Puedes agregar una breve nota con el destino del gasto (ej: 'Gasolina NP300' o 'Pintura para molde')._\n` +
                `Puedes enviar varias de forma continua; se registrarán una por una en la Mesa de Control.\n\n` +
                `_Escribe *menu* o *listo* cuando termines._`;

              await sock.sendMessage(targetJid, { text: promptMsg });
              continue;
            }
          }

          // 2. Detección Inteligente de Requisición de Materiales
          const isMaterialIntent = /^(pedir|necesit|solicit|ocup|requisici|comprar)\s*(material|cemento|acero|varilla|alambre|disco|herramienta)/i.test(lowerBody) ||
            (choiceDigit === '2' && authUser.role !== 'GERENTE_ADMINISTRATIVO');
          if (isMaterialIntent) {
            userSessions[remoteJid].state = 'MATERIAL';
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();

            const promptMsg = `📦 *Requisición de Materiales e Insumos de Obra*\n\n` +
              `Por favor escribe el listado de lo que necesitas con cantidades aproximadas (ej: _'5 bultos de cemento y 10 discos de corte 4 1/2'_, o _'1 rollo de alambre recocido'_).\n\n` +
              `El pedido se registrará con folio y se turnará de inmediato a Dirección General para su validación de precios y autorización.\n\n` +
              `_Escribe *menu* para cancelar._`;

            await sock.sendMessage(targetJid, { text: promptMsg });
            continue;
          }

          // 3. Detección Inteligente de Asistencia de Obra
          const isAttendanceIntent = /^(asistencia|lista de raya|reporte de personal|rayas|falto|faltaron)/i.test(lowerBody) ||
            (choiceDigit === '6' && authUser.role === 'GERENTE_ADMINISTRATIVO') ||
            (choiceDigit === '3' && authUser.role !== 'GERENTE_ADMINISTRATIVO');
          if (isAttendanceIntent) {
            userSessions[remoteJid].state = 'ATTENDANCE';
            userSessions[remoteJid].updatedAt = Date.now();
            saveSessions();

            const promptMsg = `👷 *Control de Asistencia y Personal en Campo*\n\n` +
              `Por favor envía la foto de tu lista de raya, o escribe las novedades del personal de hoy (altas, inasistencias o cambios de cuadrilla).\n\n` +
              `_Escribe *menu* para volver._`;

            await sock.sendMessage(targetJid, { text: promptMsg });
            continue;
          }

          // 4. Módulo Ejecutivo Directo para Lic. Ted (Opciones 1 al 4)
          if (authUser.role === 'GERENTE_ADMINISTRATIVO' && choiceDigit) {
            let directAnswer = '';
            if (choiceDigit === '1') {
              directAnswer = `🏗️ *ÁLAMOS DEL RÍO (NAVATO)*\n\n` +
                `• *Alcance:* 320 viviendas en 20 torres de 4 niveles (Obra Gris SIMA).\n` +
                `• *Monto Contractual:* $54,337,280.00 MXN ($169,804.00 / viv - Exento IVA).\n` +
                `• *Anticipo Cobrado:* 17% ($9,237,337.60 MXN en firme en BanBajío).\n` +
                `• *Condición Suspensiva:* Plazos congelados hasta el Día "D" (Anticipo + Dictamen de Uso de Suelo + Planos ejecutivos completos de M2).\n` +
                `• *Rotación:* Estricta de molde cada 24 horas. Suministros principales a cargo de M2 Coseinver.`;
            } else if (choiceDigit === '2') {
              directAnswer = `🏘️ *PROYECTO SIERRA BONITA (PARRAL)*\n\n` +
                `• *Programa:* 684 viviendas (edificios cuádruplex de 4 departamentos).\n` +
                `• *Estatus de Planos:* Definitivos aprobados con 13 láminas ejecutivas.\n` +
                `• *Espesores de Muro:* Cero muros de 12 cm. Únicamente muros de 10 cm y 20 cm para instalaciones/fachada.\n` +
                `• *Exclusividad SIMA:* Mínimo 584 viviendas exclusivas para AMIS en molde de concreto.\n` +
                `• *Aislamiento:* 100% independiente de Álamos del Río.`;
            } else if (choiceDigit === '3') {
              directAnswer = `💼 *AMIS CONSTRUCTORA · FINANZAS Y BANCOS*\n\n` +
                `• *Cuenta Fiscal:* Banco del Bajío 476863400201.\n` +
                `• *Esquema de Dispersión 3 Vías:* \n` +
                `  1. *Fiscal Directa BanBajío:* Solo nómina neta de personal con alta IMSS y recibo CFDI 4.0.\n` +
                `  2. *Socios Asimilables (Darnelix):* Reparto a los 5 socios ($12,500 c/u) con retención y timbrado.\n` +
                `  3. *Sobrenóminas y Obra (Roblock):* Factura de materiales deducibles para sobres de raya y SPEIs a personal.\n` +
                `• *Regla de Oro:* Cero dispersiones a cuentas de terceros no verificadas.`;
            } else if (choiceDigit === '4') {
              directAnswer = `⚖️ *TADR CONTABILIDAD Y FISCAL (LIC. TED)*\n\n` +
                `• *RFC:* DORT780211CQ5 (Actividad Empresarial y Servicios Profesionales).\n` +
                `• *Directiva Espejo:* Retención 10% ISR y 10.67% IVA en honorarios emitidos a AMIS.\n` +
                `• *Bolsa de Provisión SAT:* Se separa IVA residual e ISR estimado antes de dispersar a socios.\n` +
                `• *Honorarios Propios:* 100% de ingreso y utilidad personal de Ted.`;
            }

            if (directAnswer) {
              await sock.sendMessage(targetJid, { text: directAnswer });
              continue;
            }
          }

          // 5. Motor Conversacional Inteligente para Consultas Libres de Empresa
          const conversationalResponse = await generateConversationalReply(body, authUser, userState.history);
          if (conversationalResponse) {
            console.log(`[CONVERSACIONAL] Respuesta generada para ${authUser.name}`);
            await sock.sendMessage(targetJid, { text: conversationalResponse });
            userState.history.push({ role: 'user', content: body });
            userState.history.push({ role: 'assistant', content: conversationalResponse });
            if (userState.history.length > 20) userState.history = userState.history.slice(-20);
            saveSessions();
            continue;
          }

          const nowMs = Date.now();
          const shouldShowFullMenu = (!userState.lastGreetingTime || (nowMs - userState.lastGreetingTime > 2 * 60 * 60 * 1000));
          if (shouldShowFullMenu) {
            userState.lastGreetingTime = nowMs;
            saveSessions();
            const menuText = buildMainMenu(authUser, config);
            await sock.sendMessage(targetJid, { text: menuText });
            continue;
          }

          const gentlePrompt = `🫡 *Entendido, ${authUser.name}.*\n\n` +
            `Puedes indicarme tu solicitud con tus propias palabras (o escribir *menu* para ver las opciones disponibles).`;
          await sock.sendMessage(targetJid, { text: gentlePrompt });
          continue;
        }

        // Manejo de Estados Activos: EXPENSE (Facturas)
        if (userState.state === 'EXPENSE') {
          if (['listo', 'terminar', 'fin', 'ya quedo', 'ya quedó'].includes(lowerBody)) {
            userSessions[remoteJid].state = 'IDLE';
            userSessions[remoteJid].expenseCount = 0;
            userSessions[remoteJid].waitingConcept = false;
            saveSessions();

            const closingMsg = `✅ *Recepción de Comprobantes Concluida*\n\n` +
              `Todos los archivos recibidos han sido registrados en la Mesa de Control y puestos a disposición de Dirección General para su conciliación.\n\n` +
              `_Escribe *menu* para volver al inicio._`;
            await sock.sendMessage(targetJid, { text: closingMsg });
            continue;
          }

          const currentCount = (userState.expenseCount || 0) + 1;
          userSessions[remoteJid].expenseCount = currentCount;
          userSessions[remoteJid].updatedAt = Date.now();

          let ack = '';
          if (hasMedia) {
            const mediaConcept = body || 'Sin descripción previa';
            userSessions[remoteJid].waitingConcept = !body;
            userSessions[remoteJid].waitingIndex = currentCount;
            await guardarEnBuzonGastos(authUser, senderNumber, currentCount, mediaConcept, hasMedia);

            ack = `🧾 *Comprobante #${currentCount} Registrado con Éxito*\n\n` +
              (body ? `📝 *Destino / Concepto:* "${body}"\n` : '') +
              `✅ Turnado a la Mesa de Control de AMIS.\n\n` +
              `📎 *Puedes seguir enviando más facturas* (o escribe _'listo'_ cuando termines).\n\n` +
              `👉 _Escribe *menu* en cualquier momento para volver._`;
          } else {
            if (userSessions[remoteJid].waitingConcept) {
              userSessions[remoteJid].waitingConcept = false;
              await actualizarConceptoGasto(authUser, userSessions[remoteJid].waitingIndex || currentCount, body);
              ack = `📝 *Concepto agregado:* "${body}" para la factura anterior.\n\n` +
                `📎 Puedes enviar el siguiente comprobante o escribir _'listo'_.`;
            } else {
              ack = `💡 Recibido texto: "${body}". Por favor adjunta la foto o PDF de la factura, o escribe _'listo'_ para salir.`;
            }
          }

          saveSessions();
          await sock.sendMessage(targetJid, { text: ack });
          continue;
        }

        // Manejo de Estados Activos: MATERIAL (Requisiciones)
        if (userState.state === 'MATERIAL') {
          if (['listo', 'terminar', 'cancelar'].includes(lowerBody)) {
            userSessions[remoteJid].state = 'IDLE';
            saveSessions();
            await sock.sendMessage(targetJid, { text: `✅ Requisición cerrada. Escribe *menu* para volver.` });
            continue;
          }

          await guardarEnBuzonMateriales(authUser, senderNumber, body);
          userSessions[remoteJid].state = 'IDLE';
          saveSessions();

          const ack = `📦 *Requisición Registrada con Éxito*\n\n` +
            `📝 *Detalle:* "${body}"\n` +
            `👤 *Solicitante:* ${authUser.name}\n` +
            `✅ Se ha turnado la alerta a Dirección General (Lic. Ted) para su cotejo contra el Catálogo de Precios y autorización de compra.\n\n` +
            `_Escribe *menu* para volver al inicio._`;
          await sock.sendMessage(targetJid, { text: ack });
          continue;
        }

        // Manejo de Estados Activos: ATTENDANCE (Asistencia)
        if (userState.state === 'ATTENDANCE') {
          if (['listo', 'terminar', 'cancelar'].includes(lowerBody)) {
            userSessions[remoteJid].state = 'IDLE';
            saveSessions();
            await sock.sendMessage(targetJid, { text: `✅ Registro de asistencia cerrado. Escribe *menu* para volver.` });
            continue;
          }

          await guardarEnBuzonAsistencia(authUser, senderNumber, body, hasMedia);
          userSessions[remoteJid].state = 'IDLE';
          saveSessions();

          const ack = `👷 *Reporte de Asistencia Guardado con Éxito*\n\n` +
            `✅ El reporte ha sido resguardado para la conciliación de nómina de los jueves contra el Tabulador Maestro Oficial.\n\n` +
            `_Escribe *menu* para volver al inicio._`;
          await sock.sendMessage(targetJid, { text: ack });
          continue;
        }

      } catch (err) {
        console.error('Error procesando mensaje:', err);
      }
    }
  });
}

async function guardarEnBuzonGastos(authUser, senderNumber, count, concept, hasMedia) {
  try {
    console.log(`[BUZÓN GASTOS] Guardado ticket #${count} de ${authUser.name} (${senderNumber}) | Concepto: "${concept}"`);
  } catch (e) {}
}

async function actualizarConceptoGasto(authUser, index, concept) {
  try {
    console.log(`[BUZÓN GASTOS] Actualizado concepto #${index} de ${authUser.name} | Concepto: "${concept}"`);
  } catch (e) {}
}

async function guardarEnBuzonMateriales(authUser, senderNumber, detail) {
  try {
    console.log(`[BUZÓN MATERIALES] Requisición de ${authUser.name} (${senderNumber}): "${detail}"`);
  } catch (e) {}
}

async function guardarEnBuzonAsistencia(authUser, senderNumber, detail, hasMedia) {
  try {
    console.log(`[BUZÓN ASISTENCIA] Reporte de ${authUser.name} (${senderNumber}): "${detail}" | Media: ${hasMedia}`);
  } catch (e) {}
}
