// Manejo global de excepciones para evitar que el contenedor muera
process.on('uncaughtException', (err) => {
  console.error('🛡️ [EXCEPCIÓN CAPTURADA]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [RECHAZO CAPTURADO]:', reason);
});

import pkg from '@whiskeysockets/baileys';
const makeWASocket = typeof pkg === 'function' ? pkg : (pkg.default || pkg.makeWASocket || pkg);
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = pkg;
import pino from 'pino';
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

// Iniciar Servidor HTTP inmediatamente para Render
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: isClientReady,
      authenticated: isClientReady,
      needsQr: !isClientReady && !!currentQrData,
      pairingCode: currentPairingCode || null,
      user: connectedUser || null
    }));
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
        .code-box { background: #0f172a; border: 2px dashed #38bdf8; border-radius: 12px; padding: 16px; margin: 16px 0; }
        .code-text { font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #38bdf8; }
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
            <div class="badge badge-qr">⚡ VINCULACIÓN DIRECTA</div>
            
            ${currentPairingCode ? `
              <div class="code-box">
                <div style="font-size:12px; color:#94a3b8; margin-bottom:6px;">CÓDIGO DE VINCULACIÓN (8 DÍGITOS):</div>
                <div class="code-text">${currentPairingCode}</div>
              </div>
            ` : ''}

            ${currentQrDataUrl ? `
              <div class="qr-box">
                <img src="${currentQrDataUrl}" alt="Código QR WhatsApp" width="220" height="220">
              </div>
            ` : ''}

            <div class="step-list">
              <strong>Cómo vincular en tu celular:</strong><br>
              1. Abre WhatsApp en tu celular (<strong>667 354 5529</strong>).<br>
              2. Ve a <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>.<br>
              3. Toca abajo: <strong>Vincular con el número de teléfono</strong>.<br>
              4. Escribe el código de 8 dígitos de arriba (o escanea el QR).
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

// Inicialización de Conexión Baileys Multi-Device
async function startWhatsAppBot() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const version = [2, 3000, 1015901307];
  console.log(`🤖 Iniciando motor Baileys v${version.join('.')} de forma instantánea...`);

  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close();
    } catch (e) {}
  }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async () => undefined,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    emitOwnEvents: false,
    fireInitQueries: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const botPhone = '526673545529';
        const code = await sock.requestPairingCode(botPhone);
        currentPairingCode = code;
        console.log('\n======================================================');
        console.log(`🔑 CÓDIGO DE VINCULACIÓN DIRECTO WHATSAPP: ${code}`);
        console.log('======================================================\n');
      } catch (err) {
        console.error('Error solicitando pairing code:', err);
      }
    }, 4000);
  }

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
          // Si es 515 (restart required), reiniciar de inmediato con las nuevas llaves
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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!messages || messages.length === 0) return;

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
        const senderNumber = remoteJid.replace(/[^0-9]/g, '');
        const authUser = getAuthorizedUser(senderNumber, config);

        const targetJid = authUser && authUser.phone 
          ? `${authUser.phone.replace(/[^0-9]/g, '').startsWith('52') ? authUser.phone.replace(/[^0-9]/g, '') : '521' + authUser.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`
          : remoteJid;

        // Mensaje de bienvenida para público general no registrado
        if (!authUser) {
          console.log(`[PÚBLICO] Contacto no registrado: +${senderNumber} ("${body}") -> Enviando a ${targetJid}`);
          await sock.sendMessage(targetJid, { text: config.public_greeting });
          continue;
        }

        const lowerBody = body.toLowerCase();
        const isReset = ['menu', 'menú', 'inicio', 'cancelar', 'salir', 'ayuda'].includes(lowerBody);
        const userState = userSessions[remoteJid] || { state: 'IDLE' };

        if (isReset) {
          userSessions[remoteJid] = { state: 'IDLE', updatedAt: Date.now() };
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
          const selectedOpt = config.options.find(o => o.id === choiceDigit || o.id === body);
          if (selectedOpt) {
            if (selectedOpt.allowed_roles && !selectedOpt.allowed_roles.includes(authUser.role)) {
              const deniedMsg = `⛔ *Opción no disponible para su perfil.*\n\nEl módulo de *${selectedOpt.title}* es de acceso restringido.\n\nEscriba *menu* para ver sus opciones disponibles.`;
              await sock.sendMessage(targetJid, { text: deniedMsg });
              continue;
            }

            if (selectedOpt.code === 'ATTENDANCE') {
              userSessions[remoteJid] = { state: 'ATTENDANCE_MENU', updatedAt: Date.now() };
              saveSessions();
              await sock.sendMessage(targetJid, { text: selectedOpt.prompt });
              continue;
            }

            userSessions[remoteJid] = { state: selectedOpt.code, optionId: selectedOpt.id, updatedAt: Date.now() };
            saveSessions();
            await sock.sendMessage(targetJid, { text: selectedOpt.prompt });
            continue;
          }

          // Si no es un número de opción, va directo al Cerebro / Asistente Ejecutivo
          console.log(`[AI] Generando respuesta para ${authUser.name}...`);
          const replyText = await generateConversationalReply(body, authUser, null);
          console.log(`[AI RESPUESTA] Enviando a ${targetJid}:\n${replyText}`);
          await sock.sendMessage(targetJid, { text: replyText });
          continue;
        }

        // Submenú de Asistencias y Personal
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

        // Procesar envío de texto u operación y regresar a IDLE
        userSessions[remoteJid] = { state: 'IDLE', updatedAt: Date.now() };
        saveSessions();
        await sock.sendMessage(targetJid, { text: `✅ *Información Recibida y Asentada con Éxito*\n\n_Escribe *menu* para ver el menú principal._` });

      } catch (err) {
        console.error('Error procesando mensaje Baileys:', err);
      }
    }
  });
}

startWhatsAppBot();

