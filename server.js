// G:\Mi unidad\Antigravity_Laboratorio\integraciones\whatsapp_cloud_server\server.js
// Servidor en la Nube 24/7 · AMIS CONSTRUCTORA & Cerebro Antigravity

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { generateConversationalReply } from './asistente_conversacional.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;
const CONFIG_PATH = path.join(__dirname, 'menu_config.json');
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || 
  (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') 
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' 
    : undefined);

let currentQrData = null;
let currentQrDataUrl = null;
let isClientReady = false;
let clientInfo = null;
const processedMsgIds = new Set();

const SESSIONS_FILE = path.join(__dirname, 'active_user_sessions.json');
let userSessions = {};
if (fs.existsSync(SESSIONS_FILE)) {
  try { userSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) {}
}

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(userSessions, null, 2), 'utf8'); } catch (e) {}
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

// Configuración de Cliente WhatsApp optimizado para 512MB RAM en Render Free Tier
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--mute-audio',
      '--hide-scrollbars',
      '--disable-notifications',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-renderer-backgrounding',
      '--memory-pressure-off',
      '--js-flags=--max-old-space-size=160'
    ]
  }
});

client.on('qr', async (qr) => {
  currentQrData = qr;
  try {
    currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
  } catch (e) {}

  console.log('\n======================================================');
  console.log('⚡ ESCANEA ESTE CÓDIGO QR EN WHATSAPP (Dispositivos Vinculados):');
  console.log('======================================================\n');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('✅ Autenticación exitosa en WhatsApp Web.');
  currentQrData = null;
  currentQrDataUrl = null;
});

client.on('ready', () => {
  isClientReady = true;
  clientInfo = client.info;
  console.log('\n======================================================');
  console.log('🤖 AMIS CONSTRUCTORA · SERVIDOR 24/7 EN LA NUBE ACTIVO');
  console.log('======================================================');
  console.log(`🟢 Línea Conectada: +${client.info?.wid?.user}`);
});

client.on('message_create', async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast') return;

    const msgId = msg.id ? msg.id._serialized : null;
    if (msgId) {
      if (processedMsgIds.has(msgId)) return;
      processedMsgIds.add(msgId);
      if (processedMsgIds.size > 2000) processedMsgIds.clear();
    }

    const senderId = msg.from;
    const body = (msg.body || '').trim();
    console.log(`[WHATSAPP ENTRADA] De: ${senderId} | Texto: "${body}" | Media: ${msg.hasMedia}`);

    const config = loadConfig();
    let senderNumber = '';
    try {
      const contact = await msg.getContact();
      senderNumber = contact.number || senderId.replace(/[^0-9]/g, '');
    } catch (e) {
      senderNumber = senderId.replace(/[^0-9]/g, '');
    }

    const authUser = getAuthorizedUser(senderNumber, config);

    // Mensaje de público si no es usuario registrado
    if (!authUser) {
      console.log(`[PÚBLICO] Contacto no registrado: +${senderNumber} ("${body}")`);
      await client.sendMessage(senderId, config.public_greeting);
      return;
    }

    const lowerBody = body.toLowerCase();
    const isReset = ['menu', 'menú', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);
    const userState = userSessions[senderId] || { state: 'IDLE' };

    if (isReset) {
      userSessions[senderId] = { state: 'IDLE', updatedAt: Date.now() };
      saveSessions();
      const menuText = buildMainMenu(authUser, config);
      await client.sendMessage(senderId, menuText);
      return;
    }

    const extractDigit = (str) => {
      const match = str.match(/^[#*]*([0-9]+)/) || str.match(/([0-9]+)/);
      return match ? match[1] : null;
    };
    const choiceDigit = extractDigit(body);

    if (userState.state === 'IDLE') {
      const selectedOpt = config.options.find(o => o.id === choiceDigit || o.id === body);
      if (selectedOpt) {
        if (selectedOpt.allowed_roles && !selectedOpt.allowed_roles.includes(authUser.role)) {
          const deniedMsg = `⛔ *Opción no disponible para su perfil.*\n\nEl módulo de *${selectedOpt.title}* es de acceso restringido.\n\nEscriba *menu* para ver sus opciones disponibles.`;
          await client.sendMessage(senderId, deniedMsg);
          return;
        }

        if (selectedOpt.code === 'ATTENDANCE') {
          userSessions[senderId] = { state: 'ATTENDANCE_MENU', updatedAt: Date.now() };
          saveSessions();
          await client.sendMessage(senderId, selectedOpt.prompt);
          return;
        }

        userSessions[senderId] = { state: selectedOpt.code, optionId: selectedOpt.id, updatedAt: Date.now() };
        saveSessions();
        await client.sendMessage(senderId, selectedOpt.prompt);
        return;
      }

      // Si no es un número de opción, va directo al Cerebro IA
      let idleMedia = null;
      if (msg.hasMedia) {
        try { idleMedia = await msg.downloadMedia(); } catch (e) {}
      }
      const aiReply = await generateConversationalReply(body, authUser, idleMedia);
      await client.sendMessage(senderId, aiReply);
      return;
    }

    // Submenús y operaciones estándar
    if (userState.state === 'ATTENDANCE_MENU') {
      if (choiceDigit === '1') {
        userSessions[senderId] = { state: 'ATTENDANCE_DAILY', updatedAt: Date.now() };
        saveSessions();
        await client.sendMessage(senderId, `📸 *Lista de Asistencia Diaria*\n\nPor favor adjunta la *foto de la lista de raya firmada* o escribe el conteo de personal presente hoy (ej: _'14 presentes en obra Álamos'_).\n\n_Escribe *menu* para cancelar._`);
        return;
      } else if (choiceDigit === '2') {
        userSessions[senderId] = { state: 'ATTENDANCE_ABSENCE', updatedAt: Date.now() };
        saveSessions();
        await client.sendMessage(senderId, `❌ *Reporte de Faltas / Bajas*\n\nPor favor escribe el *nombre del trabajador, puesto y motivo de falta o baja* (ej: _'Faltó Juan Pérez - Fierrero - Falta injustificada'_).\n\n_Escribe *menu* para cancelar._`);
        return;
      } else if (choiceDigit === '3') {
        userSessions[senderId] = { state: 'ATTENDANCE_HIRE', updatedAt: Date.now() };
        saveSessions();
        await client.sendMessage(senderId, `🆕 *Registro de Nuevo Ingreso / Alta*\n\nPor favor escribe los *datos del nuevo trabajador* (Nombre completo, Puesto y Fecha de ingreso. Ej: _'Pedro López - Albañil - Ingresa hoy 09/Oct'_).\n\n_Escribe *menu* para cancelar._`);
        return;
      }
    }

    // Procesar envío de texto u operación y regresar a IDLE
    userSessions[senderId] = { state: 'IDLE', updatedAt: Date.now() };
    saveSessions();
    await client.sendMessage(senderId, `✅ *Información Recibida y Asentada con Éxito*\n\n_Escribe *menu* para ver el menú principal._`);

  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
});

// Servidor Web para Monitoreo y Código QR Visual
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: isClientReady,
      authenticated: !currentQrData,
      needsQr: !!currentQrData,
      user: clientInfo?.wid?.user || null
    }));
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
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 40px 20px; }
        .card { max-width: 480px; margin: 0 auto; background: #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
        h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
        p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 13px; margin-bottom: 24px; }
        .badge-online { background: #065f46; color: #34d399; }
        .badge-qr { background: #854d0e; color: #facc15; }
        .qr-box { background: white; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 20px; }
        img { display: block; max-width: 100%; height: auto; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🏢 Torre de Control AMIS</h1>
        <p>Servidor 24/7 de WhatsApp y Cerebro Antigravity</p>
        ${isClientReady ? `
          <div class="badge badge-online">🟢 SERVIDOR 100% EN LÍNEA</div>
          <p style="color:#e2e8f0; font-size:16px;">Conectado a la línea: <strong>+${clientInfo?.wid?.user || '5216673545529'}</strong></p>
          <p style="color:#64748b; font-size:12px;">Escuchando mensajes y asistencias día y noche.</p>
        ` : (currentQrDataUrl ? `
          <div class="badge badge-qr">⚡ ESCANEA PARA VINCULAR</div>
          <div class="qr-box">
            <img src="${currentQrDataUrl}" alt="Código QR WhatsApp" width="280" height="280">
          </div>
          <p style="color:#cbd5e1;">Abre WhatsApp en tu teléfono → Dispositivos vinculados → Escanear.</p>
          <script>setTimeout(() => location.reload(), 8000);</script>
        ` : `
          <div class="badge badge-qr">⏳ INICIALIZANDO SESIÓN...</div>
          <p>Cargando navegador y credenciales...</p>
          <script>setTimeout(() => location.reload(), 3000);</script>
        `)}
      </div>
    </body>
    </html>
  `);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Servidor HTTP activo en 0.0.0.0:${PORT}`);
});

client.initialize();
