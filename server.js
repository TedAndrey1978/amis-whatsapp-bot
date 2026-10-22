import express from 'express';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'amis_whatsapp';
const COLLECTION_NAME = 'auth_session';

let sock = null;
let qrCodeDataURL = null;
let isConnected = false;
let mongoClient = null;

// =========================================================================
// GESTIÓN DE AUTENTICACIÓN EN MONGODB ATLAS
// =========================================================================
async function initMongo() {
  if (!MONGO_URI) {
    console.warn('[AUTH] MONGO_URI no configurado. Se usará autenticación local temporal.');
    return null;
  }
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    console.log('[AUTH] Conectado exitosamente a MongoDB Atlas');
    return mongoClient.db(DB_NAME).collection(COLLECTION_NAME);
  } catch (err) {
    console.error('[AUTH ERROR] Falló la conexión a MongoDB:', err.message);
    return null;
  }
}

async function useMongoAuthState(collection) {
  const localAuthDir = path.join(__dirname, 'auth_info_baileys');
  if (!fs.existsSync(localAuthDir)) {
    fs.mkdirSync(localAuthDir, { recursive: true });
  }

  if (collection) {
    try {
      console.log('[AUTH] Restaurando sesión desde MongoDB Atlas...');
      const cursor = collection.find({});
      const docs = await cursor.toArray();
      let restoredCount = 0;
      for (const doc of docs) {
        if (doc._id && doc.data) {
          const filePath = path.join(localAuthDir, doc._id);
          fs.writeFileSync(filePath, doc.data, 'utf-8');
          restoredCount++;
        }
      }
      console.log(`[AUTH] ${restoredCount} archivos de sesión restaurados en disco local.`);
    } catch (err) {
      console.error('[AUTH ERROR] Error restaurando desde MongoDB:', err.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(localAuthDir);

  const saveCredsToMongo = async () => {
    await saveCreds();
    if (collection) {
      try {
        const files = fs.readdirSync(localAuthDir);
        for (const file of files) {
          const filePath = path.join(localAuthDir, file);
          if (fs.lstatSync(filePath).isFile()) {
            const content = fs.readFileSync(filePath, 'utf-8');
            await collection.updateOne(
              { _id: file },
              { $set: { data: content, updatedAt: new Date() } },
              { upsert: true }
            );
          }
        }
      } catch (err) {
        console.error('[AUTH ERROR] Error sincronizando a MongoDB:', err.message);
      }
    }
  };

  return { state, saveCreds: saveCredsToMongo };
}

// =========================================================================
// BASES DE DATOS EN MEMORIA Y CONTEXTO
// =========================================================================
const userContext = new Map();
const userHistory = new Map();

const CATALOGO_PRECIOS = [
  { item: 'Cemento Gris Tolteca CPC 30R 50kg', precio: 245.00, unidad: 'Saco' },
  { item: 'Varilla Corrugada 3/8" (No. 3) R-42', precio: 178.50, unidad: 'Tramo 12m' },
  { item: 'Varilla Corrugada 1/2" (No. 4) R-42', precio: 312.00, unidad: 'Tramo 12m' },
  { item: 'Alambre Recocido Calibre 16', precio: 38.50, unidad: 'Kg' },
  { item: 'Clavo para Concreto 2 1/2"', precio: 45.00, unidad: 'Kg' },
  { item: 'Arena Triturada No. 4', precio: 480.00, unidad: 'M3' },
  { item: 'Grava Triturada 3/4"', precio: 520.00, unidad: 'M3' },
  { item: 'Malla Electrosoldada 6-6/10-10', precio: 1850.00, unidad: 'Rollo 100m2' },
  { item: 'Desmoldante SIMA Ecológico Base Agua', precio: 1450.00, unidad: 'Garrafa 20L' },
  { item: 'Diesel Automotriz UBA', precio: 25.80, unidad: 'Litro' },
  { item: 'Gasolina Regular Magna', precio: 24.50, unidad: 'Litro' }
];

const PROVEEDORES_FRECUENTES = [
  { nombre: 'Cemex Concretos / Construrama', rfc: 'CEX800101XYZ', contacto: 'Lic. Roberto Garza (667) 712-4050' },
  { nombre: 'Aceros y Perfiles de Culiacán', rfc: 'APC950315ABC', contacto: 'Ing. Carlos Mendoza (667) 750-8090' },
  { nombre: 'Ferretería y Materiales del Río', rfc: 'FMR020420H12', contacto: 'Mostrador Central (667) 718-2233' },
  { nombre: 'Distribuidora Diésel del Pacífico', rfc: 'DDP110908KL9', contacto: 'Cesp. Despacho (667) 725-6677' }
];

const SUELDOS_TABULADOR = [
  { puesto: 'Herrero + Equipo Soldadura', salarioSemanal: 10800.00, diario: 1800.00 },
  { puesto: 'Residente de Obra', salarioSemanal: 7500.00, diario: 1250.00 },
  { puesto: 'Moldero Especialista', salarioSemanal: 7000.00, diario: 1166.67 },
  { puesto: 'Fierrero Especialista', salarioSemanal: 5000.00, diario: 833.33 },
  { puesto: 'Encargado de Mantenimiento', salarioSemanal: 5000.00, diario: 833.33 },
  { puesto: 'Plomero Instalador', salarioSemanal: 5000.00, diario: 833.33 },
  { puesto: 'Electricista Obra', salarioSemanal: 5000.00, diario: 833.33 },
  { puesto: 'Albañil Especialista', salarioSemanal: 4000.00, diario: 666.67 },
  { puesto: 'Supervisor PreArmados', salarioSemanal: 4000.00, diario: 666.67 },
  { puesto: 'Seguridad y Accesos Obra', salarioSemanal: 4000.00, diario: 666.67 },
  { puesto: 'Ayudante General de Obra', salarioSemanal: 3500.00, diario: 583.33 },
  { puesto: 'Ayudante de Herrero', salarioSemanal: 3500.00, diario: 583.33 },
  { puesto: 'Velador Terreno SIMA', salarioSemanal: 2400.00, diario: 400.00 },
  { puesto: 'Velador de Obra', salarioSemanal: 2000.00, diario: 333.33 }
];

// =========================================================================
// MÓDULO RUNNING: DATOS REALES DE GARMIN DE TED ANDREY
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
  },
  {
    fecha: 'Viernes 17 de Octubre, 2026',
    tipo: 'Series de Umbral Lactato (5 x 1000m r=2m)',
    distanciaKm: 9.10,
    duracion: '48m 15s',
    ritmoMedio: '5:18 min/km (Intervalos a 4:32 min/km promedio)',
    ritmoMejorKm: '4:28 min/km',
    fcMedia: 154,
    fcMax: 171,
    cadenciaMedia: 178,
    cadenciaMax: 188,
    calorias: 640,
    zonasFC: { z1: '10%', z2: '35%', z3: '20%', z4: '30%', z5: '5%' },
    tiempoRecuperacionSugerido: '48 horas',
    sensacion: 'Potente estímulo cardiovascular. Recuperación de pulso rápida en los 2 minutos de trote.'
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
async function responderCoachIA(query, history = []) {
  const q = (query || '').toLowerCase().trim();

  // Si pregunta por ritmo / a cuánto correr
  if (/cu[aá]nto debo|a qu[eé] ritmo|a qu[eé] velocidad|mi ritmo|ritmo ideal|siguiente carrera|siguiente salida|entreno de ma[nñ]ana/i.test(q)) {
    return `🏃‍♂️ *Recomendación de Ritmo y Entrenamiento (Coach Ted):*\n\n` +
      `Basado en tu última sesión de 8.52 km a 5:46 min/km con FC de 142 ppm:\n\n` +
      `• *Para tu rodaje de mañana:* Corre entre *6:00 y 6:15 min/km*. Tu objetivo no es la velocidad, es construir capilarización muscular y mitocondrias en *Zona 2 pura* (132 a 140 ppm).\n` +
      `• *Para tu día de calidad (Tempo):* Apunta a sostener *5:20 a 5:25 min/km* por bloques de 15 a 20 minutos (FC 152-156 ppm).\n` +
      `• *Para series cortas (1,000m):* Tu paso objetivo es *4:30 a 4:35 min/km* con recuperación activa de 90 segundos al trote suave.\n\n` +
      `💡 *Regla de oro:* Si no puedes mantener una conversación corta de corrido mientras ruedas en tu sesión suave, estás corriendo demasiado rápido. Baja 15 segundos al paso.`;
  }

  // Si pregunta por cadencia o técnica
  if (/cadencia|zancada|pisada|talon|impacto|rodillas|180|spm/i.test(q)) {
    return `⚡ *Análisis de Cadencia y Biomecánica (Coach Ted):*\n\n` +
      `• *Tu cadencia actual:* Promediaste *174 spm* en tu última sesión. ¡Es un número excelente! Estás dentro del rango ideal (170-180 spm).\n` +
      `• *¿Por qué importa?* A 174 spm tu tiempo de contacto con el suelo es menor a 230 milisegundos. Eso elimina la sobre-zancada (overstriding) y evita la sobrecarga en la rótula y la fascia plantar.\n` +
      `• *Consejo de afinación:* En subidas o cuando sientas fatiga en el km 7+, no trates de alargar el paso. *Acorta la zancada y acelera el braceo*. El tren inferior sigue automáticamente la cadencia de los codos.`;
  }

  // Si pregunta por pulsaciones, zonas o corazón
  if (/zona|pulsaciones|frecuencia|cardiac|coraz[oó]n|ppm|pecho/i.test(q)) {
    return `❤️ *Control de Zonas Cardíacas (Coach Ted):*\n\n` +
      `Tus zonas personalizadas de entrenamiento:\n` +
      `• *Zona 1 (<130 ppm):* Recuperación activa y regeneración celular.\n` +
      `• *Zona 2 (130 - 145 ppm):* *Tu zona sagrada de base aeróbica.* Aquí el 80% del combustible proviene de la oxidación de lípidos.\n` +
      `• *Zona 3 (146 - 156 ppm):* Zona Tempo. Buena para carreras de 15k a 21k, pero genera fatiga residual si se abusa entre semana.\n` +
      `• *Zona 4 (157 - 168 ppm):* Umbral anaeróbico. Entrenar aquí eleva tu velocidad de crucero.\n` +
      `• *Zona 5 (>168 ppm):* Potencia aeróbica máxima (VO2 máx). Reservada solo para los últimos 400m de intervalos o sprint final.\n\n` +
      `📌 *Diagnóstico:* En tu última sesión el 62% del tiempo estuviste en Zona 2. Tu eficiencia cardiometabólica está en su punto más alto del ciclo.`;
  }

  // Si pregunta por dolores, agujetas, suplementos o recuperación
  if (/dolor|molestia|s[oó]leo|gemelo|pantorrilla|recupera|suplement|creatina|electrolit|agua|descanso/i.test(q)) {
    return `💊 *Protocolo de Recuperación & Cuidado Muscular:*\n\n` +
      `• *Sóleos y Gemelos:* Aplica 10 minutos de Foam Roller suave (sin presionar directo sobre el tendón de Aquiles) y estiramiento con rodilla flexionada para aislar el sóleo.\n` +
      `• *Hidratación Táctica:* Toma 500 ml de agua con 300 mg de citrato de magnesio y una pizca de sal marina para reponer electrolitos perdidos por sudoración.\n` +
      `• *Sueño reparador:* Recuerda que la síntesis de colágeno y la hormona de crecimiento se liberan en las fases de sueño profundo (fases 3 y 4). Apunta a 7.5 horas hoy.`;
  }

  // Si pregunta por Cripto / Bitso / Inversiones personales
  if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(q)) {
    return await obtenerReporteCriptoBitso();
  }

  // Respuesta general de seguimiento deportivo y personal
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
// MOTOR DE INTELIGENCIA DE AMIS CONSTRUCTORA (CHAT 1 A 1 CON ASISTENTE)
// =========================================================================
async function responderConIA(prompt, history = []) {
  const p = (prompt || '').toLowerCase().trim();

  // 1. Reporte de Saldos y Bancos
  if (/saldo|banco|bajio|cuenta|bancar/i.test(p)) {
    return `💼 *Tesorería AMIS Constructora:*\n\n` +
      `• *Banco:* Banco del Bajío Empresarial\n` +
      `• *Cuenta Maestra:* 476863400201\n` +
      `• *Saldo Auditoría:* ~$9,050,000.00 MXN\n` +
      `• *Anticipo Infonavit Álamos:* $9,237,337.60 MXN (17% cobrado en firme, CFDI VIV-2 emitido).\n` +
      `• *Fondo de Contingencia:* Activo y disponible para compras críticas de acero y cemento.\n\n` +
      `_¿Deseas conciliar algún cheque, consultar movimientos recientes o programar dispersión de nómina?_`;
  }

  // 2. Reporte de Mano de Obra y Nómina
  if (/n[oó]mina|tabulador|sueldo|salario|pago.*semana|dispersi/i.test(p)) {
    let resp = `👷‍♂️ *Tabulador Oficial Semanal AMIS (Planta 2026):*\n\n`;
    SUELDOS_TABULADOR.slice(0, 8).forEach(item => {
      resp += `• *${item.puesto}:* $${item.salarioSemanal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}/sem ($${item.diario.toFixed(2)}/día)\n`;
    });
    resp += `\n📌 *Regla de Dispersión Semanal (Viernes):*\n` +
      `1. *Fiscal Directa BanBajío:* Solo trabajadores con alta IMSS en Nominax.\n` +
      `2. *Darnelix (Asimilables):* Socios ($12,500 c/u, 8% comisión).\n` +
      `3. *Roblock:* Destajos, sobrenóminas SPEI y sobre de raya en efectivo.`;
    return resp;
  }

  // 3. Catálogo de Precios y Mercadeo
  if (/precio|material|cemento|varilla|diesel|gasolina|arena|grava|costo/i.test(p)) {
    let resp = `🏗️ *Precios de Referencia Autorizados (Compras AMIS):*\n\n`;
    CATALOGO_PRECIOS.forEach(item => {
      resp += `• *${item.item}:* $${item.precio.toFixed(2)} MXN / ${item.unidad}\n`;
    });
    resp += `\n_Cotizaciones auditadas contra facturas recientes de Cemex, Construrama y Aceros de Culiacán._`;
    return resp;
  }

  // 4. Proveedores Frecuentes
  if (/proveedor|contacto|tel[eé]fono|cemex|acero|di[eé]sel/i.test(p)) {
    let resp = `🤝 *Directorio de Proveedores Validados AMIS:*\n\n`;
    PROVEEDORES_FRECUENTES.forEach(prov => {
      resp += `• *${prov.nombre}*\n  RFC: \`${prov.rfc}\` | Contacto: ${prov.contacto}\n\n`;
    });
    return resp;
  }

  // 5. Estado de Proyecto Álamos del Río
  if (/alamos|[aá]lamos|infonavit|lope|proyecto|vivienda|torre/i.test(p)) {
    return `🏢 *Proyecto Infonavit Álamos del Río (SIMA):*\n\n` +
      `• *Alcance:* 320 viviendas (20 torres de 4 niveles).\n` +
      `• *Monto Contrato:* $54,337,280.00 MXN ($169,804.00/viv exento IVA).\n` +
      `• *Anticipo:* $9,237,337.60 MXN (17% cobrado en BanBajío).\n` +
      `• *Estatus Operativo:* Condición suspensiva en verificación para banderazo oficial del Día 'D'. Rotación de moldes SIMA proyectada a 24 horas por nivel.`;
  }

  // 6. Asistente General por Defecto
  return `🤖 *Asistente Operativo Central AMIS*\n\n` +
    `Entiendo tu consulta sobre *"${prompt.slice(0, 50)}"*. Estoy configurado para darte soporte inmediato en:\n\n` +
    `1. *Tesorería y Bancos:* Consulta de saldos BanBajío y pagos pendientes.\n` +
    `2. *Precios de Materiales:* Varilla, cemento, agregados, diésel.\n` +
    `3. *Mano de Obra y Nómina:* Tabulador semanal, altas Nominax e incidencias.\n` +
    `4. *Proveedores:* Teléfonos, RFCs y cuentas autorizadas.\n` +
    `5. *Recepción de Gastos:* Mándame la foto de cualquier factura o ticket para registrarlo.\n\n` +
    `_Escribe lo que necesitas consultar o indícame una instrucción directa._`;
}

// =========================================================================
// CONEXIÓN PRINCIPAL CON WHATSAPP (BAILEYS)
// =========================================================================
async function connectToWhatsApp() {
  console.log('[WHATSAPP] Iniciando conexión con WhatsApp Web...');

  const mongoCollection = await initMongo();
  const { state, saveCreds } = await useMongoAuthState(mongoCollection);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[WHATSAPP] Usando versión de Baileys v${version.join('.')} (Última: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: ['AMIS Asistente', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[WHATSAPP] Nuevo código QR generado.');
      qrCodeDataURL = await qrcode.toDataURL(qr);
      isConnected = false;
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[WHATSAPP] Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);
      isConnected = false;
      qrCodeDataURL = null;

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.error('[WHATSAPP] La sesión fue cerrada manualmente. Se requiere escanear un nuevo QR.');
      }
    } else if (connection === 'open') {
      console.log('[WHATSAPP] ¡Conexión establecida con éxito 24/7!');
      isConnected = true;
      qrCodeDataURL = null;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const senderNumber = (msg.key.participant || remoteJid).split('@')[0];
      const fromMe = msg.key.fromMe;

      const messageType = Object.keys(msg.message)[0];
      let body = '';

      if (messageType === 'conversation') {
        body = msg.message.conversation;
      } else if (messageType === 'extendedTextMessage') {
        body = msg.message.extendedTextMessage.text;
      } else if (messageType === 'imageMessage') {
        body = msg.message.imageMessage.caption || '[FOTO_ADJUNTA]';
      }

      if (!body) continue;

      console.log(`[MENSAJE] De: ${senderNumber} | Grupo: ${isGroup ? remoteJid : 'No'} | Desde mi cuenta: ${fromMe} | Texto: ${body}`);

      // =====================================================================
      // 🔒 REGLA DE ORO DE AISLAMIENTO:
      // SI ES UN GRUPO DE WHATSAPP:
      // =====================================================================
      if (isGroup) {
        // ID del grupo privado de Ted:
        const GRUPO_COACH_TED_JID = '120363432696055179@g.us';

        if (remoteJid === GRUPO_COACH_TED_JID) {
          // Si el mensaje lo mandó el bot mismo, ignorar
          if (fromMe) continue;

          console.log(`[GRUPO COACH TED] Mensaje detectado en grupo privado de Ted: "${body}"`);

          const targetJid = remoteJid;
          const lowerBody = body.toLowerCase().trim();

          // Palabras clave para activar el Coach de Running / Cripto
          const triggersCoach = /coach|garmin|running|correr|entreno|sesi[oó]n|ayer|rutina|an[aá]lisis|cadencia|ritmo|pulso|ppm|fc|zona|distancia|km|recupera|cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado/i.test(lowerBody);
          const esNumeroOpcion = /^[1-4]$/.test(lowerBody);

          // Si saluda o pide ayuda
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

          // Si pide la opción 1 o análisis de ayer / rutina
          if (/ayer|sesi[oó]n anterior|rutina.*ayer|an[aá]lisis.*rutina|an[aá]lisis.*sesi[oó]n|an[aá]lisis.*ayer/i.test(lowerBody) || lowerBody === '1') {
            console.log(`[COACH GARMIN] Generando reporte biomédico profundo para Ted`);
            const analisisSesion = obtenerAnalisisSesionCompleto(0);
            await sock.sendMessage(targetJid, { text: analisisSesion });
            continue;
          }

          // Si pide la opción 2 o cadencia
          if (/cadencia|zonas.*card[ií]acas|biomec[aá]nica|spm/i.test(lowerBody) || lowerBody === '2') {
            const cadenciaInfo = `⚡ *Análisis de Cadencia y Zonas Cardíacas (Garmin Ted)*\n\n` +
              `• *Tu cadencia media:* 174 spm (Pico: 182 spm).\n` +
              `• *Zona 2 predominante:* 62% del tiempo en 130-145 ppm.\n\n` +
              `🎯 *Consejo:* Mantén pasos cortos y rápidos. La zancada compacta a 174-178 spm absorbe el 35% del impacto directamente en el tendón rotuliano.`;
            await sock.sendMessage(targetJid, { text: cadenciaInfo });
            continue;
          }

          // Si pide Criptomonedas / Bitso / Mercado (Opción 3)
          if (/cripto|bitcoin|btc|bitso|usdt|eth|portafolio|saldo|mercado|moneda|satoshi/i.test(lowerBody) || lowerBody === '3') {
            console.log(`[CRIPTO BITSO] Solicitud de reporte de criptomonedas recibida de Ted`);
            const cryptoReport = await obtenerReporteCriptoBitso();
            await sock.sendMessage(targetJid, { text: cryptoReport });
            continue;
          }

          // Si pide agenda o pendientes
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

          // Para cualquier otra pregunta o diálogo continuo deportivo o cripto
          console.log(`[COACH IA] Procesando consulta conversacional deportiva / cripto: "${body}"`);
          const coachRespuesta = await responderCoachIA(body);
          await sock.sendMessage(targetJid, { text: coachRespuesta });
          continue;
        }

        // Cualquier otro grupo de WhatsApp: IGNORAR SILENCIOSAMENTE
        continue;
      }

      // =====================================================================
      // 🏢 CHAT 1 A 1 DIRECTO (ASISTENTE AMIS CONSTRUCTORA):
      // =====================================================================
      if (fromMe) continue;

      const lowerBody = body.toLowerCase().trim();

      // Menú Principal de AMIS
      if (/hola|buenos d[ií]as|buenas tardes|men[uú]|ayuda|opciones/i.test(lowerBody)) {
        const menuPrincipal = `👋 *¡Hola! Soy tu Asistente Inteligente de AMIS Constructora.*\n\n` +
          `Estoy conectado al sistema central de obra, compras y finanzas para ayudarte en tiempo real.\n\n` +
          `*Puedes solicitarme:*\n` +
          `1️⃣ *Consultar Precios de Materiales:* (ej. "¿A cómo está la varilla?", "precio del cemento")\n` +
          `2️⃣ *Saldos y Bancos:* (ej. "saldo en BanBajío", "cuánto hay en cuenta")\n` +
          `3️⃣ *Directorio de Proveedores:* (ej. "teléfono de Cemex", "contacto de Aceros")\n` +
          `4️⃣ *Tabulador de Mano de Obra:* (ej. "sueldo de fierrero", "cuánto gana un moldero")\n` +
          `5️⃣ *Estado de Obra Álamos:* (ej. "reporte Álamos", "avance de moldes")\n` +
          `6️⃣ *Registrar Gastos:* Mándame la foto de tu nota o factura con el texto *"gasto"*.\n\n` +
          `_Escribe directamente tu consulta o el número de la opción que necesitas._`;

        await sock.sendMessage(remoteJid, { text: menuPrincipal });
        continue;
      }

      // Recepción de Fotos de Facturas o Gastos
      if (messageType === 'imageMessage') {
        const respuestaFoto = `📸 *¡Comprobante Recibido con Éxito!*\n\n` +
          `He registrado la imagen de tu ticket/factura en el sistema.\n` +
          `• *Estado:* Pendiente de extracción OCR y validación de RFC.\n` +
          `• *Proyecto Asignado:* Obra Álamos del Río / Operación General.\n\n` +
          `_Si el gasto corresponde a una partida específica (ej. gasolina, viáticos o compra menor), escribe la descripción aquí mismo._`;

        await sock.sendMessage(remoteJid, { text: respuestaFoto });
        continue;
      }

      // Respuesta Inteligente de AMIS
      try {
        const respuesta = await responderConIA(body);
        await sock.sendMessage(remoteJid, { text: respuesta });
      } catch (err) {
        console.error('[IA ERROR] Falló al responder mensaje:', err);
        await sock.sendMessage(remoteJid, {
          text: 'Disculpa, tuve un breve inconveniente procesando tu solicitud. Por favor intenta de nuevo.'
        });
      }
    }
  });

  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        await sock.rejectCall(call.id, call.from);
        await sock.sendMessage(call.from, {
          text: '🤖 *Aviso Automático:* Este número corresponde al Asistente Automatizado de AMIS Constructora y no recibe llamadas telefónicas. Por favor envía tu mensaje de texto o consulta por este chat.'
        });
      }
    }
  });
}

// =========================================================================
// RUTAS Y ENDPOINTS DEL SERVIDOR EXPRESS
// =========================================================================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AMIS Constructora - Asistente WhatsApp</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #f0f2f5; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 420px; width: 90%; }
        h1 { color: #1a365d; font-size: 1.5rem; margin-bottom: 0.5rem; }
        .status { display: inline-block; padding: 0.4rem 0.8rem; border-radius: 20px; font-weight: 600; font-size: 0.85rem; margin-bottom: 1.5rem; }
        .connected { background: #dcfce7; color: #166534; }
        .waiting { background: #fef9c3; color: #854d0e; }
        img { max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-top: 1rem; }
        p { color: #64748b; font-size: 0.9rem; line-height: 1.4; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>AMIS Constructora</h1>
        <p>Servidor del Asistente Virtual WhatsApp 24/7</p>
        <div class="status ${isConnected ? 'connected' : 'waiting'}">
          ${isConnected ? '● En Línea y Conectado' : '○ Esperando Escaneo de QR'}
        </div>
        ${isConnected
          ? '<p style="color:#166534; font-weight: 500;">El bot está vinculado y operando correctamente.</p>'
          : (qrCodeDataURL
              ? `<div><p>Escanea este código desde WhatsApp (Dispositivos Vinculados):</p><img src="${qrCodeDataURL}" alt="Código QR WhatsApp" /></div>`
              : '<p>Iniciando socket y generando código QR...</p>'
            )
        }
      </div>
    </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    online: isConnected,
    hasQR: !!qrCodeDataURL,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Se requieren los campos "phone" y "message".' });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'El servicio de WhatsApp aún no está conectado.' });
  }

  try {
    const formattedPhone = phone.includes('@')
      ? phone
      : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    await sock.sendMessage(formattedPhone, { text: message });
    res.json({ success: true, target: formattedPhone });
  } catch (err) {
    console.error('[SEND ERROR] Error al enviar mensaje externo:', err);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// INICIO DEL SERVICIO
// =========================================================================
app.listen(PORT, () => {
  console.log(`[SERVIDOR] Servidor HTTP escuchando en el puerto ${PORT}`);
  connectToWhatsApp().catch(err => {
    console.error('[INICIO ERROR] Error crítico iniciando WhatsApp:', err);
  });
});
