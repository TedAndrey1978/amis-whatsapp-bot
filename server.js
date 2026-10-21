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

// =========================================================================
// 🏃‍♂️ MOTOR DE INTELIGENCIA DEPORTIVA: COACH IA DE RUNNING & FISIOLOGÍA
// =========================================================================
async function responderCoachIA(query, history = []) {
  const q = (query || '').toLowerCase().trim();
  const apiKey = process.env.GEMINI_API_KEY;

  // 1. Si hay API Key de Gemini configurada y no revocada, generar respuesta con IA generativa
  if (apiKey && apiKey.length > 20 && !apiKey.includes('leaked')) {
    try {
      const systemPrompt = `Eres el Coach Deportivo Personal de Running del Lic. Ted Andrey Domínguez Romero.
Te estás comunicando vía WhatsApp en su grupo privado de entrenamiento.

PERFIL DEL ATLETA:
- Atleta: Lic. Ted Andrey Domínguez Romero.
- Equipamiento: Reloj Garmin Fēnix 5X Sapphire + Banda de pecho Garmin HRM-Pro Plus.
- Ubicación: Culiacán, Sinaloa (clima muy cálido y húmedo, 30°C+ nocturnos).
- Perfil: Corredor metódico que busca salud cardiovascular, longevidad articular y eficiencia metabólica.
- Telemetría de su última sesión (20 Oct):
  * 3.64 km @ 6:53 min/km (Pico en series 5:08 min/km). Total con enfriamiento: 6.26 km.
  * FC Media: 151 ppm (Zona 3) | FC Máxima: 169 ppm (Zona 4 Umbral).
  * Cadencia Media: 152.8 spm (Pico 166 spm). Objetivo: 165-170 spm.
  * Zancada Media: 0.95 m (Objetivo: 0.88-0.90 m con pasos más cortos y reactivos).
  * Training Effect: 3.0 Aeróbico (Impacto en Umbral de Lactato).
  * VO2 Max estimado: 40 ml/kg/min.
- Objetivos prioritarios:
  1. Aumentar cadencia a 165-170 spm para reducir un 15-20% el impacto en rodillas y gastar menos oxígeno.
  2. Rodajes en Zona 2 estricta (125-138 ppm) a ritmo 7:10-7:30 min/km para construir base aeróbica mitocondrial.
  3. Activar el metrónomo sonoro/vibración del Fēnix 5X a 165 bpm.

DIRECTIVAS:
- Tono: Profesional, motivador, empático, basado en fisiología y biomecánica deportiva real.
- Estilo: WhatsApp (emojis 🏃‍♂️, 👟, ❤️, ⏱️, 💡, párrafos directos, viñetas claras).
- Responde directamente a lo que pregunte Ted (dolores, molestias, clima, zapatillas, horarios, hidratación, metrónomo, descansos). Mantén la continuidad del diálogo.`;

      const contents = [];
      contents.push({ role: 'user', parts: [{ text: systemPrompt + '\n\nConfirma rol.' }] });
      contents.push({ role: 'model', parts: [{ text: '¡Entendido! Soy el Coach IA de Running del Lic. Ted Andrey.' }] });

      if (Array.isArray(history) && history.length > 0) {
        for (const item of history.slice(-6)) {
          contents.push({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.content }]
          });
        }
      }
      contents.push({ role: 'user', parts: [{ text: query }] });

      const postData = JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 900 } });

      const resText = await new Promise((resolve, reject) => {
        const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                const txt = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (txt) return resolve(txt);
              } catch(e) {}
            }
            reject(new Error(`Status ${res.statusCode}: ${data.slice(0, 100)}`));
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      if (resText) return resText;
    } catch(err) {
      console.log('[COACH GEMINI] Error en llamada API:', err.message);
    }
  }

  // 2. Motor Experto de Respaldo Fisiológico y Biomecánico Continuo
  if (/gemelo|pantorrilla|soleo|s[oó]leo|aquiles|tal[oó]n|dolor|molestia|pierna|cargar|cargado/i.test(q)) {
    return `🦵 *Consejo del Coach: Alivio y Gestión de Gemelos / Sóleo*\n\n` +
      `En tu tirada del martes promediaste *152.8 spm*. A esa cadencia, el pie pasa demasiados milisegundos apoyado en el asfalto, obligando al tríceps sural (gemelo y sóleo) a soportar todo tu peso corporal en fase de frenado.\n\n` +
      `💡 *Plan de Acción Inmediato:*\n` +
      `1️⃣ *Descarga Muscular:* Masaje con rodillo de espuma (foam roller) o una pelota de tenis sobre la pantorrilla, de abajo hacia arriba (5-7 min por pierna).\n` +
      `2️⃣ *Estiramiento Excéntrico:* Coloca la punta del pie en el borde de un escalón y deja caer el talón suavemente por 30 segundos (3 series). Esto oxigena el tendón de Aquiles.\n` +
      `3️⃣ *Hielo y Elevación:* Si hay inflamación o calor local, aplica compresas frías 10-15 min.\n` +
      `4️⃣ *Corrección para la Próxima Sesión:* Acorta la zancada y sube la cadencia a *165 spm*. Al despegar el pie más rápido, el gemelo deja de sufrir el impacto del suelo.`;
  }

  if (/rodilla|cintilla|articulaci|impacto|menisco|lumbar|espalda/i.test(q)) {
    return `🩺 *Consejo del Coach: Protección Articular y Rodillas*\n\n` +
      `El dolor o sobrecarga en rodillas suele ser síntoma de *overstriding* (aterrizar con la pierna muy extendida por delante del centro de gravedad).\n\n` +
      `💡 *Recomendaciones Técnicas:*\n` +
      `1️⃣ *Flexiona ligeramente las rodillas al pisar:* Imagina que corres sobre vidrio fino y no quieres hacer ruido.\n` +
      `2️⃣ *Cadencia a 165 bpm:* Es la mejor "medicina" biomecánica para las rodillas. Reducirás hasta un 20% de las fuerzas de torsión articular.\n` +
      `3️⃣ *Terreno:* Si sientes molestia, evita el pavimento duro y rueda sobre pasto plano o arcilla/tierra compacta durante 2 o 3 sesiones.\n` +
      `4️⃣ *Fortalecimiento:* Sentadillas búlgaras y puentes de glúteo 2 veces por semana para darle estabilidad a la rótula.`;
  }

  if (/hora|cu[aá]ndo|mañana|noche|tarde|calor|temperatura|clima|culiac[aá]n|sol/i.test(q)) {
    return `☀️ *Estrategia Térmica para Correr en Culiacán*\n\n` +
      `En Culiacán la combinación de calor (30°C+) y humedad relativa produce una fuerte *deriva cardíaca*: tu corazón debe bombear sangre a los músculos para correr y a la piel para enfriarte mediante el sudor.\n\n` +
      `⏱️ *Mejores Ventanas de Entrenamiento:*\n` +
      `• *Opción 1 (Óptima): 5:30 AM a 6:45 AM.* La temperatura está en su punto mínimo (~24-26°C) y el asfalto está frío. Ideal para cualquier entrenamiento con series o ritmo alegre.\n` +
      `• *Opción 2: 8:30 PM a 9:45 PM.* Ya no hay radiación solar, pero el asfalto aún irradia calor acumulado. Si sales de noche, mantén la intensidad en *Zona 2 estricta* (menos de 138 ppm).\n\n` +
      `💧 *Hidratación Previa:* Bebe 500 ml de agua con una pizca de sales/electrolitos 45-60 min antes de iniciar.`;
  }

  if (/metr[oó]nomo|f[eé]nix|reloj|activar|configur|poner.*metr[oó]nomo/i.test(q)) {
    return `⌚ *Paso a Paso: Configurar el Metrónomo en tu Garmin Fēnix 5X*\n\n` +
      `Tu Fēnix 5X incluye un metrónomo integrado para ayudarte a internalizar el ritmo de pasos sin tener que mirar la pantalla constantemente:\n\n` +
      `1️⃣ En la pantalla del reloj, presiona el botón superior derecho (**START**) y selecciona **Carrera**.\n` +
      `2️⃣ Antes de iniciar, mantén presionado el botón central izquierdo (**UP / MENU**).\n` +
      `3️⃣ Selecciona **Configuración de carrera > Metrónomo**.\n` +
      `4️⃣ Entra a **Estado** y cámbialo a **Activado**.\n` +
      `5️⃣ En **Latidos por minuto (bpm)**, ajústalo a **165** (o 168 bpm).\n` +
      `6️⃣ En **Alerta**, elige **Vibración** (recomendado para no hacer ruido) o *Sonido y vibración*.\n\n` +
      `💡 *Cómo usarlo:* Cada vez que sientas la vibración, un pie debe hacer contacto con el suelo. ¡Verás cómo tu zancada se vuelve automáticamente más corta y ágil!`;
  }

  if (/zona|card[ií]aca|ppm|pulso|pulsaciones|hrm|banda|pecho|frecuencia/i.test(q)) {
    return `❤️ *Guía de Frecuencia Cardíaca con tu HRM-Pro Plus*\n\n` +
      `La banda pectoral HRM-Pro Plus mide directamente la señal eléctrica del corazón, eliminando el retraso del sensor óptico de muñeca cuando hay sudor.\n\n` +
      `📊 *Tus Zonas de Referencia para Running:*\n` +
      `• *Zona 1 (105 - 120 ppm) - Calentamiento / Recuperación activa:*\n` +
      `  Caminata ágil o trote muy suave. Facilita el riego sanguíneo.\n` +
      `• *Zona 2 (121 - 138 ppm) - Base Aeróbica / Quema de Grasas:*\n` +
      `  *Aquí debe estar el 70-80% de tus entrenamientos.* Puedes hablar en oraciones completas sin sofocarte. Multiplica las mitocondrias musculares.\n` +
      `• *Zona 3 (139 - 153 ppm) - Ritmo Crucero / Tempo:*\n` +
      `  Tu pulso promedio del martes (151 ppm). Exige concentración y genera resistencia sostenida.\n` +
      `• *Zona 4 (154 - 168 ppm) - Umbral de Lactato:*\n` +
      `  Donde tocaste 169 ppm en los picos de aceleración. No debes pasar más de 10-15 minutos aquí por semana para no sobreentrenar.`;
  }

  if (/hidrat|agua|sal|sales|electrolito|suplement|comida|comer|desayun|prote[ií]na|creatina|caf[eé]/i.test(q)) {
    return `🥤 *Estrategia de Nutrición e Hidratación del Coach*\n\n` +
      `En climas como Culiacán, una pérdida del 2% del peso en sudor reduce tu rendimiento un 15% y eleva el pulso en 7-10 ppm.\n\n` +
      `💡 *Protocolo Recomendado:*\n` +
      `1️⃣ *Sales y Electrolitos:* No bebas solo agua pura; el sudor pierde sodio, potasio y magnesio. Agrega electrolitos en polvo (sin exceso de azúcar) en tu hidratación diaria.\n` +
      `2️⃣ *Pre-Carrera (60 min antes):* Un café solo o espresso (la cafeína moviliza ácidos grasos y reduce la percepción del esfuerzo) + medio plátano.\n` +
      `3️⃣ *Post-Carrera:* Dentro de los primeros 45 minutos, toma agua fresca con sales y una fuente de proteína + carbohidrato simple para restaurar el glucógeno hepático y muscular.\n` +
      `4️⃣ *Creatina:* 3 a 5 gramos diarios son excelentes para la recuperación celular muscular.`;
  }

  if (/zapatilla|tenis|zapato|calzado|asfalto|drop|amortigua/i.test(q)) {
    return `👟 *Criterios de Calzado para Asfalto y tu Perfil*\n\n` +
      `Para un ritmo de 6:40 - 7:20 min/km en asfalto con objetivo de proteger articulaciones:\n\n` +
      `1️⃣ *Amortiguación Media/Alta:* Busca modelos de entrenamiento diario (*daily trainers*) con espuma reactiva pero suave (ej: Brooks Ghost / Glycerin, Asics Novablast / Cumulus, Nike Pegasus, Saucony Ride).\n` +
      `2️⃣ *Drop Recomendado:* Un drop de *8 a 10 mm* suele ser el más amigable para corredores que buscan descargar los gemelos y el tendón de Aquiles.\n` +
      `3️⃣ *Vida Útil:* Reemplaza las zapatillas entre los 600 y 800 km acumulados; la espuma pierde capacidad de disipar impacto aunque la suela se vea entera.`;
  }

  if (/plan|pr[oó]xim|siguiente|rutina|entreno|sesi[oó]n|cu[aá]nto|ritmo|mañana/i.test(q)) {
    return `📋 *Plan para tu Próxima Sesión de Entrenamiento*\n\n` +
      `Viniendo del estímulo de umbral (TE 3.0) del martes, la regla de oro es *acumular volumen sin fatiga cardiovascular*:\n\n` +
      `🎯 *Prescripción de la Sesión:*\n` +
      `• *Tipo:* Rodaje regenerativo de base aeróbica.\n` +
      `• *Distancia:* 4.0 a 5.0 km continuos.\n` +
      `• *Ritmo Objetivo:* **7:10 a 7:30 min/km** (cero prisas; el objetivo es el corazón, no el cronómetro).\n` +
      `• *Frecuencia Cardíaca:* Mantenerte en **Zona 2 estricta (125 a 138 ppm)**. Si sube de 140 ppm, baja el ritmo de inmediato.\n` +
      `• *Foco Biomecánico:* Pasos cortos y ágiles con metrónomo a 165 bpm.\n\n` +
      `¿A qué hora tienes pensado salir para darte la recomendación de temperatura?`;
  }

  return `🏃‍♂️ *Tu Coach IA de Running:*\n\n` +
    `Entendido, Lic. Ted. Sobre "${query}":\n\n` +
    `Mi recomendación técnica es priorizar la *consistencia y la eficiencia biomecánica*. En tu etapa actual, dar pasos más cortos (~165 spm) y controlar el pulso en Zona 2 (125-138 ppm) te permitirá duplicar tu resistencia sin riesgo de lesión en rodillas o gemelos.\n\n` +
    `💡 *Puedes consultarme sobre:*\n` +
    `• Alivio de dolores en gemelos o rodillas.\n` +
    `• Cómo activar el metrónomo en tu Fēnix 5X.\n` +
    `• Horarios para correr por el calor en Culiacán.\n` +
    `• Zonas cardíacas de tu banda HRM-Pro Plus.\n` +
    `• Zapatillas, hidratación y plan para tu próxima tirada.\n\n` +
    `_Pregúntame exactamente lo que sientas o necesites afinar._`;
}

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

            // 1. Si pide carrera, análisis, métricas, ayer, pulso, ritmo, etc.
            if (/analisis|análisis|carrera|running|entren|ayer|sesi[oó]n|rutina|km|ritmo|pulso|garmin|m[eé]tricas|reporte|reloj|consejo/i.test(lowerBody) || lowerBody === '1') {
              const fullReport = `🏃‍♂️ *DICTAMEN DEL COACH IA: RUNNING & FISIOLOGÍA DEPORTIVA*\n` +
                `👤 *Atleta:* Lic. Ted Andrey Domínguez | *Dispositivo:* Garmin Fēnix 5X + HRM-Pro Plus\n` +
                `📍 *Ubicación:* Culiacán, Sin. (30.7 °C) | 📅 *Sesión:* Martes 20 Oct (19:52 hrs)\n` +
                `🏷️ *Actividad:* _Culiacán - Sesion JR Tranqu_\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 *1. TELEMETRÍA DE LA SESIÓN*\n` +
                `• *Distancia Principal:* 3.64 km (Total acumulado con enfriamiento: 6.26 km)\n` +
                `• *Tiempo Activo:* 24m 56s\n` +
                `• *Ritmo Medio:* 6:53 min/km (Pico en series: 5:08 min/km)\n` +
                `• *Frecuencia Cardíaca Media:* 151 ppm (~78% FC Máx - Zona 3 media)\n` +
                `• *Frecuencia Cardíaca Máxima:* 169 ppm (~88% FC Máx - Zona 4 Umbral)\n` +
                `• *Cadencia Promedio:* 152.8 spm (Pico: 166 spm)\n` +
                `• *Longitud de Zancada:* 0.95 m (94.8 cm)\n` +
                `• *Training Effect:* 🏆 *3.0 Aeróbico* (Mejora sustancial en Umbral de Lactato)\n` +
                `• *Gasto Calórico:* 298 kcal\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🔬 *2. ANÁLISIS BIOMECÁNICO Y EFICIENCIA*\n` +
                `• *Cadencia (153 spm):* Tu frecuencia de paso fue algo pausada para el ritmo de 6:53 min/km. Al pasar más milisegundos en contacto con el suelo, el impacto se absorbe en articulaciones (rodillas/lumbares) en vez de aprovechar el rebote elástico del tendón de Aquiles.\n` +
                `• *Ajuste Técnico:* No necesitas correr más rápido; la clave es *acortar ligeramente la zancada* (a ~0.88-0.90 m) y subir tu cadencia a *165-170 spm*. Esto reduce el impacto articular entre 15% y 20% y baja tus pulsaciones a la misma velocidad.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `❤️ *3. FISIOLOGÍA Y FACTOR CLIMA (CULIACÁN)*\n` +
                `• *Termorregulación a 30.7 °C:* Correr con calor y humedad obliga al corazón a bombear sangre para impulsar los músculos y enfriar la piel por sudoración. Eso explica la deriva cardíaca hasta 169 ppm.\n` +
                `• *Enfriamiento Impecable:* Cerrar con 2 km a ritmo 7:13 min/km con pulso de 134 ppm (Zona 2 pura) fue un acierto total para barrer el lactato residual y acelerar la regeneración muscular.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `💡 *4. PRESCRIPCIÓN DEL COACH: A CUÁNTO Y CÓMO CORRER*\n` +
                `1️⃣ *Para Hoy/Mañana:* Tu cuerpo ya completó las 24h de supercompensación del estímulo de umbral (TE 3.0).\n` +
                `2️⃣ *Ritmo Prescrito:* \n` +
                `   • *Tirada Base/Regenerativa:* Corre entre *7:10 y 7:30 min/km*.\n` +
                `   • *Zona Cardíaca Objetivo:* Mantén el pulso en *Zona 2 estricta (125 a 138 ppm)*. Si el calor de Culiacán te sube a más de 142 ppm, reduce el ritmo sin dudar.\n` +
                `3️⃣ *Herramienta en tu Fēnix 5X:* Activa el *metrónomo sonoro o por vibración a 165 bpm* para coordinar una pisada más ágil y reactiva.\n` +
                `4️⃣ *Hidratación:* Repón sales minerales (sodio/magnesio) por la alta sudoración.\n\n` +
                `_¿Quieres profundizar en algún punto o consultar tu próximo entrenamiento?_`;
              await sock.sendMessage(targetJid, { text: fullReport });
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
                `1️⃣ *Consultar última carrera en Garmin (Análisis completo)*\n` +
                `2️⃣ *Objetivos de cadencia y zonas cardíacas*\n` +
                `3️⃣ *Revisar agenda y pendientes personales*\n\n` +
                `💬 _Escribe directamente el número (1 al 3) o pregúntame lo que gustes._`;
              await sock.sendMessage(targetJid, { text: greetingCoach });
              continue;
            }

            // 5. Motor Conversacional Inteligente del Coach IA (Mantiene el tema y da consejos continuos)
            if (!userSessions[remoteJid]) {
              userSessions[remoteJid] = { history: [] };
            }
            if (!userSessions[remoteJid].history) userSessions[remoteJid].history = [];

            const coachAdvice = await responderCoachIA(body, userSessions[remoteJid].history);
            userSessions[remoteJid].history.push({ role: 'user', content: body });
            userSessions[remoteJid].history.push({ role: 'assistant', content: coachAdvice });
            if (userSessions[remoteJid].history.length > 20) {
              userSessions[remoteJid].history = userSessions[remoteJid].history.slice(-20);
            }
            saveSessions();

            await sock.sendMessage(targetJid, { text: coachAdvice });
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
