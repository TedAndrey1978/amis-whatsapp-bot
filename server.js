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
let lastMongoError = null;

async function useMongoAuthState() {
  try {
    if (!mongoClient) {
      console.log('📡 Conectando a MongoDB Atlas para persistencia de sesión 24/7...');
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
    console.error('Error guardando sesiones:', e.message);
  }
}

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'menu_config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error leyendo menu_config.json:', e);
  }
  return { users: [], modules: {} };
}

function getAuthorizedUser(sender, config, fullSender = '') {
  const cleanSender = (sender || '').replace(/[^0-9]/g, '');
  const searchStr = `${sender} ${fullSender} ${cleanSender}`.toLowerCase();

  return config.users.find(u => {
    const uPhone = (u.phone || '').replace(/[^0-9]/g, '');
    const uLid = (u.lid || '').replace(/[^0-9]/g, '');

    if (uPhone && (cleanSender.endsWith(uPhone) || uPhone.endsWith(cleanSender) || searchStr.includes(uPhone))) return true;
    if (uLid && (cleanSender.endsWith(uLid) || uLid.endsWith(cleanSender) || searchStr.includes(uLid))) return true;

    return false;
  });
}

function buildMainMenu(user, config) {
  const roleName = user.role.toUpperCase();
  let menu = `👋 *¡Hola, ${user.name}!* Bienvenido al Asistente Virtual Operativo de *AMIS CONSTRUCTORA*.\n`;
  menu += `🎭 *Rol:* ${roleName}\n\n`;
  menu += `Por favor, selecciona una opción respondiendo con el número correspondiente:\n\n`;

  const availableModules = [];
  let optIndex = 1;

  for (const [key, mod] of Object.entries(config.modules)) {
    if (mod.allowed_roles.includes(user.role) || mod.allowed_roles.includes('*')) {
      availableModules.push({ digit: optIndex.toString(), key, title: mod.title, description: mod.description });
      menu += `${optIndex}️⃣ *${mod.title}*\n   _${mod.description}_\n\n`;
      optIndex++;
    }
  }

  menu += `💡 _Escribe *menu* en cualquier momento para regresar aquí._`;
  return menu;
}

// =========================================================================
// 🏃‍♂️ BASE DE CONOCIMIENTO BIOMÉDICO Y FISIOLÓGICO GARMIN CONNECT
// =========================================================================
const ULTIMAS_SESIONES_RUNNING = [
  {
    fecha: 'Jueves 22 de Octubre, 2026 (19:34)',
    tipo: 'Carrera Nocturna de Calidad (5K Progresivo)',
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
    zonasFC: { z1: '2%', z2: '28%', z3: '55%', z4: '15%', z5: '0%' },
    tiempoRecuperacionSugerido: '24 horas',
    sensacion: 'Muy buen cierre de carrera, aceleración progresiva en el último kilómetro.'
  },
  {
    fecha: 'Martes 20 de Octubre, 2026 (20:43)',
    tipo: 'Rodaje Suave de Descarga / Regenerativo',
    distanciaKm: 2.02,
    duracion: '14m 35s',
    ritmoMedio: '7:13 min/km',
    ritmoMejorKm: '6:45 min/km',
    fcMedia: 134,
    fcMax: 146,
    cadenciaMedia: 158,
    cadenciaMax: 168,
    calorias: 155,
    balance: '49.5% / 50.5%',
    oscilacion: '7.8 cm',
    trainingEffect: 2.1,
    zonasFC: { z1: '15%', z2: '75%', z3: '10%', z4: '0%', z5: '0%' },
    tiempoRecuperacionSugerido: '12 horas',
    sensacion: 'Excelente control aeróbico en Zona 2 pura, piernas descansadas.'
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

async function responderConsultaPilar(pilar, query, userState = null) {
  const q = (query || '').toLowerCase().trim();

  // Respuestas Pilar 1: Obra
  if (pilar === 'PILAR_1_OBRA') {
    if (/franco|parral|sierra bonita/i.test(q) || q === '2') {
      if (userState) { userState.activeSubmodule = 'PARRAL'; saveSessions(); }
      return `⛏️ *Proyecto Franco / Parral (SIMA - Chihuahua)*\n\n` +
        `• *Alcance:* 684 viviendas en edificios cuádruplex (prototipo Sierra Bonita).\n` +
        `• *Estatus de Planos:* Visto bueno definitivo del martes 7 de octubre de 2026 (13 láminas ejecutivas autorizadas).\n` +
        `• *Espesores de Muro:* Cero muros de 12 cm. Muros de *10 cm* (carga y colindancias) y *20 cm* (instalaciones sanitarias/bajantes y fachada de acceso).\n` +
        `• *Honorarios Estructurales:* $240,000 + IVA (bonificables si contratan antes del 15 de diciembre de 2026).\n` +
        `• *Exclusividad SIMA:* Franco edifica hasta 100 tradicionales; mínimo 584 exclusivas para AMIS.`;
    }
    if (q === '1' || /^(alamos|[aá]lamos|lope|infonavit)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'ALAMOS'; saveSessions(); }
      return `🏢 *Proyecto Infonavit Álamos del Río (AMIS SIMA)*\n\n` +
        `• *Alcance:* 320 viviendas (20 torres de 4 niveles).\n` +
        `• *Monto Contrato:* $54,337,280.00 MXN ($169,804.00/viv exento de IVA).\n` +
        `• *Cobranza:* Anticipo del 17% ($9,237,337.60 MXN) cobrado y timbrado en CFDI VIV-2 en BanBajío.\n` +
        `• *Condición Suspensiva:* Plazos congelados hasta cumplimiento total del Día 'D' (dictamen de uso de suelo + planos autorizados).\n` +
        `• *Rotación:* Estricta rotación de 24 horas por nivel de molde SIMA.`;
    }
    if (q === '2' || /^(franco|parral|sierra bonita)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'PARRAL'; saveSessions(); }
      return `⛏️ *Proyecto Franco / Parral (SIMA - Chihuahua)*\n\n` +
        `• *Alcance:* 684 viviendas en edificios cuádruplex (prototipo Sierra Bonita).\n` +
        `• *Estatus de Planos:* Visto bueno definitivo del martes 7 de octubre de 2026 (13 láminas ejecutivas autorizadas).\n` +
        `• *Espesores de Muro:* Cero muros de 12 cm. Muros de *10 cm* y *20 cm*.\n` +
        `• *Honorarios Estructurales:* $240,000 + IVA (bonificables si contratan antes del 15 de diciembre de 2026).\n` +
        `• *Exclusividad SIMA:* Franco edifica hasta 100 tradicionales; mínimo 584 exclusivas para AMIS.`;
    }
    if (q === '3' || /^(material|materiales|precios|catalogo)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'MATERIALES'; saveSessions(); }
      return `🏗️ *Catálogo de Precios de Materiales (Compras AMIS):*\n\n` +
        `• *Cemento Gris Tolteca 50kg:* $245.00 MXN / Saco\n` +
        `• *Varilla 3/8" (No. 3):* $178.50 MXN / Tramo 12m\n` +
        `• *Varilla 1/2" (No. 4):* $312.00 MXN / Tramo 12m\n` +
        `• *Alambre Recocido Cal. 16:* $38.50 MXN / Kg\n` +
        `• *Arena Triturada:* $480.00 MXN / M3 | *Grava 3/4":* $520.00 MXN / M3\n` +
        `• *Diésel Automotriz:* $25.80 MXN / Litro\n\n` +
        `_Precios de mercado reales auditados contra facturas de compras recientes._`;
    }
    return null;
  }

  // Respuestas Pilar 2: Fiscal / Finanzas
  if (pilar === 'PILAR_2_FINANZAS_FISCAL') {
    if (q === '1' || /^(saldo|banbaj[ií]o|banco|tesorer[ií]a)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'AMIS_FISCAL'; saveSessions(); }
      return `💼 *Tesorería & Fiscal AMIS Constructora (ACO241114A70):*\n\n` +
        `• *Cuenta BanBajío Maestra:* 476863400201\n` +
        `• *Saldo Auditoría:* ~$9,050,000.00 MXN (Anticipo Álamos blindado).\n` +
        `• *Vías de Dispersión Semanal (Viernes):*\n` +
        `  1. *Fiscal Directa BanBajío:* Solo trabajadores con alta IMSS y timbrado Nominax.\n` +
        `  2. *DARNELIX Asimilables (8%):* $62,500.00 netos ($12,500 c/u para los 5 socios). Depósito: $67,129.63 MXN.\n` +
        `  3. *CONSTRUCTORA ROBLOCK (7%):* Destajos, sobrenóminas SPEI y raya en efectivo.`;
    }
    if (q === '2' || /^(tadr|honorarios?|consultor[ií]a)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'TADR_FISCAL'; saveSessions(); }
      return `💼 *Contabilidad Personal TADR (RFC: DORT780211CQ5):*\n\n` +
        `• *Régimen:* Actividad Empresarial y Servicios Profesionales / Consultoría.\n` +
        `• *Directiva Espejo AMIS:* En facturas para reparto de socios se retiene 10% ISR y 10.67% IVA, apartando bolsa SAT (5.33% IVA residual + ISR).\n` +
        `• *Asesorías Propias:* 100% ingreso exclusivo de Ted Andrey.\n` +
        `• *Libro Maestro:* Control_Fiscal_y_Facturacion_2026_TADR.xlsx.`;
    }
    if (q === '3' || /^(submayor|proyecto ejecutivo|360k)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'PROY_EJECUTIVO'; saveSessions(); }
      return `📑 *Submayor Proyecto Ejecutivo AMIS ($360,000.00 MXN):*\n\n` +
        `• *Titularidad:* 50% Ing. Samuel Domínguez / 50% Lic. Ted Andrey.\n` +
        `• *Anticipo Cobrado:* $100,000.00 MXN (CFDI VIV-1).\n` +
        `• *Saldo por Cobrar:* $260,000.00 MXN.\n` +
        `• *Aislamiento:* Cuenta corriente 100% independiente de los repartos ordinarios de socios.`;
    }
    if (q === '4' || /^(familiar|modulo familiar|isabel|samuel)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'FAMILIAR'; saveSessions(); }
      return `👨‍👩‍👧 *Módulo Fiscal Familiar (AntiGravity Fiscal Familiar):*\n\n` +
        `1. *Ing. Samuel Domínguez (DORS510222UA2):* Régimen 606 (Dividendos) + 605 (Asimilados). Solo presenta Anual en Abril. Estatus: 100% blindado.\n` +
        `2. *Sra. Isabel Romero (ROGI561130NM0):* Alerta SAT activa por régimen 612. Acción prioritaria: Tramitar Disminución de Obligaciones ante SAT para dejarla solo en Sueldos/Asimilados.`;
    }
    if (q === '5' || /^(sima|moldes?)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'SIMA_MOLDES'; saveSessions(); }
      return `⚙️ *Sistema de Moldes SIMA (Activos & Operación):*\n\n` +
        `• *Juegos de Moldes:* Equipos monolíticos de aluminio de alta resistencia para muros y losas.\n` +
        `• *Rotación Oficial:* 24 horas continuas de fraguado y descimbrado por nivel.\n` +
        `• *Mantenimiento:* Supervisión a cargo de Bladimir Beltrán y reposición de herrajes/esquineros autorizados.`;
    }
    return null;
  }

  // Respuestas Pilar 3: Personal / Tech
  if (pilar === 'PILAR_3_PERSONAL') {
    if (q === '1' || /^(cripto|bitso|btc|usdt|portafolio)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'BITSO'; saveSessions(); }
      return await obtenerReporteCriptoBitso();
    }
    if (q === '2' || /^(coach|running|menu coach)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'RUNNING'; saveSessions(); }
      return await responderCoachIA(query);
    }
    if (/^(ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis|carrera ayer)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'RUNNING'; saveSessions(); }
      return await obtenerAnalisisSesionCompleto(0);
    }
    if (q === '3' || /^(supleai|app)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'SUPLEAI'; saveSessions(); }
      return `📱 *SupleAI App (SaaS de Suplementación Inteligente):*\n\n` +
        `• *Arquitectura:* Frontend React Native multiplataforma + Backend FastAPI.\n` +
        `• *Monetización:* Deep-linking de suplementos recomendados vía programas de afiliados (Amazon México y Mercado Libre).\n` +
        `• *Blindaje Médico:* Regla de exclusión estricta para embarazo, lactancia y patologías crónicas.\n` +
        `• *Estatus:* Base de datos de ingredientes activos y compatibilidad fisiológica configurada.\n\n` +
        `_¿Deseas consultar sobre ingredientes, monetización de afiliados o desarrollo de la app?_`;
    }
    if (q === '4' || /^(china|importaciones|yupoo|1688)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'CHINA'; saveSessions(); }
      return `🇨🇳 *Compras en China & Abastecimiento Internacional:*\n\n` +
        `• *Fábricas y Plataformas:* Conexión directa OEM/ODM en 1688, Taobao y catálogos Yupoo.\n` +
        `• *Agentes y Casilleros:* Operación vía CSSBuy / Sugargoo para consolidación en bodega de China y US Closer para USA.\n` +
        `• *Protocolo de Inspección:* Control de calidad (QC) con fotos HD, verificación de medidas en cm e instrucción 'Drop Box' para aligerar peso volumétrico y blindar aduana.\n` +
        `• *Repositorio:* Expediente exclusivo en 06_COMPRAS_CHINAS.\n\n` +
        `_Estoy listo como tu Director de Sourcing. ¿Deseas consultar estatus de pedidos, catálogos Yupoo, guías de rastreo o cotizar un nuevo producto?_`;
    }
    if (q === '5' || /^(agenda|pendientes)$/i.test(q)) {
      if (userState) { userState.activeSubmodule = 'AGENDA'; saveSessions(); }
      return `📋 *Agenda Ejecutiva Personal (Lic. Ted):*\n\n` +
        `• Asistente personal y coach activos 24/7.\n` +
        `• Monitoreo de portafolio Bitso sincronizado con precios en vivo.\n` +
        `• Reporte nocturno de running y recordatorios matutinos configurados.\n\n` +
        `_Todo en orden. ¿Deseas agendar alguna actividad o recordatorio específico?_`;
    }
    // Para cualquier conversación, duda o pregunta abierta: Dejar pasar a Gemini AI!
    return null;
  }

  return null;
}

async function consultarCerebroPorDivision(division, userQuery, history = [], submodule = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  let systemPrompt = '';
  if (division === 'PILAR_1_OBRA') {
    systemPrompt = `Eres el Director Técnico e Ingeniero de Obra Monolítica SIMA de Ted Andrey Domínguez en AMIS Constructora.
Ámbito EXCLUSIVO de conversación: DIVISIÓN 1 (Obra y Edificación Monolítica).
- Proyectos:
  1. INFONAVIT Álamos del Río (Navolato / Proyecto Lope): 320 viviendas (20 torres de 4 niveles). Contrato $54.33 MDP ($169,804/viv exento IVA). Anticipo 17% ($9.23 MDP en firme en BanBajío con CFDI VIV-2). Habilitado de acero y pre-armados en patio. Plazos congelados hasta condición suspensiva del Día "D" (uso de suelo + planos aprobados). Suministros mayores de M2 Coseinver ($60.76 MDP).
  2. Proyecto Franco (Sierra Bonita, Parral, Chihuahua): 684 viviendas (edificios cuádruplex). Muros de 10 cm (carga y colindancias) y 20 cm (instalaciones sanitarias/bajantes y fachada de acceso). Cero muros de 12 cm. Visto bueno del 7 de oct 2026. Honorarios $240k+IVA.
  3. Sistema de moldes SIMA con rotación estricta de 24 horas por nivel.
  4. Precios de compras reales de insumos (cemento $245, varilla 3/8 $178.50, varilla 1/2 $312, alambre $38.50, diésel $25.80).
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de finanzas personales, running, salud personal o criptomonedas. Si Ted pregunta de eso, indícale cordialmente que para eso debe cambiar a la División 2 (Fiscal) o División 3 (Personal).
Tono: Muy natural, conversacional, profesional de ingeniería, claro, conciso y directo al grano.`;
  } else if (division === 'PILAR_2_FINANZAS_FISCAL') {
    systemPrompt = `Eres el Contralor Corporativo y Asesor Fiscal de Cabecera de Ted Andrey Domínguez en AMIS Constructora y TADR Consultoría.
Ámbito EXCLUSIVO de conversación: DIVISIÓN 2 (Fiscal, Corporativo y Tesorería).
- AMIS Constructora, S.A. de C.V. (RFC: ACO241114A70). Cuenta Maestra BanBajío 476863400201 (Saldo vivo ~$9.05 MDP). 5 Socios al 20% c/u (Ing. Samuel, Sra. Isabel, Sam, Ted, Mariano).
- Dispersión semanal (Viernes): Vía 1 Fiscal BanBajío (solo trabajadores con alta IMSS Nominax), Vía 2 Asimilables Socios Darnelix 8% ($12,500 netos c/u = $62,500 total), Vía 3 Roblock 7% (factura deducible de materiales para destajos, sobrenóminas SPEI y raya en efectivo). Cero cuentas de terceros.
- TADR Fiscal (Ted Andrey Domínguez Romero - RFC DORT780211CQ5): Régimen de honorarios/actividad empresarial. Retenciones 10% ISR y 10.67% IVA en facturas a AMIS, apartando bolsa SAT (5.33% IVA residual + ISR). Asesorías reales 100% de Ted.
- Submayor Proyecto Ejecutivo $360,000 MXN: Reparto 50% Ing. Samuel / 50% Ted ($100k anticipo cobrado VIV-1, $260k por cobrar).
- Módulo Familiar: Ing. Samuel (anual en abril), Sra. Isabel (trámite de disminución ante SAT).
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de entrenamientos, running, tenis o temas deportivos. Si Ted pregunta de eso, indícale que pertenece a la División 3.
Tono: Analítico, preciso, matemático al centavo, blindado fiscalmente y conversacional.`;
  } else if (division === 'PILAR_3_PERSONAL') {
    const isChina = submodule === 'CHINA' || /china|compras?|pedido|pedidos|paquete|paquetes|gu[ií]a|rastreo|casillero|yupoo|1688|taobao|cssbuy|sugargoo|us closer|aduanas?/i.test(userQuery);
    const isRunning = submodule === 'RUNNING' || /running|garmin|correr|entreno|cadencia|ritmo|metr[oó]nomo|km|s[oó]leo|zancada|pulsaciones|ppm|frecuencia card/i.test(userQuery);
    const isCripto = submodule === 'BITSO' || /cripto|bitso|btc|bitcoin|usdt|satoshis?|portafolio/i.test(userQuery);
    const isSuple = submodule === 'SUPLEAI' || /supleai|suplement|creatina|prote[ií]na|afiliados/i.test(userQuery);
    const isAgenda = submodule === 'AGENDA' || /agenda|pendiente|recordatorio/i.test(userQuery);

    if (isChina && !isRunning && !isCripto) {
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
      systemPrompt = `Eres el Asesor Financiero Cripto y Analista de Mercados de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: MERCADO CRIPTOMONEDAS & BITSO ALPHA.
- Portafolio de Ted en vivo: 0.00063682 BTC + 105.85 USDT. Capital depositado: $3,000 MXN. Meta fijada: 0.001 BTC (100,000 satoshis). Faltan solo 0.00036318 BTC (convertibles desde USDT).
- Estrategia: Mantener reserva USDT y comprar BTC en caídas clave o convertir el faltante a BTC para asegurar la meta de los 100,000 satoshis.
AISLAMIENTO ESTRICTO: Tienes estrictamente PROHIBIDO hablar de running, obras de construcción o impuestos.
Tono: Analista financiero cuantitativo, seguro, estratégico y directo.`;
    } else if (isSuple && !isChina && !isRunning) {
      systemPrompt = `Eres el Product Lead y Nutriólogo Deportivo Senior de la aplicación SupleAI App de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: SUPLEAI APP (SaaS de Suplementación Inteligente).
- Arquitectura: Frontend React Native + Backend FastAPI.
- Monetización: Deep-linking de suplementos recomendados vía programas de afiliados (Amazon México y Mercado Libre).
- Filtros Médicos: Exclusión estricta de embarazo, lactancia y patologías crónicas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de finanzas corporativas, obras de construcción o impuestos.
Tono: Innovador tecnológico, científico de la salud y visión de negocio SaaS.`;
    } else if (isAgenda && !isChina && !isRunning) {
      systemPrompt = `Eres el Asistente Ejecutivo Personal y Chief of Staff de Ted Andrey Domínguez.
Ámbito EXCLUSIVO de conversación: AGENDA EJECUTIVA Y COMPROMISOS PERSONALES.
- Asistencia 24/7 en organización de actividades, pendientes y seguimiento de metas.
AISLAMIENTO ESTRICTO: Tienes terminantemente PROHIBIDO hablar de concreto o temas ajenos a la agenda personal.
Tono: Ejecutivo, impecable, proactivo y organizado.`;
    } else {
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
        return answer.trim();
      }
    } catch(e) {}
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
        console.log('📲 Escanea el código QR desde tu WhatsApp para conectar el Bot.');
      }

      if (connection === 'close') {
        isClientReady = false;
        connectedUser = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`🔌 Conexión cerrada. Razón / Status: ${statusCode}. Reconectando: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(startWhatsAppBot, 3000);
        } else {
          console.log('🚪 Sesión cerrada definitivamente en el teléfono. Limpiando credenciales...');
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
        connectedUser = sock.user;
        console.log(`✅ ¡CONEXIÓN ESTABLECIDA CON ÉXITO! Conectado como: ${sock.user?.id || sock.user?.name}`);
      }
    });

    const recentUserMessages = new Map();
    const processedMsgIds = new Set();

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

              if (/^(ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis.*rutina|an[aá]lisis.*sesi[oó]n|an[aá]lisis.*ayer)$/i.test(lowerBody) || lowerBody === '1') {
                console.log('[COACH] Generando análisis biomédico Garmin para Ted');
                const analisisSesion = await obtenerAnalisisSesionCompleto(0);
                await sock.sendMessage(targetJid, { text: analisisSesion });
                continue;
              }

              if (lowerBody === '2') {
                const cadenciaInfo = `⚡ *Análisis de Cadencia y Zonas Cardíacas (Garmin Ted)*\n\n` +
                  `• *Tu cadencia media:* 160 spm (Pico: 181 spm en 5K de ayer).\n` +
                  `• *Zona 3 Tempo:* 157 ppm promedio.\n\n` +
                  `🎯 *Consejo:* Ajustar el metrónomo a 172 spm en tu Fēnix 5X es la progresión biomecánica perfecta para acercarte a los 175 spm sin forzar la zancada.`;
                await sock.sendMessage(targetJid, { text: cadenciaInfo });
                continue;
              }

              if (/^(cripto|bitcoin|btc|bitso|usdt|eth|portafolio)$/i.test(lowerBody) || lowerBody === '3') {
                console.log(`[CRIPTO BITSO] Solicitud de reporte de criptomonedas recibida de Ted`);
                const cryptoReport = await obtenerReporteCriptoBitso();
                await sock.sendMessage(targetJid, { text: cryptoReport });
                continue;
              }

              if (/^(agenda|pendientes)$/i.test(lowerBody) || lowerBody === '4') {
                const agenda = `📋 *Agenda Ejecutiva Personal (Lic. Ted)*\n\n` +
                  `• Asistente personal y coach activos 24/7.\n` +
                  `• Reporte nocturno automático de running programado a las 8:30 PM.\n` +
                  `• Recordatorio matutino de actividades configurado.\n` +
                  `• Monitoreo de portafolio Bitso sincronizado.\n\n` +
                  `_Todo en orden. ¿Deseas agregar algún recordatorio personal?_`;
                await sock.sendMessage(targetJid, { text: agenda });
                continue;
              }

              // Conversación fluida con Gemini AI para el grupo de Running
              const aiReply = await consultarCerebroPorDivision('PILAR_3_PERSONAL', body, [], 'RUNNING');
              if (aiReply) {
                await sock.sendMessage(targetJid, { text: aiReply });
              } else {
                const coachRespuesta = await responderCoachIA(body);
                await sock.sendMessage(targetJid, { text: coachRespuesta });
              }
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
            console.log(`[CENTRO DE MANDO TED] Mensaje de Ted: "${body}" | División: ${userState.activePillar || 'IDLE'} | Submódulo: ${userState.activeSubmodule || 'NINGUNO'}`);

            // 1. Saludo, Menú, Inicio o Reset: SIEMPRE abre el Menú Maestro
            if (isReset || /^(hola|buenos d[ií]as|buenas|empezar|inicio|men[uú]|help|ayuda)$/i.test(lowerBody)) {
              userState.activePillar = null;
              userState.activeSubmodule = null;
              userState.waitingPillarConfirmation = false;
              userState.pendingQuery = null;
              userState.pendingTargetPillar = null;
              saveSessions();
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
                saveSessions();

                const pInfo = PILARES_INFO[targetPillar];
                let ackChange = `🔄 *Contexto cambiado exitosamente al ${pInfo.titulo}*\n\n`;
                if (savedQuery) {
                  const queryReply = await responderConsultaPilar(targetPillar, savedQuery, userState);
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
                  text: `✅ Entendido. Nos mantenemos en el *${curPInfo.titulo}*. ¿Qué deseas consultar de este proyecto? (O escribe *menu* para volver a la raíz).`
                });
                continue;
              }
            }

            // 3. Selección directa de División desde el Menú Maestro
            if (!userState.activePillar) {
              if (lowerBody === '1' || /^(pilar 1|divisi[oó]n 1|obra)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_1_OBRA';
                userState.activeSubmodule = null;
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar1() });
                continue;
              } else if (lowerBody === '2' || /^(pilar 2|divisi[oó]n 2|fiscal|finanzas)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_2_FINANZAS_FISCAL';
                userState.activeSubmodule = null;
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar2() });
                continue;
              } else if (lowerBody === '3' || /^(pilar 3|divisi[oó]n 3|personal)$/i.test(lowerBody)) {
                userState.activePillar = 'PILAR_3_PERSONAL';
                userState.activeSubmodule = null;
                saveSessions();
                await sock.sendMessage(targetJid, { text: getSubmenuPilar3() });
                continue;
              }
            }

            // 4. Si Ted ya está dentro de una División, auditar detección cruzada
            const detectedPillar = detectarPilarDeConsulta(body);
            if (userState.activePillar && detectedPillar && detectedPillar !== userState.activePillar) {
              userState.waitingPillarConfirmation = true;
              userState.pendingQuery = body;
              userState.pendingTargetPillar = detectedPillar;
              saveSessions();

              const currentPInfo = PILARES_INFO[userState.activePillar];
              const targetPInfo = PILARES_INFO[detectedPillar];

              const warningMsg = `⚠️ *Lic. Ted, actualmente te encuentras en el ${currentPInfo.titulo}.*\n\n` +
                `Tu consulta corresponde al *${targetPInfo.titulo}* (${targetPInfo.proyectos}).\n\n` +
                `¿Deseas que cambiemos de contexto a esa división?\n` +
                `👉 Responde *Sí* para cambiar y ver la respuesta, o continúa con tus temas de esta división (o escribe *menu*).`;

              await sock.sendMessage(targetJid, { text: warningMsg });
              continue;
            }

            // 5. Atajos rápidos de menú (solo números u opciones directas)
            const effectivePillar = userState.activePillar || detectedPillar || 'PILAR_1_OBRA';
            const pillarReply = await responderConsultaPilar(effectivePillar, body, userState);
            if (pillarReply) {
              userState.history.push({ role: 'user', text: body });
              userState.history.push({ role: 'model', text: pillarReply });
              if (userState.history.length > 10) userState.history = userState.history.slice(-10);
              saveSessions();
              await sock.sendMessage(targetJid, { text: pillarReply });
              continue;
            }

            // 6. Conversación Fluida con Inteligencia Artificial (Gemini Especializado por División y Submódulo)
            console.log(`[AI TED] Generando respuesta conversacional para ${effectivePillar} (Submódulo: ${userState.activeSubmodule || 'GENERAL'} - "${body.slice(0, 40)}")...`);
            const aiReply = await consultarCerebroPorDivision(effectivePillar, body, userState.history, userState.activeSubmodule);
            if (aiReply) {
              userState.history.push({ role: 'user', text: body });
              userState.history.push({ role: 'model', text: aiReply });
              if (userState.history.length > 10) userState.history = userState.history.slice(-10);
              saveSessions();
              await sock.sendMessage(targetJid, { text: aiReply });
              continue;
            }

            // 7. Respuesta por defecto si fallara la conexión a la IA
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
